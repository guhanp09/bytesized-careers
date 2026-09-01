from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    authenticated_rate_limit,
    get_current_user,
    get_db,
    get_job_import_conversation_service,
    get_job_import_processing_service,
    get_job_import_service,
    get_job_import_url_service,
)
from app.core.rate_limit import MARKETPLACE_ACTION_LIMIT, OUTBOUND_FETCH_LIMIT
from app.models import User
from app.schemas.job import JobRead
from app.schemas.job_import import (
    JobImportAnswerRequest,
    JobImportApplyRequest,
    JobImportApplyResponse,
    JobImportAttachRequest,
    JobImportAttachResponse,
    JobImportConflictResolutionRequest,
    JobImportConversationRead,
    JobImportDraftContextRead,
    JobImportDraftInitialize,
    JobImportDraftRead,
    JobImportFieldReviewRequest,
    JobImportPrefillRequest,
    JobImportProcessRequest,
    JobImportProcessResponse,
    JobImportSourceCreate,
    JobImportSourceRead,
    JobImportUrlSourceCreate,
)
from app.services.job_import_conversation_service import (
    ConversationSnapshot,
    JobImportConversationService,
)
from app.services.job_import_processing_service import JobImportProcessingService
from app.services.job_import_service import JobImportError, JobImportService
from app.services.job_import_url_service import JobImportUrlService

router = APIRouter(prefix="/job-imports", tags=["job-imports"])


def _raise_import_error(error: JobImportError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail=error.as_detail(),
    ) from error


