from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_user,
    get_db,
    get_job_service,
    require_job_owner,
)
from app.core.brand_about_eligibility import should_enrich_brand_about
from app.core.rate_limit import MARKETPLACE_ACTION_LIMIT, rate_limit
from app.integrations.openai.brand_summary_adapter import (
    BrandSummaryConfig,
    OpenAIBrandSummarizer,
)
from app.models import HiringIdentity, Job, User
from app.schemas import JobCreate, JobListResponse, JobRead, JobStatus, JobUpdate
from app.services.brand_enrichment_service import (
    BrandAboutRunner,
    BrandEnrichmentService,
)
from app.services.job_service import (
    JobAuthRequiredError,
    JobForbiddenError,
    JobNotFoundError,
    JobService,
    JobValidationError,
    JobVerificationRequiredError,
)
from app.services.public_listing_serializer import public_job_read

logger = logging.getLogger(__name__)


def build_brand_enrichment_service() -> BrandEnrichmentService:
    """The engine, configured from settings.

    The probe branch is the seam a browser test uses to hold an attempt open
    mid-flight so the race guarantees can be observed through the product. It is
    inert in any ordinary process: `active_probe()` returns None unless the
    dev-only router installed one, and that router refuses to load outside
    development or test.
    """

    from app.core.config import settings
    from app.services.brand_enrichment_probe import (
        GatedFetcher,
        GatedSummarizer,
        active_probe,
    )

    probe = active_probe()
    if probe is not None:
        return BrandEnrichmentService(GatedSummarizer(probe), fetcher=GatedFetcher(probe))

    return BrandEnrichmentService(
        OpenAIBrandSummarizer(
            BrandSummaryConfig(
                api_key=(
                    settings.openai_api_key.get_secret_value()
                    if settings.openai_api_key is not None
                    else None
                ),
                model=settings.openai_model,
            )
        )
    )

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get(
    "",
    response_model=JobListResponse,
    summary="List jobs",
    description="List jobs with pagination, filtering, and default newest-first sorting.",
)
async def list_jobs(
    q: str | None = Query(default=None, description="Search text in job title"),
    role: list[str] | None = Query(default=None, description="Filter by canonical role slug"),
    platform: list[str] | None = Query(default=None, description="Filter by platform value"),
    format_filter: list[str] | None = Query(
        default=None,
        alias="format",
        description="Filter by structured content format",
    ),
    work_mode: list[str] | None = Query(default=None, description="Filter by work mode"),
    engagement_type: list[str] | None = Query(
        default=None,
        description="Filter by engagement type",
    ),
    budget_unit: list[str] | None = Query(default=None, description="Filter by compensation unit"),
    language: list[str] | None = Query(
        default=None,
        description="Deprecated compatibility parameter; no longer filters public jobs",
    ),
    location: str | None = Query(default=None, description="Filter by location substring"),
    start_timeframe: str | None = Query(default=None, description="Filter by start timeframe"),
    status_filter: JobStatus | None = Query(default=None, alias="status", description="Filter by status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    service: JobService = Depends(get_job_service),
) -> JobListResponse:
    if status_filter not in (None, "published"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "PUBLIC_JOB_STATUS_INVALID",
                "message": "Public job listings only support status=published.",
            },
        )
    items, total = await service.list_jobs(
        limit=limit,
        offset=offset,
        q=q,
        role=role,
        platform=platform,
        format_filter=format_filter,
        work_mode=work_mode,
        engagement_type=engagement_type,
        budget_unit=budget_unit,
        language=language,
        location=location,
        start_timeframe=start_timeframe,
    )
    return JobListResponse(
        items=[public_job_read(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{job_id}",
    response_model=JobRead,
    summary="Get job details",
)
async def get_job(job_id: UUID, service: JobService = Depends(get_job_service)) -> JobRead:
    try:
        job = await service.get_public_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return public_job_read(job)


@router.post(
    "",
    response_model=JobRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a job",
)
async def create_job(
    payload: JobCreate,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobService = Depends(get_job_service),
    current_user: User = Depends(get_current_user),
) -> JobRead | JSONResponse:
    try:
        job = await service.create_job(
            payload,
            actor_user_id=current_user.id,
        )
    except JobValidationError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": exc.as_detail()},
        )
    except JobAuthRequiredError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except JobVerificationRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "REPRESENTATION_VERIFICATION_REQUIRED",
                "message": str(exc),
            },
        ) from exc
    except JobForbiddenError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return JobRead.model_validate(job)


