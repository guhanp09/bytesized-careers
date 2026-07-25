"""Interview coordination: the smallest workflow that lets two people meet.

Scope is deliberately narrow. This arranges *one* conversation's interview —
when, in whose time zone, how, and whether the other side confirmed. It is not a
calendar: no third-party invitations, no availability grids, no recurrence, no
external sync, and no reminder scheduler of its own. Anything richer belongs in
the tools people already use.

Three guarantees shape every function here:

* **Nothing participant-visible happens without the organiser saying so.** The
  applicant learns of an interview because the organiser sent an invitation, not
  because a message mentioned a day of the week. No text is ever parsed for
  intent.
* **One authoritative path.** Where an interview implies a lifecycle change, it
  goes through ``interaction_transition_service`` — the same versioned, atomic,
  idempotent path every other status change uses — rather than a second private
  route that could disagree with it.
* **A retry changes nothing twice.** Every mutation carries the caller's
  idempotency key; a replay of the same key returns the row it already produced.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Conversation,
    InteractionInterview,
    Job,
    JobApplication,
    TalentInterest,
    TalentListing,
    User,
)
from app.notifications import dispatch_notification
from app.services import interaction_transition_service as transitions
from app.services import messaging_service

logger = logging.getLogger(__name__)

MeetingMethod = Literal["video_call", "phone", "in_person", "other"]

#: How the method reads in a message. Plain words, because the other participant
#: is being told where to turn up, not shown a database value.
METHOD_LABELS: dict[str, str] = {
    "video_call": "Video call",
    "phone": "Phone call",
    "in_person": "In person",
    "other": "Details in the message",
}

#: An interview may be arranged a little in the past (people write things up
#: afterwards) but not absurdly so, and not so far ahead that it is obviously a
#: typo in the year.
MIN_SCHEDULE_OFFSET_DAYS = 30
MAX_SCHEDULE_OFFSET_DAYS = 365
MAX_DETAIL_LENGTH = 500
MAX_NOTE_LENGTH = 2000
#: Beyond this, an arranged interview stops being "coming up" and starts being
#: something the organiser owes a decision on.
FOLLOW_UP_GRACE_MINUTES = 60


class InterviewError(Exception):
    code = "interview_error"


class InterviewForbidden(InterviewError):
    code = "forbidden"


class InvalidInterview(InterviewError):
    code = "invalid_interview"


class StaleInterview(InterviewError):
    """Someone else changed the arrangement while this form was open."""

    code = "stale_interview"

    def __init__(self, current_version: int):
        super().__init__("The interview changed — the latest arrangement is loaded.")
        self.current_version = current_version


class InterviewNotFound(InterviewError):
    code = "not_found"


@dataclass
class InterviewResult:
    outcome: Literal["created", "rescheduled", "confirmed", "completed", "cancelled", "unchanged"]
    interview: InteractionInterview
    message_id: uuid.UUID | None = None
    note_message_id: uuid.UUID | None = None
    #: True when this call also moved the interaction's participant-visible
    #: status (an invitation on an application does; a reschedule never does).
    status_changed: bool = False


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime | None) -> datetime | None:
    """Read a stored timestamp back as an explicit UTC instant.

    Not cosmetic. Postgres returns `timestamptz` values already aware, but
    SQLite has no time-zone type and hands back a naive datetime — which
    `astimezone` would then interpret as the *server's* local zone, and which
    `isoformat` would emit without an offset for a browser to misread as its
    own local time. Either mistake shows someone a confident, wrong interview
    time, so every read of a stored instant goes through here.
    """
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _log(event: str, **fields: object) -> None:
    logger.info(event, extra={"interview": fields})


def organiser_id(conversation: Conversation) -> uuid.UUID | None:
    """Who may arrange the interview.

    Participant B is the managing side of both context types — the job owner on
    an application, the listing owner on a hiring request — so one rule covers
    both. The counterparty is never blocked from *talking* about timing; they
    simply do not own the arrangement, in the same way they do not own the stage.
    """
    return conversation.participant_b_user_id


def _require_organiser(conversation: Conversation, actor: User) -> None:
    if actor.id != organiser_id(conversation) and actor.account_type != "ADMIN":
        raise InterviewForbidden("Only the person managing this conversation can arrange the interview.")


def _require_participant(conversation: Conversation, actor: User) -> None:
    if not messaging_service.is_participant(conversation, actor.id):
        raise InterviewForbidden("Not a conversation participant.")


def _validate_timezone(name: str) -> str:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
        raise InvalidInterview("That time zone isn't recognised.") from exc
    return name


def _validate_schedule(scheduled_at: datetime) -> datetime:
    when = scheduled_at if scheduled_at.tzinfo else scheduled_at.replace(tzinfo=UTC)
    delta_days = (when - _now()).total_seconds() / 86400
    if delta_days < -MIN_SCHEDULE_OFFSET_DAYS:
        raise InvalidInterview("That date is too far in the past to arrange.")
    if delta_days > MAX_SCHEDULE_OFFSET_DAYS:
        raise InvalidInterview("That date is more than a year away — check the year.")
    return when.astimezone(UTC)


def describe_schedule(interview: InteractionInterview) -> str:
    """One line naming when and how, in the organiser's stated zone.

    The zone is spelled out because "4pm" is ambiguous across two countries and
    a missed interview is a genuinely costly mistake. Clients additionally render
    the instant in the reader's own zone; this string is what goes into the
    message body, which has no client to help it.
    """
    scheduled = _as_utc(interview.scheduled_at) or _now()
    try:
        local = scheduled.astimezone(ZoneInfo(interview.timezone))
        zone = interview.timezone
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        local = scheduled.astimezone(UTC)
        zone = "UTC"
    stamp = local.strftime("%a %-d %b, %-I:%M %p")
    parts = [f"{stamp} ({zone})", METHOD_LABELS.get(interview.meeting_method, "Details in the message")]
    if interview.duration_minutes:
        parts.append(f"{interview.duration_minutes} min")
    return " · ".join(parts)


# --- reads -----------------------------------------------------------------


async def get_interview(
    session: AsyncSession, conversation_id: uuid.UUID
) -> InteractionInterview | None:
    return (
        await session.execute(
            select(InteractionInterview).where(
                InteractionInterview.conversation_id == conversation_id
            )
        )
    ).scalar_one_or_none()


async def list_for_user(session: AsyncSession, user_id: uuid.UUID) -> list[InteractionInterview]:
    """Every interview on a conversation the caller takes part in.

    Scoped by a join to the caller's conversations, so there is no parameter
    through which someone could read an arrangement they are not part of.
    """
    rows = (
        await session.execute(
            select(InteractionInterview)
            .join(Conversation, Conversation.id == InteractionInterview.conversation_id)
            .where(
                (Conversation.participant_a_user_id == user_id)
                | (Conversation.participant_b_user_id == user_id)
            )
        )
    ).scalars().all()
    return list(rows)


def follow_up_due(interview: InteractionInterview | None, *, now: datetime | None = None) -> bool:
    """Has an arranged interview reached the point of owing a decision?

    True once a proposed or confirmed interview's time has passed (plus a short
    grace period, so the queue does not nag while the call is still happening),
    and true for a completed interview until a decision closes the record. False
    for anything cancelled — a call that never happened owes nothing.
    """
    if interview is None:
        return False
    if interview.status == "completed":
        return True
    if interview.status not in {"proposed", "confirmed"}:
        return False
    reference = now or _now()
    scheduled = _as_utc(interview.scheduled_at)
    if scheduled is None:
        return False
    return (reference - scheduled).total_seconds() > FOLLOW_UP_GRACE_MINUTES * 60


# --- context ---------------------------------------------------------------


async def _context_label(session: AsyncSession, conversation: Conversation) -> str:
    if conversation.application_id:
        application = await session.get(JobApplication, conversation.application_id)
        if application is not None:
            title = (
                await session.execute(select(Job.title).where(Job.id == application.job_id))
            ).scalar_one_or_none()
            return title or "this job"
        return "this job"
    if conversation.talent_interest_id:
        interest = await session.get(TalentInterest, conversation.talent_interest_id)
        if interest is not None:
            title = (
                await session.execute(
                    select(TalentListing.title).where(TalentListing.id == interest.talent_listing_id)
                )
            ).scalar_one_or_none()
            return title or "this hiring request"
    return "this conversation"


async def _notify_counterparty(
    session: AsyncSession,
    *,
    conversation: Conversation,
    actor: User,
    title: str,
    body: str,
    dedupe_key: str,
) -> None:
    recipient_id = messaging_service.other_participant_id(conversation, actor.id)
    record_id = str(
        conversation.application_id or conversation.talent_interest_id or conversation.id
    )
    if conversation.context_type == "job_application":
        recipient_mode = "talent" if recipient_id == conversation.participant_a_user_id else "recruiter"
    else:
        recipient_mode = "recruiter" if recipient_id == conversation.participant_a_user_id else "talent"
    await dispatch_notification(
        session,
        event_key="interview_updated",
        recipient_user_id=recipient_id,
        actor_user_id=actor.id,
        title=title,
        body=body,
        category="application",
        resource_type="conversation",
        resource_id=str(conversation.id),
        action_url=f"/applications?view=inbox&mode={recipient_mode}&thread={record_id}",
        payload={"conversation_id": str(conversation.id)},
        dedupe_key=dedupe_key,
        strict_outbox=True,
    )


async def _post_interview_message(
    session: AsyncSession,
    *,
    conversation: Conversation,
    actor: User,
    body: str,
    request_key: str,
    suffix: str,
) -> uuid.UUID:
    """The platform's own record of what was arranged.

    Marked ``interview_update`` so clients can render it as an arrangement rather
    than as something the organiser typed, and keyed off the request so a retry
    resolves to the same row instead of announcing the same time twice.
    """
    message = await messaging_service.post_message(
        session,
        conversation,
        actor,
        body,
        kind="interview_update",
        allow_closed=True,
        allow_blocked=True,
        notify_recipient=False,
        commit=False,
        client_message_id=uuid.uuid5(
            uuid.NAMESPACE_URL, f"creatorjobs:interview:{suffix}:{request_key}"
        ),
        metadata={"interview": True},
    )
    return message.id


async def _post_organiser_note(
    session: AsyncSession,
    *,
    conversation: Conversation,
    actor: User,
    note: str | None,
    request_key: str,
    suffix: str,
) -> uuid.UUID | None:
    """The organiser's own words, kept attributable to them.

    Posted as an ordinary message in the same transaction as the arrangement, so
    an invitation can never arrive without the explanation that was written to
    accompany it.
    """
    clean = (note or "").strip()
    if not clean:
        return None
    message = await messaging_service.post_message(
        session,
        conversation,
        actor,
        clean[:MAX_NOTE_LENGTH],
        allow_closed=True,
        allow_blocked=True,
        notify_recipient=False,
        commit=False,
        client_message_id=uuid.uuid5(
            uuid.NAMESPACE_URL, f"creatorjobs:interview-note:{suffix}:{request_key}"
        ),
    )
    return message.id


# --- mutations -------------------------------------------------------------


async def propose(
    session: AsyncSession,
    *,
    conversation: Conversation,
    actor: User,
    scheduled_at: datetime,
    timezone_name: str,
    meeting_method: str,
    meeting_detail: str | None,
    duration_minutes: int | None,
    note: str | None,
    expected_version: int,
    idempotency_key: str,
    application_expected_version: int | None = None,
) -> InterviewResult:
    """Invite to an interview, or move one that is already arranged.

    ``expected_version`` is 0 for a first invitation and the current version for
    a reschedule, so a stale form is refused rather than silently overwriting a
    time the other tab already sent.

    On an application, a first invitation also moves the record to the
    participant-visible ``interviewing`` stage. That runs through the ordinary
    transition service, which owns the version check, the trusted event, the
    exactly-once notification and the delivery intent — so an interview
    invitation is auditable in exactly the same way every other shared outcome
    is. A reschedule changes no status: the stage is still "interviewing".
    """
    _require_organiser(conversation, actor)
    when = _validate_schedule(scheduled_at)
    zone = _validate_timezone(timezone_name)
    if meeting_method not in METHOD_LABELS:
        raise InvalidInterview("Choose how you'll meet.")
    detail = (meeting_detail or "").strip()[:MAX_DETAIL_LENGTH] or None

    existing = (
        await session.execute(
            select(InteractionInterview)
            .where(InteractionInterview.conversation_id == conversation.id)
            .with_for_update()
        )
    ).scalar_one_or_none()

    # A replay of the same submit returns what it already produced. Checked
    # before the version comparison, because a retry legitimately carries the
    # version it saw *before* its own first attempt succeeded.
    if existing is not None and existing.last_request_key == idempotency_key:
        return InterviewResult("unchanged", existing)

    if existing is None:
        if expected_version not in (0, 1):
            raise StaleInterview(0)
    elif existing.version != expected_version:
        raise StaleInterview(existing.version)

    # A finished or abandoned arrangement is not rescheduled — it is replaced by
    # a new round, so "reschedule_count" keeps meaning "times this one moved".
    starting_new_round = existing is not None and existing.status in {"completed", "cancelled"}
    rescheduling = existing is not None and not starting_new_round

    if existing is None:
        interview = InteractionInterview(
            conversation_id=conversation.id,
            status="proposed",
            scheduled_at=when,
            timezone=zone,
            duration_minutes=duration_minutes,
            meeting_method=meeting_method,
            meeting_detail=detail,
            proposed_by_user_id=actor.id,
            version=1,
            last_request_key=idempotency_key,
        )
        session.add(interview)
        try:
            await session.flush()
        except IntegrityError:
            # Another tab created it between the SELECT and the INSERT. The
            # unique constraint is the arbiter; report the conflict rather than
            # overwriting a time the other request already announced.
            await session.rollback()
            current = await get_interview(session, conversation.id)
            raise StaleInterview(current.version if current else 0) from None
    else:
        interview = existing
        interview.previous_scheduled_at = interview.scheduled_at
        interview.scheduled_at = when
        interview.timezone = zone
        interview.duration_minutes = duration_minutes
        interview.meeting_method = meeting_method
        interview.meeting_detail = detail
        interview.status = "proposed"
        interview.confirmed_at = None
        interview.confirmed_by_user_id = None
        interview.version += 1
        interview.last_request_key = idempotency_key
        if starting_new_round:
            interview.round_number += 1
            interview.reschedule_count = 0
            interview.completed_at = None
            interview.cancelled_at = None
            interview.cancel_reason = None
        else:
            interview.reschedule_count += 1
        await session.flush()

    schedule_line = describe_schedule(interview)
    if detail:
        schedule_line = f"{schedule_line}\n{detail}"

    label = await _context_label(session, conversation)
    status_changed = False
    message_id: uuid.UUID | None = None
    note_message_id: uuid.UUID | None = None

    application = (
        await session.get(JobApplication, conversation.application_id)
        if conversation.application_id
        else None
    )
    should_transition = (
        application is not None
        and not rescheduling
        and application.status != "interviewing"
        and application.participant_status not in {"hired", "rejected", "withdrawn"}
    )

    if should_transition and application is not None:
        result = await transitions.transition_application(
            session,
            application_id=application.id,
            actor=actor,
            requested_status="interviewing",
            expected_version=(
                application_expected_version
                if application_expected_version is not None
                else application.status_version
            ),
            idempotency_key=f"interview:{idempotency_key}",
            detail_line=schedule_line,
            note=note,
        )
        status_changed = result.outcome == "transitioned"
        message_id = result.message_id
        note_message_id = result.note_message_id
    else:
        headline = (
            f"Interview moved for “{label}”." if rescheduling else f"Interview invitation for “{label}”."
        )
        if rescheduling and interview.previous_scheduled_at is not None:
            headline = f"{headline} It was previously arranged for another time."
        message_id = await _post_interview_message(
            session,
            conversation=conversation,
            actor=actor,
            body=f"{headline}\n{schedule_line}",
            request_key=idempotency_key,
            suffix="propose",
        )
        note_message_id = await _post_organiser_note(
            session,
            conversation=conversation,
            actor=actor,
            note=note,
            request_key=idempotency_key,
            suffix="propose",
        )
        await _notify_counterparty(
            session,
            conversation=conversation,
            actor=actor,
            title="Interview moved" if rescheduling else "Interview invitation",
            body=f"{label} — {describe_schedule(interview)}",
            dedupe_key=f"interview:{interview.id}:v{interview.version}",
        )

    await session.flush()
    _log(
        "interview_proposed",
        interview_id=str(interview.id),
        conversation_id=str(conversation.id),
        actor_user_id=str(actor.id),
        version=interview.version,
        round_number=interview.round_number,
        reschedule_count=interview.reschedule_count,
        status_changed=status_changed,
        outcome="rescheduled" if rescheduling else "created",
    )
    return InterviewResult(
        "rescheduled" if rescheduling else "created",
        interview,
        message_id=message_id,
        note_message_id=note_message_id,
        status_changed=status_changed,
    )


async def confirm(
    session: AsyncSession,
    *,
    conversation: Conversation,
    actor: User,
    expected_version: int,
    idempotency_key: str,
) -> InterviewResult:
    """The invited participant says the time works.

    Either participant may confirm — the organiser confirming their own proposal
    is meaningful when the time was agreed verbally elsewhere — but it is the
    counterparty's confirmation that the organiser is usually waiting for, so the
    notification always goes to the other side.
    """
    _require_participant(conversation, actor)
    interview = (
        await session.execute(
            select(InteractionInterview)
            .where(InteractionInterview.conversation_id == conversation.id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if interview is None:
        raise InterviewNotFound("There is no interview to confirm.")
    if interview.last_request_key == idempotency_key:
        return InterviewResult("unchanged", interview)
    if interview.status == "confirmed":
        return InterviewResult("unchanged", interview)
    if interview.status != "proposed":
        raise InvalidInterview("This interview is no longer awaiting confirmation.")
    if interview.version != expected_version:
        raise StaleInterview(interview.version)

    interview.status = "confirmed"
    interview.confirmed_at = _now()
    interview.confirmed_by_user_id = actor.id
    interview.version += 1
    interview.last_request_key = idempotency_key
    await session.flush()

    label = await _context_label(session, conversation)
    message_id = await _post_interview_message(
        session,
        conversation=conversation,
        actor=actor,
        body=f"Interview confirmed for “{label}”.\n{describe_schedule(interview)}",
        request_key=idempotency_key,
        suffix="confirm",
    )
    await _notify_counterparty(
        session,
        conversation=conversation,
        actor=actor,
        title="Interview confirmed",
        body=f"{label} — {describe_schedule(interview)}",
        dedupe_key=f"interview:{interview.id}:v{interview.version}",
    )
    await session.flush()
    _log(
        "interview_confirmed",
        interview_id=str(interview.id),
        conversation_id=str(conversation.id),
        actor_user_id=str(actor.id),
        version=interview.version,
    )
    return InterviewResult("confirmed", interview, message_id=message_id)


async def complete(
    session: AsyncSession,
    *,
    conversation: Conversation,
    actor: User,
    expected_version: int,
    idempotency_key: str,
) -> InterviewResult:
    """Close out the arrangement. Private bookkeeping, nothing more.

    Deliberately posts no message, sends no notification, and changes no
    participant-visible status. Both people already know whether they met; what
    the organiser is recording is that *they* are done with the scheduling, which
    is their own business. It does not decide anything: the record moves into the
    follow-up queue and waits for a real decision through the ordinary
    transition path.
    """
    _require_organiser(conversation, actor)
    interview = (
        await session.execute(
            select(InteractionInterview)
            .where(InteractionInterview.conversation_id == conversation.id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if interview is None:
        raise InterviewNotFound("There is no interview to complete.")
    if interview.last_request_key == idempotency_key or interview.status == "completed":
        return InterviewResult("unchanged", interview)
    if interview.status not in {"proposed", "confirmed"}:
        raise InvalidInterview("This interview can no longer be marked complete.")
    if interview.version != expected_version:
        raise StaleInterview(interview.version)

    interview.status = "completed"
    interview.completed_at = _now()
    interview.version += 1
    interview.last_request_key = idempotency_key
    await session.flush()
    _log(
        "interview_completed",
        interview_id=str(interview.id),
        conversation_id=str(conversation.id),
        actor_user_id=str(actor.id),
        version=interview.version,
    )
    return InterviewResult("completed", interview)


async def cancel(
    session: AsyncSession,
    *,
    conversation: Conversation,
    actor: User,
    reason: str | None,
    expected_version: int,
    idempotency_key: str,
) -> InterviewResult:
    """Call the interview off, and say so.

    Never silent: the other participant may have blocked out the time, so a
    cancellation always reaches them. The interaction's stage is left alone —
    cancelling a call is not the same as deciding about the person, and inferring
    one from the other is precisely the guess this system refuses to make.
    """
    _require_organiser(conversation, actor)
    interview = (
        await session.execute(
            select(InteractionInterview)
            .where(InteractionInterview.conversation_id == conversation.id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if interview is None:
        raise InterviewNotFound("There is no interview to cancel.")
    if interview.last_request_key == idempotency_key or interview.status == "cancelled":
        return InterviewResult("unchanged", interview)
    if interview.status not in {"proposed", "confirmed"}:
        raise InvalidInterview("This interview can no longer be cancelled.")
    if interview.version != expected_version:
        raise StaleInterview(interview.version)

    interview.status = "cancelled"
    interview.cancelled_at = _now()
    interview.cancel_reason = (reason or "").strip()[:MAX_NOTE_LENGTH] or None
    interview.version += 1
    interview.last_request_key = idempotency_key
    await session.flush()

    label = await _context_label(session, conversation)
    body = f"Interview cancelled for “{label}”."
    message_id = await _post_interview_message(
        session,
        conversation=conversation,
        actor=actor,
        body=body,
        request_key=idempotency_key,
        suffix="cancel",
    )
    note_message_id = await _post_organiser_note(
        session,
        conversation=conversation,
        actor=actor,
        note=interview.cancel_reason,
        request_key=idempotency_key,
        suffix="cancel",
    )
    await _notify_counterparty(
        session,
        conversation=conversation,
        actor=actor,
        title="Interview cancelled",
        body=f"{label} — the arranged time has been cancelled.",
        dedupe_key=f"interview:{interview.id}:v{interview.version}",
    )
    await session.flush()
    _log(
        "interview_cancelled",
        interview_id=str(interview.id),
        conversation_id=str(conversation.id),
        actor_user_id=str(actor.id),
        version=interview.version,
    )
    return InterviewResult(
        "cancelled", interview, message_id=message_id, note_message_id=note_message_id
    )


# --- serialisation ---------------------------------------------------------


def serialize_interview(
    interview: InteractionInterview | None, conversation: Conversation, viewer_id: uuid.UUID
) -> dict | None:
    """The arrangement, as both participants may see it.

    Everything here was deliberately communicated, so there is nothing to
    withhold. ``can_manage`` tells the client which controls to offer; it is a
    convenience, not the authorisation — the service checks the organiser on
    every write regardless of what a client believes.
    """
    if interview is None:
        return None
    def stamp(value: datetime | None) -> str | None:
        aware = _as_utc(value)
        return aware.isoformat() if aware else None

    return {
        "id": str(interview.id),
        "conversation_id": str(interview.conversation_id),
        "status": interview.status,
        "scheduled_at": stamp(interview.scheduled_at),
        "timezone": interview.timezone,
        "duration_minutes": interview.duration_minutes,
        "meeting_method": interview.meeting_method,
        "meeting_detail": interview.meeting_detail,
        "schedule_label": describe_schedule(interview),
        "previous_scheduled_at": stamp(interview.previous_scheduled_at),
        "reschedule_count": interview.reschedule_count,
        "round_number": interview.round_number,
        "confirmed_at": stamp(interview.confirmed_at),
        "confirmed_by_me": interview.confirmed_by_user_id == viewer_id,
        "completed_at": stamp(interview.completed_at),
        "cancelled_at": stamp(interview.cancelled_at),
        "version": interview.version,
        "can_manage": organiser_id(conversation) == viewer_id,
        "follow_up_due": follow_up_due(interview),
    }
