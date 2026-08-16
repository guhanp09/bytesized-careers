"""Something has to actually run the worker.

`process_outbox_once` deliberately does one pass and no scheduling, which makes
it testable but also makes it inert: a queue with nothing calling it is a queue
that does not drain, and every email is recorded as intended and never sent.

This is the smallest thing that fixes that — a loop, a session per pass, and a
stop signal. It owns no delivery logic of its own, so everything about what
happens to a row still lives on the row.

Run it as its own process:

    python -m app.notifications.runner

or let the API host it in-process by setting EMAIL_WORKER_IN_PROCESS=true, which
is how local development gets mail without a second terminal. In production a
separate process is preferable: a worker that shares a lifetime with the web
server stops whenever the web server does, including during a deploy.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.notifications.email import real_delivery_enabled
from app.notifications.provider import EmailProvider, MockEmailProvider, SmtpEmailProvider

logger = logging.getLogger(__name__)

#: Long enough that an idle queue is not a busy poll, short enough that a person
#: waiting on a password reset does not notice the difference.
DEFAULT_INTERVAL_SECONDS = 5.0

DEFAULT_BATCH = 20


def build_provider() -> EmailProvider:
    """Real delivery only when it has been switched on explicitly.

    The mock is the default everywhere, including production, so an
    incompletely configured deployment records mail rather than half-sending it.
    """

    if real_delivery_enabled():
        return SmtpEmailProvider()
    return MockEmailProvider()


async def run_worker_forever(
    session_factory: Callable[[], AsyncSession],
    *,
    provider: EmailProvider | None = None,
    interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
    batch: int = DEFAULT_BATCH,
    stop: asyncio.Event | None = None,
    worker_id: str | None = None,
) -> None:
    """Drain the outbox until asked to stop.

    A fresh session per pass, because a long-lived one holds a transaction open
    across the sleep and turns an idle worker into a lock holder.

    A pass that raises is logged and the loop continues. The alternative — the
    loop dying on one bad row — is the failure that queues exist to prevent, and
    the rows themselves are unharmed: an unfinished lease lapses on its own.
    """

    # Imported here so that importing this module does not pull the worker's
    # dependencies into the API process before it decides to run one.
    from app.notifications.worker import process_outbox_once

    identity = worker_id or f"worker-{uuid.uuid4().hex[:12]}"
    signal = stop or asyncio.Event()
    sender = provider or build_provider()
    logger.info("email_worker_started", extra={"worker": identity, "interval": interval_seconds})

    while not signal.is_set():
        try:
            async with session_factory() as session:
                await process_outbox_once(
                    session, provider=sender, worker_id=identity, limit=batch
                )
                await session.commit()
        except Exception:  # noqa: BLE001 - one bad pass must not end the worker
            logger.exception("email_worker_pass_failed", extra={"worker": identity})

        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(signal.wait(), timeout=interval_seconds)

    logger.info("email_worker_stopped", extra={"worker": identity})


async def _main() -> None:  # pragma: no cover - process entrypoint
    from app.db.session import SessionLocal

    logging.basicConfig(level=logging.INFO)
    await run_worker_forever(
        SessionLocal,
        interval_seconds=float(settings.email_worker_interval_seconds),
    )


if __name__ == "__main__":  # pragma: no cover - process entrypoint
    asyncio.run(_main())
