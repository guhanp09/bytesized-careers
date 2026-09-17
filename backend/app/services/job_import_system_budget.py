"""Conservative deployment-wide admission budget; no provider prices assumed."""

from fastapi import HTTPException

from app.core.config import settings
from app.core.rate_limit import RateLimitRule, enforce_rate_limit
from app.services.job_import_service import JobImportError

SYSTEM_ATTEMPT_WINDOW_SECONDS = 30 * 24 * 60 * 60


async def reserve_system_import_attempt() -> None:
    """Reserve before committing a user's attempt, never refund uncertain work.

    The fixed namespace follows no user, draft, process, or configured limit.
    Restarting a process or lowering a limit therefore cannot reset Redis history.
    The shared limiter owns atomicity, bounded I/O, and fail-closed behavior.
    One unit permits one extraction with its already-bounded internal retries.
    """
    try:
        await enforce_rate_limit(
            key="system",
            rule=RateLimitRule(
                "job_import_system_attempts_v1",
                limit=settings.job_import_system_attempt_limit,
                window_seconds=SYSTEM_ATTEMPT_WINDOW_SECONDS,
            ),
        )
    except HTTPException as exc:
        if exc.status_code == 429:
            raise JobImportError(
                "JOB_IMPORT_SYSTEM_BUDGET_EXHAUSTED",
                "AI draft preparation has reached its shared allowance. "
                "Your source is saved; you can still post a job manually.",
                status_code=429,
            ) from exc
        raise JobImportError(
            "JOB_IMPORT_SYSTEM_BUDGET_UNAVAILABLE",
            "AI draft preparation safeguards are temporarily unavailable. "
            "Your source is saved; please try again later.",
            status_code=503,
        ) from exc