@router.get(
    "/native-jobs/{job_id}/context",
    response_model=JobImportDraftContextRead,
    summary="Read private import context linked to an owned native job draft",
)
async def get_native_job_import_context(
    job_id: UUID,
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportDraftContextRead:
    try:
        draft, source = await service.get_draft_for_target_job(
            job_id,
            owner_user_id=current_user.id,
        )
    except JobImportError as error:
        _raise_import_error(error)
    source_url = source.final_source_url or source.source_url
    return JobImportDraftContextRead(
        draft=await service.draft_read(draft),
        source_type=source.source_type,
        source_label=source.source_title
        or ("Public job post" if source.source_type == "public_url" else "Pasted job post"),
        source_url=str(source_url) if source_url else None,
    )


@router.post(
    "/sources",
    response_model=JobImportSourceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a private job-import source",
)
async def create_import_source(
    payload: JobImportSourceCreate,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportSourceRead:
    try:
        source = await service.create_source(payload, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return service.source_read(source)


@router.post(
    "/url-sources",
    response_model=JobImportSourceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Securely retrieve and create a private public-URL import source",
)
async def create_url_import_source(
    payload: JobImportUrlSourceCreate,
    _limit: None = authenticated_rate_limit(OUTBOUND_FETCH_LIMIT),
    url_service: JobImportUrlService = Depends(get_job_import_url_service),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportSourceRead:
    try:
        source = await url_service.ingest(payload, owner_user_id=current_user.id)
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
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
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
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
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


@router.post(
    "/drafts/{draft_id}/process",
    response_model=JobImportProcessResponse,
    summary="Process an owned normalized-text import draft privately",
)
async def process_import_draft(
    draft_id: UUID,
    _payload: JobImportProcessRequest,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    processing_service: JobImportProcessingService = Depends(get_job_import_processing_service),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportProcessResponse:
    try:
        result = await processing_service.process(
            draft_id,
            owner_user_id=current_user.id,
        )
    except JobImportError as error:
        _raise_import_error(error)
    return JobImportProcessResponse(
        outcome=result.outcome,
        draft=await service.draft_read(result.draft),
    )


@router.patch(
    "/drafts/{draft_id}/fields/{field_path}",
    response_model=JobImportDraftRead,
    summary="Review one field in an owned job-import draft",
)
async def review_import_field(
    draft_id: UUID,
    field_path: str,
    payload: JobImportFieldReviewRequest,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
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


def _conversation_read(snapshot: ConversationSnapshot) -> JobImportConversationRead:
    return JobImportConversationRead(
        state=snapshot.state,
        active_question=snapshot.active_question,
        recruiter_context_version=snapshot.recruiter_context_version,
        continuation_count=snapshot.continuation_count,
        waiting=snapshot.waiting,
        ready_for_draft=snapshot.ready_for_draft,
        phase=snapshot.phase,
        essential_remaining=snapshot.essential_remaining,
        manual_continuation=snapshot.manual_continuation,
    )


@router.get(
    "/drafts/{draft_id}/conversation",
    response_model=JobImportConversationRead,
    summary="Read the checkpointed conversation without starting any work",
)
async def read_import_conversation(
    draft_id: UUID,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportConversationService = Depends(get_job_import_conversation_service),
    current_user: User = Depends(get_current_user),
) -> JobImportConversationRead:
    # Deliberately a plain read. Polling and refresh both land here, and neither
    # may start a provider stage.
    try:
        snapshot = await service.snapshot(draft_id, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return _conversation_read(snapshot)


@router.post(
    "/drafts/{draft_id}/conversation/begin",
    response_model=JobImportConversationRead,
    summary="Enter the conversation for a prepared draft",
)
async def begin_import_conversation(
    draft_id: UUID,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportConversationService = Depends(get_job_import_conversation_service),
    current_user: User = Depends(get_current_user),
) -> JobImportConversationRead:
    try:
        snapshot = await service.begin(draft_id, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return _conversation_read(snapshot)


@router.post(
    "/drafts/{draft_id}/conversation/answer",
    response_model=JobImportConversationRead,
    summary="Answer the one question the assistant is waiting on",
)
async def answer_import_question(
    draft_id: UUID,
    payload: JobImportAnswerRequest,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportConversationService = Depends(get_job_import_conversation_service),
    current_user: User = Depends(get_current_user),
) -> JobImportConversationRead:
    try:
        snapshot = await service.answer_active_question(
            draft_id,
            payload.field_path,
            payload.value,
            owner_user_id=current_user.id,
            expected_context_version=payload.expected_context_version,
        )
    except JobImportError as error:
        _raise_import_error(error)
    return _conversation_read(snapshot)


@router.post(
    "/drafts/{draft_id}/conversation/skip",
    response_model=JobImportConversationRead,
    summary="Skip the active optional suggestion",
)
async def skip_import_question(
    draft_id: UUID,
    remaining: bool = False,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportConversationService = Depends(get_job_import_conversation_service),
    current_user: User = Depends(get_current_user),
) -> JobImportConversationRead:
    try:
        snapshot = (
            await service.skip_remaining_suggestions(
                draft_id, owner_user_id=current_user.id
            )
            if remaining
            else await service.dismiss_active_question(
                draft_id, owner_user_id=current_user.id
            )
        )
    except JobImportError as error:
        _raise_import_error(error)
    return _conversation_read(snapshot)


@router.post(
    "/drafts/{draft_id}/conversation/continue-manually",
    response_model=JobImportConversationRead,
    summary="Leave the conversation and finish in the ordinary Post Job editor",
)
async def continue_import_manually(
    draft_id: UUID,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportConversationService = Depends(get_job_import_conversation_service),
    current_user: User = Depends(get_current_user),
) -> JobImportConversationRead:
    try:
        snapshot = await service.continue_manually(draft_id, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return _conversation_read(snapshot)


@router.post(
    "/drafts/{draft_id}/conversation/pause",
    response_model=JobImportConversationRead,
    summary="Record that the recruiter stepped away, keeping the draft resumable",
)
async def pause_import_conversation(
    draft_id: UUID,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportConversationService = Depends(get_job_import_conversation_service),
    current_user: User = Depends(get_current_user),
) -> JobImportConversationRead:
    try:
        snapshot = await service.mark_abandoned(draft_id, owner_user_id=current_user.id)
    except JobImportError as error:
        _raise_import_error(error)
    return _conversation_read(snapshot)


@router.put(
    "/drafts/{draft_id}/prefill/{field_path}",
    response_model=JobImportDraftRead,
    summary="Answer a recruiter-owned detail while an import draft is still being prepared",
)
async def set_import_prefill(
    draft_id: UUID,
    field_path: str,
    payload: JobImportPrefillRequest,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    current_user: User = Depends(get_current_user),
) -> JobImportDraftRead:
    try:
        draft = await service.set_recruiter_prefill(
            draft_id,
            field_path,
            payload.value,
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
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
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
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
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
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
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
    background: BackgroundTasks,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    session: AsyncSession = Depends(get_db),
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
    from app.api.v1.routers.jobs import schedule_brand_about_enrichment

    await schedule_brand_about_enrichment(background, job=job, session=session)
    return JobImportApplyResponse(
        draft=await service.draft_read(draft),
        job=JobRead.model_validate(job),
        created=created,
    )


@router.post(
    "/drafts/{draft_id}/attach",
    response_model=JobImportAttachResponse,
    summary="Attach retained import context to an owned canonical job",
)
async def attach_import_draft(
    draft_id: UUID,
    payload: JobImportAttachRequest,
    background: BackgroundTasks,
    _limit: None = authenticated_rate_limit(MARKETPLACE_ACTION_LIMIT),
    service: JobImportService = Depends(get_job_import_service),
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobImportAttachResponse:
    try:
        draft, job, linked = await service.attach_to_native_job(
            draft_id,
            payload.target_job_id,
            owner_user_id=current_user.id,
        )
    except JobImportError as error:
        _raise_import_error(error)
    from app.api.v1.routers.jobs import schedule_brand_about_enrichment

    await schedule_brand_about_enrichment(background, job=job, session=session)
    return JobImportAttachResponse(
        draft=await service.draft_read(draft),
        job=JobRead.model_validate(job),
        linked=linked,
    )
