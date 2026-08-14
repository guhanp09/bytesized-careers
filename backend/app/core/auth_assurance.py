from __future__ import annotations

from datetime import UTC, datetime, timedelta

STRONG_AUTH_METHODS: frozenset[str] = frozenset(
    {
        "recovery_code",
        "totp",
        "webauthn",
    }
)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def has_fresh_strong_auth(
    *,
    method: str | None,
    verified_at: datetime | None,
    expires_at: datetime | None,
    max_age_minutes: int,
    now: datetime | None = None,
) -> bool:
    """Accept only a supported, current, policy-bounded second-factor proof."""

    if (
        method not in STRONG_AUTH_METHODS
        or verified_at is None
        or expires_at is None
    ):
        return False

    checked_at = now or datetime.now(UTC)
    checked_at = _as_utc(checked_at)
    verified = _as_utc(verified_at)
    stored_expiry = _as_utc(expires_at)
    policy_expiry = verified + timedelta(minutes=max_age_minutes)

    return verified <= checked_at < min(stored_expiry, policy_expiry)
