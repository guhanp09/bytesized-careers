"""Backend-authoritative user-to-user interaction blocks.

Blocking is intentionally separate from moderation, suspension, rejection, and
archiving.  It preserves historical marketplace records while preventing fresh
direct interaction in either direction between the two underlying user accounts.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserBlock


class BlockingError(Exception):
    """Base error for product-level block operations."""


class CannotBlockSelf(BlockingError):
    pass


class BlockedUserNotFound(BlockingError):
    pass


class InteractionBlocked(BlockingError):
    """Raised when either participant has blocked the other."""


@dataclass(frozen=True)
class BlockState:
    interaction_blocked: bool
    blocked_by_me: bool


def _pair_filter(first_user_id: UUID, second_user_id: UUID):
    return or_(
        and_(
            UserBlock.blocker_user_id == first_user_id,
            UserBlock.blocked_user_id == second_user_id,
        ),
        and_(
            UserBlock.blocker_user_id == second_user_id,
            UserBlock.blocked_user_id == first_user_id,
        ),
    )


async def get_block_state(
    session: AsyncSession,
    viewer_user_id: UUID,
    counterparty_user_id: UUID,
) -> BlockState:
    if viewer_user_id == counterparty_user_id:
        return BlockState(interaction_blocked=False, blocked_by_me=False)
    rows = (
        await session.execute(
            select(UserBlock.blocker_user_id).where(_pair_filter(viewer_user_id, counterparty_user_id))
        )
    ).scalars().all()
    return BlockState(
        interaction_blocked=bool(rows),
        blocked_by_me=viewer_user_id in set(rows),
    )


async def interaction_is_blocked(
    session: AsyncSession,
    first_user_id: UUID,
    second_user_id: UUID,
) -> bool:
    if first_user_id == second_user_id:
        return False
    return (
        await session.execute(
            select(UserBlock.id).where(_pair_filter(first_user_id, second_user_id)).limit(1)
        )
    ).scalar_one_or_none() is not None


async def assert_can_interact(
    session: AsyncSession,
    first_user_id: UUID,
    second_user_id: UUID,
) -> None:
    if await interaction_is_blocked(session, first_user_id, second_user_id):
        raise InteractionBlocked("Direct interaction is unavailable.")


async def block_user(
    session: AsyncSession,
    *,
    blocker_user_id: UUID,
    blocked_user_id: UUID,
) -> tuple[UserBlock, bool]:
    if blocker_user_id == blocked_user_id:
        raise CannotBlockSelf("You cannot block yourself.")
    target = (
        await session.execute(select(User.id).where(User.id == blocked_user_id))
    ).scalar_one_or_none()
    if target is None:
        raise BlockedUserNotFound("User not found.")
    existing = (
        await session.execute(
            select(UserBlock).where(
                UserBlock.blocker_user_id == blocker_user_id,
                UserBlock.blocked_user_id == blocked_user_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    record = UserBlock(blocker_user_id=blocker_user_id, blocked_user_id=blocked_user_id)
    try:
        async with session.begin_nested():
            session.add(record)
            await session.flush()
    except IntegrityError:
        existing = (
            await session.execute(
                select(UserBlock).where(
                    UserBlock.blocker_user_id == blocker_user_id,
                    UserBlock.blocked_user_id == blocked_user_id,
                )
            )
        ).scalar_one()
        return existing, False
    await session.commit()
    await session.refresh(record)
    return record, True


async def unblock_user(
    session: AsyncSession,
    *,
    blocker_user_id: UUID,
    blocked_user_id: UUID,
) -> bool:
    result = await session.execute(
        delete(UserBlock).where(
            UserBlock.blocker_user_id == blocker_user_id,
            UserBlock.blocked_user_id == blocked_user_id,
        )
    )
    removed = bool(result.rowcount)
    if removed:
        await session.commit()
    return removed
