from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.rate_limit import MARKETPLACE_ACTION_LIMIT, rate_limit
from app.models import Conversation, JobApplication, Message, TalentInterest, User
from app.services import messaging_service as ms

router = APIRouter(prefix="/me", tags=["messaging"])


# --- schemas ---------------------------------------------------------------


class MessageRead(BaseModel):
    id: str
    conversation_id: str
    sender_user_id: str
    from_me: bool
    sender_name: str | None = None
    body: str
    # "status_update" for platform-generated pipeline updates; None for user text.
    kind: str | None = None
    created_at: str | None = None


class ConversationRead(BaseModel):
    id: str
    context_type: str
    application_id: str | None = None
    talent_interest_id: str | None = None
    thread_id: str
    last_message_at: str | None = None
    unread_count: int


class ConversationDetail(BaseModel):
    conversation: ConversationRead
    messages: list[MessageRead]


class SendMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=ms.MAX_MESSAGE_LENGTH)
    # Only the platform status-update kind is accepted; user text sends no kind.
    kind: Literal["status_update"] | None = None


# --- helpers ---------------------------------------------------------------


async def _conversation_detail(
    session: AsyncSession, conversation: Conversation, viewer: User
) -> ConversationDetail:
    names = await ms.participant_names(session, conversation)
    messages = await ms.list_messages(session, conversation)
    unread = await ms.unread_count(session, conversation, viewer.id)
    return ConversationDetail(
        conversation=ConversationRead(**ms.serialize_conversation(conversation, viewer.id, unread)),
        messages=[
            MessageRead(**ms.serialize_message(m, viewer.id, names.get(m.sender_user_id)))
            for m in messages
        ],
    )


async def _require_application(session: AsyncSession, application_id: UUID) -> JobApplication:
    app = (
        await session.execute(select(JobApplication).where(JobApplication.id == application_id))
    ).scalar_one_or_none()
    if app is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


async def _require_interest(session: AsyncSession, interest_id: UUID) -> TalentInterest:
    interest = (
        await session.execute(select(TalentInterest).where(TalentInterest.id == interest_id))
    ).scalar_one_or_none()
    if interest is None:
        raise HTTPException(status_code=404, detail="Hiring request not found")
    return interest


def _require_participant(conversation: Conversation, user: User) -> None:
    if not ms.is_participant(conversation, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a conversation participant")


# --- endpoints -------------------------------------------------------------


@router.get("/conversations", response_model=list[ConversationRead])
async def list_my_conversations(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[ConversationRead]:
    rows = (
        await session.execute(
            select(Conversation)
            .where(
                or_(
                    Conversation.participant_a_user_id == current_user.id,
                    Conversation.participant_b_user_id == current_user.id,
                )
            )
            .order_by(Conversation.last_message_at.desc().nullslast(), Conversation.created_at.desc())
        )
    ).scalars().all()
    result = []
    for conversation in rows:
        unread = await ms.unread_count(session, conversation, current_user.id)
        result.append(ConversationRead(**ms.serialize_conversation(conversation, current_user.id, unread)))
    return result


@router.get("/applications/{application_id}/conversation", response_model=ConversationDetail)
async def get_application_conversation(
    application_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ConversationDetail:
    application = await _require_application(session, application_id)
    # Only the applicant or the job owner may open this thread.
    if current_user.id not in (application.applicant_user_id, application.job_owner_user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a conversation participant")
    conversation = await ms.get_or_create_conversation_for_application(session, application)
    await session.commit()  # persist lazy-created conversation
    return await _conversation_detail(session, conversation, current_user)


@router.get("/talent-interests/{interest_id}/conversation", response_model=ConversationDetail)
async def get_interest_conversation(
    interest_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ConversationDetail:
    interest = await _require_interest(session, interest_id)
    if current_user.id not in (interest.recruiter_user_id, interest.owner_user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a conversation participant")
    conversation = await ms.get_or_create_conversation_for_interest(session, interest)
    await session.commit()
    return await _conversation_detail(session, conversation, current_user)


async def _require_conversation(session: AsyncSession, conversation_id: UUID) -> Conversation:
    conversation = (
        await session.execute(select(Conversation).where(Conversation.id == conversation_id))
    ).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ConversationDetail:
    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)
    return await _conversation_detail(session, conversation, current_user)


@router.post("/conversations/{conversation_id}/messages", response_model=MessageRead, status_code=201)
async def send_message(
    conversation_id: UUID,
    payload: SendMessageRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageRead:
    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)
    try:
        message = await ms.post_message(session, conversation, current_user, payload.body, kind=payload.kind)
    except ms.EmptyMessageBody as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Message cannot be empty") from exc
    except ms.NotAParticipant as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a conversation participant") from exc
    return MessageRead(
        **ms.serialize_message(message, current_user.id, current_user.display_name or current_user.username)
    )


@router.post("/conversations/{conversation_id}/read", response_model=ConversationRead)
async def mark_conversation_read(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ConversationRead:
    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)
    await ms.mark_read(session, conversation, current_user.id)
    return ConversationRead(**ms.serialize_conversation(conversation, current_user.id, 0))
