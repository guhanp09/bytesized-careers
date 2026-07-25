"""Personal, per-user organisation of a conversation.

Everything here is private to one participant. No function in this module may
change lifecycle status, post a message, create a notification, emit a trusted
event, or write a participant-visible timeline entry — a preference is how one
person organises their own workspace, and the counterparty must never be able to
observe it, directly or by inference.

Writes are idempotent upserts guarded by the table's unique constraint, so a
double-click or a race between two tabs converges on one row instead of failing.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Conversation, InteractionUserPreference


class NotAParticipant(Exception):
    """The user is not part of this conversation."""


class ConversationNotFound(Exception):
    """No such conversation."""


def _now() -> datetime:
    return datetime.now(UTC)


async def _require_participant(
    session: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID
) -> Conversation:
    """Authorisation gate for every read and write in this module.

    Preferences are keyed by conversation, so participation in that conversation
    is the whole of the permission model: a non-participant can neither read nor
    create a row, and there is no admin or moderator bypass — nobody has a
    legitimate reason to inspect another person's private organisation.
    """
    conversation = (
        await session.execute(select(Conversation).where(Conversation.id == conversation_id))
    ).scalar_one_or_none()
    if conversation is None:
        raise ConversationNotFound()
    if user_id not in (conversation.participant_a_user_id, conversation.participant_b_user_id):
        raise NotAParticipant()
    return conversation


async def get_preference(
    session: AsyncSession, *, conversation_id: uuid.UUID, user_id: uuid.UUID
) -> InteractionUserPreference | None:
    """This user's row for this conversation, or None when they have never set one."""
    await _require_participant(session, conversation_id, user_id)
    return (
        await session.execute(
            select(InteractionUserPreference).where(
                InteractionUserPreference.user_id == user_id,
                InteractionUserPreference.conversation_id == conversation_id,
            )
        )
    ).scalar_one_or_none()


async def list_preferences(
    session: AsyncSession, *, user_id: uuid.UUID
) -> list[InteractionUserPreference]:
    """Every preference this user owns.

    Scoped to `user_id` by construction, so it can only ever return the caller's
    own rows — there is no conversation filter that could widen it.
    """
    return list(
        (
            await session.execute(
                select(InteractionUserPreference).where(InteractionUserPreference.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )


async def _upsert(
    session: AsyncSession,
    *,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    **fields: object,
) -> InteractionUserPreference:
    """Apply `fields` to this user's row, creating it if needed.

    Idempotent: repeating the same call converges on the same state. Concurrency
    is handled by letting the unique constraint arbitrate — if a parallel request
    inserted first, the IntegrityError is caught and the existing row is updated
    instead, so two tabs can never produce two rows.
    """
    await _require_participant(session, conversation_id, user_id)

    existing = (
        await session.execute(
            select(InteractionUserPreference).where(
                InteractionUserPreference.user_id == user_id,
                InteractionUserPreference.conversation_id == conversation_id,
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        preference = InteractionUserPreference(
            user_id=user_id, conversation_id=conversation_id, **fields
        )
        session.add(preference)
        try:
            await session.flush()
            return preference
        except IntegrityError:
            # Someone else created the row between our SELECT and INSERT.
            await session.rollback()
            await _require_participant(session, conversation_id, user_id)
            existing = (
                await session.execute(
                    select(InteractionUserPreference).where(
                        InteractionUserPreference.user_id == user_id,
                        InteractionUserPreference.conversation_id == conversation_id,
                    )
                )
            ).scalar_one()

    for key, value in fields.items():
        setattr(existing, key, value)
    await session.flush()
    return existing


async def set_starred(
    session: AsyncSession, *, conversation_id: uuid.UUID, user_id: uuid.UUID, starred: bool
) -> InteractionUserPreference:
    """Star or unstar. Orthogonal to stage — a starred record keeps its status."""
    return await _upsert(
        session,
        conversation_id=conversation_id,
        user_id=user_id,
        starred_at=_now() if starred else None,
    )


async def set_snooze(
    session: AsyncSession,
    *,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    until: datetime | None,
) -> InteractionUserPreference:
    """Hide queue recommendations until `until`, or clear the snooze with None.

    The conversation itself stays fully visible and fully actionable; only the
    *recommendation* is quietened.
    """
    return await _upsert(
        session, conversation_id=conversation_id, user_id=user_id, snoozed_until=until
    )


async def set_queue_dismissed(
    session: AsyncSession, *, conversation_id: uuid.UUID, user_id: uuid.UUID, dismissed: bool
) -> InteractionUserPreference:
    """"No reply needed": correct a queue recommendation without touching status."""
    return await _upsert(
        session,
        conversation_id=conversation_id,
        user_id=user_id,
        queue_dismissed_at=_now() if dismissed else None,
    )


async def set_decision_prompt_dismissed(
    session: AsyncSession,
    *,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    dismissed: bool,
    trigger_version: int | None = None,
) -> InteractionUserPreference:
    """Remember that the first-open decision surface was dismissed.

    The version is stored alongside so a later change to the triggering rules can
    re-offer the surface rather than honouring a dismissal that answered
    different behaviour.
    """
    return await _upsert(
        session,
        conversation_id=conversation_id,
        user_id=user_id,
        decision_prompt_dismissed_at=_now() if dismissed else None,
        decision_prompt_trigger_version=trigger_version if dismissed else None,
    )


def serialize_preference(preference: InteractionUserPreference | None) -> dict:
    """Shape returned to the *owner only*.

    Never embed this in a conversation or interaction payload that the
    counterparty can read — it is exposed through the owner-scoped preference
    endpoints alone.
    """
    if preference is None:
        return {
            "starred": False,
            "starred_at": None,
            "snoozed_until": None,
            "queue_dismissed": False,
            "decision_prompt_dismissed": False,
            "decision_prompt_trigger_version": None,
        }
    return {
        "starred": preference.starred_at is not None,
        "starred_at": preference.starred_at.isoformat() if preference.starred_at else None,
        "snoozed_until": preference.snoozed_until.isoformat() if preference.snoozed_until else None,
        "queue_dismissed": preference.queue_dismissed_at is not None,
        "decision_prompt_dismissed": preference.decision_prompt_dismissed_at is not None,
        "decision_prompt_trigger_version": preference.decision_prompt_trigger_version,
    }
