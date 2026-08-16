"""The loop that actually delivers what the outbox promised.

Until now nothing did. `queue_notification_email` wrote durable rows and
`_process_outbox_row` existed with no production caller, so every notification
email was recorded as intended and never sent. That is a safe failure — better
than sending twice — but it is still a queue that does not drain.

This is the piece in the middle: claim, ask the provider, record what it said.
It holds no state of its own. Everything that decides what happens next lives on
the row, which is what lets a second worker pick up where a dead one stopped and
what makes the whole thing testable without a scheduler.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.provider import EmailProvider, ProviderOutcome
from app.repositories.email_outbox_delivery import (
    mark_retryable_failure,
    mark_sent,
    mark_suppressed,
    mark_terminal_failure,
)
from app.repositories.email_outbox_repository import claim_due_emails

logger = logging.getLogger(__name__)


@dataclass
class DeliveryRun:
    """What one pass of the loop did, for logging and for tests."""

    claimed: int = 0
    sent: int = 0
    retrying: int = 0
    failed: int = 0
    suppressed: int = 0


async def process_outbox_once(
    session: AsyncSession,
    *,
    provider: EmailProvider,
    worker_id: str | None = None,
    limit: int = 10,
    now: datetime | None = None,
) -> DeliveryRun:
    """Claim a batch, attempt each one, and record the outcome.

    One pass rather than a loop, so the caller owns scheduling. A worker process
    calls this on a timer; a test calls it once and asserts. Nothing here sleeps
    or retries internally — the retry schedule is on the row, so "try again
    later" means exactly "leave it for a later pass".

    A provider that raises rather than returning a result is treated as a
    retryable failure. Losing the row to an unhandled exception would strand it
    until its lease expired, and an exception from a network client is precisely
    the transient case retries exist for.
    """

    identity = worker_id or f"worker-{uuid.uuid4().hex[:12]}"
    run = DeliveryRun()

    claimed = await claim_due_emails(session, worker_id=identity, limit=limit, now=now)
    run.claimed = len(claimed)

    for row in claimed:
        row_id = row.id
        try:
            result = await provider.send(row)
        except Exception as exc:  # noqa: BLE001 - any provider fault is a delivery fault
            logger.warning(
                "notification_email_provider_raised",
                extra={"event_key": row.event_key, "error": type(exc).__name__},
            )
            if await mark_retryable_failure(session, row_id, error=str(exc), now=now):
                run.retrying += 1
            else:
                run.failed += 1
            continue

        if result.outcome is ProviderOutcome.SENT:
            await mark_sent(session, row_id, provider_message_id=result.message_id, now=now)
            run.sent += 1
        elif result.outcome is ProviderOutcome.RETRYABLE:
            if await mark_retryable_failure(session, row_id, error=result.detail, now=now):
                run.retrying += 1
            else:
                run.failed += 1
        elif result.outcome is ProviderOutcome.SUPPRESSED:
            await mark_suppressed(session, row_id, reason=result.detail, now=now)
            run.suppressed += 1
        else:
            await mark_terminal_failure(session, row_id, error=result.detail, now=now)
            run.failed += 1

    if run.claimed:
        logger.info(
            "notification_email_run",
            extra={
                "worker": identity,
                "claimed": run.claimed,
                "sent": run.sent,
                "retrying": run.retrying,
                "failed": run.failed,
                "suppressed": run.suppressed,
            },
        )
    return run
