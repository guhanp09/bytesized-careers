from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.rate_limit import MARKETPLACE_ACTION_LIMIT, rate_limit
from app.models import Conversation, JobApplication, Message, TalentInterest, User, UserBlock
from app.realtime import events as realtime_events
from app.schemas.reviews import EngagementSummary
from app.services import blocking_service, review_service
from app.services import interaction_preference_service as prefs
from app.services import interaction_transition_service as transitions
from app.services import interview_service as interviews
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
    # Structured payload for the automated screening-question message (rendered natively
    # in the Inbox); absent for all other messages.
    message_kind: str | None = None
    automated: bool = False
    screening: dict | None = None
    # The applicant's answers to those questions, snapshotted against the
    # question set as it was asked; absent for every other message.
    screening_answers: dict | None = None
    # Optional composer intent the sender chose, and whether it asked for a
    # reply. Presentation evidence only — it never affects lifecycle status.
    intent: str | None = None
    response_expected: bool = False
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
    is_closed: bool = False


class InterviewRead(BaseModel):
    """The arranged interview, as both participants may see it.

    Every field here was deliberately communicated by the organiser, so there is
    nothing private to withhold. The manager's assessment of how it went is a
    private note and never appears in this shape.
    """

    id: str
    conversation_id: str
    status: Literal["proposed", "confirmed", "completed", "cancelled"]
    scheduled_at: str | None = None
    timezone: str
    duration_minutes: int | None = None
    meeting_method: str
    meeting_detail: str | None = None
    #: Pre-rendered "when and how" in the organiser's stated zone. Clients also
    #: render `scheduled_at` in the reader's own zone; this is the shared truth.
    schedule_label: str
    previous_scheduled_at: str | None = None
    reschedule_count: int = 0
    round_number: int = 1
    confirmed_at: str | None = None
    confirmed_by_me: bool = False
    completed_at: str | None = None
    cancelled_at: str | None = None
    version: int
    can_manage: bool = False
    follow_up_due: bool = False


class ConversationDetail(BaseModel):
    conversation: ConversationRead
    messages: list[MessageRead]
    engagement: EngagementSummary | None = None
    interview: InterviewRead | None = None


class SendMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=ms.MAX_MESSAGE_LENGTH)
    client_message_id: UUID | None = None
    #: Optional composer intent. Purely an accelerator: it records that the
    #: sender was asking for something, so the other side's workspace can say
    #: "waiting on you" with evidence instead of guessing from the fact that a
    #: message merely arrived. It never changes status and is restricted to the
    #: message-sending intents — consequential outcomes go through the
    #: confirmed transition endpoints, never through a message body.
    intent: Literal[
        "ask_question",
        "request_portfolio",
        "check_availability",
        "propose_interview",
        "request_confirmation",
    ] | None = None


class ScreeningAnswerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Which asked question this answers, by its position in the snapshot the
    #: hiring side sent. Positions rather than prompts, so a client cannot
    #: reword the question it claims to be answering.
    position: int = Field(ge=0, le=99)
    response: str = Field(default="", max_length=ms.SCREENING_ANSWER_MAX_LENGTH)


class SendScreeningAnswersRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answers: list[ScreeningAnswerIn] = Field(default_factory=list, max_length=20)


class SendStatusUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: "shortlisted" was retired with the stage itself (see 0047); only the
    #: remaining optional-shared outcome can be communicated this way.
    stage: Literal["rejected"]
    expected_version: int = Field(ge=1)
    idempotency_key: UUID


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
    is_closed = await ms.conversation_is_closed(session, conversation)
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
                is_closed=is_closed,
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
        interview=(
            InterviewRead(**serialized)
            if (
                serialized := interviews.serialize_interview(
                    await interviews.get_interview(session, conversation.id), conversation, viewer.id
                )
            )
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
        is_closed = await ms.conversation_is_closed(session, conversation)
        result.append(
            ConversationRead(
                **ms.serialize_conversation(
                    conversation,
                    current_user.id,
                    unread,
                    interaction_blocked=block_state.interaction_blocked,
                    blocked_by_me=block_state.blocked_by_me,
                    is_closed=is_closed,
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


@router.post(
    "/conversations/{conversation_id}/screening-answers",
    response_model=MessageRead,
    status_code=201,
)
async def send_screening_answers(
    conversation_id: UUID,
    payload: SendScreeningAnswersRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageRead:
    """Answer the screening questions asked in this conversation.

    The questions arrive as a structured message; the answers go back the same
    way, snapshotted against the question set as it was asked. That keeps both
    halves in the one place both participants already look, makes them immutable
    by construction — a later edit to the job cannot rewrite an answer already
    given — and makes a retry idempotent through the message's deterministic
    client id rather than through a second table.
    """
    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)
    try:
        message = await ms.post_screening_answers(
            session,
            conversation,
            current_user,
            {entry.position: entry.response for entry in payload.answers},
        )
    except ms.ScreeningQuestionsMissing as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No screening questions were asked in this conversation",
        ) from exc
    except ms.ScreeningAnswerInvalid as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.detail) from exc
    except ms.ConversationClosed as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This conversation is closed to new messages",
        ) from exc
    except ms.IdempotencyConflict as exc:
        # The same answers already landed. Returning the existing message keeps a
        # double submit from reading as a failure.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="These answers were already sent",
        ) from exc
    except ms.NotAParticipant as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a conversation participant") from exc
    except ms.InteractionBlocked as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This conversation is unavailable"
        ) from exc
    await realtime_events.emit_message_created(
        session, conversation=conversation, message=message
    )
    return MessageRead(
        **ms.serialize_message(
            message, current_user.id, current_user.display_name or current_user.username
        )
    )


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
            # Recorded on the message itself so the expectation is durable and
            # visible on every device, rather than inferred later from text.
            metadata=ms.intent_metadata(payload.intent),
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
    """Compatibility route for deliberately sharing a private application decision.

    Consequential outcomes are shared by their canonical transition endpoints.
    This route is intentionally limited to optional Shortlisted/Rejected updates
    and still requires versioning plus an idempotency key.
    """

    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)

    if conversation.application_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hiring-request outcomes are shared by the Accepted or Declined action.",
        )
    try:
        result = await transitions.share_application_status(
            session,
            application_id=conversation.application_id,
            actor=current_user,
            requested_status=payload.stage,
            expected_version=payload.expected_version,
            idempotency_key=str(payload.idempotency_key),
        )
        await session.commit()
    except transitions.TransitionForbidden as exc:
        await session.rollback()
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except transitions.StaleTransition as exc:
        await session.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": exc.code,
                "message": "Changed elsewhere — latest status loaded.",
                "current_status": exc.current_status,
                "current_version": exc.current_version,
            },
        ) from exc
    except transitions.TransitionError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc

    event = result.event
    if event is None:
        raise HTTPException(status_code=409, detail="This decision was already shared.")
    client_message_id = uuid.uuid5(uuid.NAMESPACE_URL, f"creatorjobs:status:{event.id}")
    message = (
        await session.execute(
            select(Message).where(
                Message.conversation_id == conversation.id,
                Message.client_message_id == client_message_id,
            )
        )
    ).scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=409, detail="The shared decision is saved. Refresh this conversation.")
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
            is_closed=await ms.conversation_is_closed(session, conversation),
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


# --- personal interaction preferences --------------------------------------
#
# Strictly owner-scoped. Every endpoint resolves the row from the authenticated
# user, so there is no parameter through which one participant could read or
# mutate the other's organisation. None of these writes touch lifecycle status,
# post a message, create a notification, or emit a trusted event.


class InteractionPreferenceRead(BaseModel):
    conversation_id: str
    starred: bool = False
    starred_at: str | None = None
    snoozed_until: str | None = None
    queue_dismissed: bool = False
    decision_prompt_dismissed: bool = False
    decision_prompt_trigger_version: int | None = None


class StarUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    starred: bool


class SnoozeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: ISO-8601 instant to stay quiet until, or null to clear the snooze.
    until: datetime | None = None


class QueueDismissalUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dismissed: bool


class DecisionPromptUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dismissed: bool
    trigger_version: int | None = None


def _preference_error(exc: Exception) -> HTTPException:
    if isinstance(exc, prefs.ConversationNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="Not a conversation participant"
    )


