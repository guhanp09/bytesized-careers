from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

from app.models import JobImportDraft
from app.schemas.job_import import JobImportProviderMetadata
from app.services.job_import_provider import (
    JobImportExtractionProvider,
    JobImportProviderError,
)
from app.services.job_import_service import JobImportError, JobImportService


@dataclass(frozen=True)
class JobImportProcessResult:
    outcome: str
    draft: JobImportDraft


class JobImportProcessingService:
    """Orchestrate one bounded provider call without holding a DB transaction."""

    _PROCESSED_STATUSES = {
        "awaiting_recruiter_review",
        "partially_reviewed",
        "ready_to_apply",
    }
    _TERMINAL_STATUSES = {
        "applied_to_native_draft",
        "discarded",
        "superseded",
    }
    _TEXT_SOURCE_TYPES = {
        "pasted_text",
        "rough_description",
        "external_listing_text",
        "public_url",
    }

    def __init__(
        self,
        import_service: JobImportService,
        provider: JobImportExtractionProvider,
    ) -> None:
        self.import_service = import_service
        self.provider = provider

    async def process(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> JobImportProcessResult:
        draft = await self.import_service.get_draft(
            draft_id,
            owner_user_id=owner_user_id,
        )
        current = self._current_outcome(draft)
        if current is not None:
            return current

        request = await self.import_service.build_extraction_request(
            draft_id,
            owner_user_id=owner_user_id,
        )
        if (
            request.source.source_type not in self._TEXT_SOURCE_TYPES
            or not request.source.original_text
        ):
            raise JobImportError(
                "JOB_IMPORT_TEXT_SOURCE_REQUIRED",
                "OpenAI processing currently supports normalized text sources only.",
            )

        processing_attempt_id = uuid4()
        try:
            await self.import_service.begin_processing(
                draft_id,
                owner_user_id=owner_user_id,
                processing_attempt_id=processing_attempt_id,
            )
        except JobImportError as error:
            if error.code != "JOB_IMPORT_INVALID_TRANSITION":
                raise
            raced = await self.import_service.get_draft(
                draft_id,
                owner_user_id=owner_user_id,
            )
            raced_outcome = self._current_outcome(raced)
            if raced_outcome is not None:
                return raced_outcome
            raise

        try:
            provider_result = await self.provider.extract(request)
        except JobImportProviderError as error:
            await self._mark_failed_if_current(
                draft_id,
                owner_user_id=owner_user_id,
                processing_attempt_id=processing_attempt_id,
                error_code=error.code,
                message=error.message,
                provider_audit=error.metadata,
            )
            raise JobImportError(
                error.code,
                error.message,
                status_code=error.status_code,
            ) from error
        except Exception as error:
            await self._mark_failed_if_current(
                draft_id,
                owner_user_id=owner_user_id,
                processing_attempt_id=processing_attempt_id,
                error_code="JOB_IMPORT_PROVIDER_FAILED",
                message="The text extraction provider failed unexpectedly.",
                provider_audit=None,
            )
            raise JobImportError(
                "JOB_IMPORT_PROVIDER_FAILED",
                "The text extraction provider failed unexpectedly.",
                status_code=502,
            ) from error

        try:
            completed = await self.import_service.record_extraction_result(
                draft_id,
                provider_result.extraction,
                owner_user_id=owner_user_id,
                provider_metadata=provider_result.metadata,
                expected_processing_attempt_id=processing_attempt_id,
            )
        except JobImportError as error:
            if error.code != "JOB_IMPORT_STALE_PROCESSING_RESULT":
                await self._mark_failed_if_current(
                    draft_id,
                    owner_user_id=owner_user_id,
                    processing_attempt_id=processing_attempt_id,
                    error_code=error.code,
                    message=error.message,
                    provider_audit=provider_result.metadata,
                )
            raise
        except Exception as error:
            await self._mark_failed_if_current(
                draft_id,
                owner_user_id=owner_user_id,
                processing_attempt_id=processing_attempt_id,
                error_code="JOB_IMPORT_PROCESSING_FAILED",
                message="The extraction result could not be persisted.",
                provider_audit=provider_result.metadata,
            )
            raise JobImportError(
                "JOB_IMPORT_PROCESSING_FAILED",
                "The extraction result could not be persisted.",
                status_code=500,
            ) from error
        return JobImportProcessResult(outcome="processed", draft=completed)

    @classmethod
    def _current_outcome(
        cls,
        draft: JobImportDraft,
    ) -> JobImportProcessResult | None:
        if draft.processing_status == "processing":
            return JobImportProcessResult(
                outcome="already_processing",
                draft=draft,
            )
        if draft.processing_status in cls._PROCESSED_STATUSES:
            return JobImportProcessResult(
                outcome="already_processed",
                draft=draft,
            )
        if draft.processing_status in cls._TERMINAL_STATUSES:
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "This import draft cannot be processed from its current state.",
                status_code=409,
            )
        return None

    async def _mark_failed_if_current(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
        processing_attempt_id: UUID,
        error_code: str,
        message: str,
        provider_audit: JobImportProviderMetadata | None,
    ) -> None:
        try:
            await self.import_service.mark_processing_failed(
                draft_id,
                owner_user_id=owner_user_id,
                error_code=error_code,
                message=message,
                expected_processing_attempt_id=processing_attempt_id,
                provider_audit=provider_audit,
            )
        except JobImportError as error:
            if error.code not in {
                "JOB_IMPORT_DRAFT_NOT_FOUND",
                "JOB_IMPORT_INVALID_TRANSITION",
                "JOB_IMPORT_STALE_PROCESSING_RESULT",
            }:
                raise
