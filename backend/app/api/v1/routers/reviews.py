from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.rate_limit import MARKETPLACE_ACTION_LIMIT, rate_limit
from app.models import Engagement, JobApplication, TalentInterest, User
from app.schemas.reviews import (
    CompletionRequest,
    CompletionResponseRequest,
    EngagementSummary,
    MyReviewRead,
    ReviewUpsertRequest,
    ReviewWorkspaceResponse,
    StartResponseRequest,
)
from app.services import review_service

router = APIRouter(prefix="/me", tags=["reviews"])


def _raise_domain(error: review_service.ReviewDomainError) -> None:
    if isinstance(error, review_service.EngagementNotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    if isinstance(error, review_service.EngagementForbidden):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error


async def _summary_and_commit(
    session: AsyncSession,
    engagement,
    viewer_id: UUID,
) -> EngagementSummary:
    summary = await review_service.engagement_summary(session, engagement, viewer_id)
    await session.commit()
    return summary


@router.post(
    "/applications/{application_id}/engagement/start-request",
    response_model=EngagementSummary,
)
async def request_application_start(
    application_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EngagementSummary:
    application = await session.get(JobApplication, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")
    if current_user.id not in (application.applicant_user_id, application.job_owner_user_id):
        raise HTTPException(status_code=403, detail="Not an application participant")
    try:
        engagement = await review_service.ensure_for_application(session, application)
        await review_service.request_start(session, engagement, current_user)
        return await _summary_and_commit(session, engagement, current_user.id)
    except review_service.ReviewDomainError as error:
        _raise_domain(error)


@router.post(
    "/talent-interests/{interest_id}/engagement/start-request",
    response_model=EngagementSummary,
)
async def request_interest_start(
    interest_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EngagementSummary:
    interest = await session.get(TalentInterest, interest_id)
    if interest is None:
        raise HTTPException(status_code=404, detail="Hiring request not found")
    if current_user.id not in (interest.recruiter_user_id, interest.owner_user_id):
        raise HTTPException(status_code=403, detail="Not a hiring-request participant")
    try:
        engagement = await review_service.ensure_for_interest(session, interest)
        await review_service.request_start(session, engagement, current_user)
        return await _summary_and_commit(session, engagement, current_user.id)
    except review_service.ReviewDomainError as error:
        _raise_domain(error)


#: Engagements where something is still being arranged or worked on. Finished
#: ones are the review workspace's business, not the inbox's.
LIVE_ENGAGEMENT_STATUSES = ("ready_to_start", "start_pending", "active", "completion_pending")


@router.get("/engagements", response_model=list[EngagementSummary])
async def list_my_engagements(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[EngagementSummary]:
    """Every live engagement the caller takes part in, in one request.

    The workspace needs these list-wide: "whose start is still unconfirmed?" is
    a question about the whole inbox, and answering it by opening each thread in
    turn would make the highest-priority queue unreachable in practice.

    Scoped by participation, so there is no parameter through which someone
    could read an engagement they are not part of.
    """
    engagements = (
        await session.execute(
            select(Engagement)
            .where(
                or_(
                    Engagement.recruiter_user_id == current_user.id,
                    Engagement.talent_user_id == current_user.id,
                ),
                Engagement.status.in_(LIVE_ENGAGEMENT_STATUSES),
            )
            .order_by(Engagement.updated_at.desc())
        )
    ).scalars().all()
    summaries = [
        await review_service.engagement_summary(session, engagement, current_user.id)
        for engagement in engagements
    ]
    # `engagement_summary` can finalize expired windows as a side effect.
    await session.commit()
    return summaries


@router.get("/engagements/{engagement_id}", response_model=EngagementSummary)
async def get_engagement(
    engagement_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EngagementSummary:
    engagement = await session.get(Engagement, engagement_id)
    if engagement is None:
        raise HTTPException(status_code=404, detail="Engagement not found")
    try:
        return await _summary_and_commit(session, engagement, current_user.id)
    except review_service.ReviewDomainError as error:
        _raise_domain(error)


@router.post("/engagements/{engagement_id}/start-response", response_model=EngagementSummary)
async def respond_to_start(
    engagement_id: UUID,
    payload: StartResponseRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EngagementSummary:
    try:
        engagement = await review_service.start_response(
            session, engagement_id, current_user, payload.decision
        )
        return await _summary_and_commit(session, engagement, current_user.id)
    except review_service.ReviewDomainError as error:
        _raise_domain(error)


@router.post("/engagements/{engagement_id}/cancel", response_model=EngagementSummary)
async def cancel_engagement(
    engagement_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EngagementSummary:
    try:
        engagement = await review_service.cancel_before_start(session, engagement_id, current_user)
        return await _summary_and_commit(session, engagement, current_user.id)
    except review_service.ReviewDomainError as error:
        _raise_domain(error)


@router.post("/engagements/{engagement_id}/completion-request", response_model=EngagementSummary)
async def request_completion(
    engagement_id: UUID,
    payload: CompletionRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EngagementSummary:
    try:
        engagement = await review_service.request_completion(
            session,
            engagement_id,
            current_user,
            outcome=payload.outcome,
            note=payload.note,
        )
        return await _summary_and_commit(session, engagement, current_user.id)
    except review_service.ReviewDomainError as error:
        _raise_domain(error)


@router.post("/engagements/{engagement_id}/completion-response", response_model=EngagementSummary)
async def respond_to_completion(
    engagement_id: UUID,
    payload: CompletionResponseRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EngagementSummary:
    try:
        engagement = await review_service.completion_response(
            session,
            engagement_id,
            current_user,
            decision=payload.decision,
            note=payload.note,
        )
        return await _summary_and_commit(session, engagement, current_user.id)
    except review_service.ReviewDomainError as error:
        _raise_domain(error)


@router.put("/engagements/{engagement_id}/review", response_model=MyReviewRead)
async def save_review(
    engagement_id: UUID,
    payload: ReviewUpsertRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MyReviewRead:
    try:
        review = await review_service.upsert_review(
            session,
            engagement_id,
            current_user,
            overall_rating=payload.overall_rating,
            dimension_ratings=payload.dimension_ratings,
            public_feedback=payload.public_feedback,
        )
        await session.commit()
        return review
    except review_service.ReviewDomainError as error:
        _raise_domain(error)


@router.get("/reviews", response_model=ReviewWorkspaceResponse)
async def get_review_workspace(
    mode: Literal["talent", "hiring"] = Query(default="talent"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ReviewWorkspaceResponse:
    result = await review_service.review_workspace(session, current_user, mode)
    await session.commit()
    return result
