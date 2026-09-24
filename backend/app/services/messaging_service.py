"""Real user-to-user messaging service.

A conversation is a one-to-one thread anchored to a job application or talent
interest. This module owns conversation get-or-create (eager on new records, lazy on
first access for older ones), message posting with the ``message_received``
notification, and per-participant read/unread state. The router and the dev workflow
tester both call these functions so there is a single real code path.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import case, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.account_state import active_account_clause
from app.models import Conversation, JobApplication, Message, TalentInterest, User
from app.notifications import dispatch_notification
from app.services import blocking_service

MAX_MESSAGE_LENGTH = 5000


class MessagingError(Exception):
    """Base class for messaging errors (mapped to HTTP codes by the router)."""


class NotAParticipant(MessagingError):
    pass


class EmptyMessageBody(MessagingError):
    pass


class ConversationClosed(MessagingError):
    pass


class IdempotencyConflict(MessagingError):
    pass


class InteractionBlocked(MessagingError):
    """A user-to-user block takes precedence over ordinary chat."""


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
    try:
        async with session.begin_nested():
            session.add(conversation)
            await session.flush()
        return conversation
    except IntegrityError:
        # Two participants may open a legacy application at the same moment.
        # The unique source constraint picks one conversation; return it instead
        # of leaking a transient 500 from the losing request.
        existing = (
            await session.execute(
                select(Conversation).where(Conversation.application_id == application.id)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        raise


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
    try:
        async with session.begin_nested():
            session.add(conversation)
            await session.flush()
        return conversation
    except IntegrityError:
        existing = (
            await session.execute(
                select(Conversation).where(
                    Conversation.talent_interest_id == interest.id
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        raise


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


def counterparty_last_read_for(conversation: Conversation, user_id: UUID) -> datetime | None:
    return (
        conversation.participant_b_last_read_at
        if user_id == conversation.participant_a_user_id
        else conversation.participant_a_last_read_at
    )


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


CLOSED_APPLICATION_STATUSES = frozenset({"rejected", "withdrawn"})
CLOSED_INTEREST_STATUSES = frozenset({"declined", "withdrawn"})


async def conversation_is_closed(session: AsyncSession, conversation: Conversation) -> bool:
    """Return whether ordinary participant messages are closed for this thread.

    Hired applications and accepted hiring requests intentionally stay open: those
    users need the conversation while work is active. Rejected, declined, withdrawn,
    and shared terminal outcomes close ordinary chat. Archiving is an internal
    organization action, so it only closes a thread whose participant-visible
    relationship was already terminal. Trusted lifecycle events may still be
    appended by their dedicated server-side workflows.
    """

    if await blocking_service.interaction_is_blocked(
        session, conversation.participant_a_user_id, conversation.participant_b_user_id
    ):
        return True

    active_participant_count = int(
        (
            await session.execute(
                select(func.count())
                .select_from(User)
                .where(
                    User.id.in_(
                        [
                            conversation.participant_a_user_id,
                            conversation.participant_b_user_id,
                        ]
                    ),
                    active_account_clause(User),
                )
            )
        ).scalar_one()
    )
    if active_participant_count != 2:
        return True

    if conversation.application_id is not None:
        application_state = (
            await session.execute(
                select(JobApplication.status, JobApplication.participant_status).where(
                    JobApplication.id == conversation.application_id
                )
            )
        ).one_or_none()
        if application_state is None:
            return True
        _, participant_status = application_state
        return participant_status in CLOSED_APPLICATION_STATUSES
    if conversation.talent_interest_id is not None:
        interest_state = (
            await session.execute(
                select(TalentInterest.status, TalentInterest.participant_status).where(
                    TalentInterest.id == conversation.talent_interest_id
                )
            )
        ).one_or_none()
        if interest_state is None:
            return True
        _, participant_status = interest_state
        return participant_status in CLOSED_INTEREST_STATUSES
    return True


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


async def mark_read(session: AsyncSession, conversation: Conversation, user_id: UUID) -> datetime:
    """Advance one participant's read state monotonically and return it.

    A receipt is participant progress, not a notification read.  The SQL `CASE`
    update means delayed requests from another tab can never move progress backward.
    """
    if not is_participant(conversation, user_id):
        raise NotAParticipant()
    now = datetime.now(UTC)
    column = (
        Conversation.participant_a_last_read_at
        if user_id == conversation.participant_a_user_id
        else Conversation.participant_b_last_read_at
    )
    await session.execute(
        update(Conversation)
        .where(Conversation.id == conversation.id)
        .values(
            {
                column.key: case(
                    (column.is_(None), now),
                    (column < now, now),
                    else_=column,
                )
            }
        )
    )
    await session.commit()
    await session.refresh(conversation)
    return _last_read_for(conversation, user_id) or now


async def list_messages(session: AsyncSession, conversation: Conversation) -> list[Message]:
    rows = (
        await session.execute(
            select(Message)
            .where(Message.conversation_id == conversation.id, Message.deleted_at.is_(None))
            .order_by(Message.created_at, Message.id)
        )
    ).scalars().all()
    return list(rows)


async def participant_names(session: AsyncSession, conversation: Conversation) -> dict[UUID, str]:
    ids = [conversation.participant_a_user_id, conversation.participant_b_user_id]
    rows = (await session.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {u.id: (u.display_name or u.username or u.email) for u in rows}


# --- screening answers -----------------------------------------------------

SCREENING_ANSWER_MAX_LENGTH = 5000

#: Deterministic namespace for the applicant's answers message, so a retry, a
#: double submit, or two tabs racing each other all resolve to the same row
#: through the (conversation_id, client_message_id) uniqueness constraint.
SCREENING_ANSWERS_NAMESPACE = uuid5(NAMESPACE_URL, "creatorjobs:screening-answers-message")


class ScreeningQuestionsMissing(Exception):
    """Nobody asked anything in this conversation."""


class ScreeningAnswerInvalid(Exception):
    """A required question was left blank, or an answer names no known question."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


