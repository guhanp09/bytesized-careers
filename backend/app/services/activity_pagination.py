"""Deterministic, bounded pagination for the applications workspace.

The workspace is one timeline assembled from two relationship tables and four
viewer-relative directions.  Paginating each response array independently
would make "newest activity" depend on which array the client happened to read
first, so this module builds one key-only union and pages that union before any
of the comparatively wide relationship/context rows are loaded.

Cursors are opaque transport state, not authorization.  Every source query is
still scoped to the authenticated user, including the optional deep-link
anchor.  A modified cursor can therefore change where that user reads their own
timeline, but can never select another user's row.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import String, and_, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import JobApplication, TalentInterest

ActivityMode = Literal["all", "talent", "hiring"]
ActivitySource = Literal[
    "sent_application",
    "received_application",
    "sent_interest",
    "received_interest",
]

DEFAULT_ACTIVITY_PAGE_LIMIT = 100
MAX_ACTIVITY_PAGE_LIMIT = 200
ACTIVITY_CONTEXT_LIMIT = 100

SOURCE_RANK: dict[ActivitySource, int] = {
    # Keep equal-timestamp ordering aligned with mapActivityToOwnerInteractions,
    # whose stable client sort encounters the arrays in this same order.
    "sent_application": 0,
    "received_application": 1,
    "sent_interest": 2,
    "received_interest": 3,
}
MODE_SOURCES: dict[ActivityMode, tuple[ActivitySource, ...]] = {
    "all": tuple(SOURCE_RANK),
    "talent": ("sent_application", "received_interest"),
    "hiring": ("received_application", "sent_interest"),
}

_CURSOR_VERSION = 1
_CURSOR_CHARS = re.compile(r"^[A-Za-z0-9_-]+$")
_CURSOR_KEYS = {"v", "mode", "snapshot", "at", "source", "id"}


class InvalidActivityCursor(ValueError):
    """The cursor is malformed or belongs to a different feed scope."""


@dataclass(frozen=True, slots=True)
class ActivityCursor:
    mode: ActivityMode
    snapshot_at: datetime
    sort_at: datetime
    source: ActivitySource
    record_id: UUID


@dataclass(frozen=True, slots=True)
class ActivityPageKey:
    source: ActivitySource
    record_id: UUID
    sort_at: datetime


@dataclass(frozen=True, slots=True)
class ActivityPage:
    keys: tuple[ActivityPageKey, ...]
    counts: dict[ActivitySource, int]
    total: int
    limit: int
    has_more: bool
    next_cursor: str | None
    snapshot_at: datetime


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _timestamp(value: datetime) -> str:
    return _aware_utc(value).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _parse_timestamp(value: object) -> datetime:
    if not isinstance(value, str) or len(value) > 40:
        raise InvalidActivityCursor
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidActivityCursor from exc
    if parsed.tzinfo is None:
        raise InvalidActivityCursor
    return parsed.astimezone(UTC)


def encode_activity_cursor(cursor: ActivityCursor) -> str:
    payload = {
        "v": _CURSOR_VERSION,
        "mode": cursor.mode,
        "snapshot": _timestamp(cursor.snapshot_at),
        "at": _timestamp(cursor.sort_at),
        "source": cursor.source,
        "id": str(cursor.record_id),
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


def decode_activity_cursor(raw: str, *, expected_mode: ActivityMode) -> ActivityCursor:
    if not raw or len(raw) > 1024 or _CURSOR_CHARS.fullmatch(raw) is None:
        raise InvalidActivityCursor
    try:
        padded = raw + "=" * (-len(raw) % 4)
        decoded = base64.b64decode(padded, altchars=b"-_", validate=True)
        if len(decoded) > 512:
            raise InvalidActivityCursor
        payload = json.loads(decoded)
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InvalidActivityCursor from exc
    if not isinstance(payload, dict) or set(payload) != _CURSOR_KEYS:
        raise InvalidActivityCursor
    if payload["v"] != _CURSOR_VERSION or payload["mode"] != expected_mode:
        raise InvalidActivityCursor
    source = payload["source"]
    if source not in SOURCE_RANK or source not in MODE_SOURCES[expected_mode]:
        raise InvalidActivityCursor
    raw_id = payload["id"]
    if not isinstance(raw_id, str):
        raise InvalidActivityCursor
    try:
        record_id = UUID(raw_id)
    except ValueError as exc:
        raise InvalidActivityCursor from exc
    if str(record_id) != raw_id.lower():
        raise InvalidActivityCursor
    snapshot_at = _parse_timestamp(payload["snapshot"])
    sort_at = _parse_timestamp(payload["at"])
    if sort_at > snapshot_at:
        raise InvalidActivityCursor
    return ActivityCursor(
        mode=expected_mode,
        snapshot_at=snapshot_at,
        sort_at=sort_at,
        source=source,
        record_id=record_id,
    )


def _source_select(
    source: ActivitySource,
    *,
    user_id: UUID,
    snapshot_at: datetime,
) -> object:
    if source == "sent_application":
        model = JobApplication
        ownership = JobApplication.applicant_user_id == user_id
    elif source == "received_application":
        model = JobApplication
        ownership = JobApplication.job_owner_user_id == user_id
    elif source == "sent_interest":
        model = TalentInterest
        ownership = TalentInterest.recruiter_user_id == user_id
    else:
        model = TalentInterest
        ownership = TalentInterest.owner_user_id == user_id
    return select(
        literal(source, type_=String(32)).label("source"),
        literal(SOURCE_RANK[source]).label("source_rank"),
        model.id.label("record_id"),
        model.updated_at.label("sort_at"),
    ).where(ownership, model.updated_at <= snapshot_at)


def _feed(*, user_id: UUID, mode: ActivityMode, snapshot_at: datetime):
    return union_all(
        *(
            _source_select(source, user_id=user_id, snapshot_at=snapshot_at)
            for source in MODE_SOURCES[mode]
        )
    ).subquery("activity_feed")


async def _activity_counts(
    session: AsyncSession,
    *,
    user_id: UUID,
    snapshot_at: datetime,
) -> dict[ActivitySource, int]:
    statements = {
        "sent_application": select(func.count(JobApplication.id)).where(
            JobApplication.applicant_user_id == user_id,
            JobApplication.updated_at <= snapshot_at,
        ),
        "received_application": select(func.count(JobApplication.id)).where(
            JobApplication.job_owner_user_id == user_id,
            JobApplication.updated_at <= snapshot_at,
        ),
        "sent_interest": select(func.count(TalentInterest.id)).where(
            TalentInterest.recruiter_user_id == user_id,
            TalentInterest.updated_at <= snapshot_at,
        ),
        "received_interest": select(func.count(TalentInterest.id)).where(
            TalentInterest.owner_user_id == user_id,
            TalentInterest.updated_at <= snapshot_at,
        ),
    }
    row = (
        await session.execute(
            select(
                *(
                    statement.scalar_subquery().label(source)
                    for source, statement in statements.items()
                )
            )
        )
    ).one()
    return {source: int(row._mapping[source]) for source in SOURCE_RANK}


async def load_activity_page(
    session: AsyncSession,
    *,
    user_id: UUID,
    mode: ActivityMode,
    limit: int,
    cursor: str | None,
    include_id: UUID | None,
) -> ActivityPage:
    decoded = decode_activity_cursor(cursor, expected_mode=mode) if cursor else None
    snapshot_at = decoded.snapshot_at if decoded else datetime.now(UTC)
    feed = _feed(user_id=user_id, mode=mode, snapshot_at=snapshot_at)
    statement = select(
        feed.c.source,
        feed.c.source_rank,
        feed.c.record_id,
        feed.c.sort_at,
    )
    if decoded is not None:
        cursor_rank = SOURCE_RANK[decoded.source]
        statement = statement.where(
            or_(
                feed.c.sort_at < decoded.sort_at,
                and_(
                    feed.c.sort_at == decoded.sort_at,
                    feed.c.source_rank > cursor_rank,
                ),
                and_(
                    feed.c.sort_at == decoded.sort_at,
                    feed.c.source_rank == cursor_rank,
                    feed.c.record_id < decoded.record_id,
                ),
            )
        )
    rows = (
        await session.execute(
            statement.order_by(
                feed.c.sort_at.desc(),
                feed.c.source_rank.asc(),
                feed.c.record_id.desc(),
            ).limit(limit + 1)
        )
    ).all()
    has_more = len(rows) > limit
    page_rows = list(rows[:limit])

    # A notification/deep link can point beyond page one. Include that one
    # owned row additively, while leaving the ordinary cursor anchored to the
    # last chronological row so subsequent pages remain complete and stable.
    if decoded is None and include_id is not None and not any(
        row.record_id == include_id for row in page_rows
    ):
        anchor = (
            await session.execute(
                select(
                    feed.c.source,
                    feed.c.source_rank,
                    feed.c.record_id,
                    feed.c.sort_at,
                )
                .where(feed.c.record_id == include_id)
                .order_by(feed.c.source_rank.asc())
                .limit(1)
            )
        ).one_or_none()
        if anchor is not None:
            page_rows.append(anchor)

    keys = tuple(
        ActivityPageKey(
            source=row.source,
            record_id=row.record_id,
            sort_at=_aware_utc(row.sort_at),
        )
        for row in page_rows
    )
    next_cursor = None
    if has_more and rows:
        last = rows[limit - 1]
        next_cursor = encode_activity_cursor(
            ActivityCursor(
                mode=mode,
                snapshot_at=snapshot_at,
                sort_at=_aware_utc(last.sort_at),
                source=last.source,
                record_id=last.record_id,
            )
        )
    counts = await _activity_counts(
        session,
        user_id=user_id,
        snapshot_at=snapshot_at,
    )
    total = sum(counts[source] for source in MODE_SOURCES[mode])
    return ActivityPage(
        keys=keys,
        counts=counts,
        total=total,
        limit=limit,
        has_more=has_more,
        next_cursor=next_cursor,
        snapshot_at=snapshot_at,
    )
