from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.core.rate_limit import CHECKOUT_LIMIT, MARKETPLACE_ACTION_LIMIT, REPORT_LIMIT, rate_limit
from app.models import (
    Entitlement,
    EngagementReview,
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
from app.services.messaging_service import (
    get_or_create_conversation_for_application,
    get_or_create_conversation_for_interest,
)
from app.services import review_service
from app.schemas.job import JobRead
from app.schemas.marketplace import (
    ActivitySummaryResponse,
    EntitlementRead,
    JobApplicationBulkStatusUpdate,
    JobApplicationCreate,
    JobApplicationRead,
    JobApplicationStatusUpdate,
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
    TalentListingCreate,
    TalentListingListResponse,
    TalentListingRead,
    TalentListingUpdate,
)

router = APIRouter(tags=["marketplace"])


def _application_read_for_sender(application: JobApplication) -> JobApplicationRead:
    """Serialize an application for its sender (applicant): the job owner's
    private manager_note must never leak to the applicant."""
    read = JobApplicationRead.model_validate(application)
    read.manager_note = None
    return read


def _interest_read_for_sender(interest: TalentInterest) -> TalentInterestRead:
    """Serialize a hiring request for its sender (recruiter): the talent's
    private manager_note must never leak to the recruiter."""
    read = TalentInterestRead.model_validate(interest)
    read.manager_note = None
    return read


async def _application_read(
    session: AsyncSession,
    application: JobApplication,
    viewer_id: UUID,
    *,
    sender_view: bool,
) -> JobApplicationRead:
    read = _application_read_for_sender(application) if sender_view else JobApplicationRead.model_validate(application)
    engagement = await review_service.engagement_for_application(session, application.id)
    if engagement is not None:
        read.engagement = await review_service.engagement_summary(session, engagement, viewer_id)
    return read


async def _interest_read(
    session: AsyncSession,
    interest: TalentInterest,
    viewer_id: UUID,
    *,
    sender_view: bool,
) -> TalentInterestRead:
    read = _interest_read_for_sender(interest) if sender_view else TalentInterestRead.model_validate(interest)
    engagement = await review_service.engagement_for_interest(session, interest.id)
    if engagement is not None:
        read.engagement = await review_service.engagement_summary(session, engagement, viewer_id)
    return read


async def _assert_application_transition_allowed(
    session: AsyncSession, application: JobApplication, next_status: str
) -> None:
    engagement = await review_service.engagement_for_application(session, application.id)
    if engagement is None or next_status == application.status:
        return
    if next_status == "archived" and engagement.status in review_service.TERMINAL_STATES:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Use the engagement controls after a candidate has been hired.",
    )


async def _assert_interest_transition_allowed(
    session: AsyncSession, interest: TalentInterest, next_status: str
) -> None:
    engagement = await review_service.engagement_for_interest(session, interest.id)
    if engagement is None or next_status == interest.status:
        return
    if next_status == "archived" and engagement.status in review_service.TERMINAL_STATES:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Use the engagement controls after a hiring request has been accepted.",
    )