async def latest_screening_questions(
    session: AsyncSession, conversation: Conversation
) -> dict[str, object] | None:
    """The most recent screening-question snapshot asked in this conversation.

    The snapshot is the authority for what was asked. Answers are validated and
    labelled against it rather than against the job, so editing the job later
    cannot retroactively change the question somebody already answered.
    """
    rows = (
        await session.execute(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.created_at.desc(), Message.id.desc())
        )
    ).scalars()
    for message in rows:
        metadata = message.metadata_json or {}
        if metadata.get("message_kind") == "screening_questions":
            questions = metadata.get("questions")
            return {
                "questions": questions if isinstance(questions, list) else [],
                "snapshot_version": metadata.get("snapshot_version"),
            }
    return None


def build_screening_answer_snapshot(
    questions: list[dict[str, object]],
    responses: dict[int, str],
) -> list[dict[str, object]]:
    """Pair each asked question with what was said, in the order it was asked.

    Every question appears, answered or not. Dropping the blank ones would make
    an unanswered optional question indistinguishable from one that was never
    asked, which is exactly the thing a reviewer needs to be able to tell apart.
    """
    snapshot: list[dict[str, object]] = []
    for index, question in enumerate(questions):
        if not isinstance(question, dict):
            continue
        position = int(question.get("position", index) or index)
        prompt = str(question.get("prompt") or "").strip()
        if not prompt:
            continue
        required = bool(question.get("required"))
        response = (responses.get(position) or "").strip()[:SCREENING_ANSWER_MAX_LENGTH]
        if required and not response:
            raise ScreeningAnswerInvalid(f"Question {position + 1} needs an answer.")
        snapshot.append(
            {
                "position": position,
                "prompt": prompt,
                "required": required,
                "response": response,
                "answered": bool(response),
            }
        )
    known = {entry["position"] for entry in snapshot}
    for position in responses:
        if position not in known:
            raise ScreeningAnswerInvalid("An answer refers to a question that was not asked.")
    return snapshot


def screening_answers_body(snapshot: list[dict[str, object]]) -> str:
    """Readable fallback for notifications and any client that cannot render the card."""
    lines = ["Answers to your questions:", ""]
    for number, entry in enumerate(snapshot, start=1):
        response = entry["response"] or ("No answer" if entry["required"] else "Skipped (optional)")
        lines.append(f"{number}. {entry['prompt']}")
        lines.append(f"   {response}")
    return "\n".join(lines)


