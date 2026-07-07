"""Real user-to-user messaging service.

A conversation is a one-to-one thread anchored to a job application or talent
interest. This module owns conversation get-or-create (eager on new records, lazy on
first access for older ones), message posting with the ``message_received``
notification, and per-participant read/unread state. The router and the dev workflow
tester both call these functions so there is a single real code path.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Conversation, JobApplication, Message, TalentInterest, User
from app.notifications import dispatch_notification

MAX_MESSAGE_LENGTH = 5000


class MessagingError(Exception):
    """Base class for messaging errors (mapped to HTTP codes by the router)."""


class NotAParticipant(MessagingError):
    pass


class EmptyMessageBody(MessagingError):
    pass


class MissingParticipants(MessagingError):
    """The anchoring record has no second participant (e.g. an orphaned application)."""


# --- conversation get-or-create --------------------------------------------


async def get_or_create_conversation_for_application(
    session: AsyncSession, application: JobApplication
) -> Conversation:
    existing = (
        await session.execute(
            select(Conversation).where(Conversation.application_id == application.id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    if application.job_owner_user_id is None:
        raise MissingParticipants("Application has no job owner to message.")
    conversation = Conversation(
        context_type="job_application",
        application_id=application.id,
        job_id=application.job_id,
        participant_a_user_id=application.applicant_user_id,
        participant_b_user_id=application.job_owner_user_id,
    )
    session.add(conversation)
    await session.flush()
    return conversation


async def get_or_create_conversation_for_interest(
    session: AsyncSession, interest: TalentInterest
) -> Conversation:
    existing = (
        await session.execute(
            select(Conversation).where(Conversation.talent_interest_id == interest.id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    conversation = Conversation(
        context_type="talent_interest",
        talent_interest_id=interest.id,
        talent_listing_id=interest.talent_listing_id,
        job_id=interest.job_id,
        participant_a_user_id=interest.recruiter_user_id,
        participant_b_user_id=interest.owner_user_id,
    )
    session.add(conversation)
    await session.flush()
    return conversation


# --- participants / read state ---------------------------------------------


def is_participant(conversation: Conversation, user_id: UUID) -> bool:
    return user_id in (conversation.participant_a_user_id, conversation.participant_b_user_id)


def other_participant_id(conversation: Conversation, user_id: UUID) -> UUID:
    return (
        conversation.participant_b_user_id
        if user_id == conversation.participant_a_user_id
        else conversation.participant_a_user_id
    )


def _last_read_for(conversation: Conversation, user_id: UUID) -> datetime | None:
    if user_id == conversation.participant_a_user_id:
        return conversation.participant_a_last_read_at
    return conversation.participant_b_last_read_at


async def unread_count(session: AsyncSession, conversation: Conversation, user_id: UUID) -> int:
    """Messages from the *other* participant newer than this viewer's last read."""

    last_read = _last_read_for(conversation, user_id)
    stmt = (
        select(func.count())
        .select_from(Message)
        .where(
            Message.conversation_id == conversation.id,
            Message.sender_user_id != user_id,
            Message.deleted_at.is_(None),
        )
    )
    if last_read is not None:
        stmt = stmt.where(Message.created_at > last_read)
    return int((await session.execute(stmt)).scalar_one())


async def mark_read(session: AsyncSession, conversation: Conversation, user_id: UUID) -> None:
    if not is_participant(conversation, user_id):
        raise NotAParticipant()
    now = datetime.now(timezone.utc)
    if user_id == conversation.participant_a_user_id:
        conversation.participant_a_last_read_at = now
    else:
        conversation.participant_b_last_read_at = now
    await session.commit()


async def list_messages(session: AsyncSession, conversation: Conversation) -> list[Message]:
    rows = (
        await session.execute(
            select(Message)
            .where(Message.conversation_id == conversation.id, Message.deleted_at.is_(None))
            .order_by(Message.created_at)
        )
    ).scalars().all()
    return list(rows)


async def participant_names(session: AsyncSession, conversation: Conversation) -> dict[UUID, str]:
    ids = [conversation.participant_a_user_id, conversation.participant_b_user_id]
    rows = (await session.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {u.id: (u.display_name or u.username or u.email) for u in rows}


# --- posting ---------------------------------------------------------------


async def post_message(
    session: AsyncSession,
    conversation: Conversation,
    sender: User,
    body: str,
    kind: str | None = None,
) -> Message:
    """Post a message. ``kind`` marks platform-generated entries (currently
    "status_update", posted when a manager chooses to inform the other side of
    a pipeline stage change) so clients can render them apart from user text.
    """
    if not is_participant(conversation, sender.id):
        raise NotAParticipant()
    clean = (body or "").strip()
    if not clean:
        raise EmptyMessageBody()
    clean = clean[:MAX_MESSAGE_LENGTH]

    message = Message(
        conversation_id=conversation.id,
        sender_user_id=sender.id,
        body=clean,
        metadata_json={"kind": kind} if kind else {},
    )
    session.add(message)
    await session.flush()  # populate message.id / created_at before referencing them

    conversation.last_message_at = message.created_at or datetime.now(timezone.utc)
    # Sending implicitly reads the thread for the sender.
    if sender.id == conversation.participant_a_user_id:
        conversation.participant_a_last_read_at = conversation.last_message_at
    else:
        conversation.participant_b_last_read_at = conversation.last_message_at

    recipient_id = other_participant_id(conversation, sender.id)
    # The inbox thread is keyed by the anchoring record id (application/interest),
    # which is also the OwnerInteraction id the frontend opens via ?thread=.
    record_id = str(conversation.application_id or conversation.talent_interest_id or conversation.id)
    view = "hiring" if conversation.context_type == "job_application" else "talent"
    sender_name = sender.display_name or sender.username or sender.email
    await dispatch_notification(
        session,
        event_key="message_received",
        recipient_user_id=recipient_id,
        title=f"New message from {sender_name}",
        body=clean[:140],
        actor_user_id=sender.id,
        category="message",
        resource_type="conversation",
        resource_id=str(conversation.id),
        action_url=f"/applications?view={view}&thread={record_id}",
        payload={"conversation_id": str(conversation.id), "thread_id": record_id},
    )
    await session.commit()
    await session.refresh(message)
    return message


def serialize_message(message: Message, viewer_id: UUID, sender_name: str | None = None) -> dict:
    return {
        "id": str(message.id),
        "conversation_id": str(message.conversation_id),
        "sender_user_id": str(message.sender_user_id),
        "from_me": message.sender_user_id == viewer_id,
        "sender_name": sender_name,
        "body": message.body,
        "kind": (message.metadata_json or {}).get("kind"),
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }


def serialize_conversation(conversation: Conversation, viewer_id: UUID, unread: int) -> dict:
    return {
        "id": str(conversation.id),
        "context_type": conversation.context_type,
        "application_id": str(conversation.application_id) if conversation.application_id else None,
        "talent_interest_id": (
            str(conversation.talent_interest_id) if conversation.talent_interest_id else None
        ),
        "thread_id": str(conversation.application_id or conversation.talent_interest_id or conversation.id),
        "last_message_at": conversation.last_message_at.isoformat() if conversation.last_message_at else None,
        "unread_count": unread,
    }