@router.get("/interaction-preferences", response_model=list[InteractionPreferenceRead])
async def list_interaction_preferences(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[InteractionPreferenceRead]:
    """Every preference the caller owns, in one request.

    The workspace loads many conversations at once, so fetching these per thread
    would multiply round-trips for what is a small, user-scoped set.
    """
    rows = await prefs.list_preferences(session, user_id=current_user.id)
    return [
        InteractionPreferenceRead(
            conversation_id=str(row.conversation_id), **prefs.serialize_preference(row)
        )
        for row in rows
    ]


async def _apply_preference(
    session: AsyncSession, conversation_id: UUID, user_id: UUID, mutate
) -> InteractionPreferenceRead:
    try:
        preference = await mutate()
    except (prefs.NotAParticipant, prefs.ConversationNotFound) as exc:
        await session.rollback()
        raise _preference_error(exc) from exc
    await session.commit()
    return InteractionPreferenceRead(
        conversation_id=str(conversation_id), **prefs.serialize_preference(preference)
    )


@router.put("/conversations/{conversation_id}/preferences/star", response_model=InteractionPreferenceRead)
async def set_conversation_star(
    conversation_id: UUID,
    payload: StarUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InteractionPreferenceRead:
    return await _apply_preference(
        session,
        conversation_id,
        current_user.id,
        lambda: prefs.set_starred(
            session,
            conversation_id=conversation_id,
            user_id=current_user.id,
            starred=payload.starred,
        ),
    )


@router.put("/conversations/{conversation_id}/preferences/snooze", response_model=InteractionPreferenceRead)
async def set_conversation_snooze(
    conversation_id: UUID,
    payload: SnoozeUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InteractionPreferenceRead:
    return await _apply_preference(
        session,
        conversation_id,
        current_user.id,
        lambda: prefs.set_snooze(
            session,
            conversation_id=conversation_id,
            user_id=current_user.id,
            until=payload.until,
        ),
    )


@router.put(
    "/conversations/{conversation_id}/preferences/queue-dismissal",
    response_model=InteractionPreferenceRead,
)
async def set_conversation_queue_dismissal(
    conversation_id: UUID,
    payload: QueueDismissalUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InteractionPreferenceRead:
    return await _apply_preference(
        session,
        conversation_id,
        current_user.id,
        lambda: prefs.set_queue_dismissed(
            session,
            conversation_id=conversation_id,
            user_id=current_user.id,
            dismissed=payload.dismissed,
        ),
    )


@router.put(
    "/conversations/{conversation_id}/preferences/decision-prompt",
    response_model=InteractionPreferenceRead,
)
async def set_conversation_decision_prompt(
    conversation_id: UUID,
    payload: DecisionPromptUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InteractionPreferenceRead:
    return await _apply_preference(
        session,
        conversation_id,
        current_user.id,
        lambda: prefs.set_decision_prompt_dismissed(
            session,
            conversation_id=conversation_id,
            user_id=current_user.id,
            dismissed=payload.dismissed,
            trigger_version=payload.trigger_version,
        ),
    )


# --- interview coordination ------------------------------------------------
#
# Structured scheduling on top of the existing conversation. Nothing here parses
# message text: an interview exists because someone deliberately arranged one.
# Where an arrangement implies a lifecycle change it goes through the ordinary
# transition service, so there is exactly one authoritative status path.


class ProposeInterviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scheduled_at: datetime
    #: IANA zone the organiser was thinking in. Validated server-side, because a
    #: wrong zone is a missed interview rather than a cosmetic error.
    timezone: str = Field(min_length=1, max_length=64)
    meeting_method: Literal["video_call", "phone", "in_person", "other"]
    meeting_detail: str | None = Field(default=None, max_length=interviews.MAX_DETAIL_LENGTH)
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    #: The organiser's own accompanying message. Always editable in the client
    #: and always optional — the arrangement stands on its own.
    note: str | None = Field(default=None, max_length=interviews.MAX_NOTE_LENGTH)
    #: 0 for a first invitation, the current interview version for a reschedule.
    expected_version: int = Field(ge=0)
    #: Required for the first invitation on an application, which also moves the
    #: participant-visible stage and therefore needs the record's own version.
    application_expected_version: int | None = Field(default=None, ge=1)
    idempotency_key: UUID


class InterviewActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    idempotency_key: UUID


class CancelInterviewRequest(InterviewActionRequest):
    reason: str | None = Field(default=None, max_length=interviews.MAX_NOTE_LENGTH)


def _interview_error(exc: interviews.InterviewError) -> HTTPException:
    if isinstance(exc, interviews.InterviewForbidden):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, interviews.InterviewNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, interviews.StaleInterview):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": exc.code,
                "message": str(exc),
                "current_version": exc.current_version,
            },
        )
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": exc.code, "message": str(exc)},
    )


async def _emit_interview_message(
    session: AsyncSession, conversation: Conversation, result: interviews.InterviewResult
) -> None:
    """Fan out the committed announcement, if this action made one.

    Marking an interview complete deliberately produces nothing to emit: it is
    private bookkeeping, and pushing an event for it would let the counterparty
    infer a manager-only action from the timing of a socket frame.
    """
    for message_id in (result.message_id, result.note_message_id):
        if message_id is None:
            continue
        message = await session.get(Message, message_id)
        if message is not None:
            await realtime_events.emit_message_created(
                session, conversation=conversation, message=message
            )


async def _interview_response(
    session: AsyncSession, conversation: Conversation, viewer: User, result: interviews.InterviewResult
) -> InterviewRead:
    serialized = interviews.serialize_interview(result.interview, conversation, viewer.id)
    assert serialized is not None  # a result always carries its row
    return InterviewRead(**serialized)


@router.get("/interviews", response_model=list[InterviewRead])
async def list_my_interviews(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[InterviewRead]:
    """Every interview on a conversation the caller takes part in.

    One request rather than one per thread: the workspace needs all of them to
    derive its follow-up queue, and a per-thread fetch would turn a queue count
    into N round-trips.
    """
    rows = await interviews.list_for_user(session, current_user.id)
    by_conversation = {
        row.conversation_id: row for row in rows
    }
    conversations = (
        await session.execute(
            select(Conversation).where(Conversation.id.in_(list(by_conversation.keys())))
        )
    ).scalars().all() if by_conversation else []
    result: list[InterviewRead] = []
    for conversation in conversations:
        serialized = interviews.serialize_interview(
            by_conversation[conversation.id], conversation, current_user.id
        )
        if serialized is not None:
            result.append(InterviewRead(**serialized))
    return result


@router.put("/conversations/{conversation_id}/interview", response_model=InterviewRead)
async def propose_interview(
    conversation_id: UUID,
    payload: ProposeInterviewRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InterviewRead:
    """Invite to an interview, or move one already arranged.

    One endpoint for both because they are the same user intent — "this is when
    we're meeting" — and splitting them would let a client create a second
    arrangement by calling the wrong route. Which one happened is decided by the
    database state, not by the caller.
    """
    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)
    try:
        result = await interviews.propose(
            session,
            conversation=conversation,
            actor=current_user,
            scheduled_at=payload.scheduled_at,
            timezone_name=payload.timezone,
            meeting_method=payload.meeting_method,
            meeting_detail=payload.meeting_detail,
            duration_minutes=payload.duration_minutes,
            note=payload.note,
            expected_version=payload.expected_version,
            idempotency_key=str(payload.idempotency_key),
            application_expected_version=payload.application_expected_version,
        )
        response = await _interview_response(session, conversation, current_user, result)
        await session.commit()
    except interviews.InterviewError as exc:
        await session.rollback()
        raise _interview_error(exc) from exc
    except transitions.StaleTransition as exc:
        await session.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": exc.code,
                "message": "Changed elsewhere — latest status loaded.",
                "current_status": exc.current_status,
                "current_version": exc.current_version,
            },
        ) from exc
    except transitions.TransitionError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail={"code": exc.code, "message": str(exc)}) from exc
    await _emit_interview_message(session, conversation, result)
    return response


