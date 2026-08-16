"""Reading and writing which email categories a person has refused."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification_preference import NotificationOptOut


async def opted_out_categories(
    session: AsyncSession, user_id: uuid.UUID | None
) -> frozenset[str]:
    """What this person has refused. An unknown user has refused nothing.

    Mail addressed to someone with no account — an invitation, for instance —
    has no preferences to consult, and treating that as "refused everything"
    would silently stop the one message that matters most.
    """

    if user_id is None:
        return frozenset()

    rows = await session.execute(
        select(NotificationOptOut.category).where(NotificationOptOut.user_id == user_id)
    )
    return frozenset(rows.scalars().all())


async def record_opt_out(
    session: AsyncSession, *, user_id: uuid.UUID, category: str
) -> None:
    """Refuse a category, idempotently.

    An unsubscribe link gets clicked twice, prefetched by a mail client, and
    followed by a scanner. Every one of those must mean the same thing.
    """

    dialect = session.bind.dialect.name if session.bind is not None else ""
    insert = postgresql_insert if dialect == "postgresql" else sqlite_insert
    await session.execute(
        insert(NotificationOptOut)
        .values(id=uuid.uuid4(), user_id=user_id, category=category)
        .on_conflict_do_nothing(index_elements=["user_id", "category"])
    )


async def clear_opt_out(
    session: AsyncSession, *, user_id: uuid.UUID, category: str
) -> None:
    """Subscribe again by removing the refusal."""

    await session.execute(
        delete(NotificationOptOut)
        .where(NotificationOptOut.user_id == user_id)
        .where(NotificationOptOut.category == category)
    )
