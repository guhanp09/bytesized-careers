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
                details=self._safe_failure_details(error.metadata),
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
                validation_audit = self._result_validation_audit(
                    provider_result.metadata,
                    error,
                )
                await self._mark_failed_if_current(
                    draft_id,
                    owner_user_id=owner_user_id,
                    processing_attempt_id=processing_attempt_id,
                    error_code=error.code,
                    message=error.message,
                    provider_audit=validation_audit,
                )
                raise JobImportError(
                    error.code,
                    error.message,
                    status_code=error.status_code,
                    details={
                        **(error.details if isinstance(error.details, dict) else {}),
                        "processing_diagnostic": self._safe_failure_details(validation_audit),
                    },
                ) from error
            raise
        except Exception as error:
            await self._mark_failed_if_current(
                draft_id,
                owner_user_id=owner_user_id,
                processing_attempt_id=processing_attempt_id,
                error_code="JOB_IMPORT_PROCESSING_FAILED",
                message="The extraction result could not be persisted.",
                provider_audit=provider_result.metadata.model_copy(
                    update={
                        "metadata": {
                            **provider_result.metadata.metadata,
                            "processing_stage": "provider_neutral_persistence",
                            "failure_code": "JOB_IMPORT_PROCESSING_FAILED",
                            "failure_subreason": "persistence_failure",
                        }
                    }
                ),
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

    @staticmethod
    def _safe_field_path(value: object) -> str | None:
        if not isinstance(value, str) or not 1 <= len(value) <= 120:
            return None
        if not value[0].islower():
            return None
        if not all(
            character.islower() or character.isdigit() or character == "_" for character in value
        ):
            return None
        return value

    @classmethod
    def _result_validation_audit(
        cls,
        provider_audit: JobImportProviderMetadata,
        error: JobImportError,
    ) -> JobImportProviderMetadata:
        """Retain a bounded private reason when validated output fails persistence."""

        details = error.details if isinstance(error.details, dict) else {}
        stage = "provider_neutral_persistence"
        subreason = "field_policy_rejection"
        affected_field_path: str | None = None

        if error.code == "JOB_IMPORT_EVIDENCE_REFERENCE_INVALID":
            stage = "evidence_validation"
            subreason = "invalid_evidence_reference"
        elif error.code == "JOB_IMPORT_UNSUPPORTED_FIELD":
            stage = "field_policy_validation"
            raw_fields = details.get("fields")
            fields = raw_fields if isinstance(raw_fields, list) else []
            affected_field_path = next(
                (path for value in fields if (path := cls._safe_field_path(value)) is not None),
                None,
            )
            if affected_field_path in {"languages", "language_requirements"}:
                subreason = "prohibited_language_field"
            elif affected_field_path == "screening_questions":
                subreason = "prohibited_screening_question_field"
            elif affected_field_path in set(details.get("server_owned_fields") or []):
                subreason = "creatorjobs_owned_field"
            else:
                subreason = "unsupported_field"
        elif error.code == "JOB_IMPORT_UNSUPPORTED_NESTED_FIELD":
            stage = "field_policy_validation"
            subreason = "unsupported_nested_field"
            affected_field_path = cls._safe_field_path(details.get("field_path"))
        elif error.code == "JOB_IMPORT_CONFLICT_VALUES_NOT_DISTINCT":
            stage = "provider_neutral_validation"
            subreason = "malformed_conflict"
            affected_field_path = cls._safe_field_path(details.get("field_path"))
        elif error.code == "JOB_IMPORT_EXTRACTION_SCHEMA_MISMATCH":
            stage = "provider_neutral_validation"
            subreason = "extraction_schema_mismatch"
        elif error.code == "JOB_IMPORT_TARGET_SCHEMA_MISMATCH":
            stage = "provider_neutral_validation"
            subreason = "target_schema_mismatch"
        elif error.code == "JOB_IMPORT_MACHINE_OUTPUT_IMMUTABLE":
            stage = "processing_state_validation"
            subreason = "machine_output_immutable"

        diagnostics: dict[str, object] = {
            "processing_stage": stage,
            "failure_code": error.code,
            "failure_subreason": subreason,
        }
        if affected_field_path is not None:
            diagnostics["affected_field_path"] = affected_field_path
        alternative_index = details.get("alternative_index")
        if isinstance(alternative_index, int) and 0 <= alternative_index <= 7:
            diagnostics["affected_conflict_alternative_index"] = alternative_index
        return provider_audit.model_copy(
            update={
                "metadata": {
                    **provider_audit.metadata,
                    **diagnostics,
                }
            }
        )

    @classmethod
    def _safe_failure_details(
        cls,
        provider_audit: JobImportProviderMetadata | None,
    ) -> dict[str, object]:
        if provider_audit is None:
            return {}
        metadata = provider_audit.metadata
        allowed_text = {
            "request_id": 255,
            "processing_stage": 80,
            "failure_code": 80,
            "failure_subreason": 80,
            "segmentation_version": 80,
            "affected_field_path": 120,
            "affected_structure": 40,
        }
        details: dict[str, object] = {}
        for key, maximum in allowed_text.items():
            value = metadata.get(key)
            if isinstance(value, str) and 1 <= len(value) <= maximum:
                details[key] = value
        for key in {
            "provider_http_status",
            "span_count",
            "returned_evidence_id_count",
            "invalid_evidence_id_count",
            "unknown_evidence_id_count",
            "duplicate_evidence_id_count",
            "affected_structure_index",
            "affected_conflict_alternative_index",
        }:
            value = metadata.get(key)
            if isinstance(value, int) and 0 <= value <= 1_000_000:
                details[key] = value
        invalid_ids = metadata.get("invalid_evidence_span_ids")
        if isinstance(invalid_ids, list):
            bounded_ids = [
                value
                for value in invalid_ids[:5]
                if isinstance(value, str)
                and len(value) == 5
                and value.startswith("E")
                and value[1:].isdigit()
            ]
            if bounded_ids:
                details["invalid_evidence_span_ids"] = bounded_ids
        return details

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