@router.post("/conversations/{conversation_id}/interview/confirm", response_model=InterviewRead)
async def confirm_interview(
    conversation_id: UUID,
    payload: InterviewActionRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InterviewRead:
    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)
    try:
        result = await interviews.confirm(
            session,
            conversation=conversation,
            actor=current_user,
            expected_version=payload.expected_version,
            idempotency_key=str(payload.idempotency_key),
        )
        response = await _interview_response(session, conversation, current_user, result)
        await session.commit()
    except interviews.InterviewError as exc:
        await session.rollback()
        raise _interview_error(exc) from exc
    await _emit_interview_message(session, conversation, result)
    return response


@router.post("/conversations/{conversation_id}/interview/complete", response_model=InterviewRead)
async def complete_interview(
    conversation_id: UUID,
    payload: InterviewActionRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InterviewRead:
    """Close out the scheduling. Private: sends nothing, decides nothing."""
    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)
    try:
        result = await interviews.complete(
            session,
            conversation=conversation,
            actor=current_user,
            expected_version=payload.expected_version,
            idempotency_key=str(payload.idempotency_key),
        )
        response = await _interview_response(session, conversation, current_user, result)
        await session.commit()
    except interviews.InterviewError as exc:
        await session.rollback()
        raise _interview_error(exc) from exc
    return response


@router.post("/conversations/{conversation_id}/interview/cancel", response_model=InterviewRead)
async def cancel_interview(
    conversation_id: UUID,
    payload: CancelInterviewRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InterviewRead:
    conversation = await _require_conversation(session, conversation_id)
    _require_participant(conversation, current_user)
    try:
        result = await interviews.cancel(
            session,
            conversation=conversation,
            actor=current_user,
            reason=payload.reason,
            expected_version=payload.expected_version,
            idempotency_key=str(payload.idempotency_key),
        )
        response = await _interview_response(session, conversation, current_user, result)
        await session.commit()
    except interviews.InterviewError as exc:
        await session.rollback()
        raise _interview_error(exc) from exc
    await _emit_interview_message(session, conversation, result)
    return response