async def post_screening_answers(
    session: AsyncSession,
    conversation: Conversation,
    sender: User,
    responses: dict[int, str],
    *,
    commit: bool = True,
) -> Message:
    """Answer the screening questions asked in this conversation.

    One structured message rather than a new endpoint or a second table: the
    questions already travel as a message, the thread is already the place both
    participants look, and a message is immutable — so the answers are
    snapshotted by construction and a later job edit cannot rewrite them.
    """
    asked = await latest_screening_questions(session, conversation)
    if asked is None:
        raise ScreeningQuestionsMissing()
    questions = asked["questions"] if isinstance(asked["questions"], list) else []
    snapshot = build_screening_answer_snapshot(questions, responses)
    snapshot_version = str(asked.get("snapshot_version") or "")
    metadata: dict[str, object] = {
        "message_kind": "screening_answers",
        "snapshot_version": snapshot_version,
        "answered_at": datetime.now(UTC).isoformat(),
        "answers": snapshot,
    }
    client_message_id = uuid5(
        SCREENING_ANSWERS_NAMESPACE, f"{conversation.id}:{sender.id}:{snapshot_version}"
    )
    return await post_message(
        session,
        conversation,
        sender,
        screening_answers_body(snapshot),
        kind="screening_answers",
        metadata=metadata,
        client_message_id=client_message_id,
        commit=commit,
    )


# --- posting ---------------------------------------------------------------


