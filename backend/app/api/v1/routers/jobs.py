from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import (
    get_current_user,
    get_job_service,
    get_optional_current_user,
    require_job_owner,
)
from app.core.rate_limit import MARKETPLACE_ACTION_LIMIT, rate_limit
from app.models import Job, User
from app.schemas import JobCreate, JobListResponse, JobRead, JobStatus, JobUpdate
from app.services.job_service import (
    JobAuthRequiredError,
    JobForbiddenError,
    JobNotFoundError,
    JobService,
    JobValidationError,
    JobVerificationRequiredError,
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
    platform: str | None = Query(default=None, description="Filter by platform value"),
    location: str | None = Query(default=None, description="Filter by location substring"),
    start_timeframe: str | None = Query(default=None, description="Filter by start timeframe"),
    status_filter: JobStatus | None = Query(default=None, alias="status", description="Filter by status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    service: JobService = Depends(get_job_service),
) -> JobListResponse:
    items, total = await service.list_jobs(
        limit=limit,
        offset=offset,
        q=q,
        platform=platform,
        location=location,
        start_timeframe=start_timeframe,
        status=status_filter,
    )
    return JobListResponse(
        items=[JobRead.model_validate(item) for item in items],
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
        job = await service.get_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return JobRead.model_validate(job)


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
    current_user: User | None = Depends(get_optional_current_user),
) -> JobRead:
    try:
        job = await service.create_job(
            payload,
            actor_user_id=current_user.id if current_user is not None else None,
        )
    except JobValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
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
) -> JobRead:
    try:
        job = await service.update_job_record(owned_job, payload, actor_user_id=current_user.id)
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
