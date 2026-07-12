from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.rate_limit import MARKETPLACE_ACTION_LIMIT, rate_limit
from app.models import Conversation, Job, JobApplication, Message, TalentInterest, TalentListing, User, UserBlock
from app.realtime import events as realtime_events
from app.services import blocking_service
from app.services import messaging_service as ms
from app.services import review_service
from app.schemas.reviews import EngagementSummary

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
    read_by_recipient: bool = False


class ConversationRead(BaseModel):
    id: str
    context_type: str
    application_id: str | None = None
    talent_interest_id: str | None = None
    thread_id: str
    last_message_at: str | None = None
    unread_count: int
    viewer_last_read_at: str | None = None
    counterparty_last_read_at: str | None = None
    interaction_blocked: bool = False
    blocked_by_me: bool = False


class ConversationDetail(BaseModel):
    conversation: ConversationRead
    messages: list[MessageRead]
    engagement: EngagementSummary | None = None


class SendMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=ms.MAX_MESSAGE_LENGTH)
    client_message_id: UUID | None = None


class SendStatusUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: Literal[
        "shortlisted",
        "interviewing",
        "hired",
        "rejected",
        "contacted",
        "declined",
    ]


class UserBlockRead(BaseModel):
    blocked_user_id: str
    created_at: str | None = None


class BlockMutationRead(BaseModel):
    interaction_blocked: bool
    blocked_by_me: bool


# --- helpers ---------------------------------------------------------------


async def _conversation_detail(
    session: AsyncSession, conversation: Conversation, viewer: User
) -> ConversationDetail:
    block_state = await blocking_service.get_block_state(
        session, viewer.id, ms.other_participant_id(conversation, viewer.id)
    )
    names = await ms.participant_names(session, conversation)
    messages = await ms.list_messages(session, conversation)
    unread = await ms.unread_count(session, conversation, viewer.id)
    engagement = None
    if conversation.application_id:
        engagement = await review_service.engagement_for_application(session, conversation.application_id)
    elif conversation.talent_interest_id:
        engagement = await review_service.engagement_for_interest(session, conversation.talent_interest_id)
    return ConversationDetail(
        conversation=ConversationRead(
            **ms.serialize_conversation(
                conversation,
                viewer.id,
                unread,
                interaction_blocked=block_state.interaction_blocked,
                blocked_by_me=block_state.blocked_by_me,
            )
        ),
        messages=[
            MessageRead(
                **ms.serialize_message(
                    m,
                    viewer.id,
                    names.get(m.sender_user_id),
                    counterparty_last_read_at=(
                        None
                        if block_state.interaction_blocked
                        else ms.counterparty_last_read_for(conversation, viewer.id)
                    ),
                )
            )
            for m in messages
        ],
        engagement=(
            await review_service.engagement_summary(session, engagement, viewer.id)
            if engagement is not None
            else None
        ),
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
        block_state = await blocking_service.get_block_state(
            session, current_user.id, ms.other_participant_id(conversation, current_user.id)
        )
        result.append(
            ConversationRead(
                **ms.serialize_conversation(
                    conversation,
                    current_user.id,
                    unread,
                    interaction_blocked=block_state.interaction_blocked,
                    blocked_by_me=block_state.blocked_by_me,
                )
            )
        )
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
    detail = await _conversation_detail(session, conversation, current_user)
    await session.commit()  # persist lazy-created conversation and deadline reconciliation
    return detail


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
    detail = await _conversation_detail(session, conversation, current_user)
    await session.commit()
    return detail


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
    detail = await _conversation_detail(session, conversation, current_user)
    await session.commit()
    return detail


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
        message = await ms.post_message(
            session,
            conversation,
            current_user,
            payload.body,
            client_message_id=payload.client_message_id,
        )
    except ms.EmptyMessageBody as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Message cannot be empty") from exc
    except ms.ConversationClosed as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This conversation is closed to new messages",
        ) from exc
    except ms.IdempotencyConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Message retry key was already used with different content",
        ) from exc
    except ms.NotAParticipant as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a conversation participant") from exc
    except ms.InteractionBlocked as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This conversation is unavailable for new messages",
        ) from exc
    await realtime_events.emit_message_created(
        session, conversation=conversation, message=message
    )
    return MessageRead(
        **ms.serialize_message(message, current_user.id, current_user.display_name or current_user.username)
    )