@router.patch(
    "/{job_id}",
    response_model=JobRead,
    summary="Update a job",
)
async def update_job(
    payload: JobUpdate,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    owned_job: Job = Depends(require_job_owner),
    service: JobService = Depends(get_job_service),
    current_user: User = Depends(get_current_user),
) -> JobRead | JSONResponse:
    try:
        job = await service.update_job_record(owned_job, payload, actor_user_id=current_user.id)
    except JobValidationError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": exc.as_detail()},
        )
    except JobAuthRequiredError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except JobVerificationRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "REPRESENTATION_VERIFICATION_REQUIRED",
                "message": str(exc),
            },
        ) from exc
    except JobForbiddenError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return JobRead.model_validate(job)


@router.delete(
    "/{job_id}",
    response_model=JobRead,
    summary="Archive (soft delete) a job",
    description="Soft-deletes the job by setting deleted_at and archiving status.",
)
async def delete_job(
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    owned_job: Job = Depends(require_job_owner),
    service: JobService = Depends(get_job_service),
) -> JobRead:
    job = await service.delete_job_record(owned_job)
    return JobRead.model_validate(job)

class BrandAboutEnrichResponse(BaseModel):
    """What the trigger was told. Diagnostics, never candidate copy."""

    outcome: str
    reason: str = ""


@router.post(
    "/{job_id}/brand-about/enrich",
    response_model=BrandAboutEnrichResponse,
    summary="Request bounded brand About enrichment for an owned job",
)
async def enrich_brand_about(
    background: BackgroundTasks,
    owned_job: Job = Depends(require_job_owner),
    session: AsyncSession = Depends(get_db),
) -> BrandAboutEnrichResponse:
    """Claim an eligible job for enrichment and do the work after responding.

    The response is deliberately immediate. Enrichment is a website fetch and a
    model call, and the recruiter's save must not wait for either — so this
    answers as soon as it knows whether there is work to do, and the work itself
    runs in a background task once the response has been sent.

    That also settles the cancellation problem the import pipeline already
    taught us about: because the work does not depend on the client holding the
    connection, navigating away the instant a draft is saved cannot strand it.
    If the process itself dies mid-attempt, the accepted 180-second stale rule
    makes the row eligible again rather than leaving it running forever.

    Nothing is accepted from the client. The brand, its official URL and the
    eligibility decision all come from persisted CreatorJobs state, so a caller
    cannot ask for a different company to be described.
    """

    decision = should_enrich_brand_about(
        about=owned_job.about_channel,
        hiring_identity_id=owned_job.hiring_identity_id,
        status=owned_job.brand_about_status,
        attempted_identity_id=owned_job.brand_about_identity_id,
        attempted_at=owned_job.brand_about_attempted_at,
    )
    if not decision.eligible:
        return BrandAboutEnrichResponse(outcome="not_eligible", reason=decision.reason)

    identity = await session.get(HiringIdentity, owned_job.hiring_identity_id)
    if identity is None:
        return BrandAboutEnrichResponse(
            outcome="not_eligible", reason="the hiring identity is no longer available"
        )

    background.add_task(_run_brand_about_enrichment, owned_job.id, identity.id)
    return BrandAboutEnrichResponse(outcome="claimed", reason=decision.reason)


async def _run_brand_about_enrichment(job_id: UUID, identity_id: UUID) -> None:
    """Run one enrichment attempt on its own session, after the response.

    Its own session because the request's is closed by now. Failures are logged
    and dropped: enrichment is optional, and there is no surface on which a
    recruiter should learn that a brand's website was slow.
    """

    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        try:
            job = await session.get(Job, job_id)
            identity = await session.get(HiringIdentity, identity_id)
            if job is None or identity is None:
                return
            runner = BrandAboutRunner(session, build_brand_enrichment_service())
            await runner.run(job, identity)
        except Exception:  # pragma: no cover - optional enhancement
            logger.exception("brand_about_enrichment_failed", extra={"job_id": str(job_id)})
