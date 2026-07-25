from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.core.rate_limit import CHECKOUT_LIMIT, MARKETPLACE_ACTION_LIMIT, REPORT_LIMIT, rate_limit
from app.models import (
    Conversation,
    Entitlement,
    EngagementReview,
    InteractionPrivateNote,
    InteractionStatusEvent,
    Job,
    JobApplication,
    Message,
    Notification,
    Report,
    SavedJob,
    SavedTalentListing,
    TalentInterest,
    TalentListing,
    User,
)
from app.notifications import dispatch_notification
from app.realtime import events as realtime_events
from app.services.messaging_service import (
    get_or_create_conversation_for_application,
    get_or_create_conversation_for_interest,
)
from app.services import (
    blocking_service,
    interaction_status,
    interaction_transition_service as transitions,
    messaging_service as ms,
    review_service,
)
from app.schemas.job import JobRead
from pydantic import BaseModel

from app.schemas.marketplace import (
    ActivitySummaryResponse,
    ApplicationTransitionResponse,
    EntitlementRead,
    JobApplicationBulkStatusUpdate,
    JobApplicationCreate,
    JobApplicationRead,
    JobApplicationStatusUpdate,
    InteractionPrivateNoteCreate,
    InteractionPrivateNoteRead,
    InteractionArchiveUpdate,
    InteractionTransitionRequest,
    LaunchCheckoutRequest,
    ManagerNoteUpdate,
    NotificationListResponse,
    NotificationRead,
    ReportCreate,
    ReportRead,
    SavedJobRead,
    SavedJobSummaryItem,
    SavedSummaryResponse,
    SavedTalentListingRead,
    SavedTalentSummaryItem,
    SaveJobRequest,
    SaveTalentListingRequest,
    TalentInterestBulkStatusUpdate,
    TalentInterestCreate,
    TalentInterestRead,
    TalentInterestStatusUpdate,
    TalentInterestTransitionResponse,
    TalentListingCreate,
    TalentListingListResponse,
    TalentListingRead,
    TalentListingUpdate,
)

router = APIRouter(tags=["marketplace"])
logger = logging.getLogger(__name__)


async def _emit_transition_message_best_effort(
    session: AsyncSession,
    *,
    conversation: Conversation | None,
    message_id: UUID | None,
    interaction_type: str,
    interaction_id: UUID,
    note_message_id: UUID | None = None,
) -> None:
    """Emit realtime state only after commit and never invalidate that commit.

    The manager's optional note is a second committed message, so it has to be
    fanned out alongside the trusted status message; otherwise the decision
    arrives live and the explanation for it only turns up on the next poll.
    Emitted in write order so the recipient reads the outcome before the note.
    """
    if conversation is None:
        return
    for emitted_id in (message_id, note_message_id):
        if emitted_id is None:
            continue
        message = await session.get(Message, emitted_id)
        if message is None:
            continue
        try:
            await realtime_events.emit_message_created(
                session, conversation=conversation, message=message
            )
        except Exception:
            logger.exception(
                "interaction_realtime_delivery_failed",
                extra={"transition": {
                    "interaction_type": interaction_type,
                    "interaction_id": str(interaction_id),
                    "trusted_message_id": str(emitted_id),
                    "final_outcome": "committed_delivery_pending",
                    "structured_error_code": "realtime_delivery_failed",
                }},
            )


def _transition_http_error(exc: transitions.TransitionError) -> HTTPException:
    if isinstance(exc, transitions.TransitionForbidden):
        code = status.HTTP_403_FORBIDDEN
    elif isinstance(exc, transitions.StaleTransition):
        code = status.HTTP_409_CONFLICT
    elif isinstance(
        exc,
        (
            transitions.InvalidTransition,
            transitions.IdempotencyConflict,
            transitions.IntegrityViolation,
        ),
    ):
        code = status.HTTP_409_CONFLICT
    else:
        code = status.HTTP_422_UNPROCESSABLE_ENTITY
    detail: dict[str, object] = {"code": exc.code, "message": str(exc)}
    if isinstance(exc, transitions.StaleTransition):
        detail.update(current_status=exc.current_status, current_version=exc.current_version)
    return HTTPException(status_code=code, detail=detail)


def _set_archive_state(
    conversation: Conversation, viewer_id: UUID, *, archived: bool
) -> None:
    value = datetime.now(UTC) if archived else None
    if viewer_id == conversation.participant_a_user_id:
        conversation.participant_a_archived_at = value
    elif viewer_id == conversation.participant_b_user_id:
        conversation.participant_b_archived_at = value
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conversation participant required",
        )


#: Historical participant-visible value. "Shortlisted" is no longer a stage a
#: manager can enter, but some applicants were genuinely told it at the time, and
#: that update really happened — regressing them to "Application received" would
#: erase a real communication. They keep a stable, honest label until a later
#: shared outcome supersedes it.
LEGACY_SHARED_SHORTLISTED = "shortlisted"


def _participant_facing_status(participant_status: str | None) -> str:
    """Map stored participant state to what the sender should read."""
    if participant_status == LEGACY_SHARED_SHORTLISTED:
        return "under_consideration"
    return participant_status or "new"


def _application_read_for_sender(application: JobApplication) -> JobApplicationRead:
    """Serialize an application for its sender (applicant): the job owner's
    private manager_note must never leak to the applicant."""
    read = JobApplicationRead.model_validate(application)
    read.status = _participant_facing_status(application.participant_status)
    read.manager_note = None
    read.legacy_archive_resolution_required = False
    return read


def _interest_read_for_sender(interest: TalentInterest) -> TalentInterestRead:
    """Serialize a hiring request for its sender (recruiter): the talent's
    private manager_note must never leak to the recruiter."""
    if interest.status == "contacted":
        interest.status = "accepted"
    if interest.participant_status == "contacted":
        interest.participant_status = "accepted"
    read = TalentInterestRead.model_validate(interest)
    read.status = interest.participant_status or "new"
    read.manager_note = None
    read.legacy_archive_resolution_required = False
    return read


async def _application_read(
    session: AsyncSession,
    application: JobApplication,
    viewer_id: UUID,
    *,
    sender_view: bool,
) -> JobApplicationRead:
    read = _application_read_for_sender(application) if sender_view else JobApplicationRead.model_validate(application)
    applicant = await session.get(User, application.applicant_user_id)
    snapshot = application.applicant_snapshot or {}
    read.applicant_display_name = (
        (applicant.display_name or applicant.username) if applicant is not None
        else snapshot.get("display_name") or snapshot.get("username") or "Former collaborator"
    )
    read.applicant_username = applicant.username if applicant is not None else snapshot.get("username")
    read.applicant_avatar_url = applicant.avatar_url if applicant is not None else None
    conversation = (
        await session.execute(
            select(Conversation).where(Conversation.application_id == application.id)
        )
    ).scalar_one_or_none()
    if conversation is not None:
        read.archived_at = (
            conversation.participant_a_archived_at
            if viewer_id == conversation.participant_a_user_id
            else conversation.participant_b_archived_at
        )
    engagement = await review_service.engagement_for_application(session, application.id)
    if engagement is not None:
        read.engagement = await review_service.engagement_summary(session, engagement, viewer_id)
    history_query = select(InteractionStatusEvent).where(
        InteractionStatusEvent.interaction_type == "application",
        InteractionStatusEvent.interaction_id == application.id,
    )
    if sender_view:
        history_query = history_query.where(InteractionStatusEvent.audience == "participants")
    read.status_history = list(
        (await session.execute(history_query.order_by(InteractionStatusEvent.created_at))).scalars().all()
    )
    return read


async def _interest_read(
    session: AsyncSession,
    interest: TalentInterest,
    viewer_id: UUID,
    *,
    sender_view: bool,
) -> TalentInterestRead:
    if interest.status == "contacted":
        interest.status = "accepted"
    if interest.participant_status == "contacted":
        interest.participant_status = "accepted"
    read = _interest_read_for_sender(interest) if sender_view else TalentInterestRead.model_validate(interest)
    recruiter = (
        await session.execute(select(User).where(User.id == interest.recruiter_user_id))
    ).scalar_one_or_none()
    if recruiter is not None:
        read.recruiter_display_name = (
            recruiter.display_name or recruiter.username or "Recruiter"
        )
        read.recruiter_username = recruiter.username
        read.recruiter_avatar_url = recruiter.avatar_url
    conversation = (
        await session.execute(
            select(Conversation).where(Conversation.talent_interest_id == interest.id)
        )
    ).scalar_one_or_none()
    if conversation is not None:
        read.archived_at = (
            conversation.participant_a_archived_at
            if viewer_id == conversation.participant_a_user_id
            else conversation.participant_b_archived_at
        )
    engagement = await review_service.engagement_for_interest(session, interest.id)
    if engagement is not None:
        read.engagement = await review_service.engagement_summary(session, engagement, viewer_id)
    history_query = select(InteractionStatusEvent).where(
        InteractionStatusEvent.interaction_type == "hiring_request",
        InteractionStatusEvent.interaction_id == interest.id,
    )
    if sender_view:
        history_query = history_query.where(InteractionStatusEvent.audience == "participants")
    read.status_history = list(
        (await session.execute(history_query.order_by(InteractionStatusEvent.created_at))).scalars().all()
    )
    return read


def _now() -> datetime:
    return datetime.now(UTC)


def _clean_list(values: list[str] | None) -> list[str]:
    return [item.strip() for item in values or [] if item and item.strip()]


def _first_message_answer_filled(value: object) -> bool:
    """Server-side completeness check for a single first-message answer.

    Registry-free on purpose: it mirrors the frontend's "is this answer non-empty"
    rule across every answer shape (plain text, currency/turnaround objects,
    portfolio/link/tool lists) without duplicating the TS requirement registry.
    URL/format validation stays on the client; the server enforces presence so a
    required field cannot be left blank by a direct API call.
    """
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        # Structured answers: currency {amount, unit}, turnaround {value, unit}.
        if "amount" in value:
            return bool(str(value.get("amount") or "").strip())
        if "value" in value and "unit" in value:
            return bool(str(value.get("value") or "").strip())
        return any(_first_message_answer_filled(item) for item in value.values())
    if isinstance(value, (list, tuple, set)):
        return any(_first_message_answer_filled(item) for item in value)
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return True
    return bool(value)


