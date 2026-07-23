from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.deps import get_current_user, get_job_import_service
from app.core.rate_limit import MARKETPLACE_ACTION_LIMIT, rate_limit
from app.models import User
from app.schemas.job import JobRead
from app.schemas.job_import import (
    JobImportApplyRequest,
    JobImportApplyResponse,
    JobImportConflictResolutionRequest,
    JobImportDraftInitialize,
    JobImportDraftRead,
    JobImportFieldReviewRequest,
    JobImportSourceCreate,
    JobImportSourceRead,
)
from app.services.job_import_service import JobImportError, JobImportService


router = APIRouter(prefix="/job-imports", tags=["job-imports"])


def _raise_import_error(error: JobImportError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail=error.as_detail(),
    ) from error


@router.post(
    "/sources",
    response_model=JobImportSourceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a private job-import source",
)
async def create_import_source(
    payload: JobImportSourceCreate,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportSourceRead:
    try:
        source = await service.create_source(payload, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return service.source_read(source)


@router.get(
    "/sources/{source_id}",
    response_model=JobImportSourceRead,
    summary="Read an owned private job-import source",
)
async def get_import_source(
    source_id: UUID,
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportSourceRead:
    try:
        source = await service.get_source(source_id, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return service.source_read(source)


@router.delete(
    "/sources/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Redact and soft-delete an owned job-import source",
)
async def delete_import_source(
    source_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        await service.redact_source(source_id, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/sources/{source_id}/drafts",
    response_model=JobImportDraftRead,
    status_code=status.HTTP_201_CREATED,
    summary="Initialize a private structured job-import draft",
)
async def initialize_import_draft(
    source_id: UUID,
    payload: JobImportDraftInitialize,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportDraftRead:
    try:
        draft = await service.initialize_draft(
            source_id,
            payload,
            owner_user_id=current_user.id,
        )
    except JobImportError as error:
        _raise_import_error(error)
    return await service.draft_read(draft)


@router.get(
    "/drafts/{draft_id}",
    response_model=JobImportDraftRead,
    summary="Read an owned structured job-import draft",
)
async def get_import_draft(
    draft_id: UUID,
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportDraftRead:
    try:
        draft = await service.get_draft(draft_id, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return await service.draft_read(draft)


@router.patch(
    "/drafts/{draft_id}/fields/{field_path}",
    response_model=JobImportDraftRead,
    summary="Review one field in an owned job-import draft",
)
async def review_import_field(
    draft_id: UUID,
    field_path: str,
    payload: JobImportFieldReviewRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportDraftRead:
    try:
        draft = await service.review_field(
            draft_id,
            field_path,
            payload,
            owner_user_id=current_user.id,
        )
    except JobImportError as error:
        _raise_import_error(error)
    return await service.draft_read(draft)


@router.post(
    "/drafts/{draft_id}/fields/{field_path}/resolve",
    response_model=JobImportDraftRead,
    summary="Resolve one conflicting field in an owned job-import draft",
)
async def resolve_import_conflict(
    draft_id: UUID,
    field_path: str,
    payload: JobImportConflictResolutionRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportDraftRead:
    try:
        draft = await service.resolve_conflict(
            draft_id,
            field_path,
            payload,
            owner_user_id=current_user.id,
        )
    except JobImportError as error:
        _raise_import_error(error)
    return await service.draft_read(draft)


@router.post(
    "/drafts/{draft_id}/discard",
    response_model=JobImportDraftRead,
    summary="Discard an owned job-import draft",
)
async def discard_import_draft(
    draft_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportDraftRead:
    try:
        draft = await service.discard_draft(
            draft_id,
            owner_user_id=current_user.id,
        )
    except JobImportError as error:
        _raise_import_error(error)
    return await service.draft_read(draft)


@router.delete(
    "/drafts/{draft_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Redact and soft-delete an owned job-import draft",
)
async def delete_import_draft(
    draft_id: UUID,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        await service.delete_draft(draft_id, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/drafts/{draft_id}/apply",
    response_model=JobImportApplyResponse,
    summary="Create a native job draft from reviewed import values",
)
async def apply_import_draft(
    draft_id: UUID,
    payload: JobImportApplyRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportApplyResponse:
    try:
        draft, job, created = await service.apply_to_native_draft(
            draft_id,
            payload,
            owner_user_id=current_user.id,
        )
    except JobImportError as error:
        _raise_import_error(error)
    return JobImportApplyResponse(
        draft=await service.draft_read(draft),
        job=JobRead.model_validate(job),
        created=created,
    )
