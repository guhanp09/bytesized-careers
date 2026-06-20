from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user, require_admin
from app.core.rate_limit import CHECKOUT_LIMIT, MARKETPLACE_ACTION_LIMIT, REPORT_LIMIT, rate_limit
from app.models import (
    Entitlement,
    Job,
    JobApplication,
    Notification,
    Report,
    SavedJob,
    SavedTalentListing,
    TalentInterest,
    TalentListing,
    User,
)
from app.notifications import dispatch_notification
from app.schemas.job import JobRead
from app.schemas.marketplace import (
    ActivitySummaryResponse,
    EntitlementRead,
    JobApplicationCreate,
    JobApplicationRead,
    JobApplicationStatusUpdate,
    LaunchCheckoutRequest,
    NotificationListResponse,
    NotificationRead,
    ReportAdminUpdate,
    ReportCreate,
    ReportRead,
    SavedJobRead,
    SavedJobSummaryItem,
    SavedSummaryResponse,
    SavedTalentListingRead,
    SavedTalentSummaryItem,
    SaveJobRequest,
    SaveTalentListingRequest,
    TalentInterestCreate,
    TalentInterestRead,
    TalentInterestStatusUpdate,
    TalentListingCreate,
    TalentListingListResponse,
    TalentListingRead,
    TalentListingUpdate,
)

router = APIRouter(tags=["marketplace"])

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


def _clean_list(values: list[str] | None) -> list[str]:
    return [item.strip() for item in values or [] if item and item.strip()]


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
        return JobApplicationRead.model_validate(existing)
    application = JobApplication(
        job_id=job_id,
        applicant_user_id=current_user.id,
        job_owner_user_id=job.posted_by_user_id,
        cover_note=payload.cover_note.strip() if payload.cover_note else None,
        portfolio_item_ids=_clean_list(payload.portfolio_item_ids),
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
        return JobApplicationRead.model_validate(existing)
    await session.refresh(application)
    return JobApplicationRead.model_validate(application)


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
    return [JobApplicationRead.model_validate(row) for row in rows]


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
    return [JobApplicationRead.model_validate(row) for row in rows]


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
    application.status = payload.status
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
    await session.commit()
    await session.refresh(application)
    return JobApplicationRead.model_validate(application)


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
        .where(TalentListing.deleted_at.is_(None))
    )
    if status_filter:
        query = query.where(TalentListing.status == status_filter)
    if q:
        term = f"%{q.lower()}%"
        query = query.where(func.lower(TalentListing.title).like(term))
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
    listing.views = int(listing.views or 0) + 1
    await session.commit()
    await session.refresh(listing)
    owner = await session.get(User, listing.owner_user_id)
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
    listing.formats = _clean_list(listing.formats)
    listing.platforms = _clean_list(listing.platforms)
    listing.tools = _clean_list(listing.tools)
    listing.portfolio_item_ids = _clean_list(listing.portfolio_item_ids)
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
    for key in ("roles", "formats", "platforms", "tools", "portfolio_item_ids"):
        if key in updates:
            updates[key] = _clean_list(updates[key])
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
        existing.status = "new"
        await session.commit()
        await session.refresh(existing)
        return TalentInterestRead.model_validate(existing)
    interest = TalentInterest(
        talent_listing_id=listing_id,
        recruiter_user_id=current_user.id,
        job_id=payload.job_id,
        owner_user_id=listing.owner_user_id,
        note=payload.note.strip() if payload.note else None,
    )
    session.add(interest)
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
    return TalentInterestRead.model_validate(interest)


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
    return [TalentInterestRead.model_validate(row) for row in rows]


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
    return [TalentInterestRead.model_validate(row) for row in rows]


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

    return ActivitySummaryResponse(
        my_jobs=[JobRead.model_validate(row) for row in my_jobs],
        my_talent_listings=await _talent_reads_with_owners(session, list(my_talent_listings)),
        sent_applications=[JobApplicationRead.model_validate(row) for row in sent_applications],
        received_applications=[JobApplicationRead.model_validate(row) for row in received_applications],
        received_interests=[TalentInterestRead.model_validate(row) for row in received_interests],
        sent_interests=[TalentInterestRead.model_validate(row) for row in sent_interests],
        related_jobs=[
            JobRead.model_validate(row) for row in (related_jobs.scalars().all() if related_jobs is not None else [])
        ],
        related_talent_listings=await _talent_reads_with_owners(session, related_listing_rows),
    )


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
    interest.status = payload.status
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
    await session.commit()
    await session.refresh(interest)
    return TalentInterestRead.model_validate(interest)


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


@router.post("/reports", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
async def create_report(
    payload: ReportCreate,
    _limit: None = rate_limit(REPORT_LIMIT),
    current_user: User | None = Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
) -> ReportRead:
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


@router.get("/admin/reports", response_model=list[ReportRead])
async def list_admin_reports(
    status_filter: str | None = Query(default=None, alias="status"),
    admin_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> list[ReportRead]:
    _ = admin_user
    query = select(Report).order_by(Report.created_at.desc())
    if status_filter:
        query = query.where(Report.status == status_filter)
    rows = (await session.execute(query.limit(100))).scalars().all()
    return [ReportRead.model_validate(row) for row in rows]


@router.patch("/admin/reports/{report_id}", response_model=ReportRead)
async def update_admin_report(
    report_id: UUID,
    payload: ReportAdminUpdate,
    admin_user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> ReportRead:
    report = (await session.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    if payload.action == "hide_listing":
        if report.target_type == "job":
            target_id = _parse_uuid_or_none(report.target_id)
            target = (await session.execute(select(Job).where(Job.id == target_id))).scalar_one_or_none() if target_id else None
            if target is not None:
                target.deleted_at = _now()
                target.status = "archived"
        elif report.target_type == "talent_listing":
            target_id = _parse_uuid_or_none(report.target_id)
            target = (
                await session.execute(select(TalentListing).where(TalentListing.id == target_id))
            ).scalar_one_or_none() if target_id else None
            if target is not None:
                target.deleted_at = _now()
                target.status = "archived"
    elif payload.action == "pause_listing":
        if report.target_type == "job":
            target_id = _parse_uuid_or_none(report.target_id)
            target = (await session.execute(select(Job).where(Job.id == target_id))).scalar_one_or_none() if target_id else None
            if target is not None:
                target.status = "paused"
                target.paused_at = _now()
        elif report.target_type == "talent_listing":
            target_id = _parse_uuid_or_none(report.target_id)
            target = (
                await session.execute(select(TalentListing).where(TalentListing.id == target_id))
            ).scalar_one_or_none() if target_id else None
            if target is not None:
                target.status = "paused"
                target.paused_at = _now()

    report.status = payload.status
    report.action = payload.action
    report.admin_note = payload.admin_note
    report.resolved_by_user_id = admin_user.id
    report.resolved_at = _now()
    await session.commit()
    await session.refresh(report)
    return ReportRead.model_validate(report)


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