logger = logging.getLogger(__name__)


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
    job = await _get_job_or_404(session, job_id)
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
    if job.status != "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This job is not accepting applications",
        )
    if job.posted_by_user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot apply to your own job")
    existing = (
        await session.execute(
            select(JobApplication).where(
                JobApplication.job_id == job_id,
                JobApplication.applicant_user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _application_read_for_sender(existing)
    # Enforce the owner's first-message requirements server-side so a direct API
    # call cannot bypass the completion modal the frontend presents.
    _assert_first_message_complete(job.application_requirements, payload.first_message_answers)
    application = JobApplication(
        job_id=job_id,
        applicant_user_id=current_user.id,
        job_owner_user_id=job.posted_by_user_id,
        cover_note=payload.cover_note.strip() if payload.cover_note else None,
        portfolio_item_ids=_clean_list(payload.portfolio_item_ids),
        first_message_answers=payload.first_message_answers or {},
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
    await session.flush()
    # Eagerly create the conversation thread for this application so both sides can
    # message immediately (older applications get one lazily on first open).
    if job.posted_by_user_id is not None:
        await get_or_create_conversation_for_application(session, application)
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
        action_url="/applications",
        actor_user_id=current_user.id,
        payload={"job_title": job.title, "applicant_name": applicant_name},
    )
    await _create_notification(
        session,
        user_id=current_user.id,
        type_="application_submitted",
        title="Application submitted",
        body=f"Your application for {job.title} was sent.",
        category="application",
        resource_type="job",
        resource_id=str(job.id),
        action_url=f"/jobs/{job.id}",
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
                    JobApplication.applicant_user_id == current_user.id,
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


@router.patch("/applications/{application_id}/status", response_model=JobApplicationRead)
async def update_application_status(
    application_id: UUID,
    payload: JobApplicationStatusUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> JobApplicationRead:
    application = (
        await session.execute(select(JobApplication).where(JobApplication.id == application_id))
    ).scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if application.job_owner_user_id != current_user.id and current_user.account_type != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Application owner required")
    await _assert_application_transition_allowed(session, application, payload.status)
    application.status = payload.status
    if payload.status == "hired":
        await review_service.ensure_for_application(session, application)
    await _create_notification(
        session,
        user_id=application.applicant_user_id,
        type_="application_status_changed",
        title="Application status updated",
        body=f"Your application is now {payload.status.replace('_', ' ')}.",
        category="application",
        resource_type="job_application",
        resource_id=str(application.id),
        action_url="/applications",
        actor_user_id=current_user.id,
        payload={"status": payload.status},
    )
    # Persist every status transition before refresh. Hired transitions already
    # flush while creating the engagement; ordinary pipeline moves do not.
    await session.flush()
    await session.refresh(application)
    result = await _application_read(session, application, current_user.id, sender_view=False)
    await session.commit()
    return result


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
    # Only the applicant who sent it may withdraw — not the recruiter/job owner.
    if application.applicant_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the applicant can withdraw this application",
        )
    if application.status == "withdrawn":
        return _application_read_for_sender(application)  # idempotent
    if application.status == "hired":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A hired application cannot be withdrawn",
        )
    application.status = "withdrawn"
    if application.job_owner_user_id is not None:
        await _create_notification(
            session,
            user_id=application.job_owner_user_id,
            type_="application_withdrawn",
            title="Application withdrawn",
            body="An applicant withdrew their application.",
            category="application",
            resource_type="job_application",
            resource_id=str(application.id),
            action_url="/applications",
            actor_user_id=current_user.id,
            payload={"status": "withdrawn"},
        )
    await session.commit()
    await session.refresh(application)
    return _application_read_for_sender(application)


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
    skip rows. Stage moves are quiet by default — internal pipeline tracking
    must never surprise the applicant. Clients that want a bell notification
    pass ``notify: true``; the richer path is a user-confirmed status-update
    chat message posted separately.
    """
    unique_ids = list(dict.fromkeys(payload.ids))
    applications = (
        (await session.execute(select(JobApplication).where(JobApplication.id.in_(unique_ids))))
        .scalars()
        .all()
    )
    if len(applications) != len(unique_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    is_admin = current_user.account_type == "ADMIN"
    if any(app.job_owner_user_id != current_user.id and not is_admin for app in applications):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Application owner required")
    for application in applications:
        if application.status == payload.status:
            if payload.status == "hired":
                await review_service.ensure_for_application(session, application)
            continue
        await _assert_application_transition_allowed(session, application, payload.status)
        application.status = payload.status
        if payload.status == "hired":
            await review_service.ensure_for_application(session, application)
        if not payload.notify:
            continue
        await _create_notification(
            session,
            user_id=application.applicant_user_id,
            type_="application_status_changed",
            title="Application status updated",
            body=f"Your application is now {payload.status.replace('_', ' ')}.",
            category="application",
            resource_type="job_application",
            resource_id=str(application.id),
            action_url="/applications",
            actor_user_id=current_user.id,
            payload={"status": payload.status},
        )
    result = [
        await _application_read(session, application, current_user.id, sender_view=False)
        for application in applications
    ]
    await session.commit()
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
        await session.execute(select(Job).where(Job.id.in_(job_ids), Job.deleted_at.is_(None)))
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
                job=JobRead.model_validate(jobs_by_id[saved.job_id])
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
    if listing.owner_user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot send interest to yourself")
    invite_job: Job | None = None
    if payload.job_id is not None:
        invite_job = await _get_job_or_404(session, payload.job_id)
        if invite_job.posted_by_user_id != current_user.id and current_user.account_type != "ADMIN":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Job owner required")
        if invite_job.status in {"closed", "archived"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select an active job for this invite")
    existing = (
        await session.execute(
            select(TalentInterest).where(
                TalentInterest.talent_listing_id == listing_id,
                TalentInterest.recruiter_user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.note = payload.note.strip() if payload.note else existing.note
        existing.job_id = payload.job_id
        if payload.first_message_answers:
            existing.first_message_answers = payload.first_message_answers
        existing.status = "new"
        await session.commit()
        await session.refresh(existing)
        return _interest_read_for_sender(existing)
    # Enforce the talent's first-message requirements server-side so a direct API
    # call cannot bypass the completion modal the frontend presents.
    _assert_first_message_complete(
        listing.first_message_requirements, payload.first_message_answers
    )
    interest = TalentInterest(
        talent_listing_id=listing_id,
        recruiter_user_id=current_user.id,
        job_id=payload.job_id,
        owner_user_id=listing.owner_user_id,
        note=payload.note.strip() if payload.note else None,
        first_message_answers=payload.first_message_answers or {},
    )
    session.add(interest)
    # Flush so interest.id is populated before it is referenced as the notification's
    # resource_id (otherwise it is stamped as the string "None").
    await session.flush()
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
        action_url="/applications",
        actor_user_id=current_user.id,
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
            JobRead.model_validate(row) for row in (related_jobs.scalars().all() if related_jobs is not None else [])
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
    interest = (
        await session.execute(select(TalentInterest).where(TalentInterest.id == interest_id))
    ).scalar_one_or_none()
    if interest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interest not found")
    if interest.owner_user_id != current_user.id and current_user.account_type != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Interest owner required")
    await _assert_interest_transition_allowed(session, interest, payload.status)
    interest.status = payload.status
    if payload.status == "contacted":
        await review_service.ensure_for_interest(session, interest)
    await _create_notification(
        session,
        user_id=interest.recruiter_user_id,
        type_="talent_interest_status_changed",
        title="Talent interest status updated",
        body=f"Your interest is now {payload.status}.",
        category="talent",
        resource_type="talent_interest",
        resource_id=str(interest.id),
        action_url="/applications",
        actor_user_id=current_user.id,
        payload={"status": payload.status},
    )
    await session.flush()
    await session.refresh(interest)
    result = await _interest_read(session, interest, current_user.id, sender_view=False)
    await session.commit()
    return result


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
    # Only the recruiter who sent the hiring request may withdraw — not the talent.
    if interest.recruiter_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the sender can withdraw this hiring request",
        )
    if interest.status == "withdrawn":
        return _interest_read_for_sender(interest)  # idempotent
    if await review_service.engagement_for_interest(session, interest.id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Use the engagement controls after a hiring request has been accepted",
        )
    interest.status = "withdrawn"
    await _create_notification(
        session,
        user_id=interest.owner_user_id,
        type_="talent_interest_withdrawn",
        title="Hiring request withdrawn",
        body="A recruiter withdrew their hiring request.",
        category="talent",
        resource_type="talent_interest",
        resource_id=str(interest.id),
        action_url="/applications",
        actor_user_id=current_user.id,
        payload={"status": "withdrawn"},
    )
    await session.commit()
    await session.refresh(interest)
    return _interest_read_for_sender(interest)


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

    Owner-only, all-or-nothing — mirrors the application bulk endpoint,
    including the quiet-by-default notification behavior.
    """
    unique_ids = list(dict.fromkeys(payload.ids))
    interests = (
        (await session.execute(select(TalentInterest).where(TalentInterest.id.in_(unique_ids))))
        .scalars()
        .all()
    )
    if len(interests) != len(unique_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interest not found")
    is_admin = current_user.account_type == "ADMIN"
    if any(interest.owner_user_id != current_user.id and not is_admin for interest in interests):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Interest owner required")
    for interest in interests:
        if interest.status == payload.status:
            if payload.status == "contacted":
                await review_service.ensure_for_interest(session, interest)
            continue
        await _assert_interest_transition_allowed(session, interest, payload.status)
        interest.status = payload.status
        if payload.status == "contacted":
            await review_service.ensure_for_interest(session, interest)
        if not payload.notify:
            continue
        await _create_notification(
            session,
            user_id=interest.recruiter_user_id,
            type_="talent_interest_status_changed",
            title="Talent interest status updated",
            body=f"Your interest is now {payload.status}.",
            category="talent",
            resource_type="talent_interest",
            resource_id=str(interest.id),
            action_url="/applications",
            actor_user_id=current_user.id,
            payload={"status": payload.status},
        )
    result = [
        await _interest_read(session, interest, current_user.id, sender_view=False)
        for interest in interests
    ]
    await session.commit()
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