def _assert_first_message_complete(
    required_keys: list[str] | None,
    answers: dict | None,
) -> None:
    """Reject creation when any owner-configured requirement is missing/blank."""
    if not required_keys:
        return
    answers = answers or {}
    missing = [
        key for key in required_keys if not _first_message_answer_filled(answers.get(key))
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Missing required first-message details: {', '.join(missing)}",
        )


SCREENING_QUESTIONS_ANSWER_KEY = "screening_questions"
SCREENING_RESPONSE_MAX_LENGTH = 5000

# Deterministic namespace for the automated screening-question Inbox message. The
# message's client_message_id = uuid5(namespace, f"{application_id}:{snapshot_version}")
# so the (conversation_id, client_message_id) uniqueness constraint makes delivery
# idempotent across retries, refreshes, and concurrent duplicate application requests.
SCREENING_MESSAGE_NAMESPACE = uuid5(NAMESPACE_URL, "creatorjobs:screening-questions-message")


def _snapshot_screening_questions(raw: object) -> list[dict[str, object]]:
    """Build an ordered, sanitized snapshot of a job's screening questions.

    Read directly from the authoritative job record (never from candidate input) so a
    candidate cannot modify, omit, inject, or replay questions.
    """
    if not isinstance(raw, list):
        return []
    snapshot: list[dict[str, object]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("prompt") or "").strip()
        if not prompt:
            continue
        guidance_raw = item.get("response_guidance")
        guidance = str(guidance_raw).strip() if guidance_raw else ""
        snapshot.append(
            {
                "id": str(item.get("id")) if item.get("id") else str(index),
                "position": index,
                "prompt": prompt,
                "required": bool(item.get("required")),
                "response_guidance": guidance or None,
            }
        )
    return snapshot


