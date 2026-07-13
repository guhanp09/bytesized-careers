from __future__ import annotations

"""Admin panel API (docs/ADMIN_PANEL_PLAN.md).

Every route is authorized through a *permission key* (see
`app.core.admin_permissions`) — today all keys resolve to the single ADMIN
account type, but routes never check "is admin" directly, so real roles can
land later without touching this file's structure. Every mutation (and the
privacy-sensitive reported-conversation view) writes an `AdminAuditLog` entry
in the same transaction via `record_admin_action`.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.admin_permissions import require_permission
from app.core.account_types import is_admin
from app.core.config import settings
from app.core.marketplace import JOB_STATUSES, TALENT_LISTING_STATUSES
from app.models import (
    Conversation,
    EmailOutbox,
    Entitlement,
    EngagementReview,
    HiringIdentity,
    AdminAuditLog,
    InteractionStatusEvent,
    Job,
    JobApplication,
    Message,
    PortfolioItem,
    Report,
    TalentInterest,
    TalentListing,
    User,
)
from app.notifications import dispatch_notification
from app.notifications.registry import EVENT_REGISTRY
from app.schemas.admin import (
    AdminAbuseSignalRow,
    AdminAbuseSignalsResponse,
    AdminApplicationItem,
    AdminApplicationListResponse,
    AdminAuditLogItem,
    AdminAuditLogListResponse,
    AdminConversationMessage,
    AdminEntitlementItem,
    AdminEntitlementListResponse,
    AdminEntitlementRevokeRequest,
    AdminIdentityDecisionRequest,
    AdminIdentityItem,
    AdminIdentityListResponse,
    AdminIdentitySummary,
    AdminInterestItem,
    AdminInterestListResponse,
    AdminJobItem,
    AdminJobListResponse,
    AdminListingStateRequest,
    AdminMessageModerationRequest,
    AdminNoticeRequest,
    AdminNoticeResponse,
    AdminOutboxItem,
    AdminOverviewResponse,
    AdminRegistryEvent,
    AdminReportedConversationResponse,
    AdminReportItem,
    AdminReportListResponse,
    AdminReportResolveRequest,
    AdminSuspendRequest,
    AdminTalentListingItem,
    AdminTalentListingListResponse,
    AdminUnsuspendRequest,
    AdminUserDetailResponse,
    AdminUserItem,
    AdminUserListResponse,
    AdminUserRef,
    AdminWarnRequest,
)
from app.services.audit_service import record_admin_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _now() -> datetime:
    return datetime.now(UTC)


def _user_ref(user: User | None) -> AdminUserRef | None:
    if user is None:
        return None
    return AdminUserRef(
        id=user.id, display_name=user.display_name, username=user.username, email=user.email
    )


def _parse_uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError):
        return None


@router.get("/interaction-integrity")
async def admin_interaction_integrity(
    limit: int = Query(default=100, ge=1, le=500),
    _admin: User = Depends(require_permission("audit.view")),
    session: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    """Expose migration/runtime integrity findings without mutating history."""

    rows = (
        (
            await session.execute(
                select(InteractionStatusEvent)
                .where(InteractionStatusEvent.event_kind == "integrity_issue")
                .order_by(InteractionStatusEvent.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(row.id),
            "interaction_type": row.interaction_type,
            "interaction_id": str(row.interaction_id),
            "status": row.new_status,
            "status_version": row.status_version,
            "integrity_codes": row.metadata_json.get("integrity_codes", []),
            "metadata": row.metadata_json,
            "created_at": row.created_at,
        }
        for row in rows
    ]


async def _count(session: AsyncSession, stmt) -> int:
    return int((await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one())


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------


@router.get("/overview", response_model=AdminOverviewResponse)
async def admin_overview(
    _admin: User = Depends(require_permission("view.overview")),
    session: AsyncSession = Depends(get_db),
) -> AdminOverviewResponse:
    week_ago = _now() - timedelta(days=7)

    async def count_where(model, *conditions) -> int:
        return int(
            (await session.execute(select(func.count()).select_from(model).where(*conditions))).scalar_one()
        )

    jobs_by_status: dict[str, int] = {}
    for row in (
        await session.execute(
            select(Job.status, func.count()).where(Job.deleted_at.is_(None)).group_by(Job.status)
        )
    ).all():
        jobs_by_status[row[0]] = int(row[1])
    for known in JOB_STATUSES:
        jobs_by_status.setdefault(known, 0)

    talent_by_status: dict[str, int] = {}
    for row in (
        await session.execute(
            select(TalentListing.status, func.count())
            .where(TalentListing.deleted_at.is_(None))
            .group_by(TalentListing.status)
        )
    ).all():
        talent_by_status[row[0]] = int(row[1])
    for known in TALENT_LISTING_STATUSES:
        talent_by_status.setdefault(known, 0)

    return AdminOverviewResponse(
        env=settings.app_env,
        email_mode=settings.email_mode,
        email_delivery_enabled=settings.email_delivery_enabled,
        users_total=await count_where(User),
        users_new_7d=await count_where(User, User.created_at >= week_ago),
        users_suspended=await count_where(User, User.suspended_at.isnot(None)),
        jobs_by_status=jobs_by_status,
        jobs_deleted=await count_where(Job, Job.deleted_at.isnot(None)),
        talent_by_status=talent_by_status,
        talent_deleted=await count_where(TalentListing, TalentListing.deleted_at.isnot(None)),
        applications_total=await count_where(JobApplication),
        applications_new_7d=await count_where(JobApplication, JobApplication.created_at >= week_ago),
        interests_total=await count_where(TalentInterest),
        interests_new_7d=await count_where(TalentInterest, TalentInterest.created_at >= week_ago),
        messages_total=await count_where(Message),
        reports_open=await count_where(Report, Report.status == "open"),
        verifications_pending=await count_where(
            HiringIdentity, HiringIdentity.verification_status == "PENDING"
        ),
        entitlements_active=await count_where(Entitlement, Entitlement.status == "active"),
    )


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


def _admin_user_item(user: User, counts: dict[str, int]) -> AdminUserItem:
    return AdminUserItem(
        id=user.id,
        email=user.email,
        username=user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        account_type=user.account_type,
        email_verified=user.email_verified_at is not None,
        suspended_at=user.suspended_at,
        suspension_reason=user.suspension_reason,
        last_active_at=user.last_active_at,
        created_at=user.created_at,
        jobs_count=counts.get("jobs", 0),
        talent_listings_count=counts.get("talent", 0),
        applications_sent_count=counts.get("applications", 0),
        profile_reports_count=counts.get("profile_reports", 0),
    )


async def _user_counts(session: AsyncSession, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, int]]:
    counts: dict[uuid.UUID, dict[str, int]] = {uid: {} for uid in user_ids}
    if not user_ids:
        return counts
    for key, stmt in (
        ("jobs", select(Job.posted_by_user_id, func.count()).where(Job.posted_by_user_id.in_(user_ids), Job.deleted_at.is_(None)).group_by(Job.posted_by_user_id)),
        ("talent", select(TalentListing.owner_user_id, func.count()).where(TalentListing.owner_user_id.in_(user_ids), TalentListing.deleted_at.is_(None)).group_by(TalentListing.owner_user_id)),
        ("applications", select(JobApplication.applicant_user_id, func.count()).where(JobApplication.applicant_user_id.in_(user_ids)).group_by(JobApplication.applicant_user_id)),
    ):
        for row in (await session.execute(stmt)).all():
            counts[row[0]][key] = int(row[1])
    profile_ids = [str(uid) for uid in user_ids]
    for row in (
        await session.execute(
            select(Report.target_id, func.count())
            .where(Report.target_type == "profile", Report.target_id.in_(profile_ids))
            .group_by(Report.target_id)
        )
    ).all():
        parsed = _parse_uuid(row[0])
        if parsed in counts:
            counts[parsed]["profile_reports"] = int(row[1])
    return counts


@router.get("/users", response_model=AdminUserListResponse)
async def admin_list_users(
    q: str | None = Query(default=None, max_length=200),
    suspended: bool | None = Query(default=None),
    verified: bool | None = Query(default=None, description="Email-verified filter"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_permission("users.view")),
    session: AsyncSession = Depends(get_db),
) -> AdminUserListResponse:
    query = select(User)
    if q:
        term = f"%{q.lower().strip()}%"
        query = query.where(
            or_(
                func.lower(User.email).like(term),
                func.lower(func.coalesce(User.username, "")).like(term),
                func.lower(func.coalesce(User.display_name, "")).like(term),
            )
        )
    if suspended is True:
        query = query.where(User.suspended_at.isnot(None))
    elif suspended is False:
        query = query.where(User.suspended_at.is_(None))
    if verified is True:
        query = query.where(User.email_verified_at.isnot(None))
    elif verified is False:
        query = query.where(User.email_verified_at.is_(None))

    total = await _count(session, query)
    rows = (
        (await session.execute(query.order_by(User.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    counts = await _user_counts(session, [row.id for row in rows])
    return AdminUserListResponse(
        items=[_admin_user_item(row, counts.get(row.id, {})) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/users/{user_id}", response_model=AdminUserDetailResponse)
async def admin_user_detail(
    user_id: uuid.UUID,
    _admin: User = Depends(require_permission("users.view")),
    session: AsyncSession = Depends(get_db),
) -> AdminUserDetailResponse:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    counts = (await _user_counts(session, [user.id])).get(user.id, {})
    identities = (
        (await session.execute(select(HiringIdentity).where(HiringIdentity.owner_user_id == user.id)))
        .scalars()
        .all()
    )
    entitlements = (
        (await session.execute(select(Entitlement).where(Entitlement.user_id == user.id).order_by(Entitlement.created_at.desc()).limit(20)))
        .scalars()
        .all()
    )
    interests_sent = int(
        (await session.execute(select(func.count()).select_from(TalentInterest).where(TalentInterest.recruiter_user_id == user.id))).scalar_one()
    )
    applications_received = int(
        (await session.execute(select(func.count()).select_from(JobApplication).where(JobApplication.job_owner_user_id == user.id))).scalar_one()
    )
    portfolio_count = int(
        (await session.execute(select(func.count()).select_from(PortfolioItem).where(PortfolioItem.user_id == user.id))).scalar_one()
    )

    # Reports about this user: their profile, or any listing they own.
    job_ids = [str(row) for row in (await session.execute(select(Job.id).where(Job.posted_by_user_id == user.id))).scalars().all()]
    listing_ids = [str(row) for row in (await session.execute(select(TalentListing.id).where(TalentListing.owner_user_id == user.id))).scalars().all()]
    report_conditions = [
        (Report.target_type == "profile") & (Report.target_id == str(user.id)),
    ]
    if job_ids:
        report_conditions.append((Report.target_type == "job") & (Report.target_id.in_(job_ids)))
    if listing_ids:
        report_conditions.append((Report.target_type == "talent_listing") & (Report.target_id.in_(listing_ids)))
    reports = (
        (await session.execute(select(Report).where(or_(*report_conditions)).order_by(Report.created_at.desc()).limit(20)))
        .scalars()
        .all()
    )
    reports_about = await _hydrate_reports(session, list(reports))

    audit_rows = (
        (
            await session.execute(
                select(AdminAuditLog)
                .where(AdminAuditLog.target_type == "user", AdminAuditLog.target_id == str(user.id))
                .order_by(AdminAuditLog.created_at.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    actors = await _users_by_ids(session, [row.actor_user_id for row in audit_rows if row.actor_user_id])

    return AdminUserDetailResponse(
        user=_admin_user_item(user, counts),
        hiring_verification_status=user.hiring_verification_status,
        onboarding_intent=user.onboarding_intent,
        interests_sent_count=interests_sent,
        applications_received_count=applications_received,
        portfolio_items_count=portfolio_count,
        identities=[AdminIdentitySummary.model_validate(identity, from_attributes=True) for identity in identities],
        entitlements=[AdminEntitlementItem.model_validate(entitlement) for entitlement in entitlements],
        reports_about=reports_about,
        recent_audit=[_audit_item(row, actors) for row in audit_rows],
    )


@router.post("/users/{user_id}/suspend", response_model=AdminUserItem)
async def admin_suspend_user(
    user_id: uuid.UUID,
    payload: AdminSuspendRequest,
    admin_user: User = Depends(require_permission("users.suspend")),
    session: AsyncSession = Depends(get_db),
) -> AdminUserItem:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if is_admin(user):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin accounts cannot be suspended")
    if user.suspended_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already suspended")

    before = {"suspended_at": None}
    user.suspended_at = _now()
    user.suspension_reason = payload.reason
    user.suspended_by_user_id = admin_user.id
    record_admin_action(
        session,
        actor=admin_user,
        action="user.suspend",
        target_type="user",
        target_id=user.id,
        target_label=f"User — {user.display_name or user.username or user.email}",
        before=before,
        after={"suspended_at": user.suspended_at.isoformat()},
        justification=payload.reason,
    )
    await session.commit()
    await session.refresh(user)
    counts = (await _user_counts(session, [user.id])).get(user.id, {})
    return _admin_user_item(user, counts)


@router.post("/users/{user_id}/unsuspend", response_model=AdminUserItem)
async def admin_unsuspend_user(
    user_id: uuid.UUID,
    payload: AdminUnsuspendRequest,
    admin_user: User = Depends(require_permission("users.suspend")),
    session: AsyncSession = Depends(get_db),
) -> AdminUserItem:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.suspended_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is not suspended")

    before = {"suspended_at": user.suspended_at.isoformat(), "suspension_reason": user.suspension_reason}
    user.suspended_at = None
    user.suspension_reason = None
    user.suspended_by_user_id = None
    record_admin_action(
        session,
        actor=admin_user,
        action="user.unsuspend",
        target_type="user",
        target_id=user.id,
        target_label=f"User — {user.display_name or user.username or user.email}",
        before=before,
        after={"suspended_at": None},
        justification=payload.reason,
    )
    await session.commit()
    await session.refresh(user)
    counts = (await _user_counts(session, [user.id])).get(user.id, {})
    return _admin_user_item(user, counts)


@router.post("/users/{user_id}/warn", response_model=dict)
async def admin_warn_user(
    user_id: uuid.UUID,
    payload: AdminWarnRequest,
    admin_user: User = Depends(require_permission("users.warn")),
    session: AsyncSession = Depends(get_db),
) -> dict:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await dispatch_notification(
        session,
        event_key="account_warning",
        recipient_user_id=user.id,
        actor_user_id=admin_user.id,
        title=payload.title,
        body=payload.body,
        category="moderation",
        resource_type="user",
        resource_id=str(user.id),
        action_url=payload.action_url or "/support",
    )
    record_admin_action(
        session,
        actor=admin_user,
        action="user.warn",
        target_type="user",
        target_id=user.id,
        target_label=f"User — {user.display_name or user.username or user.email}",
        after={"title": payload.title, "body": payload.body},
        justification=payload.body,
    )
    await session.commit()
    return {"ok": True}


async def _users_by_ids(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, User]:
    unique = list({value for value in ids if value})
    if not unique:
        return {}
    rows = (await session.execute(select(User).where(User.id.in_(unique)))).scalars().all()
    return {row.id: row for row in rows}


# ---------------------------------------------------------------------------
# Listings
# ---------------------------------------------------------------------------


def _apply_listing_state(target: Job | TalentListing, action: str) -> tuple[dict, dict]:
    """Apply a lifecycle action; returns (before, after) state for the audit row."""
    before = {
        "status": target.status,
        "deleted_at": target.deleted_at.isoformat() if target.deleted_at else None,
    }
    now = _now()
    if action == "pause":
        target.status = "paused"
        target.paused_at = now
    elif action == "unpause":
        if target.status != "paused":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Listing is not paused")
        target.status = "published"
    elif action == "hide":
        target.deleted_at = now
        target.status = "archived"
    elif action == "unhide":
        if target.deleted_at is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Listing is not hidden")
        # Deliberately lands in paused (not auto-published): the owner re-publishes.
        target.deleted_at = None
        target.status = "paused"
        target.paused_at = now
    elif action == "close":
        target.status = "closed"
        target.closed_at = now
    after = {
        "status": target.status,
        "deleted_at": target.deleted_at.isoformat() if target.deleted_at else None,
    }
    return before, after


@router.get("/jobs", response_model=AdminJobListResponse)
async def admin_list_jobs(
    q: str | None = Query(default=None, max_length=200),
    status_filter: str | None = Query(default=None, alias="status"),
    include_deleted: bool = Query(default=False),
    reported: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_permission("view.queues")),
    session: AsyncSession = Depends(get_db),
) -> AdminJobListResponse:
    query = select(Job)
    if not include_deleted:
        query = query.where(Job.deleted_at.is_(None))
    if status_filter:
        query = query.where(Job.status == status_filter)
    if q:
        term = f"%{q.lower().strip()}%"
        query = query.where(
            or_(func.lower(Job.title).like(term), func.lower(func.coalesce(Job.channel_name, "")).like(term))
        )
    if reported:
        # Report.target_id stores string UUIDs; resolve them first, then filter.
        raw_ids = (
            (await session.execute(select(Report.target_id).where(Report.target_type == "job").distinct()))
            .scalars()
            .all()
        )
        reported_ids = [parsed for parsed in (_parse_uuid(value) for value in raw_ids) if parsed]
        query = query.where(Job.id.in_(reported_ids or [uuid.uuid4()]))

    total = await _count(session, query)
    rows = (
        (await session.execute(query.order_by(Job.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    owners = await _users_by_ids(session, [row.posted_by_user_id for row in rows])
    job_ids = [str(row.id) for row in rows]
    app_counts: dict[uuid.UUID, int] = {}
    for entry in (
        await session.execute(
            select(JobApplication.job_id, func.count())
            .where(JobApplication.job_id.in_([row.id for row in rows] or [uuid.uuid4()]))
            .group_by(JobApplication.job_id)
        )
    ).all():
        app_counts[entry[0]] = int(entry[1])
    report_counts: dict[str, int] = {}
    if job_ids:
        for entry in (
            await session.execute(
                select(Report.target_id, func.count())
                .where(Report.target_type == "job", Report.target_id.in_(job_ids))
                .group_by(Report.target_id)
            )
        ).all():
            report_counts[entry[0]] = int(entry[1])

    return AdminJobListResponse(
        items=[
            AdminJobItem(
                id=row.id,
                title=row.title,
                status=row.status,
                is_verified=row.is_verified,
                channel_name=row.channel_name,
                category=row.category,
                location=row.location,
                deleted_at=row.deleted_at,
                created_at=row.created_at,
                owner=_user_ref(owners.get(row.posted_by_user_id)),
                applications_count=app_counts.get(row.id, 0),
                reports_count=report_counts.get(str(row.id), 0),
            )
            for row in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch("/jobs/{job_id}/state", response_model=AdminJobItem)
async def admin_job_state(
    job_id: uuid.UUID,
    payload: AdminListingStateRequest,
    admin_user: User = Depends(require_permission("listings.state")),
    session: AsyncSession = Depends(get_db),
) -> AdminJobItem:
    job = (await session.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    before, after = _apply_listing_state(job, payload.action)
    record_admin_action(
        session,
        actor=admin_user,
        action=f"job.state.{payload.action}",
        target_type="job",
        target_id=job.id,
        target_label=f"Job — {job.title}",
        before=before,
        after=after,
        justification=payload.reason,
    )
    await session.commit()
    await session.refresh(job)
    owner = (await session.execute(select(User).where(User.id == job.posted_by_user_id))).scalar_one_or_none()
    return AdminJobItem(
        id=job.id,
        title=job.title,
        status=job.status,
        is_verified=job.is_verified,
        channel_name=job.channel_name,
        category=job.category,
        location=job.location,
        deleted_at=job.deleted_at,
        created_at=job.created_at,
        owner=_user_ref(owner),
        applications_count=0,
        reports_count=0,
    )


@router.get("/talent-listings", response_model=AdminTalentListingListResponse)
async def admin_list_talent_listings(
    q: str | None = Query(default=None, max_length=200),
    status_filter: str | None = Query(default=None, alias="status"),
    include_deleted: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_permission("view.queues")),
    session: AsyncSession = Depends(get_db),
) -> AdminTalentListingListResponse:
    query = select(TalentListing)
    if not include_deleted:
        query = query.where(TalentListing.deleted_at.is_(None))
    if status_filter:
        query = query.where(TalentListing.status == status_filter)
    if q:
        term = f"%{q.lower().strip()}%"
        query = query.where(
            or_(
                func.lower(TalentListing.title).like(term),
                func.lower(func.coalesce(TalentListing.primary_role, "")).like(term),
            )
        )

    total = await _count(session, query)
    rows = (
        (await session.execute(query.order_by(TalentListing.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    owners = await _users_by_ids(session, [row.owner_user_id for row in rows])
    listing_ids = [str(row.id) for row in rows]
    interest_counts: dict[uuid.UUID, int] = {}
    for entry in (
        await session.execute(
            select(TalentInterest.talent_listing_id, func.count())
            .where(TalentInterest.talent_listing_id.in_([row.id for row in rows] or [uuid.uuid4()]))
            .group_by(TalentInterest.talent_listing_id)
        )
    ).all():
        interest_counts[entry[0]] = int(entry[1])
    report_counts: dict[str, int] = {}
    if listing_ids:
        for entry in (
            await session.execute(
                select(Report.target_id, func.count())
                .where(Report.target_type == "talent_listing", Report.target_id.in_(listing_ids))
                .group_by(Report.target_id)
            )
        ).all():
            report_counts[entry[0]] = int(entry[1])

    return AdminTalentListingListResponse(
        items=[
            AdminTalentListingItem(
                id=row.id,
                title=row.title,
                status=row.status,
                primary_role=row.primary_role,
                location=row.location,
                deleted_at=row.deleted_at,
                created_at=row.created_at,
                owner=_user_ref(owners.get(row.owner_user_id)),
                interests_count=interest_counts.get(row.id, 0),
                reports_count=report_counts.get(str(row.id), 0),
            )
            for row in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch("/talent-listings/{listing_id}/state", response_model=AdminTalentListingItem)
async def admin_talent_listing_state(
    listing_id: uuid.UUID,
    payload: AdminListingStateRequest,
    admin_user: User = Depends(require_permission("listings.state")),
    session: AsyncSession = Depends(get_db),
) -> AdminTalentListingItem:
    listing = (
        await session.execute(select(TalentListing).where(TalentListing.id == listing_id))
    ).scalar_one_or_none()
    if listing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Talent listing not found")
    before, after = _apply_listing_state(listing, payload.action)
    record_admin_action(
        session,
        actor=admin_user,
        action=f"talent_listing.state.{payload.action}",
        target_type="talent_listing",
        target_id=listing.id,
        target_label=f"Talent listing — {listing.title}",
        before=before,
        after=after,
        justification=payload.reason,
    )
    await session.commit()
    await session.refresh(listing)
    owner = (await session.execute(select(User).where(User.id == listing.owner_user_id))).scalar_one_or_none()
    return AdminTalentListingItem(
        id=listing.id,
        title=listing.title,
        status=listing.status,
        primary_role=listing.primary_role,
        location=listing.location,
        deleted_at=listing.deleted_at,
        created_at=listing.created_at,
        owner=_user_ref(owner),
        interests_count=0,
        reports_count=0,
    )


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


async def _hydrate_reports(session: AsyncSession, reports: list[Report]) -> list[AdminReportItem]:
    """Attach human context to report rows: target label/status/owner, reporter,
    and how many other reports exist against the same target."""
    if not reports:
        return []

    reporter_map = await _users_by_ids(session, [r.reporter_user_id for r in reports if r.reporter_user_id])

    ids_by_type: dict[str, list[uuid.UUID]] = {}
    for report in reports:
        parsed = _parse_uuid(report.target_id)
        if parsed is not None:
            ids_by_type.setdefault(report.target_type, []).append(parsed)

    jobs: dict[uuid.UUID, Job] = {}
    listings: dict[uuid.UUID, TalentListing] = {}
    profiles: dict[uuid.UUID, User] = {}
    messages: dict[uuid.UUID, Message] = {}
    reviews: dict[uuid.UUID, EngagementReview] = {}
    if ids_by_type.get("job"):
        rows = (await session.execute(select(Job).where(Job.id.in_(ids_by_type["job"])))).scalars().all()
        jobs = {row.id: row for row in rows}
    if ids_by_type.get("talent_listing"):
        rows = (
            (await session.execute(select(TalentListing).where(TalentListing.id.in_(ids_by_type["talent_listing"]))))
            .scalars()
            .all()
        )
        listings = {row.id: row for row in rows}
    if ids_by_type.get("profile"):
        profiles = await _users_by_ids(session, ids_by_type["profile"])
    if ids_by_type.get("message"):
        rows = (await session.execute(select(Message).where(Message.id.in_(ids_by_type["message"])))).scalars().all()
        messages = {row.id: row for row in rows}
    if ids_by_type.get("review"):
        rows = (
            await session.execute(
                select(EngagementReview).where(EngagementReview.id.in_(ids_by_type["review"]))
            )
        ).scalars().all()
        reviews = {row.id: row for row in rows}

    owner_ids: list[uuid.UUID] = []
    owner_ids.extend(job.posted_by_user_id for job in jobs.values())
    owner_ids.extend(listing.owner_user_id for listing in listings.values())
    owner_ids.extend(message.sender_user_id for message in messages.values())
    owner_ids.extend(review.reviewer_user_id for review in reviews.values() if review.reviewer_user_id)
    owners = await _users_by_ids(session, owner_ids)

    sibling_counts: dict[str, int] = {}
    target_ids = list({report.target_id for report in reports})
    for entry in (
        await session.execute(
            select(Report.target_id, func.count()).where(Report.target_id.in_(target_ids)).group_by(Report.target_id)
        )
    ).all():
        sibling_counts[entry[0]] = int(entry[1])

    items: list[AdminReportItem] = []
    for report in reports:
        parsed = _parse_uuid(report.target_id)
        target_label: str | None = None
        target_status: str | None = None
        target_owner: AdminUserRef | None = None
        if report.target_type == "job" and parsed in jobs:
            job = jobs[parsed]
            target_label = f"Job — {job.title}"
            target_status = "hidden" if job.deleted_at else job.status
            target_owner = _user_ref(owners.get(job.posted_by_user_id))
        elif report.target_type == "talent_listing" and parsed in listings:
            listing = listings[parsed]
            target_label = f"Talent listing — {listing.title}"
            target_status = "hidden" if listing.deleted_at else listing.status
            target_owner = _user_ref(owners.get(listing.owner_user_id))
        elif report.target_type == "profile" and parsed in profiles:
            profile_user = profiles[parsed]
            target_label = f"Profile — {profile_user.display_name or profile_user.username or profile_user.email}"
            target_status = "suspended" if profile_user.suspended_at else "active"
            target_owner = _user_ref(profile_user)
        elif report.target_type == "message" and parsed in messages:
            message = messages[parsed]
            target_label = "Message in a conversation"
            target_status = "hidden" if message.deleted_at else "visible"
            target_owner = _user_ref(owners.get(message.sender_user_id))
        elif report.target_type == "review" and parsed in reviews:
            review = reviews[parsed]
            target_label = "Published engagement review"
            target_status = "hidden" if review.status == "hidden" else "visible"
            target_owner = _user_ref(owners.get(review.reviewer_user_id)) if review.reviewer_user_id else None
        items.append(
            AdminReportItem(
                id=report.id,
                target_type=report.target_type,
                target_id=report.target_id,
                category=report.category,
                note=report.note,
                status=report.status,
                action=report.action,
                admin_note=report.admin_note,
                resolved_by_user_id=report.resolved_by_user_id,
                resolved_at=report.resolved_at,
                created_at=report.created_at,
                reporter=_user_ref(reporter_map.get(report.reporter_user_id)) if report.reporter_user_id else None,
                target_label=target_label,
                target_status=target_status,
                target_owner=target_owner,
                sibling_count=max(sibling_counts.get(report.target_id, 1) - 1, 0),
            )
        )
    return items


@router.get("/reports", response_model=AdminReportListResponse)
async def admin_list_reports(
    status_filter: str | None = Query(default=None, alias="status"),
    target_type: str | None = Query(default=None),
    category: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_permission("view.queues")),
    session: AsyncSession = Depends(get_db),
) -> AdminReportListResponse:
    query = select(Report)
    if status_filter:
        query = query.where(Report.status == status_filter)
    if target_type:
        query = query.where(Report.target_type == target_type)
    if category:
        query = query.where(Report.category == category)

    total = await _count(session, query)
    # Open reports oldest-first (SLA order); resolved views newest-first.
    order = Report.created_at.asc() if status_filter == "open" else Report.created_at.desc()
    rows = (await session.execute(query.order_by(order).limit(limit).offset(offset))).scalars().all()
    return AdminReportListResponse(
        items=await _hydrate_reports(session, list(rows)),
        total=total,
        limit=limit,
        offset=offset,
    )


async def _report_target_owner(session: AsyncSession, report: Report) -> User | None:
    parsed = _parse_uuid(report.target_id)
    if parsed is None:
        return None
    if report.target_type == "job":
        job = (await session.execute(select(Job).where(Job.id == parsed))).scalar_one_or_none()
        return None if job is None else (await session.execute(select(User).where(User.id == job.posted_by_user_id))).scalar_one_or_none()
    if report.target_type == "talent_listing":
        listing = (await session.execute(select(TalentListing).where(TalentListing.id == parsed))).scalar_one_or_none()
        return None if listing is None else (await session.execute(select(User).where(User.id == listing.owner_user_id))).scalar_one_or_none()
    if report.target_type == "profile":
        return (await session.execute(select(User).where(User.id == parsed))).scalar_one_or_none()
    if report.target_type == "message":
        message = (await session.execute(select(Message).where(Message.id == parsed))).scalar_one_or_none()
        return None if message is None else (await session.execute(select(User).where(User.id == message.sender_user_id))).scalar_one_or_none()
    if report.target_type == "review":
        review = (
            await session.execute(select(EngagementReview).where(EngagementReview.id == parsed))
        ).scalar_one_or_none()
        if review is None or review.reviewer_user_id is None:
            return None
        return (
            await session.execute(select(User).where(User.id == review.reviewer_user_id))
        ).scalar_one_or_none()
    return None


@router.patch("/reports/{report_id}", response_model=AdminReportItem)
async def admin_resolve_report(
    report_id: uuid.UUID,
    payload: AdminReportResolveRequest,
    admin_user: User = Depends(require_permission("reports.resolve")),
    session: AsyncSession = Depends(get_db),
) -> AdminReportItem:
    report = (await session.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    action = payload.action
    parsed_target = _parse_uuid(report.target_id)

    if action in {"pause_listing", "hide_listing"}:
        if report.target_type not in {"job", "talent_listing"}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{action} applies only to listing reports",
            )
        model = Job if report.target_type == "job" else TalentListing
        target = (await session.execute(select(model).where(model.id == parsed_target))).scalar_one_or_none() if parsed_target else None
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report target no longer exists")
        state_action = "pause" if action == "pause_listing" else "hide"
        before, after = _apply_listing_state(target, state_action)
        record_admin_action(
            session,
            actor=admin_user,
            action=f"{report.target_type}.state.{state_action}",
            target_type=report.target_type,
            target_id=report.target_id,
            target_label=f"{'Job' if report.target_type == 'job' else 'Talent listing'} — {target.title}",
            before=before,
            after=after,
            justification=payload.admin_note or f"Report {report.id} — {report.category}",
            report_id=report.id,
        )
    elif action in {"hide_review", "restore_review"}:
        if report.target_type != "review":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{action} applies only to review reports",
            )
        review = (
            await session.execute(
                select(EngagementReview).where(EngagementReview.id == parsed_target).with_for_update()
            )
        ).scalar_one_or_none() if parsed_target else None
        if review is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report target no longer exists")
        before = {
            "status": review.status,
            "hidden_at": review.hidden_at.isoformat() if review.hidden_at else None,
        }
        if action == "hide_review":
            if review.status != "hidden":
                review.status = "hidden"
                review.hidden_at = _now()
                review.hidden_by_user_id = admin_user.id
                review.hidden_reason = payload.admin_note or f"Report {report.id} — {report.category}"
        else:
            review.status = "published"
            review.hidden_at = None
            review.hidden_by_user_id = None
            review.hidden_reason = None
        record_admin_action(
            session,
            actor=admin_user,
            action=f"review.{action.removesuffix('_review')}",
            target_type="review",
            target_id=review.id,
            target_label="Published engagement review",
            before=before,
            after={
                "status": review.status,
                "hidden_at": review.hidden_at.isoformat() if review.hidden_at else None,
            },
            justification=payload.admin_note or f"Report {report.id} — {report.category}",
            report_id=report.id,
        )
    elif action == "suspend_user":
        target_user = await _report_target_owner(session, report)
        if target_user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report target user not found")
        if is_admin(target_user):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin accounts cannot be suspended")
        if target_user.suspended_at is None:
            reason = payload.user_note or payload.admin_note or f"Report {report.id} — {report.category}"
            target_user.suspended_at = _now()
            target_user.suspension_reason = reason
            target_user.suspended_by_user_id = admin_user.id
            record_admin_action(
                session,
                actor=admin_user,
                action="user.suspend",
                target_type="user",
                target_id=target_user.id,
                target_label=f"User — {target_user.display_name or target_user.username or target_user.email}",
                before={"suspended_at": None},
                after={"suspended_at": target_user.suspended_at.isoformat()},
                justification=reason,
                report_id=report.id,
            )
    elif action == "warn_user":
        if not (payload.user_note or "").strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="warn_user requires user_note (the message the user receives)",
            )
        target_user = await _report_target_owner(session, report)
        if target_user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report target user not found")
        await dispatch_notification(
            session,
            event_key="account_warning",
            recipient_user_id=target_user.id,
            actor_user_id=admin_user.id,
            title="A notice about your CreatorJobs account",
            body=payload.user_note,
            category="moderation",
            resource_type="user",
            resource_id=str(target_user.id),
            action_url="/support",
        )
        record_admin_action(
            session,
            actor=admin_user,
            action="user.warn",
            target_type="user",
            target_id=target_user.id,
            target_label=f"User — {target_user.display_name or target_user.username or target_user.email}",
            after={"body": payload.user_note},
            justification=payload.user_note,
            report_id=report.id,
        )

    if action == "reopen":
        report.status = "open"
        report.action = "reopen"
        report.resolved_by_user_id = None
        report.resolved_at = None
        if payload.admin_note:
            report.admin_note = payload.admin_note
    else:
        report.status = "dismissed" if action == "dismiss" else "action_taken"
        report.action = action
        if payload.admin_note is not None:
            report.admin_note = payload.admin_note
        report.resolved_by_user_id = admin_user.id
        report.resolved_at = _now()

    record_admin_action(
        session,
        actor=admin_user,
        action=f"report.{action}",
        target_type="report",
        target_id=report.id,
        target_label=f"Report — {report.target_type} · {report.category}",
        after={"status": report.status, "action": report.action},
        justification=payload.admin_note,
        report_id=report.id,
    )
    await session.commit()
    await session.refresh(report)
    items = await _hydrate_reports(session, [report])
    return items[0]


@router.get("/reports/{report_id}/conversation", response_model=AdminReportedConversationResponse)
async def admin_reported_conversation(
    report_id: uuid.UUID,
    admin_user: User = Depends(require_permission("conversations.view_reported")),
    session: AsyncSession = Depends(get_db),
) -> AdminReportedConversationResponse:
    """Tier-2 disclosure: message content is visible only through a report on a
    message, and every view writes an audit entry naming the report that
    legitimized it (docs/ADMIN_PANEL_PLAN.md §7.6)."""
    report = (await session.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    if report.target_type != "message":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Conversation view is only available for message reports",
        )
    message_id = _parse_uuid(report.target_id)
    message = (
        await session.execute(select(Message).where(Message.id == message_id))
    ).scalar_one_or_none() if message_id else None
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reported message no longer exists")
    conversation = (
        await session.execute(select(Conversation).where(Conversation.id == message.conversation_id))
    ).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation no longer exists")

    rows = (
        (
            await session.execute(
                select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at)
            )
        )
        .scalars()
        .all()
    )
    senders = await _users_by_ids(
        session, [conversation.participant_a_user_id, conversation.participant_b_user_id]
    )
    record_admin_action(
        session,
        actor=admin_user,
        action="conversation.view_reported",
        target_type="conversation",
        target_id=conversation.id,
        target_label=f"Conversation — {conversation.context_type}",
        justification=f"Report {report.id} — {report.category}",
        report_id=report.id,
    )
    await session.commit()

    return AdminReportedConversationResponse(
        report_id=report.id,
        conversation_id=conversation.id,
        context_type=conversation.context_type,
        participants=[ref for ref in (_user_ref(senders.get(conversation.participant_a_user_id)), _user_ref(senders.get(conversation.participant_b_user_id))) if ref],
        reported_message_id=message.id,
        messages=[
            AdminConversationMessage(
                id=row.id,
                sender=_user_ref(senders.get(row.sender_user_id)),
                body=row.body,
                kind=(row.metadata_json or {}).get("kind"),
                hidden=row.deleted_at is not None,
                created_at=row.created_at,
            )
            for row in rows
        ],
    )


@router.post("/messages/{message_id}/hide", response_model=dict)
async def admin_hide_message(
    message_id: uuid.UUID,
    payload: AdminMessageModerationRequest,
    admin_user: User = Depends(require_permission("messages.moderate")),
    session: AsyncSession = Depends(get_db),
) -> dict:
    message = (await session.execute(select(Message).where(Message.id == message_id))).scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Message is already hidden")
    message.deleted_at = _now()
    record_admin_action(
        session,
        actor=admin_user,
        action="message.hide",
        target_type="message",
        target_id=message.id,
        target_label="Message in a conversation",
        before={"hidden": False},
        after={"hidden": True},
        justification=payload.reason,
        report_id=payload.report_id,
    )
    await session.commit()
    return {"ok": True}


@router.post("/messages/{message_id}/unhide", response_model=dict)
async def admin_unhide_message(
    message_id: uuid.UUID,
    payload: AdminMessageModerationRequest,
    admin_user: User = Depends(require_permission("messages.moderate")),
    session: AsyncSession = Depends(get_db),
) -> dict:
    message = (await session.execute(select(Message).where(Message.id == message_id))).scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Message is not hidden")
    message.deleted_at = None
    record_admin_action(
        session,
        actor=admin_user,
        action="message.unhide",
        target_type="message",
        target_id=message.id,
        target_label="Message in a conversation",
        before={"hidden": True},
        after={"hidden": False},
        justification=payload.reason,
        report_id=payload.report_id,
    )
    await session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Verification (hiring identities)
# ---------------------------------------------------------------------------


@router.get("/hiring-identities", response_model=AdminIdentityListResponse)
async def admin_list_hiring_identities(
    status_filter: str | None = Query(default="PENDING", alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_permission("verification.decide")),
    session: AsyncSession = Depends(get_db),
) -> AdminIdentityListResponse:
    query = select(HiringIdentity)
    if status_filter and status_filter.lower() != "all":
        query = query.where(HiringIdentity.verification_status == status_filter.upper())
    total = await _count(session, query)
    rows = (
        (await session.execute(query.order_by(HiringIdentity.created_at.asc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    owners = await _users_by_ids(session, [row.owner_user_id for row in rows])
    jobs_counts: dict[uuid.UUID, int] = {}
    if rows:
        for entry in (
            await session.execute(
                select(Job.hiring_identity_id, func.count())
                .where(Job.hiring_identity_id.in_([row.id for row in rows]))
                .group_by(Job.hiring_identity_id)
            )
        ).all():
            jobs_counts[entry[0]] = int(entry[1])

    items = []
    for row in rows:
        item = AdminIdentityItem.model_validate(row, from_attributes=True)
        item.owner = _user_ref(owners.get(row.owner_user_id))
        item.jobs_count = jobs_counts.get(row.id, 0)
        items.append(item)
    return AdminIdentityListResponse(items=items, total=total, limit=limit, offset=offset)


@router.patch("/hiring-identities/{identity_id}", response_model=AdminIdentityItem)
async def admin_decide_hiring_identity(
    identity_id: uuid.UUID,
    payload: AdminIdentityDecisionRequest,
    admin_user: User = Depends(require_permission("verification.decide")),
    session: AsyncSession = Depends(get_db),
) -> AdminIdentityItem:
    identity = (
        await session.execute(select(HiringIdentity).where(HiringIdentity.id == identity_id))
    ).scalar_one_or_none()
    if identity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hiring identity not found")

    if payload.decision in {"reject", "revoke"} and not (payload.reason or "").strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{payload.decision} requires a reason",
        )
    if payload.decision == "revoke" and identity.verification_status != "VERIFIED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only verified identities can be revoked")

    before = {"verification_status": identity.verification_status, "verification_method": identity.verification_method}
    if payload.decision == "approve":
        identity.verification_status = "VERIFIED"
        identity.verification_method = "MANUAL_ADMIN_REVIEW"
        identity.verified_at = _now()
        identity.verification_last_error = None
        derived_verified = True
    else:
        identity.verification_status = "REJECTED"
        identity.verified_at = None
        identity.verification_last_error = payload.reason
        derived_verified = False

    # Keep the trust badge on this identity's jobs consistent with the decision.
    jobs = (
        (await session.execute(select(Job).where(Job.hiring_identity_id == identity.id))).scalars().all()
    )
    for job in jobs:
        job.is_verified = derived_verified
        job.hiring_verification_status_snapshot = identity.verification_status

    record_admin_action(
        session,
        actor=admin_user,
        action=f"identity.{payload.decision}",
        target_type="hiring_identity",
        target_id=identity.id,
        target_label=f"Hiring identity — {identity.display_name} ({identity.platform})",
        before=before,
        after={
            "verification_status": identity.verification_status,
            "verification_method": identity.verification_method,
            "jobs_updated": len(jobs),
        },
        justification=payload.reason,
    )
    await session.commit()
    await session.refresh(identity)
    owner = (await session.execute(select(User).where(User.id == identity.owner_user_id))).scalar_one_or_none()
    item = AdminIdentityItem.model_validate(identity, from_attributes=True)
    item.owner = _user_ref(owner)
    item.jobs_count = len(jobs)
    return item


# ---------------------------------------------------------------------------
# Conversations — Tier 1 metadata
# ---------------------------------------------------------------------------


@router.get("/applications", response_model=AdminApplicationListResponse)
async def admin_list_applications(
    user_id: uuid.UUID | None = Query(default=None),
    days: int | None = Query(default=None, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_permission("conversations.metadata")),
    session: AsyncSession = Depends(get_db),
) -> AdminApplicationListResponse:
    query = select(JobApplication)
    if user_id:
        query = query.where(
            or_(JobApplication.applicant_user_id == user_id, JobApplication.job_owner_user_id == user_id)
        )
    if days:
        query = query.where(JobApplication.created_at >= _now() - timedelta(days=days))
    total = await _count(session, query)
    rows = (
        (await session.execute(query.order_by(JobApplication.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    user_ids = [row.applicant_user_id for row in rows] + [row.job_owner_user_id for row in rows]
    users = await _users_by_ids(session, user_ids)
    job_ids = list({row.job_id for row in rows if row.job_id})
    jobs: dict[uuid.UUID, Job] = {}
    if job_ids:
        jobs = {job.id: job for job in (await session.execute(select(Job).where(Job.id.in_(job_ids)))).scalars().all()}
    return AdminApplicationListResponse(
        items=[
            AdminApplicationItem(
                id=row.id,
                status=row.status,
                created_at=row.created_at,
                updated_at=row.updated_at,
                job_id=row.job_id,
                job_title=jobs[row.job_id].title if row.job_id in jobs else None,
                applicant=_user_ref(users.get(row.applicant_user_id)),
                owner=_user_ref(users.get(row.job_owner_user_id)),
            )
            for row in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/talent-interests", response_model=AdminInterestListResponse)
async def admin_list_talent_interests(
    user_id: uuid.UUID | None = Query(default=None),
    days: int | None = Query(default=None, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_permission("conversations.metadata")),
    session: AsyncSession = Depends(get_db),
) -> AdminInterestListResponse:
    query = select(TalentInterest)
    if user_id:
        query = query.where(
            or_(TalentInterest.recruiter_user_id == user_id, TalentInterest.owner_user_id == user_id)
        )
    if days:
        query = query.where(TalentInterest.created_at >= _now() - timedelta(days=days))
    total = await _count(session, query)
    rows = (
        (await session.execute(query.order_by(TalentInterest.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    user_ids = [row.recruiter_user_id for row in rows] + [row.owner_user_id for row in rows]
    users = await _users_by_ids(session, user_ids)
    listing_ids = list({row.talent_listing_id for row in rows if row.talent_listing_id})
    listings: dict[uuid.UUID, TalentListing] = {}
    if listing_ids:
        listings = {
            listing.id: listing
            for listing in (
                await session.execute(select(TalentListing).where(TalentListing.id.in_(listing_ids)))
            ).scalars().all()
        }
    return AdminInterestListResponse(
        items=[
            AdminInterestItem(
                id=row.id,
                status=row.status,
                created_at=row.created_at,
                updated_at=row.updated_at,
                listing_id=row.talent_listing_id,
                listing_title=listings[row.talent_listing_id].title if row.talent_listing_id in listings else None,
                recruiter=_user_ref(users.get(row.recruiter_user_id)),
                owner=_user_ref(users.get(row.owner_user_id)),
            )
            for row in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/abuse-signals", response_model=AdminAbuseSignalsResponse)
async def admin_abuse_signals(
    days: int = Query(default=7, ge=1, le=90),
    _admin: User = Depends(require_permission("conversations.metadata")),
    session: AsyncSession = Depends(get_db),
) -> AdminAbuseSignalsResponse:
    """Volume outliers, not verdicts: who sent the most hiring requests and
    applications in the window. High counts are review signals only."""
    since = _now() - timedelta(days=days)

    async def top(model, column) -> list[AdminAbuseSignalRow]:
        rows = (
            await session.execute(
                select(column, func.count().label("n"))
                .where(model.created_at >= since)
                .group_by(column)
                .order_by(func.count().desc())
                .limit(10)
            )
        ).all()
        users = await _users_by_ids(session, [row[0] for row in rows])
        return [
            AdminAbuseSignalRow(user=_user_ref(users[row[0]]), count=int(row[1]))
            for row in rows
            if row[0] in users
        ]

    return AdminAbuseSignalsResponse(
        days=days,
        top_interest_senders=await top(TalentInterest, TalentInterest.recruiter_user_id),
        top_applicants=await top(JobApplication, JobApplication.applicant_user_id),
    )


# ---------------------------------------------------------------------------
# Platform: entitlements, notices, notification registry + outbox
# ---------------------------------------------------------------------------


@router.get("/entitlements", response_model=AdminEntitlementListResponse)
async def admin_list_entitlements(
    kind: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_permission("platform.entitlements")),
    session: AsyncSession = Depends(get_db),
) -> AdminEntitlementListResponse:
    query = select(Entitlement)
    if kind:
        query = query.where(Entitlement.kind == kind)
    if status_filter:
        query = query.where(Entitlement.status == status_filter)
    total = await _count(session, query)
    rows = (
        (await session.execute(query.order_by(Entitlement.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    return AdminEntitlementListResponse(
        items=[AdminEntitlementItem.model_validate(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/entitlements/{entitlement_id}/revoke", response_model=AdminEntitlementItem)
async def admin_revoke_entitlement(
    entitlement_id: uuid.UUID,
    payload: AdminEntitlementRevokeRequest,
    admin_user: User = Depends(require_permission("platform.entitlements")),
    session: AsyncSession = Depends(get_db),
) -> AdminEntitlementItem:
    entitlement = (
        await session.execute(select(Entitlement).where(Entitlement.id == entitlement_id))
    ).scalar_one_or_none()
    if entitlement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entitlement not found")
    if entitlement.status == "revoked":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Entitlement is already revoked")
    before = {"status": entitlement.status}
    entitlement.status = "revoked"
    record_admin_action(
        session,
        actor=admin_user,
        action="entitlement.revoke",
        target_type="entitlement",
        target_id=entitlement.id,
        target_label=f"Entitlement — {entitlement.kind}",
        before=before,
        after={"status": "revoked"},
        justification=payload.reason,
    )
    await session.commit()
    await session.refresh(entitlement)
    return AdminEntitlementItem.model_validate(entitlement)


@router.post("/notices", response_model=AdminNoticeResponse)
async def admin_send_notices(
    payload: AdminNoticeRequest,
    admin_user: User = Depends(require_permission("platform.notices")),
    session: AsyncSession = Depends(get_db),
) -> AdminNoticeResponse:
    users = await _users_by_ids(session, list(payload.user_ids))
    if not users:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No matching users")
    for user in users.values():
        await dispatch_notification(
            session,
            event_key="platform_notice",
            recipient_user_id=user.id,
            actor_user_id=admin_user.id,
            title=payload.title,
            body=payload.body,
            category="system",
            resource_type="user",
            resource_id=str(user.id),
            action_url=payload.action_url,
        )
    record_admin_action(
        session,
        actor=admin_user,
        action="platform.notice",
        target_type="users",
        target_id=str(len(users)),
        target_label=f"Platform notice — {len(users)} recipient(s)",
        after={"title": payload.title, "user_ids": [str(uid) for uid in users]},
        justification=payload.body,
    )
    await session.commit()
    return AdminNoticeResponse(delivered=len(users))


@router.get("/notifications/registry", response_model=list[AdminRegistryEvent])
async def admin_notification_registry(
    _admin: User = Depends(require_permission("view.overview")),
) -> list[AdminRegistryEvent]:
    return [
        AdminRegistryEvent(
            key=event.key,
            category=event.category,
            recipient=event.recipient,
            priority=event.priority,
            default_channels=list(event.default_channels),
            wired=event.wired,
            notes=event.notes,
        )
        for event in EVENT_REGISTRY.values()
    ]


@router.get("/email-outbox", response_model=list[AdminOutboxItem])
async def admin_email_outbox(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    _admin: User = Depends(require_permission("view.overview")),
    session: AsyncSession = Depends(get_db),
) -> list[AdminOutboxItem]:
    query = select(EmailOutbox)
    if status_filter:
        query = query.where(EmailOutbox.status == status_filter)
    rows = (
        (await session.execute(query.order_by(EmailOutbox.created_at.desc()).limit(limit))).scalars().all()
    )
    return [AdminOutboxItem.model_validate(row) for row in rows]


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


def _audit_item(row: AdminAuditLog, actors: dict[uuid.UUID, User]) -> AdminAuditLogItem:
    return AdminAuditLogItem(
        id=row.id,
        actor=_user_ref(actors.get(row.actor_user_id)) if row.actor_user_id else None,
        action=row.action,
        target_type=row.target_type,
        target_id=row.target_id,
        target_label=row.target_label,
        before_json=row.before_json,
        after_json=row.after_json,
        justification=row.justification,
        report_id=row.report_id,
        created_at=row.created_at,
    )


@router.get("/audit-log", response_model=AdminAuditLogListResponse)
async def admin_audit_log(
    action: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    actor_user_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_permission("audit.view")),
    session: AsyncSession = Depends(get_db),
) -> AdminAuditLogListResponse:
    query = select(AdminAuditLog)
    if action:
        query = query.where(AdminAuditLog.action == action)
    if target_type:
        query = query.where(AdminAuditLog.target_type == target_type)
    if actor_user_id:
        query = query.where(AdminAuditLog.actor_user_id == actor_user_id)
    total = await _count(session, query)
    rows = (
        (await session.execute(query.order_by(AdminAuditLog.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    actors = await _users_by_ids(session, [row.actor_user_id for row in rows if row.actor_user_id])
    return AdminAuditLogListResponse(
        items=[_audit_item(row, actors) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
