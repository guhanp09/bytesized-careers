"""The thing that looks at imports nobody is looking at.

The read-time staleness assessment settles a stranded row when someone reads it,
which serves the recruiter who comes back and refreshes. It cannot serve the one
who does not — and that row stays marked `processing` for as long as the database
exists, describing work that stopped happening.

This sweep is deliberately narrow, and the narrowness is the design:

**It never calls the provider.** It settles a stranded attempt into a truthful
failed state and schedules when it may be tried again; it does not try again
itself. Re-running an import unattended would spend money on behalf of someone
who is not there to see the result, and would hand them a draft they did not ask
for on their next visit. The recruiter — or their next request — decides whether
to spend again.

That also settles the kill-switch question by construction. An incident switch
has to stop provider work already in the queue, not merely stop new work from
being enqueued. Since this sweep invokes no provider, it stays safe to run while
the switch is off, and running it then is actively useful: rows stop claiming to
be in progress even while the feature is paused.

The session factory is injected rather than imported. A worker that reaches for
the configured engine itself cannot be pointed at a disposable database by a
test, and that is exactly how a test once wrote a row into dev.db.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.job_import_execution_repository import (
    claim_stranded_drafts,
    settle_as_failed,
)

logger = logging.getLogger(__name__)

#: Imports are far rarer than emails, and a stranded one is already minutes old
#: by the time its lease lapses. Sweeping every half minute is responsive enough
#: and costs one indexed query.
DEFAULT_INTERVAL_SECONDS = 30.0

#: Small: every row in a batch is a row that already went wrong, and taking a
#: hundred of them in one transaction only makes the failure larger.
DEFAULT_BATCH = 5


@dataclass
class SweepResult:
    """What one pass did, for logging and for tests."""

    claimed: int = 0
    settled: int = 0
    retry_scheduled: int = 0
    exhausted: int = 0


async def sweep_stranded_imports_once(
    session: AsyncSession,
    *,
    worker_id: str | None = None,
    limit: int = DEFAULT_BATCH,
    now: datetime | None = None,
) -> SweepResult:
    """Settle every import whose worker went away, and say when to retry.

    One pass, no loop and no sleep, so the caller owns scheduling: a worker
    calls this on a timer, a test calls it once and asserts.
    """

    moment = now or datetime.now(UTC)
    identity = worker_id or f"import-sweeper-{uuid.uuid4().hex[:12]}"
    result = SweepResult()

    stranded = await claim_stranded_drafts(
        session, worker_id=identity, limit=limit, now=moment
    )
    result.claimed = len(stranded)

    for draft in stranded:
        next_attempt_at = await settle_as_failed(
            session, draft.id, now=moment, worker_id=identity
        )
        result.settled += 1
        if next_attempt_at is None:
            result.exhausted += 1
        else:
            result.retry_scheduled += 1

    if result.claimed:
        logger.info(
            "job_import_sweep",
            extra={
                "worker": identity,
                "claimed": result.claimed,
                "settled": result.settled,
                "retry_scheduled": result.retry_scheduled,
                "exhausted": result.exhausted,
            },
        )
    return result


async def run_import_sweeper_forever(
    session_factory: Callable[[], AsyncSession],
    *,
    interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
    limit: int = DEFAULT_BATCH,
    stop: asyncio.Event | None = None,
    worker_id: str | None = None,
) -> None:
    """Run the sweep until asked to stop.

    A fresh session per pass, because a long-lived one holds a transaction open
    across the sleep and turns an idle sweeper into a lock holder. A pass that
    raises is logged and the loop continues: the rows are unharmed, since an
    unfinished lease lapses on its own, and a loop that dies on one bad row is
    the failure this whole mechanism exists to prevent.
    """

    signal = stop or asyncio.Event()
    identity = worker_id or f"import-sweeper-{uuid.uuid4().hex[:12]}"
    logger.info(
        "job_import_sweeper_started",
        extra={"worker": identity, "interval": interval_seconds},
    )

    while not signal.is_set():
        try:
            async with session_factory() as session:
                await sweep_stranded_imports_once(
                    session, worker_id=identity, limit=limit
                )
                await session.commit()
        except Exception:  # noqa: BLE001 - one bad pass must not end the sweeper
            logger.exception("job_import_sweep_failed", extra={"worker": identity})

        # Waited on rather than slept through, so stopping costs the pass in
        # flight rather than a whole interval.
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(signal.wait(), timeout=interval_seconds)

    logger.info("job_import_sweeper_stopped", extra={"worker": identity})


async def _main() -> None:  # pragma: no cover - process entrypoint
    """Run the sweep as its own process.

    Preferred over hosting it in the API: a sweeper that shares a lifetime with
    the web server also shares its restarts, and the rows it exists to rescue
    are created by exactly those restarts.
    """

    from app.core.config import settings
    from app.db.session import SessionLocal

    logging.basicConfig(level=logging.INFO)
    await run_import_sweeper_forever(
        SessionLocal,
        interval_seconds=float(settings.job_import_sweeper_interval_seconds),
    )


if __name__ == "__main__":  # pragma: no cover - process entrypoint
    asyncio.run(_main())