def _screening_snapshot_version(snapshot: list[dict[str, object]]) -> str:
    """Stable version derived from the ordered question content (idempotency key part)."""
    payload = json.dumps(
        [(q["position"], q["prompt"], q["required"]) for q in snapshot],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _screening_message_body(snapshot: list[dict[str, object]]) -> str:
    """Human-readable fallback body for notifications and unsupported clients."""
    lines = ["A few questions from the hiring team:", ""]
    for number, question in enumerate(snapshot, start=1):
        suffix = " (Required)" if question["required"] else ""
        lines.append(f"{number}. {question['prompt']}{suffix}")
    lines.append("")
    lines.append("Reply in this conversation with your answers.")
    return "\n".join(lines)


async def _send_screening_questions_message(
    session: AsyncSession,
    *,
    job: Job,
    application: JobApplication,
    conversation: Conversation | None,
) -> None:
    """After a successful application, deliver the job's screening questions as one
    automated hiring-side Inbox message in the application conversation.

    Runs inside the application transaction (``commit=False``) so the message is atomic
    with the application. Idempotent via the deterministic client_message_id.
    """
    if conversation is None or job.posted_by_user_id is None:
        return
    snapshot = _snapshot_screening_questions(job.screening_questions)
    if not snapshot:
        return
    owner = await session.get(User, job.posted_by_user_id)
    if owner is None:
        return
    snapshot_version = _screening_snapshot_version(snapshot)
    metadata: dict[str, object] = {
        "message_kind": "screening_questions",
        "automated": True,
        "application_id": str(application.id),
        "job_id": str(job.id),
        "snapshot_version": snapshot_version,
        "snapshot_at": _now().isoformat(),
        "source": "job_screening_snapshot",
        "questions": snapshot,
    }
    client_message_id = uuid5(
        SCREENING_MESSAGE_NAMESPACE, f"{application.id}:{snapshot_version}"
    )
    try:
        await ms.post_message(
            session,
            conversation,
            owner,
            _screening_message_body(snapshot),
            kind="screening_questions",
            metadata=metadata,
            client_message_id=client_message_id,
            notify_recipient=True,
            allow_closed=True,
            allow_blocked=True,
            commit=False,
        )
    except ms.NotAParticipant:
        # Should not happen (the owner is always participant B), but never fail the
        # application over the automated message.
        logger.warning(
            "Skipped screening message: owner is not a conversation participant",
            extra={"application_id": str(application.id)},
        )


def _application_validation_error(
    *,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> HTTPException:
    detail: dict[str, object] = {"code": code, "message": message}
    if field_errors:
        detail["field_errors"] = field_errors
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=detail,
    )


def _normalize_screening_question_answers(
    questions: list[dict[str, object]] | None,
    answers: dict,
) -> None:
    """Validate candidate screening responses and replace client metadata.

    Screening responses share the existing first-message JSON envelope so the
    application remains migration-free. Clients submit entries shaped as
    ``{"question_index": 0, "response": "..."}``. Prompt text, required state,
    and response guidance are always rebuilt from the job: a caller cannot forge
    the question that recruiters later see in the application summary.
    """

    canonical_questions = [question for question in questions or [] if isinstance(question, dict)]
    if not canonical_questions:
        answers.pop(SCREENING_QUESTIONS_ANSWER_KEY, None)
        return

    raw_entries = answers.get(SCREENING_QUESTIONS_ANSWER_KEY, [])
    field_errors: dict[str, list[str]] = {}
    responses_by_index: dict[int, str] = {}

    if not isinstance(raw_entries, list):
        field_errors[f"first_message_answers.{SCREENING_QUESTIONS_ANSWER_KEY}"] = [
            "Screening question answers must be a list."
        ]
        raw_entries = []

    for position, entry in enumerate(raw_entries):
        entry_field = (
            f"first_message_answers.{SCREENING_QUESTIONS_ANSWER_KEY}.{position}"
        )
        if not isinstance(entry, dict):
            field_errors[entry_field] = ["Use a structured screening question answer."]
            continue

        question_index = entry.get("question_index")
        if (
            isinstance(question_index, bool)
            or not isinstance(question_index, int)
            or question_index < 0
            or question_index >= len(canonical_questions)
        ):
            field_errors[f"{entry_field}.question_index"] = [
                "Select a valid screening question."
            ]
            continue
        if question_index in responses_by_index:
            field_errors[f"{entry_field}.question_index"] = [
                "Answer each screening question only once."
            ]
            continue

        response = entry.get("response", "")
        if not isinstance(response, str):
            field_errors[f"{entry_field}.response"] = ["Enter a text response."]
            continue
        normalized_response = response.strip()
        if len(normalized_response) > SCREENING_RESPONSE_MAX_LENGTH:
            field_errors[f"{entry_field}.response"] = [
                f"Keep the response under {SCREENING_RESPONSE_MAX_LENGTH} characters."
            ]
            continue
        responses_by_index[question_index] = normalized_response

    snapshots: list[dict[str, object]] = []
    for question_index, question in enumerate(canonical_questions):
        prompt = str(question.get("prompt") or "").strip()
        required = bool(question.get("required", True))
        response_guidance = str(question.get("response_guidance") or "").strip() or None
        response = responses_by_index.get(question_index, "")
        if required and not response:
            field_errors[
                f"first_message_answers.{SCREENING_QUESTIONS_ANSWER_KEY}.{question_index}.response"
            ] = ["Answer this required screening question."]
        snapshots.append(
            {
                "question_index": question_index,
                "prompt": prompt,
                "required": required,
                "response_guidance": response_guidance,
                "response": response,
            }
        )

    if field_errors:
        raise _application_validation_error(
            code="APPLICATION_VALIDATION_FAILED",
            message="Complete the requested application details.",
            field_errors=field_errors,
        )

    answers[SCREENING_QUESTIONS_ANSWER_KEY] = snapshots


def _application_deadline_passed(deadline: datetime | None) -> bool:
    if deadline is None:
        return False
    normalized = deadline if deadline.tzinfo is not None else deadline.replace(tzinfo=UTC)
    return normalized <= _now()


async def _create_notification(
    session: AsyncSession,
    *,
    user_id: UUID | None,
    type_: str,
    title: str,
    body: str | None = None,
    category: str = "system",
    resource_type: str | None = None,
    resource_id: str | None = None,
    action_url: str | None = None,
    actor_user_id: UUID | None = None,
    payload: dict | None = None,
) -> None:
    # Thin wrapper around the central dispatch service: writes the in-app row and
    # queues a (mocked) email when the event has email enabled in the registry.
    # A notification must never break the user action that triggered it, so any
    # unexpected dispatch failure is logged and swallowed here.
    try:
        await dispatch_notification(
            session,
            event_key=type_,
            recipient_user_id=user_id,
            title=title,
            body=body,
            actor_user_id=actor_user_id,
            category=category,
            resource_type=resource_type,
            resource_id=resource_id,
            action_url=action_url,
            payload=payload,
        )
    except Exception:
        logger.exception("notification_dispatch_failed", extra={"event_key": type_})


def _job_snapshot(job: Job) -> dict:
    return {
        "id": str(job.id),
        "title": job.title,
        "category": job.category,
        "location": job.location,
        "budget_amount": str(job.budget_amount) if job.budget_amount is not None else None,
        "budget_max": str(job.budget_max) if job.budget_max is not None else None,
        "budget_note": job.budget_note,
        "budget_currency": job.budget_currency,
        "budget_unit": job.budget_unit,
        "work_mode": job.work_mode,
        "contract_type": job.contract_type,
        "channel_name": job.channel_name,
        "hiring_display_name": job.hiring_display_name_snapshot,
        "is_verified": job.is_verified,
        "status": job.status,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


def _candidate_safe_job_read(job: Job) -> JobRead:
    read = JobRead.model_validate(job)
    read.screening_questions = None
    read.languages = []
    read.language_requirements = None
    return read


def _public_job_predicates() -> tuple[object, ...]:
    suspended_owner = (
        select(User.id)
        .where(
            User.id == Job.posted_by_user_id,
            User.suspended_at.isnot(None),
        )
        .exists()
    )
    return (
        Job.status == "published",
        Job.deleted_at.is_(None),
        ~suspended_owner,
    )


def _talent_snapshot(listing: TalentListing) -> dict:
    return {
        "id": str(listing.id),
        "title": listing.title,
        "primary_role": listing.primary_role,
        "roles": listing.roles or [],
        "niche": listing.niche,
        "content_niches": listing.content_niches or [],
        "content_genres": listing.content_genres or [],
        "formats": listing.formats or [],
        "platforms": listing.platforms or [],
        "tools": listing.tools or [],
        "location": listing.location,
        "timezone": listing.timezone,
        "availability_status": listing.availability_status,
        "rate_min": float(listing.rate_min) if listing.rate_min is not None else None,
        "rate_max": float(listing.rate_max) if listing.rate_max is not None else None,
        "rate_currency": listing.rate_currency,
        "status": listing.status,
        "created_at": listing.created_at.isoformat() if listing.created_at else None,
    }


def _talent_read(listing: TalentListing, owner: User | None = None) -> TalentListingRead:
    return TalentListingRead.model_validate(listing).model_copy(
        update={
            "owner_display_name": owner.display_name if owner else None,
            "owner_username": owner.username if owner else None,
            "owner_avatar_url": owner.avatar_url if owner else None,
        }
    )


def _parse_uuid_or_none(value: str) -> UUID | None:
    try:
        return UUID(value)
    except (TypeError, ValueError):
        return None


def _target_action_url(target_type: str | None, target_id: str | None) -> str:
    if target_type == "job" and target_id:
        return f"/jobs/{target_id}"
    if target_type == "talent_listing" and target_id:
        return f"/talent/{target_id}"
    return "/activity?tab=drafts"


async def _talent_reads_with_owners(
    session: AsyncSession, listings: list[TalentListing]
) -> list[TalentListingRead]:
    if not listings:
        return []
    owner_ids = {listing.owner_user_id for listing in listings}
    owners = (
        await session.execute(select(User).where(User.id.in_(owner_ids)))
    ).scalars().all()
    owners_by_id = {owner.id: owner for owner in owners}
    return [_talent_read(listing, owners_by_id.get(listing.owner_user_id)) for listing in listings]


async def _get_job_or_404(session: AsyncSession, job_id: UUID) -> Job:
    job = (
        await session.execute(select(Job).where(Job.id == job_id, Job.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


async def _get_listing_or_404(session: AsyncSession, listing_id: UUID) -> TalentListing:
    listing = (
        await session.execute(
            select(TalentListing).where(TalentListing.id == listing_id, TalentListing.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if listing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Talent listing not found")
    return listing


@router.post("/jobs/{job_id}/save", response_model=SavedJobRead)
async def save_job(
    job_id: UUID,
    payload: SaveJobRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SavedJobRead:
    job = (
        await session.execute(
            select(Job).where(Job.id == job_id, *_public_job_predicates())
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found",
        )
    snapshot = _job_snapshot(job)
    existing = (
        await session.execute(select(SavedJob).where(SavedJob.user_id == current_user.id, SavedJob.job_id == job_id))
    ).scalar_one_or_none()
    if existing is not None:
        existing.note = payload.note
        existing.job_snapshot = snapshot
        await session.commit()
        await session.refresh(existing)
        return SavedJobRead.model_validate(existing)
    saved = SavedJob(user_id=current_user.id, job_id=job_id, note=payload.note, job_snapshot=snapshot)
    session.add(saved)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        saved = (
            await session.execute(select(SavedJob).where(SavedJob.user_id == current_user.id, SavedJob.job_id == job_id))
        ).scalar_one()
    await session.refresh(saved)
    return SavedJobRead.model_validate(saved)


@router.delete("/jobs/{job_id}/save", response_model=dict)
async def unsave_job(
    job_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    existing = (
        await session.execute(select(SavedJob).where(SavedJob.user_id == current_user.id, SavedJob.job_id == job_id))
    ).scalar_one_or_none()
    if existing is not None:
        await session.delete(existing)
        await session.commit()
    return {"ok": True}


@router.get("/me/saved-jobs", response_model=list[SavedJobRead])
async def list_saved_jobs(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[SavedJobRead]:
    rows = (
        await session.execute(
            select(SavedJob).where(SavedJob.user_id == current_user.id).order_by(SavedJob.created_at.desc())
        )
    ).scalars().all()
    return [SavedJobRead.model_validate(row) for row in rows]


@router.get("/jobs/{job_id}/application", response_model=JobApplicationRead | None)
async def get_my_application_for_job(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> JobApplicationRead | None:
    """Return the caller's one application for this immutable job listing.

    The job page uses this relationship read after refresh/sign-in so it never
    relies on transient client state to decide whether Apply is available.
    """

    await _get_job_or_404(session, job_id)
    application = (
        await session.execute(
            select(JobApplication).where(
                JobApplication.job_id == job_id,
                JobApplication.applicant_user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if application is None:
        return None
    result = await _application_read(session, application, current_user.id, sender_view=True)
    await session.commit()
    return result


@router.post(
    "/jobs/{job_id}/applications",
    response_model=JobApplicationRead,
    status_code=status.HTTP_201_CREATED,
)
async def apply_to_job(
    job_id: UUID,
    payload: JobApplicationCreate,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> JobApplicationRead:
    job = await _get_job_or_404(session, job_id)
    applicant_user_id = current_user.id
    if job.posted_by_user_id == applicant_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot apply to your own job")
    existing = (
        await session.execute(
            select(JobApplication).where(
                JobApplication.job_id == job_id,
                JobApplication.applicant_user_id == applicant_user_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _application_read_for_sender(existing)
    if job.status != "published" or job.posted_by_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This job is not accepting applications",
        )
    owner_is_active = (
        await session.execute(
            select(User.id).where(
                User.id == job.posted_by_user_id,
                User.suspended_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if owner_is_active is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This job is not accepting applications",
        )
    if job.application_mode == "external":
        raise _application_validation_error(
            code="EXTERNAL_APPLICATION_ONLY",
            message="This job accepts applications on an external site.",
        )
    if _application_deadline_passed(job.deadline_at):
        raise _application_validation_error(
            code="APPLICATION_DEADLINE_PASSED",
            message="The application deadline for this job has passed.",
        )
    try:
        await blocking_service.assert_can_interact(
            session, applicant_user_id, job.posted_by_user_id
        )
    except blocking_service.InteractionBlocked as exc:
        # Do not disclose which participant owns a private block relationship.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This job is unavailable for direct interaction",
        ) from exc
    # Enforce the owner's first-message requirements server-side so a direct API
    # call cannot bypass the completion modal the frontend presents.
    first_message_answers = dict(payload.first_message_answers or {})
    # Screening questions are no longer collected before applying — CreatorJobs sends
    # them into the Inbox conversation afterwards (see _send_screening_questions_message).
    # Drop any client-supplied screening answers so a direct API call cannot inject or
    # replay them onto the application; historical applications keep their stored answers.
    first_message_answers.pop(SCREENING_QUESTIONS_ANSWER_KEY, None)
    _assert_first_message_complete(job.application_requirements, first_message_answers)
    application = JobApplication(
        job_id=job_id,
        applicant_user_id=applicant_user_id,
        job_owner_user_id=job.posted_by_user_id,
        cover_note=payload.cover_note.strip() if payload.cover_note else None,
        portfolio_item_ids=_clean_list(payload.portfolio_item_ids),
        first_message_answers=first_message_answers,
        applicant_snapshot={
            "display_name": current_user.display_name,
            "username": current_user.username,
            "headline": current_user.headline,
            "skills": current_user.skills or [],
            "location": current_user.location,
            "timezone": current_user.timezone,
        },
    )
    job.applicants = int(job.applicants or 0) + 1
    session.add(application)
    # Flush so the DB-side default assigns application.id before we reference it in the
    # recruiter notification — otherwise resource_id is stamped as the string "None"
    # and the notification can't deep-link back to this application.
    try:
        await session.flush()
    except IntegrityError:
        # A second concurrent Apply request can pass the lookup before the first
        # transaction commits. The database uniqueness constraint is the final
        # arbiter; return the winning application instead of leaking a 500.
        await session.rollback()
        existing = (
            await session.execute(
                select(JobApplication).where(
                    JobApplication.job_id == job_id,
                    JobApplication.applicant_user_id == applicant_user_id,
                )
            )
        ).scalar_one()
        return _application_read_for_sender(existing)
    # Eagerly create the conversation thread for this application so both sides can
    # message immediately (older applications get one lazily on first open).
    conversation: Conversation | None = None
    if job.posted_by_user_id is not None:
        conversation = await get_or_create_conversation_for_application(session, application)
    # After the application + conversation exist, deliver the job's screening questions
    # as one automated hiring-side message in the same conversation (ordering: the
    # candidate's synthesized first message, then this snapshot message). Atomic with the
    # application (commit=False) and idempotent, so retries never duplicate it.
    await _send_screening_questions_message(
        session, job=job, application=application, conversation=conversation
    )
    applicant_name = current_user.display_name or current_user.username or current_user.email
    await _create_notification(
        session,
        user_id=job.posted_by_user_id,
        type_="new_applicant",
        title="New applicant received",
        body=f"{applicant_name} applied to {job.title}.",
        category="application",
        resource_type="job_application",
        resource_id=str(application.id),
        action_url=f"/applications?view=inbox&mode=recruiter&thread={application.id}",
        actor_user_id=applicant_user_id,
        payload={"job_title": job.title, "applicant_name": applicant_name},
    )
    await _create_notification(
        session,
        user_id=applicant_user_id,
        type_="application_submitted",
        title="Application submitted",
        body=f"Your application for {job.title} was sent.",
        category="application",
        resource_type="job_application",
        resource_id=str(application.id),
        action_url=f"/applications?view=inbox&mode=talent&thread={application.id}",
        payload={"job_title": job.title},
    )
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = (
            await session.execute(
                select(JobApplication).where(
                    JobApplication.job_id == job_id,
                    JobApplication.applicant_user_id == applicant_user_id,
                )
            )
        ).scalar_one()
        return _application_read_for_sender(existing)
    await session.refresh(application)
    return _application_read_for_sender(application)


@router.get("/me/applications/sent", response_model=list[JobApplicationRead])
async def list_sent_applications(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[JobApplicationRead]:
    rows = (
        await session.execute(
            select(JobApplication)
            .where(JobApplication.applicant_user_id == current_user.id)
            .order_by(JobApplication.created_at.desc())
        )
    ).scalars().all()
    result = [await _application_read(session, row, current_user.id, sender_view=True) for row in rows]
    await session.commit()
    return result


@router.get("/me/applications/received", response_model=list[JobApplicationRead])
async def list_received_applications(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[JobApplicationRead]:
    rows = (
        await session.execute(
            select(JobApplication)
            .where(JobApplication.job_owner_user_id == current_user.id)
            .order_by(JobApplication.created_at.desc())
        )
    ).scalars().all()
    result = [await _application_read(session, row, current_user.id, sender_view=False) for row in rows]
    await session.commit()
    return result


class ReviewStartedResponse(BaseModel):
    changed: bool
    current_status: str
    status_version: int


@router.post("/applications/{application_id}/review-started", response_model=ReviewStartedResponse)
async def mark_application_review_started(
    application_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ReviewStartedResponse:
    """Record a deliberate open. Private, owner-only, idempotent.

    Never messages or notifies the applicant, and never touches
    ``participant_status`` — from their side nothing has happened.
    """
    try:
        changed, status_value, version = await transitions.mark_review_started(
            session,
            interaction_type="application",
            interaction_id=application_id,
            actor=current_user,
        )
        await session.commit()
    except transitions.TransitionError as exc:
        await session.rollback()
        raise _transition_http_error(exc) from exc
    return ReviewStartedResponse(changed=changed, current_status=status_value, status_version=version)


@router.post("/talent-interests/{interest_id}/review-started", response_model=ReviewStartedResponse)
async def mark_interest_review_started(
    interest_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ReviewStartedResponse:
    try:
        changed, status_value, version = await transitions.mark_review_started(
            session,
            interaction_type="hiring_request",
            interaction_id=interest_id,
            actor=current_user,
        )
        await session.commit()
    except transitions.TransitionError as exc:
        await session.rollback()
        raise _transition_http_error(exc) from exc
    return ReviewStartedResponse(changed=changed, current_status=status_value, status_version=version)


@router.post("/applications/{application_id}/transition", response_model=ApplicationTransitionResponse)
async def transition_application_status(
    application_id: UUID,
    payload: InteractionTransitionRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ApplicationTransitionResponse:
    actor_user_id = current_user.id
    try:
        result = await transitions.transition_application(
            session,
            application_id=application_id,
            actor=current_user,
            requested_status=payload.status,
            expected_version=payload.expected_version,
            idempotency_key=str(payload.idempotency_key),
        )
        await session.commit()
    except transitions.TransitionError as exc:
        await session.rollback()
        logger.warning(
            "interaction_transition_rejected",
            extra={
                "transition": {
                    "interaction_type": "application",
                    "interaction_id": str(application_id),
                    "actor_user_id": str(actor_user_id),
                    "requested_status": payload.status,
                    "expected_version": payload.expected_version,
                    "idempotency_key": str(payload.idempotency_key),
                    "final_outcome": "rejected",
                    "structured_error_code": exc.code,
                }
            },
        )
        raise _transition_http_error(exc) from exc
    except Exception:
        await session.rollback()
        logger.exception(
            "interaction_transition_failed",
            extra={"transition": {
                "interaction_type": "application", "interaction_id": str(application_id),
                "actor_user_id": str(actor_user_id), "requested_status": payload.status,
                "expected_version": payload.expected_version,
                "idempotency_key": str(payload.idempotency_key),
                "final_outcome": "failed", "structured_error_code": "transaction_failed",
            }},
        )
        raise
    await session.refresh(result.interaction)
    read = await _application_read(session, result.interaction, actor_user_id, sender_view=False)
    await _emit_transition_message_best_effort(
        session,
        conversation=result.conversation,
        message_id=result.message_id,
        note_message_id=result.note_message_id,
        interaction_type="application",
        interaction_id=application_id,
    )
    return ApplicationTransitionResponse(
        outcome=result.outcome,
        current_status=result.interaction.status,
        status_version=result.interaction.status_version,
        application=read,
    )


@router.post("/applications/{application_id}/archive", response_model=JobApplicationRead)
async def set_application_archive_state(
    application_id: UUID,
    payload: InteractionArchiveUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> JobApplicationRead:
    application = (
        await session.execute(
            select(JobApplication).where(JobApplication.id == application_id).with_for_update()
        )
    ).scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")
    if (
        not payload.archived
        and current_user.id == application.job_owner_user_id
        and application.status == "archived"
        and application.legacy_archive_resolution_required
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "legacy_archive_resolution_required",
                "message": "Choose the current pipeline stage to restore this record.",
                "allowed_statuses": sorted(
                    interaction_status.LEGACY_APPLICATION_RESOLUTION_TARGETS
                ),
            },
        )
    conversation = await get_or_create_conversation_for_application(session, application)
    _set_archive_state(conversation, current_user.id, archived=payload.archived)
    await session.commit()
    await session.refresh(application)
    return await _application_read(
        session,
        application,
        current_user.id,
        sender_view=current_user.id == application.applicant_user_id,
    )


@router.post("/applications/{application_id}/status-communication", response_model=ApplicationTransitionResponse)
async def communicate_application_status(
    application_id: UUID,
    payload: InteractionTransitionRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ApplicationTransitionResponse:
    actor_user_id = current_user.id
    try:
        result = await transitions.share_application_status(
            session,
            application_id=application_id,
            actor=current_user,
            requested_status=payload.status,
            expected_version=payload.expected_version,
            idempotency_key=str(payload.idempotency_key),
            note=payload.note,
        )
        await session.commit()
    except transitions.TransitionError as exc:
        await session.rollback()
        logger.warning(
            "interaction_communication_rejected",
            extra={"transition": {
                "interaction_type": "application", "interaction_id": str(application_id),
                "actor_user_id": str(actor_user_id), "requested_status": payload.status,
                "expected_version": payload.expected_version,
                "idempotency_key": str(payload.idempotency_key),
                "final_outcome": "rejected", "structured_error_code": exc.code,
            }},
        )
        raise _transition_http_error(exc) from exc
    except Exception:
        await session.rollback()
        logger.exception(
            "interaction_status_communication_failed",
            extra={"transition": {
                "interaction_type": "application", "interaction_id": str(application_id),
                "actor_user_id": str(actor_user_id), "requested_status": payload.status,
                "expected_version": payload.expected_version,
                "idempotency_key": str(payload.idempotency_key),
                "final_outcome": "failed", "structured_error_code": "transaction_failed",
            }},
        )
        raise
    await session.refresh(result.interaction)
    read = await _application_read(session, result.interaction, actor_user_id, sender_view=False)
    await _emit_transition_message_best_effort(
        session,
        conversation=result.conversation,
        message_id=result.message_id,
        note_message_id=result.note_message_id,
        interaction_type="application",
        interaction_id=application_id,
    )
    return ApplicationTransitionResponse(
        outcome=result.outcome,
        current_status=result.interaction.status,
        status_version=result.interaction.status_version,
        application=read,
    )


@router.patch("/applications/{application_id}/status", response_model=JobApplicationRead)
async def update_application_status(
    application_id: UUID,
    payload: JobApplicationStatusUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> JobApplicationRead:
    application = await session.get(JobApplication, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")
    actor_user_id = current_user.id
    expected_version = application.status_version
    logger.warning(
        "legacy_transition_without_version",
        extra={"transition": {
            "interaction_type": "application",
            "interaction_id": str(application_id),
            "actor_user_id": str(actor_user_id),
            "expected_version": expected_version,
            "compatibility_route": "PATCH /applications/{id}/status",
            "removal_target": "first-party clients migrated to versioned transitions",
        }},
    )
    try:
        result = await transitions.transition_application(
            session, application_id=application_id, actor=current_user,
            requested_status=payload.status, expected_version=expected_version,
            idempotency_key=str(uuid5(NAMESPACE_URL, f"legacy:application:{application.id}:{expected_version}:{payload.status}")),
        )
        await session.commit()
    except transitions.TransitionError as exc:
        await session.rollback()
        logger.warning(
            "interaction_transition_rejected",
            extra={"transition": {
                "interaction_type": "application", "interaction_id": str(application_id),
                "actor_user_id": str(actor_user_id), "requested_status": payload.status,
                "expected_version": expected_version,
                "idempotency_key": "legacy-derived",
                "final_outcome": "rejected", "structured_error_code": exc.code,
            }},
        )
        raise _transition_http_error(exc) from exc
    except Exception:
        await session.rollback()
        logger.exception(
            "interaction_transition_failed",
            extra={"transition": {
                "interaction_type": "application", "interaction_id": str(application_id),
                "actor_user_id": str(actor_user_id), "requested_status": payload.status,
                "expected_version": expected_version, "idempotency_key": "legacy-derived",
                "final_outcome": "failed", "structured_error_code": "transaction_failed",
            }},
        )
        raise
    await session.refresh(result.interaction)
    return await _application_read(session, result.interaction, actor_user_id, sender_view=False)


@router.post("/applications/{application_id}/withdraw", response_model=JobApplicationRead)
async def withdraw_application(
    application_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> JobApplicationRead:
    application = (
        await session.execute(select(JobApplication).where(JobApplication.id == application_id))
    ).scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    actor_user_id = current_user.id
    expected_version = application.status_version
    try:
        result = await transitions.transition_application(
            session,
            application_id=application.id,
            actor=current_user,
            requested_status="withdrawn",
            expected_version=expected_version,
            idempotency_key=str(
                uuid5(
                    NAMESPACE_URL,
                    f"withdraw:application:{application.id}:{expected_version}",
                )
            ),
        )
        await session.commit()
    except transitions.TransitionError as exc:
        await session.rollback()
        logger.warning(
            "interaction_transition_rejected",
            extra={"transition": {
                "interaction_type": "application", "interaction_id": str(application_id),
                "actor_user_id": str(actor_user_id), "requested_status": "withdrawn",
                "expected_version": expected_version,
                "idempotency_key": "withdraw-derived",
                "final_outcome": "rejected", "structured_error_code": exc.code,
            }},
        )
        raise _transition_http_error(exc) from exc
    await _emit_transition_message_best_effort(
        session,
        conversation=result.conversation,
        message_id=result.message_id,
        note_message_id=result.note_message_id,
        interaction_type="application",
        interaction_id=application_id,
    )
    await session.refresh(result.interaction)
    return await _application_read(
        session, result.interaction, current_user.id, sender_view=True
    )


async def _ensure_legacy_private_note(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    application: JobApplication | None = None,
    interest: TalentInterest | None = None,
) -> None:
    if application is not None:
        source_filter = InteractionPrivateNote.application_id == application.id
    elif interest is not None:
        source_filter = InteractionPrivateNote.talent_interest_id == interest.id
    else:
        return
    existing_id = (
        await session.execute(
            select(InteractionPrivateNote.id)
            .where(
                InteractionPrivateNote.owner_user_id == owner_user_id,
                source_filter,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    source = application or interest
    if existing_id is not None or not source.manager_note:
        return
    session.add(
        InteractionPrivateNote(
            owner_user_id=owner_user_id,
            application_id=application.id if application is not None else None,
            talent_interest_id=interest.id if interest is not None else None,
            body=source.manager_note,
            created_at=source.updated_at or source.created_at,
        )
    )
    await session.flush()


async def _application_owned_by(
    session: AsyncSession, application_id: UUID, owner_user_id: UUID
) -> JobApplication:
    application = (
        await session.execute(select(JobApplication).where(JobApplication.id == application_id))
    ).scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if application.job_owner_user_id != owner_user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Application owner required")
    return application


@router.get(
    "/applications/{application_id}/notes",
    response_model=list[InteractionPrivateNoteRead],
)
async def list_application_private_notes(
    application_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[InteractionPrivateNoteRead]:
    application = await _application_owned_by(session, application_id, current_user.id)
    await _ensure_legacy_private_note(
        session, owner_user_id=current_user.id, application=application
    )
    rows = (
        await session.execute(
            select(InteractionPrivateNote)
            .where(
                InteractionPrivateNote.application_id == application_id,
                InteractionPrivateNote.owner_user_id == current_user.id,
            )
            .order_by(InteractionPrivateNote.created_at.desc(), InteractionPrivateNote.id.desc())
        )
    ).scalars().all()
    await session.commit()
    return [InteractionPrivateNoteRead.model_validate(row) for row in rows]


@router.post(
    "/applications/{application_id}/notes",
    response_model=InteractionPrivateNoteRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_application_private_note(
    application_id: UUID,
    payload: InteractionPrivateNoteCreate,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InteractionPrivateNoteRead:
    application = await _application_owned_by(session, application_id, current_user.id)
    await _ensure_legacy_private_note(
        session, owner_user_id=current_user.id, application=application
    )
    note = InteractionPrivateNote(
        owner_user_id=current_user.id,
        application_id=application.id,
        body=payload.body,
    )
    session.add(note)
    application.manager_note = payload.body
    await session.commit()
    await session.refresh(note)
    return InteractionPrivateNoteRead.model_validate(note)


@router.delete("/applications/{application_id}/notes/{note_id}", status_code=204)
async def delete_application_private_note(
    application_id: UUID,
    note_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> None:
    application = await _application_owned_by(session, application_id, current_user.id)
    note = (
        await session.execute(
            select(InteractionPrivateNote).where(
                InteractionPrivateNote.id == note_id,
                InteractionPrivateNote.application_id == application_id,
                InteractionPrivateNote.owner_user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Private note not found")
    await session.delete(note)
    await session.flush()
    application.manager_note = (
        await session.execute(
            select(InteractionPrivateNote.body)
            .where(
                InteractionPrivateNote.application_id == application_id,
                InteractionPrivateNote.owner_user_id == current_user.id,
            )
            .order_by(InteractionPrivateNote.created_at.desc(), InteractionPrivateNote.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    await session.commit()


@router.patch("/applications/{application_id}/note", response_model=JobApplicationRead)
async def update_application_manager_note(
    application_id: UUID,
    payload: ManagerNoteUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> JobApplicationRead:
    """Set/clear the job owner's private note on a received application.

    The note is a pipeline annotation for the manager only; no notification is
    dispatched and the applicant can never read it.
    """
    application = (
        await session.execute(select(JobApplication).where(JobApplication.id == application_id))
    ).scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if application.job_owner_user_id != current_user.id and current_user.account_type != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Application owner required")
    note = (payload.note or "").strip()
    if note:
        await _ensure_legacy_private_note(
            session, owner_user_id=application.job_owner_user_id, application=application
        )
        session.add(
            InteractionPrivateNote(
                owner_user_id=application.job_owner_user_id,
                application_id=application.id,
                body=note,
            )
        )
    else:
        await session.execute(
            delete(InteractionPrivateNote).where(
                InteractionPrivateNote.application_id == application.id,
                InteractionPrivateNote.owner_user_id == application.job_owner_user_id,
            )
        )
    application.manager_note = note or None
    await session.commit()
    await session.refresh(application)
    return JobApplicationRead.model_validate(application)


@router.post("/applications/bulk-status", response_model=list[JobApplicationRead])
async def bulk_update_application_status(
    payload: JobApplicationBulkStatusUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[JobApplicationRead]:
    """Move several received applications to one pipeline stage in a single call.

    Owner-only, all-or-nothing: if any id is missing or not managed by the
    caller the whole batch is rejected, so a bulk action can never silently
    skip rows. Only lower-risk private organization stages are accepted here;
    Hired and other shared outcomes must be confirmed one relationship at a time.
    """
    unique_ids = list(dict.fromkeys(payload.ids))
    applications = (
        (
            await session.execute(
                select(JobApplication)
                .where(JobApplication.id.in_(unique_ids))
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    if len(applications) != len(unique_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    is_admin = current_user.account_type == "ADMIN"
    if any(app.job_owner_user_id != current_user.id and not is_admin for app in applications):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Application owner required")
    for application in applications:
        try:
            await transitions.transition_application(
                session,
                application_id=application.id,
                actor=current_user,
                requested_status=payload.status,
                expected_version=application.status_version,
                idempotency_key=str(
                    uuid5(
                        NAMESPACE_URL,
                        f"bulk:application:{current_user.id}:{application.id}:"
                        f"{application.status_version}:{payload.status}",
                    )
                ),
            )
        except transitions.TransitionError as exc:
            raise _transition_http_error(exc) from exc
    await session.commit()
    for application in applications:
        await session.refresh(application)
    result = [
        await _application_read(session, application, current_user.id, sender_view=False)
        for application in applications
    ]
    return result


@router.get("/talent-listings", response_model=TalentListingListResponse)
async def list_talent_listings(
    q: str | None = None,
    role: str | None = None,
    location: str | None = None,
    platform: str | None = None,
    availability: str | None = None,
    status_filter: str | None = Query(default="published", alias="status"),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_db),
) -> TalentListingListResponse:
    query = (
        select(TalentListing, User)
        .join(User, TalentListing.owner_user_id == User.id)
        # Suspended owners' listings are excluded from the public marketplace.
        .where(TalentListing.deleted_at.is_(None), User.suspended_at.is_(None))
    )
    if status_filter:
        query = query.where(TalentListing.status == status_filter)
    if q:
        term = f"%{q.lower()}%"
        query = query.where(
            or_(
                func.lower(TalentListing.title).like(term),
                func.lower(TalentListing.primary_role).like(term),
                func.lower(TalentListing.niche).like(term),
                func.lower(TalentListing.description).like(term),
                func.lower(TalentListing.roles.cast(String)).like(term),
                func.lower(TalentListing.content_niches.cast(String)).like(term),
                func.lower(TalentListing.content_genres.cast(String)).like(term),
                func.lower(TalentListing.formats.cast(String)).like(term),
                func.lower(TalentListing.platforms.cast(String)).like(term),
                func.lower(TalentListing.tools.cast(String)).like(term),
                func.lower(TalentListing.languages.cast(String)).like(term),
                func.lower(User.display_name).like(term),
                func.lower(User.username).like(term),
            )
        )
    if role:
        query = query.where(func.lower(TalentListing.roles.cast(String)).like(f"%{role.lower()}%"))
    if location:
        query = query.where(func.lower(TalentListing.location).like(f"%{location.lower()}%"))
    if platform:
        query = query.where(func.lower(TalentListing.platforms.cast(String)).like(f"%{platform.lower()}%"))
    if availability:
        query = query.where(TalentListing.availability_status == availability)
    total = int((await session.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
    rows = (
        await session.execute(query.order_by(TalentListing.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return TalentListingListResponse(
        items=[_talent_read(listing, owner) for listing, owner in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/talent-listings/{listing_id}", response_model=TalentListingRead)
async def get_talent_listing(
    listing_id: UUID,
    session: AsyncSession = Depends(get_db),
) -> TalentListingRead:
    listing = await _get_listing_or_404(session, listing_id)
    if listing.status not in {"published", "featured"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Talent listing not found")
    owner = await session.get(User, listing.owner_user_id)
    if owner is not None and owner.suspended_at is not None:
        # Suspended owners' content is hidden from the public marketplace.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Talent listing not found")
    listing.views = int(listing.views or 0) + 1
    await session.commit()
    await session.refresh(listing)
    return _talent_read(listing, owner)


@router.get("/me/talent-listings", response_model=list[TalentListingRead])
async def list_my_talent_listings(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[TalentListingRead]:
    rows = (
        await session.execute(
            select(TalentListing)
            .where(TalentListing.owner_user_id == current_user.id, TalentListing.deleted_at.is_(None))
            .order_by(TalentListing.created_at.desc())
        )
    ).scalars().all()
    return [_talent_read(row, current_user) for row in rows]


@router.post("/talent-listings", response_model=TalentListingRead, status_code=status.HTTP_201_CREATED)
async def create_talent_listing(
    payload: TalentListingCreate,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TalentListingRead:
    listing = TalentListing(owner_user_id=current_user.id, **payload.model_dump())
    listing.roles = _clean_list(listing.roles)
    listing.content_niches = _clean_list(listing.content_niches)
    listing.content_genres = _clean_list(listing.content_genres)
    listing.formats = _clean_list(listing.formats)
    listing.platforms = _clean_list(listing.platforms)
    listing.tools = _clean_list(listing.tools)
    listing.languages = _clean_list(listing.languages)
    listing.portfolio_item_ids = _clean_list(listing.portfolio_item_ids)
    listing.first_message_requirements = _clean_list(listing.first_message_requirements)
    listing.first_message_custom_instruction = (listing.first_message_custom_instruction or "").strip() or None
    session.add(listing)
    await _create_notification(
        session,
        user_id=current_user.id,
        type_="talent_listing_created",
        title="Talent listing created",
        body="Your talent listing is ready to manage.",
        category="talent",
        resource_type="talent_listing",
        resource_id=str(listing.id),
        action_url=f"/talent/{listing.id}",
    )
    await session.commit()
    await session.refresh(listing)
    return _talent_read(listing, current_user)


@router.patch("/talent-listings/{listing_id}", response_model=TalentListingRead)
async def update_talent_listing(
    listing_id: UUID,
    payload: TalentListingUpdate,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TalentListingRead:
    listing = await _get_listing_or_404(session, listing_id)
    if listing.owner_user_id != current_user.id and current_user.account_type != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Talent listing owner required")
    updates = payload.model_dump(exclude_unset=True)
    for key in (
        "roles",
        "content_niches",
        "content_genres",
        "formats",
        "platforms",
        "tools",
        "portfolio_item_ids",
        "first_message_requirements",
    ):
        if key in updates:
            updates[key] = _clean_list(updates[key])
    if "first_message_custom_instruction" in updates:
        updates["first_message_custom_instruction"] = (
            updates["first_message_custom_instruction"] or ""
        ).strip() or None
    for key, value in updates.items():
        setattr(listing, key, value)
    await session.commit()
    await session.refresh(listing)
    owner = (
        current_user
        if listing.owner_user_id == current_user.id
        else await session.get(User, listing.owner_user_id)
    )
    return _talent_read(listing, owner)


@router.delete("/talent-listings/{listing_id}", response_model=dict)
async def delete_talent_listing(
    listing_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    listing = await _get_listing_or_404(session, listing_id)
    if listing.owner_user_id != current_user.id and current_user.account_type != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Talent listing owner required")
    listing.deleted_at = _now()
    listing.status = "archived"
    await session.commit()
    return {"ok": True}


@router.post("/talent-listings/{listing_id}/save", response_model=SavedTalentListingRead)
async def save_talent_listing(
    listing_id: UUID,
    payload: SaveTalentListingRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SavedTalentListingRead:
    listing = await _get_listing_or_404(session, listing_id)
    snapshot = _talent_snapshot(listing)
    existing = (
        await session.execute(
            select(SavedTalentListing).where(
                SavedTalentListing.user_id == current_user.id,
                SavedTalentListing.talent_listing_id == listing_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.note = payload.note
        existing.talent_snapshot = snapshot
        await session.commit()
        await session.refresh(existing)
        return SavedTalentListingRead.model_validate(existing)
    saved = SavedTalentListing(
        user_id=current_user.id,
        talent_listing_id=listing_id,
        note=payload.note,
        talent_snapshot=snapshot,
    )
    listing.saves = int(listing.saves or 0) + 1
    session.add(saved)
    await session.commit()
    await session.refresh(saved)
    return SavedTalentListingRead.model_validate(saved)


@router.delete("/talent-listings/{listing_id}/save", response_model=dict)
async def unsave_talent_listing(
    listing_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    existing = (
        await session.execute(
            select(SavedTalentListing).where(
                SavedTalentListing.user_id == current_user.id,
                SavedTalentListing.talent_listing_id == listing_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        await session.delete(existing)
        await session.commit()
    return {"ok": True}


@router.get("/me/saved-talent", response_model=list[SavedTalentListingRead])
async def list_saved_talent(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[SavedTalentListingRead]:
    rows = (
        await session.execute(
            select(SavedTalentListing)
            .where(SavedTalentListing.user_id == current_user.id)
            .order_by(SavedTalentListing.created_at.desc())
        )
    ).scalars().all()
    return [SavedTalentListingRead.model_validate(row) for row in rows]


@router.get("/me/saved/summary", response_model=SavedSummaryResponse)
async def saved_summary(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SavedSummaryResponse:
    saved_jobs = (
        await session.execute(
            select(SavedJob)
            .where(SavedJob.user_id == current_user.id)
            .order_by(SavedJob.created_at.desc())
        )
    ).scalars().all()
    saved_talent = (
        await session.execute(
            select(SavedTalentListing)
            .where(SavedTalentListing.user_id == current_user.id)
            .order_by(SavedTalentListing.created_at.desc())
        )
    ).scalars().all()

    job_ids = [row.job_id for row in saved_jobs]
    jobs = (
        await session.execute(
            select(Job).where(Job.id.in_(job_ids), *_public_job_predicates())
        )
        if job_ids
        else None
    )
    jobs_by_id = {job.id: job for job in jobs.scalars().all()} if jobs is not None else {}

    listing_ids = [row.talent_listing_id for row in saved_talent]
    listings = (
        await session.execute(
            select(TalentListing).where(
                TalentListing.id.in_(listing_ids),
                TalentListing.deleted_at.is_(None),
            )
        )
        if listing_ids
        else None
    )
    listing_rows = list(listings.scalars().all()) if listings is not None else []
    talent_reads = await _talent_reads_with_owners(session, listing_rows)
    talent_by_id = {item.id: item for item in talent_reads}

    return SavedSummaryResponse(
        jobs=[
            SavedJobSummaryItem(
                saved=SavedJobRead.model_validate(saved),
                job=_candidate_safe_job_read(jobs_by_id[saved.job_id])
                if saved.job_id in jobs_by_id
                else None,
            )
            for saved in saved_jobs
        ],
        talent=[
            SavedTalentSummaryItem(
                saved=SavedTalentListingRead.model_validate(saved),
                talent=talent_by_id.get(saved.talent_listing_id),
            )
            for saved in saved_talent
        ],
    )


@router.get(
    "/talent-listings/{listing_id}/interest",
    response_model=TalentInterestRead | None,
)
async def get_my_talent_interest(
    listing_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TalentInterestRead | None:
    """Return the caller's durable hiring request for this listing, if any."""

    interest = (
        await session.execute(
            select(TalentInterest).where(
                TalentInterest.talent_listing_id == listing_id,
                TalentInterest.recruiter_user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if interest is None:
        return None
    result = await _interest_read(session, interest, current_user.id, sender_view=True)
    await session.commit()
    return result


@router.post(
    "/talent-listings/{listing_id}/interest",
    response_model=TalentInterestRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_talent_interest(
    listing_id: UUID,
    payload: TalentInterestCreate,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TalentInterestRead:
    listing = await _get_listing_or_404(session, listing_id)
    recruiter_user_id = current_user.id
    if listing.owner_user_id == recruiter_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot send interest to yourself")
    existing = (
        await session.execute(
            select(TalentInterest).where(
                TalentInterest.talent_listing_id == listing_id,
                TalentInterest.recruiter_user_id == recruiter_user_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        # A listing/recruiter pair has one durable hiring-request history. A
        # revisit or retry must open that record, never reset a terminal or
        # accepted request back to "new" or overwrite its original answers.
        return _interest_read_for_sender(existing)
    if listing.status != "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This talent listing is not accepting hiring requests",
        )
    owner_is_active = (
        await session.execute(
            select(User.id).where(
                User.id == listing.owner_user_id,
                User.suspended_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if owner_is_active is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This talent listing is not accepting hiring requests",
        )
    try:
        await blocking_service.assert_can_interact(
            session, recruiter_user_id, listing.owner_user_id
        )
    except blocking_service.InteractionBlocked as exc:
        # Public listings can remain visible; only a new direct interaction is
        # unavailable and no private blocker identity is exposed.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This talent listing is unavailable for direct interaction",
        ) from exc
    invite_job: Job | None = None
    if payload.job_id is not None:
        invite_job = await _get_job_or_404(session, payload.job_id)
        if invite_job.posted_by_user_id != current_user.id and current_user.account_type != "ADMIN":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Job owner required")
        if invite_job.status in {"closed", "archived"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select an active job for this invite")
    # Enforce the talent's first-message requirements server-side so a direct API
    # call cannot bypass the completion modal the frontend presents.
    _assert_first_message_complete(
        listing.first_message_requirements, payload.first_message_answers
    )
    interest = TalentInterest(
        talent_listing_id=listing_id,
        recruiter_user_id=recruiter_user_id,
        job_id=payload.job_id,
        owner_user_id=listing.owner_user_id,
        note=payload.note.strip() if payload.note else None,
        first_message_answers=payload.first_message_answers or {},
    )
    session.add(interest)
    # Flush so interest.id is populated before it is referenced as the notification's
    # resource_id (otherwise it is stamped as the string "None").
    try:
        await session.flush()
    except IntegrityError:
        # Concurrent clicks resolve to the one request selected by the database
        # uniqueness constraint. The losing transaction produces no thread or
        # notifications of its own.
        await session.rollback()
        existing = (
            await session.execute(
                select(TalentInterest).where(
                    TalentInterest.talent_listing_id == listing_id,
                    TalentInterest.recruiter_user_id == recruiter_user_id,
                )
            )
        ).scalar_one()
        return _interest_read_for_sender(existing)
    # Eagerly create the conversation thread for this hiring request.
    await get_or_create_conversation_for_interest(session, interest)
    title = "New job invite" if invite_job is not None else "New recruiter interest"
    body = (
        f"{current_user.display_name or current_user.username or current_user.email} invited you to {invite_job.title}."
        if invite_job is not None
        else f"{current_user.display_name or current_user.username or current_user.email} is interested in your listing."
    )
    await _create_notification(
        session,
        user_id=listing.owner_user_id,
        type_="talent_interest_received",
        title=title,
        body=body,
        category="talent",
        resource_type="talent_interest",
        resource_id=str(interest.id),
        action_url=f"/applications?view=inbox&mode=talent&thread={interest.id}",
        actor_user_id=recruiter_user_id,
        payload={"job_title": invite_job.title} if invite_job is not None else {},
    )
    await session.commit()
    await session.refresh(interest)
    return _interest_read_for_sender(interest)


@router.get("/me/talent-interests", response_model=list[TalentInterestRead])
async def list_received_talent_interests(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[TalentInterestRead]:
    rows = (
        await session.execute(
            select(TalentInterest)
            .where(TalentInterest.owner_user_id == current_user.id)
            .order_by(TalentInterest.created_at.desc())
        )
    ).scalars().all()
    result = [await _interest_read(session, row, current_user.id, sender_view=False) for row in rows]
    await session.commit()
    return result


@router.get("/me/talent-interests/sent", response_model=list[TalentInterestRead])
async def list_sent_talent_interests(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[TalentInterestRead]:
    rows = (
        await session.execute(
            select(TalentInterest)
            .where(TalentInterest.recruiter_user_id == current_user.id)
            .order_by(TalentInterest.created_at.desc())
        )
    ).scalars().all()
    result = [await _interest_read(session, row, current_user.id, sender_view=True) for row in rows]
    await session.commit()
    return result


@router.post("/talent-interests/{interest_id}/transition", response_model=TalentInterestTransitionResponse)
async def transition_talent_interest_status(
    interest_id: UUID,
    payload: InteractionTransitionRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TalentInterestTransitionResponse:
    actor_user_id = current_user.id
    try:
        result = await transitions.transition_interest(
            session,
            interest_id=interest_id,
            actor=current_user,
            requested_status=payload.status,
            expected_version=payload.expected_version,
            idempotency_key=str(payload.idempotency_key),
            note=payload.note,
        )
        await session.commit()
    except transitions.TransitionError as exc:
        await session.rollback()
        logger.warning(
            "interaction_transition_rejected",
            extra={"transition": {
                "interaction_type": "hiring_request", "interaction_id": str(interest_id),
                "actor_user_id": str(actor_user_id), "requested_status": payload.status,
                "expected_version": payload.expected_version,
                "idempotency_key": str(payload.idempotency_key),
                "final_outcome": "rejected", "structured_error_code": exc.code,
            }},
        )
        raise _transition_http_error(exc) from exc
    except Exception:
        await session.rollback()
        logger.exception(
            "interaction_transition_failed",
            extra={"transition": {
                "interaction_type": "hiring_request", "interaction_id": str(interest_id),
                "actor_user_id": str(actor_user_id), "requested_status": payload.status,
                "expected_version": payload.expected_version,
                "idempotency_key": str(payload.idempotency_key),
                "final_outcome": "failed", "structured_error_code": "transaction_failed",
            }},
        )
        raise
    await session.refresh(result.interaction)
    read = await _interest_read(session, result.interaction, actor_user_id, sender_view=False)
    await _emit_transition_message_best_effort(
        session,
        conversation=result.conversation,
        message_id=result.message_id,
        note_message_id=result.note_message_id,
        interaction_type="hiring_request",
        interaction_id=interest_id,
    )
    return TalentInterestTransitionResponse(
        outcome=result.outcome,
        current_status=transitions.normalize_interest_status(result.interaction.status),
        status_version=result.interaction.status_version,
        interest=read,
    )


@router.post("/talent-interests/{interest_id}/archive", response_model=TalentInterestRead)
async def set_interest_archive_state(
    interest_id: UUID,
    payload: InteractionArchiveUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TalentInterestRead:
    interest = (
        await session.execute(
            select(TalentInterest).where(TalentInterest.id == interest_id).with_for_update()
        )
    ).scalar_one_or_none()
    if interest is None:
        raise HTTPException(status_code=404, detail="Interest not found")
    if (
        not payload.archived
        and current_user.id == interest.owner_user_id
        and interest.status == "archived"
        and interest.legacy_archive_resolution_required
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "legacy_archive_resolution_required",
                "message": "Choose the current pipeline stage to restore this record.",
                "allowed_statuses": sorted(
                    interaction_status.LEGACY_INTEREST_RESOLUTION_TARGETS
                ),
            },
        )
    conversation = await get_or_create_conversation_for_interest(session, interest)
    _set_archive_state(conversation, current_user.id, archived=payload.archived)
    await session.commit()
    await session.refresh(interest)
    return await _interest_read(
        session,
        interest,
        current_user.id,
        sender_view=current_user.id == interest.recruiter_user_id,
    )


@router.get("/me/activity/summary", response_model=ActivitySummaryResponse)
async def activity_summary(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ActivitySummaryResponse:
    my_jobs = (
        await session.execute(
            select(Job)
            .where(Job.posted_by_user_id == current_user.id, Job.deleted_at.is_(None))
            .order_by(Job.created_at.desc())
        )
    ).scalars().all()
    my_talent_listings = (
        await session.execute(
            select(TalentListing)
            .where(TalentListing.owner_user_id == current_user.id, TalentListing.deleted_at.is_(None))
            .order_by(TalentListing.created_at.desc())
        )
    ).scalars().all()
    sent_applications = (
        await session.execute(
            select(JobApplication)
            .where(JobApplication.applicant_user_id == current_user.id)
            .order_by(JobApplication.created_at.desc())
        )
    ).scalars().all()
    received_applications = (
        await session.execute(
            select(JobApplication)
            .where(JobApplication.job_owner_user_id == current_user.id)
            .order_by(JobApplication.created_at.desc())
        )
    ).scalars().all()
    received_interests = (
        await session.execute(
            select(TalentInterest)
            .where(TalentInterest.owner_user_id == current_user.id)
            .order_by(TalentInterest.created_at.desc())
        )
    ).scalars().all()
    sent_interests = (
        await session.execute(
            select(TalentInterest)
            .where(TalentInterest.recruiter_user_id == current_user.id)
            .order_by(TalentInterest.created_at.desc())
        )
    ).scalars().all()

    related_job_ids = {
        row.job_id
        for row in [*sent_applications, *received_applications, *received_interests, *sent_interests]
        if getattr(row, "job_id", None) is not None
    }
    related_jobs = (
        await session.execute(select(Job).where(Job.id.in_(related_job_ids), Job.deleted_at.is_(None)))
        if related_job_ids
        else None
    )
    related_listing_ids = {
        interest.talent_listing_id for interest in [*received_interests, *sent_interests]
    }
    related_listings = (
        await session.execute(
            select(TalentListing).where(
                TalentListing.id.in_(related_listing_ids),
                TalentListing.deleted_at.is_(None),
            )
        )
        if related_listing_ids
        else None
    )
    related_listing_rows = list(related_listings.scalars().all()) if related_listings is not None else []

    response = ActivitySummaryResponse(
        my_jobs=[JobRead.model_validate(row) for row in my_jobs],
        my_talent_listings=await _talent_reads_with_owners(session, list(my_talent_listings)),
        sent_applications=[
            await _application_read(session, row, current_user.id, sender_view=True)
            for row in sent_applications
        ],
        received_applications=[
            await _application_read(session, row, current_user.id, sender_view=False)
            for row in received_applications
        ],
        received_interests=[
            await _interest_read(session, row, current_user.id, sender_view=False)
            for row in received_interests
        ],
        sent_interests=[
            await _interest_read(session, row, current_user.id, sender_view=True)
            for row in sent_interests
        ],
        related_jobs=[
            _candidate_safe_job_read(row)
            for row in (
                related_jobs.scalars().all()
                if related_jobs is not None
                else []
            )
        ],
        related_talent_listings=await _talent_reads_with_owners(session, related_listing_rows),
    )
    await session.commit()
    return response


@router.patch("/talent-interests/{interest_id}/status", response_model=TalentInterestRead)
async def update_talent_interest_status(
    interest_id: UUID,
    payload: TalentInterestStatusUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TalentInterestRead:
    interest = await session.get(TalentInterest, interest_id)
    if interest is None:
        raise HTTPException(status_code=404, detail="Interest not found")
    actor_user_id = current_user.id
    expected_version = interest.status_version
    logger.warning(
        "legacy_transition_without_version",
        extra={"transition": {
            "interaction_type": "hiring_request",
            "interaction_id": str(interest_id),
            "actor_user_id": str(actor_user_id),
            "expected_version": expected_version,
            "compatibility_route": "PATCH /talent-interests/{id}/status",
            "removal_target": "first-party clients migrated to versioned transitions",
        }},
    )
    try:
        result = await transitions.transition_interest(
            session, interest_id=interest_id, actor=current_user,
            requested_status=payload.status, expected_version=expected_version,
            idempotency_key=str(uuid5(NAMESPACE_URL, f"legacy:interest:{interest.id}:{expected_version}:{payload.status}")),
        )
        await session.commit()
    except transitions.TransitionError as exc:
        await session.rollback()
        logger.warning(
            "interaction_transition_rejected",
            extra={"transition": {
                "interaction_type": "hiring_request", "interaction_id": str(interest_id),
                "actor_user_id": str(actor_user_id), "requested_status": payload.status,
                "expected_version": expected_version, "idempotency_key": "legacy-derived",
                "final_outcome": "rejected", "structured_error_code": exc.code,
            }},
        )
        raise _transition_http_error(exc) from exc
    except Exception:
        await session.rollback()
        logger.exception(
            "interaction_transition_failed",
            extra={"transition": {
                "interaction_type": "hiring_request", "interaction_id": str(interest_id),
                "actor_user_id": str(actor_user_id), "requested_status": payload.status,
                "expected_version": expected_version, "idempotency_key": "legacy-derived",
                "final_outcome": "failed", "structured_error_code": "transaction_failed",
            }},
        )
        raise
    await session.refresh(result.interaction)
    return await _interest_read(session, result.interaction, current_user.id, sender_view=False)


@router.post("/talent-interests/{interest_id}/withdraw", response_model=TalentInterestRead)
async def withdraw_talent_interest(
    interest_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TalentInterestRead:
    interest = (
        await session.execute(select(TalentInterest).where(TalentInterest.id == interest_id))
    ).scalar_one_or_none()
    if interest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interest not found")
    actor_user_id = current_user.id
    expected_version = interest.status_version
    try:
        result = await transitions.transition_interest(
            session,
            interest_id=interest.id,
            actor=current_user,
            requested_status="withdrawn",
            expected_version=expected_version,
            idempotency_key=str(
                uuid5(
                    NAMESPACE_URL,
                    f"withdraw:hiring-request:{interest.id}:{expected_version}",
                )
            ),
        )
        await session.commit()
    except transitions.TransitionError as exc:
        await session.rollback()
        logger.warning(
            "interaction_transition_rejected",
            extra={"transition": {
                "interaction_type": "hiring_request", "interaction_id": str(interest_id),
                "actor_user_id": str(actor_user_id), "requested_status": "withdrawn",
                "expected_version": expected_version, "idempotency_key": "withdraw-derived",
                "final_outcome": "rejected", "structured_error_code": exc.code,
            }},
        )
        raise _transition_http_error(exc) from exc
    except Exception:
        await session.rollback()
        logger.exception(
            "interaction_transition_failed",
            extra={"transition": {
                "interaction_type": "hiring_request", "interaction_id": str(interest_id),
                "actor_user_id": str(actor_user_id), "requested_status": "withdrawn",
                "expected_version": expected_version, "idempotency_key": "withdraw-derived",
                "final_outcome": "failed", "structured_error_code": "transaction_failed",
            }},
        )
        raise
    await _emit_transition_message_best_effort(
        session,
        conversation=result.conversation,
        message_id=result.message_id,
        note_message_id=result.note_message_id,
        interaction_type="hiring_request",
        interaction_id=interest_id,
    )
    await session.refresh(result.interaction)
    return await _interest_read(
        session, result.interaction, current_user.id, sender_view=True
    )


async def _interest_owned_by(
    session: AsyncSession, interest_id: UUID, owner_user_id: UUID
) -> TalentInterest:
    interest = (
        await session.execute(select(TalentInterest).where(TalentInterest.id == interest_id))
    ).scalar_one_or_none()
    if interest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interest not found")
    if interest.owner_user_id != owner_user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Interest owner required")
    return interest


@router.get(
    "/talent-interests/{interest_id}/notes",
    response_model=list[InteractionPrivateNoteRead],
)
async def list_interest_private_notes(
    interest_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[InteractionPrivateNoteRead]:
    interest = await _interest_owned_by(session, interest_id, current_user.id)
    await _ensure_legacy_private_note(
        session, owner_user_id=current_user.id, interest=interest
    )
    rows = (
        await session.execute(
            select(InteractionPrivateNote)
            .where(
                InteractionPrivateNote.talent_interest_id == interest_id,
                InteractionPrivateNote.owner_user_id == current_user.id,
            )
            .order_by(InteractionPrivateNote.created_at.desc(), InteractionPrivateNote.id.desc())
        )
    ).scalars().all()
    await session.commit()
    return [InteractionPrivateNoteRead.model_validate(row) for row in rows]


@router.post(
    "/talent-interests/{interest_id}/notes",
    response_model=InteractionPrivateNoteRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_interest_private_note(
    interest_id: UUID,
    payload: InteractionPrivateNoteCreate,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> InteractionPrivateNoteRead:
    interest = await _interest_owned_by(session, interest_id, current_user.id)
    await _ensure_legacy_private_note(
        session, owner_user_id=current_user.id, interest=interest
    )
    note = InteractionPrivateNote(
        owner_user_id=current_user.id,
        talent_interest_id=interest.id,
        body=payload.body,
    )
    session.add(note)
    interest.manager_note = payload.body
    await session.commit()
    await session.refresh(note)
    return InteractionPrivateNoteRead.model_validate(note)


@router.delete("/talent-interests/{interest_id}/notes/{note_id}", status_code=204)
async def delete_interest_private_note(
    interest_id: UUID,
    note_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> None:
    interest = await _interest_owned_by(session, interest_id, current_user.id)
    note = (
        await session.execute(
            select(InteractionPrivateNote).where(
                InteractionPrivateNote.id == note_id,
                InteractionPrivateNote.talent_interest_id == interest_id,
                InteractionPrivateNote.owner_user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Private note not found")
    await session.delete(note)
    await session.flush()
    interest.manager_note = (
        await session.execute(
            select(InteractionPrivateNote.body)
            .where(
                InteractionPrivateNote.talent_interest_id == interest_id,
                InteractionPrivateNote.owner_user_id == current_user.id,
            )
            .order_by(InteractionPrivateNote.created_at.desc(), InteractionPrivateNote.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    await session.commit()


@router.patch("/talent-interests/{interest_id}/note", response_model=TalentInterestRead)
async def update_talent_interest_manager_note(
    interest_id: UUID,
    payload: ManagerNoteUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TalentInterestRead:
    """Set/clear the talent's private note on a received hiring request.

    Manager-only annotation; no notification, never visible to the recruiter.
    """
    interest = (
        await session.execute(select(TalentInterest).where(TalentInterest.id == interest_id))
    ).scalar_one_or_none()
    if interest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interest not found")
    if interest.owner_user_id != current_user.id and current_user.account_type != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Interest owner required")
    note = (payload.note or "").strip()
    if note:
        await _ensure_legacy_private_note(
            session, owner_user_id=interest.owner_user_id, interest=interest
        )
        session.add(
            InteractionPrivateNote(
                owner_user_id=interest.owner_user_id,
                talent_interest_id=interest.id,
                body=note,
            )
        )
    else:
        await session.execute(
            delete(InteractionPrivateNote).where(
                InteractionPrivateNote.talent_interest_id == interest.id,
                InteractionPrivateNote.owner_user_id == interest.owner_user_id,
            )
        )
    interest.manager_note = note or None
    await session.commit()
    await session.refresh(interest)
    return TalentInterestRead.model_validate(interest)


@router.post("/talent-interests/bulk-status", response_model=list[TalentInterestRead])
async def bulk_update_talent_interest_status(
    payload: TalentInterestBulkStatusUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[TalentInterestRead]:
    """Move several received hiring requests to one stage in a single call.

    Owner-only and all-or-nothing. Only private Reviewing is available in bulk;
    Accepted and Declined are consequential shared decisions made one at a time.
    """
    unique_ids = list(dict.fromkeys(payload.ids))
    interests = (
        (
            await session.execute(
                select(TalentInterest)
                .where(TalentInterest.id.in_(unique_ids))
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    if len(interests) != len(unique_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interest not found")
    is_admin = current_user.account_type == "ADMIN"
    if any(interest.owner_user_id != current_user.id and not is_admin for interest in interests):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Interest owner required")
    for interest in interests:
        try:
            await transitions.transition_interest(
                session,
                interest_id=interest.id,
                actor=current_user,
                requested_status=payload.status,
                expected_version=interest.status_version,
                idempotency_key=str(
                    uuid5(
                        NAMESPACE_URL,
                        f"bulk:hiring-request:{current_user.id}:{interest.id}:"
                        f"{interest.status_version}:{payload.status}",
                    )
                ),
            )
        except transitions.TransitionError as exc:
            raise _transition_http_error(exc) from exc
    await session.commit()
    for interest in interests:
        # Creating an engagement flushes the session and expires server-managed
        # timestamp attributes on SQLite/Postgres. Refresh before Pydantic reads
        # the row so bulk acceptance follows the same safe path as the single
        # status endpoint instead of attempting async IO during serialization.
        await session.refresh(interest)
    result = [
        await _interest_read(session, interest, current_user.id, sender_view=False)
        for interest in interests
    ]
    return result


@router.get("/notifications", response_model=NotificationListResponse)
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> NotificationListResponse:
    rows = (
        await session.execute(
            select(Notification)
            .where(Notification.user_id == current_user.id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    unread = int(
        (
            await session.execute(
                select(func.count()).select_from(Notification).where(
                    Notification.user_id == current_user.id,
                    Notification.read_at.is_(None),
                )
            )
        ).scalar_one()
    )
    return NotificationListResponse(
        items=[NotificationRead.model_validate(row) for row in rows],
        unread_count=unread,
    )


@router.patch("/notifications/{notification_id}/read", response_model=NotificationRead)
async def mark_notification_read(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> NotificationRead:
    notification = (
        await session.execute(
            select(Notification).where(Notification.id == notification_id, Notification.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.read_at = notification.read_at or _now()
    await session.commit()
    await session.refresh(notification)
    return NotificationRead.model_validate(notification)


@router.post("/notifications/mark-all-read", response_model=dict)
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    rows = (
        await session.execute(
            select(Notification).where(Notification.user_id == current_user.id, Notification.read_at.is_(None))
        )
    ).scalars().all()
    now = _now()
    for row in rows:
        row.read_at = now
    await session.commit()
    return {"ok": True, "updated": len(rows)}


async def _report_target_exists(session: AsyncSession, target_type: str, target_id: str) -> bool:
    """A report must point at something real — otherwise the admin queue fills
    with unactionable rows and target hydration can never resolve them."""
    parsed = _parse_uuid_or_none(target_id)
    if parsed is None:
        return False
    model = {
        "job": Job,
        "talent_listing": TalentListing,
        "profile": User,
        "message": Message,
        "review": EngagementReview,
    }.get(target_type)
    if model is None:
        return False
    row = (await session.execute(select(model.id).where(model.id == parsed))).scalar_one_or_none()
    return row is not None


@router.post("/reports", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
async def create_report(
    payload: ReportCreate,
    _limit: None = rate_limit(REPORT_LIMIT),
    current_user: User | None = Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
) -> ReportRead:
    if not await _report_target_exists(session, payload.target_type, payload.target_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report target not found")
    report = Report(
        reporter_user_id=current_user.id if current_user else None,
        target_type=payload.target_type,
        target_id=payload.target_id,
        category=payload.category,
        note=payload.note,
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return ReportRead.model_validate(report)


@router.get("/me/jobs", response_model=list[JobRead])
async def list_my_jobs(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[JobRead]:
    rows = (
        await session.execute(
            select(Job)
            .where(Job.posted_by_user_id == current_user.id, Job.deleted_at.is_(None))
            .order_by(Job.created_at.desc())
        )
    ).scalars().all()
    return [JobRead.model_validate(row) for row in rows]


# The admin report queue moved to app/api/v1/routers/admin.py (GET/PATCH
# /admin/reports): enum-enforced actions, pagination, target hydration, and
# audit-log writes live there.


@router.post("/checkout/launch-free", response_model=EntitlementRead, status_code=status.HTTP_201_CREATED)
async def complete_launch_free_checkout(
    payload: LaunchCheckoutRequest,
    _limit: None = rate_limit(CHECKOUT_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EntitlementRead:
    entitlement = Entitlement(
        user_id=current_user.id,
        kind=payload.kind,
        target_type=payload.target_type,
        target_id=payload.target_id,
        source="free_launch",
        status="active",
        metadata_json={"price": 0, "currency": "INR", "launch_free": True},
        checkout_intent_id=payload.checkout_intent_id,
    )
    session.add(entitlement)
    await _create_notification(
        session,
        user_id=current_user.id,
        type_="launch_free_checkout_completed",
        title="Launch-free access confirmed",
        body="This marketplace action is free during launch.",
        category="checkout",
        resource_type=payload.target_type,
        resource_id=payload.target_id,
        action_url=_target_action_url(payload.target_type, payload.target_id),
    )
    await session.commit()
    await session.refresh(entitlement)
    return EntitlementRead.model_validate(entitlement)


@router.get("/me/entitlements", response_model=list[EntitlementRead])
async def list_my_entitlements(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[EntitlementRead]:
    rows = (
        await session.execute(
            select(Entitlement).where(Entitlement.user_id == current_user.id).order_by(Entitlement.created_at.desc())
        )
    ).scalars().all()
    return [EntitlementRead.model_validate(row) for row in rows]