async def post_message(
    session: AsyncSession,
    conversation: Conversation,
    sender: User,
    body: str,
    kind: str | None = None,
    *,
    allow_closed: bool = False,
    metadata: dict[str, object] | None = None,
    client_message_id: UUID | None = None,
    notify_recipient: bool = True,
    allow_blocked: bool = False,
    commit: bool = True,
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

    if client_message_id is not None:
        existing = (
            await session.execute(
                select(Message).where(
                    Message.conversation_id == conversation.id,
                    Message.client_message_id == client_message_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.sender_user_id != sender.id or existing.body != clean:
                raise IdempotencyConflict()
            return existing

    if not allow_blocked:
        try:
            await blocking_service.assert_can_interact(
                session, conversation.participant_a_user_id, conversation.participant_b_user_id
            )
        except blocking_service.InteractionBlocked as exc:
            raise InteractionBlocked() from exc

    if not allow_closed and await conversation_is_closed(session, conversation):
        raise ConversationClosed()

    message_metadata = dict(metadata or {})
    if kind:
        message_metadata["kind"] = kind

    created_at = datetime.now(UTC)
    message = Message(
        conversation_id=conversation.id,
        sender_user_id=sender.id,
        client_message_id=client_message_id,
        body=clean,
        metadata_json=message_metadata,
        created_at=created_at,
    )
    try:
        async with session.begin_nested():
            session.add(message)
            await session.flush()  # populate message.id before referencing it
    except IntegrityError:
        if client_message_id is None:
            raise
        existing = (
            await session.execute(
                select(Message).where(
                    Message.conversation_id == conversation.id,
                    Message.client_message_id == client_message_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        if existing.sender_user_id != sender.id or existing.body != clean:
            raise IdempotencyConflict() from None
        return existing

    conversation.last_message_at = message.created_at or created_at
    # Sending implicitly reads the thread for the sender.
    if sender.id == conversation.participant_a_user_id:
        conversation.participant_a_last_read_at = conversation.last_message_at
    else:
        conversation.participant_b_last_read_at = conversation.last_message_at

    recipient_id = other_participant_id(conversation, sender.id)
    # The inbox thread is keyed by the anchoring record id (application/interest),
    # which is also the OwnerInteraction id the frontend opens via ?thread=.
    record_id = str(conversation.application_id or conversation.talent_interest_id or conversation.id)
    if conversation.context_type == "job_application":
        # participant A is the applicant; participant B is the recruiter.
        recipient_mode = "talent" if recipient_id == conversation.participant_a_user_id else "recruiter"
    else:
        # participant A sent the hiring request; participant B owns the talent listing.
        recipient_mode = "recruiter" if recipient_id == conversation.participant_a_user_id else "talent"
    sender_name = sender.display_name or sender.username or sender.email
    if notify_recipient:
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
            action_url=f"/applications?view=inbox&mode={recipient_mode}&thread={record_id}",
            payload={"conversation_id": str(conversation.id), "thread_id": record_id},
        )
    if commit:
        await session.commit()
        await session.refresh(message)
    else:
        await session.flush()
    return message


#: Composer intents that genuinely ask the other participant for something.
#: Only these justify a high-confidence "waiting on them" / "needs your reply"
#: work state; anything else stays descriptive.
RESPONSE_EXPECTING_INTENTS = frozenset(
    {
        "ask_question",
        "request_portfolio",
        "check_availability",
        "propose_interview",
        "request_confirmation",
    }
)


def intent_metadata(intent: str | None) -> dict | None:
    """Message metadata for an optional composer intent.

    Returns ``None`` for a plain freeform message so ordinary sends stay exactly
    as they were — no metadata, no behaviour change, and no way for freeform text
    to imply an expectation the sender never made.
    """
    if not intent:
        return None
    return {"intent": intent, "response_expected": intent in RESPONSE_EXPECTING_INTENTS}


def serialize_message(
    message: Message,
    viewer_id: UUID,
    sender_name: str | None = None,
    *,
    counterparty_last_read_at: datetime | None = None,
) -> dict:
    message_created_at = _as_utc(message.created_at)
    counterparty_read_at = _as_utc(counterparty_last_read_at)
    metadata = message.metadata_json or {}
    serialized = {
        "id": str(message.id),
        "conversation_id": str(message.conversation_id),
        "sender_user_id": str(message.sender_user_id),
        "from_me": message.sender_user_id == viewer_id,
        "sender_name": sender_name,
        "body": message.body,
        "kind": metadata.get("kind"),
        "created_at": message.created_at.isoformat() if message.created_at else None,
        "read_by_recipient": bool(
            message.sender_user_id == viewer_id
            and message_created_at is not None
            and counterparty_read_at is not None
            and message_created_at <= counterparty_read_at
        ),
    }
    # The composer intent, curated like everything else here. Both participants
    # may see it: it says only "this message asked for something", which is
    # exactly what the sender chose to communicate, and it carries no private
    # evaluation state.
    intent = metadata.get("intent")
    if isinstance(intent, str) and intent:
        serialized["intent"] = intent
        serialized["response_expected"] = bool(metadata.get("response_expected"))
    # Expose a curated structured payload for the automated screening-question message so
    # the Inbox can render it natively instead of reparsing the text body. No other
    # message metadata is leaked.
    if metadata.get("message_kind") == "screening_questions":
        questions = metadata.get("questions")
        serialized["message_kind"] = "screening_questions"
        serialized["automated"] = bool(metadata.get("automated"))
        serialized["screening"] = {
            "questions": questions if isinstance(questions, list) else [],
            "application_id": metadata.get("application_id"),
            "job_id": metadata.get("job_id"),
            "snapshot_version": metadata.get("snapshot_version"),
        }
    # The applicant's answers to those questions, snapshotted against the
    # questions as they were asked. Curated the same way: the payload is built
    # by the server from the question message plus the responses, never echoed
    # back from client input, so a later edit to the job cannot rewrite what was
    # already answered.
    if metadata.get("message_kind") == "screening_answers":
        answers = metadata.get("answers")
        serialized["message_kind"] = "screening_answers"
        serialized["screening_answers"] = {
            "answers": answers if isinstance(answers, list) else [],
            "snapshot_version": metadata.get("snapshot_version"),
            "answered_at": metadata.get("answered_at"),
        }
    return serialized


def serialize_conversation(
    conversation: Conversation,
    viewer_id: UUID,
    unread: int,
    *,
    interaction_blocked: bool = False,
    blocked_by_me: bool = False,
    is_closed: bool = False,
) -> dict:
    viewer_last_read_at = _last_read_for(conversation, viewer_id)
    counterparty_last_read_at = (
        None if interaction_blocked else counterparty_last_read_for(conversation, viewer_id)
    )
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
        "viewer_last_read_at": viewer_last_read_at.isoformat() if viewer_last_read_at else None,
        "counterparty_last_read_at": (
            counterparty_last_read_at.isoformat() if counterparty_last_read_at else None
        ),
        "interaction_blocked": interaction_blocked,
        "blocked_by_me": blocked_by_me,
        "is_closed": is_closed,
    }
