from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_]{2,19}$")
USERNAME_COOLDOWN_DAYS = 30
USERNAME_MAX_CHANGES = 2

DEFAULT_PRIVACY_SETTINGS: dict[str, bool] = {
    "show_bio": True,
    "show_links": True,
    "show_skills": True,
    "show_location": False,
    "show_availability": False,
    "show_youtube_badge": True,
}


def normalize_username(value: str) -> str:
    return value.strip().lower()


def validate_username_format(value: str) -> bool:
    return bool(USERNAME_RE.fullmatch(value))


def can_change_username(
    *,
    username_change_count: int,
    username_last_changed_at: datetime | None,
    now: datetime | None = None,
) -> tuple[bool, datetime | None]:
    if username_change_count >= USERNAME_MAX_CHANGES:
        return False, None

    if username_last_changed_at is None:
        return True, None

    current_time = now or datetime.now(UTC)
    last_changed = username_last_changed_at
    if last_changed.tzinfo is None:
        last_changed = last_changed.replace(tzinfo=UTC)
    next_change_at = last_changed + timedelta(days=USERNAME_COOLDOWN_DAYS)
    return current_time >= next_change_at, next_change_at