@router.post(
    "/conversations/{conversation_id}/status-update",
    response_model=MessageRead,
    status_code=201,
)
async def send_status_update(
    conversation_id: UUID,
    payload: SendStatusUpdateRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageRead:
    """Post a trusted pipeline event after verifying its source record.

    Clients provide only the stage. The backend verifies that the caller manages
    the application/request and that the source is currently in that stage, then
    generates the platform copy. Ordinary message calls cannot choose a trusted
    message kind or forge arbitrary system text.
    """

    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)

    if conversation.application_id is not None:
        application = await _require_application(session, conversation.application_id)
        if application.job_owner_user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Application owner required",
            )
        notices = {
            "shortlisted": "Shortlisted",
            "interviewing": "Invited to interview",
            "hired": "Hired",
            "rejected": "Not moving forward",
        }
        prefix = notices.get(payload.stage)
        if prefix is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Stage is not valid for an application",
            )
        if application.status != payload.stage:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Application is no longer in that stage",
            )
        job_title = (
            await session.execute(select(Job.title).where(Job.id == application.job_id))
        ).scalar_one_or_none()
        body = f"{prefix} for “{job_title}”." if job_title else f"{prefix}."
    elif conversation.talent_interest_id is not None:
        interest = await _require_interest(session, conversation.talent_interest_id)
        if interest.owner_user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Talent listing owner required",
            )
        notices = {
            "contacted": "Hiring request accepted.",
            "declined": "Hiring request declined.",
        }
        body = notices.get(payload.stage)
        if body is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Stage is not valid for a hiring request",
            )
        if interest.status != payload.stage:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Hiring request is no longer in that stage",
            )
        # Confirm the listing still exists. This also prevents an orphaned request
        # from producing a trusted-looking event after its context was removed.
        listing_exists = (
            await session.execute(
                select(TalentListing.id).where(TalentListing.id == interest.talent_listing_id)
            )
        ).scalar_one_or_none()
        if listing_exists is None:
            raise HTTPException(status_code=409, detail="Talent listing is no longer available")
    else:
        raise HTTPException(status_code=409, detail="Conversation context is unavailable")

    try:
        message = await ms.post_message(
            session,
            conversation,
            current_user,
            body,
            kind="status_update",
            allow_closed=True,
            metadata={"stage": payload.stage},
        )
    except ms.InteractionBlocked as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This conversation is unavailable for new messages",
        ) from exc
    await realtime_events.emit_message_created(
        session, conversation=conversation, message=message
    )
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
    read_at = await ms.mark_read(session, conversation, current_user.id)
    block_state = await blocking_service.get_block_state(
        session, current_user.id, ms.other_participant_id(conversation, current_user.id)
    )
    response = ConversationRead(
        **ms.serialize_conversation(
            conversation,
            current_user.id,
            0,
            interaction_blocked=block_state.interaction_blocked,
            blocked_by_me=block_state.blocked_by_me,
        )
    )
    # `read_at` is consumed by the real-time transport in a later layer. Keep it
    # calculated here so HTTP remains authoritative even without WebSockets.
    await realtime_events.emit_read_progress(
        session,
        conversation=conversation,
        reader_user_id=current_user.id,
        read_at=read_at,
    )
    return response


@router.get("/blocks", response_model=list[UserBlockRead])
async def list_my_blocks(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[UserBlockRead]:
    rows = (
        await session.execute(
            select(UserBlock)
            .where(UserBlock.blocker_user_id == current_user.id)
            .order_by(UserBlock.created_at.desc())
        )
    ).scalars().all()
    return [
        UserBlockRead(
            blocked_user_id=str(row.blocked_user_id),
            created_at=row.created_at.isoformat() if row.created_at else None,
        )
        for row in rows
    ]


@router.post("/blocks/{user_id}", response_model=BlockMutationRead)
async def block_user(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> BlockMutationRead:
    try:
        _, created = await blocking_service.block_user(
            session,
            blocker_user_id=current_user.id,
            blocked_user_id=user_id,
        )
    except blocking_service.CannotBlockSelf as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except blocking_service.BlockedUserNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if created:
        await realtime_events.emit_block_change(
            blocker_user_id=current_user.id,
            blocked_user_id=user_id,
            blocked=True,
        )
    return BlockMutationRead(interaction_blocked=True, blocked_by_me=True)


@router.delete("/blocks/{user_id}", response_model=BlockMutationRead)
async def unblock_user(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> BlockMutationRead:
    removed = await blocking_service.unblock_user(
        session,
        blocker_user_id=current_user.id,
        blocked_user_id=user_id,
    )
    state = await blocking_service.get_block_state(session, current_user.id, user_id)
    if removed:
        await realtime_events.emit_block_change(
            blocker_user_id=current_user.id,
            blocked_user_id=user_id,
            blocked=False,
        )
    return BlockMutationRead(
        interaction_blocked=state.interaction_blocked,
        blocked_by_me=state.blocked_by_me,
    )
