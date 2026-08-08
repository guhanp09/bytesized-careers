from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from uuid import UUID, uuid4

from app.core.job_import_structured_fields import fields_from_structured_context
from app.core.job_taxonomy import CURRENT_LISTING_SCHEMA_VERSION
from app.models import JobImportDraft
from app.schemas.job_import import (
    CURRENT_EXTRACTION_SCHEMA_VERSION,
    JobImportExtractionResponse,
    JobImportProviderMetadata,
)
from app.services.job_import_provider import (
    JobImportExtractionProvider,
    JobImportProviderError,
)
from app.services.job_import_service import JobImportError, JobImportService

logger = logging.getLogger(__name__)


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
    #: Provider failures that mean "the reply was the wrong shape", not "the
    #: service is unavailable". These are recoverable: the source is intact, so
    #: the draft can still be built and the assistant asks for what it needs.
    #:
    #: Two neighbours are deliberately excluded. OPENAI_EVIDENCE_INVALID means
    #: cited provenance did not resolve, and OPENAI_REFUSED is a content-policy
    #: signal — both are integrity events worth surfacing rather than smoothing
    #: over, and both are rare enough not to be the interruption this addresses.
    #: Failures that must still stop the workflow.
    #:
    #: Deliberately tiny. Everything else that can go wrong once a source has
    #: been accepted is recoverable, because the source itself is intact and the
    #: assistant can ask for whatever the machine failed to read. These two are
    #: the exceptions: the draft is not ours to write, or the database refused
    #: the write — in both cases there is nothing to degrade *to*.
    _UNRECOVERABLE_CODES = {
        # A newer attempt already owns this draft; degrading would overwrite it.
        "JOB_IMPORT_STALE_PROCESSING_RESULT",
        "JOB_IMPORT_INVALID_TRANSITION",
        # The recruiter deleted the source while the call was in flight. There
        # is nothing left to build a draft from, and writing one anyway would
        # defeat the redaction they just asked for.
        "JOB_IMPORT_SOURCE_REDACTED",
        "JOB_IMPORT_SOURCE_NOT_FOUND",
        "JOB_IMPORT_DRAFT_NOT_FOUND",
        # The draft no longer accepts machine output — it was discarded, or a
        # result already landed. Either way there is nothing to recover into.
        "JOB_IMPORT_MACHINE_OUTPUT_IMMUTABLE",
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
        except asyncio.CancelledError:
            # The request went away mid-extraction — the client abandoned it, or
            # the server is shutting down. `CancelledError` is a BaseException,
            # so neither clause below sees it, and before this the draft simply
            # stayed `processing` with nobody left to finish it. That is the
            # state a recruiter watched for two minutes: not slow, abandoned.
            #
            # The status is written before the cancellation is re-raised, so the
            # draft describes what actually happened to it. Re-raising keeps the
            # cancellation itself intact; swallowing it would tell the server a
            # cancelled task completed normally.
            await self._mark_failed_if_current(
                draft_id,
                owner_user_id=owner_user_id,
                processing_attempt_id=processing_attempt_id,
                error_code="JOB_IMPORT_PROCESSING_ABANDONED",
                message="Draft preparation stopped before it finished.",
                provider_audit=None,
            )
            raise
        except JobImportProviderError as error:
            return await self._fail_or_fall_back(
                draft_id,
                owner_user_id=owner_user_id,
                processing_attempt_id=processing_attempt_id,
                error_code=error.code,
                message=error.message,
                metadata=error.metadata,
                status_code=error.status_code,
            )
        except Exception as error:
            return await self._fail_or_fall_back(
                draft_id,
                owner_user_id=owner_user_id,
                processing_attempt_id=processing_attempt_id,
                error_code="JOB_IMPORT_PROVIDER_FAILED",
                message="The text extraction provider failed unexpectedly.",
                metadata=None,
                status_code=502,
                cause=error,
            )

        try:
            completed = await self.import_service.record_extraction_result(
                draft_id,
                provider_result.extraction,
                owner_user_id=owner_user_id,
                provider_metadata=provider_result.metadata,
                expected_processing_attempt_id=processing_attempt_id,
            )
        except JobImportError as error:
            if error.code in self._UNRECOVERABLE_CODES:
                # A newer attempt already owns this draft. Degrading here would
                # overwrite its result with an empty one.
                raise
            # The provider returned something this server will not accept — an
            # unsupported field, an unverifiable citation. The reply is not
            # trustworthy, so none of it is written and the import stops rather
            # than pretending a zero-field extraction succeeded.
            return await self._fail_or_fall_back(
                draft_id,
                owner_user_id=owner_user_id,
                processing_attempt_id=processing_attempt_id,
                error_code=error.code,
                message=error.message,
                metadata=self._result_validation_audit(provider_result.metadata, error),
                status_code=error.status_code,
            )
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

    async def _fail_or_fall_back(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
        processing_attempt_id: UUID,
        error_code: str,
        message: str,
        metadata: JobImportProviderMetadata | None,
        status_code: int = 502,
        cause: BaseException | None = None,
    ) -> JobImportProcessResult:
        """Stop honestly, unless the page itself already told us the answers.

        The invariant this exists to hold:

            provider failure  !=  a valid extraction containing zero fields

        An earlier version of this code turned every provider failure into an
        empty-but-"successful" draft. That looked resilient and was the opposite:
        the recruiter was handed a draft with nothing in it and an assistant that
        asked about everything the page already said, while the system reported
        success. A timeout became the recruiter's data-entry job.

        So a failed provider stage now fails. The source is preserved, any answers
        already given are preserved, and the recruiter is offered a bounded retry,
        the paste-text route, or manual continuation.

        The single exception is a fallback with *real verified data*: a page that
        published schema.org ``JobPosting`` details we parsed deterministically,
        with no model involved. That is not a guess and not an empty result, so
        the import may continue on it — flagged as partial, never as complete.
        """

        logger.warning(
            "job_import_provider_failed",
            extra={"failure_code": error_code, "draft_id": str(draft_id)},
        )

        verified = await self._verified_structured_fallback(
            draft_id, owner_user_id=owner_user_id
        )
        if verified:
            logger.info(
                "job_import_structured_fallback_used",
                extra={"failure_code": error_code, "field_count": len(verified)},
            )
            try:
                return await self._record_structured_fallback(
                    draft_id,
                    owner_user_id=owner_user_id,
                    processing_attempt_id=processing_attempt_id,
                    error_code=error_code,
                    metadata=metadata,
                )
            except JobImportError as fallback_error:
                if fallback_error.code in self._UNRECOVERABLE_CODES:
                    raise
                # Fall through to the honest failure below.

        await self._mark_failed_if_current(
            draft_id,
            owner_user_id=owner_user_id,
            processing_attempt_id=processing_attempt_id,
            error_code=error_code,
            message=message,
            provider_audit=metadata,
        )
        error = JobImportError(
            error_code,
            message,
            status_code=status_code,
            details=self._safe_failure_details(metadata),
        )
        raise error from cause if cause is not None else error

    async def _verified_structured_fallback(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> dict[str, object]:
        """Fields the page published in machine-readable form, if any."""

        try:
            draft = await self.import_service.get_draft(
                draft_id, owner_user_id=owner_user_id
            )
            source = await self.import_service.get_source(
                draft.source_id, owner_user_id=owner_user_id
            )
        except JobImportError:
            return {}
        metadata = source.retrieval_metadata
        context = metadata.get("structured_context") if isinstance(metadata, dict) else None
        if not isinstance(context, dict) or not context:
            return {}
        try:
            return fields_from_structured_context(context)
        except Exception:  # pragma: no cover - a bonus path must never throw
            return {}

    async def _record_structured_fallback(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
        processing_attempt_id: UUID,
        error_code: str,
        metadata: JobImportProviderMetadata | None,
    ) -> JobImportProcessResult:
        """Continue on the page's own machine-readable job data.

        Deliberately *not* an empty extraction. This path runs only when the page
        published schema.org ``JobPosting`` details that were parsed
        deterministically, so the draft that results contains real, verified,
        page-sourced values — the enrichment merge in ``record_extraction_result``
        fills them in from the same structured context.

        The result is recorded as partial, and the private audit keeps the reason
        the model stage failed, so this can never be mistaken for a full run.
        """

        partial = JobImportExtractionResponse.model_validate(
            {
                "extraction_schema_version": CURRENT_EXTRACTION_SCHEMA_VERSION,
                "target_listing_schema_version": CURRENT_LISTING_SCHEMA_VERSION,
                "fields": [],
                "conflicts": [],
                "missing_fields": [],
                "warnings": [
                    {
                        "code": "structured_data_fallback",
                        "message": (
                            "Automatic reading did not finish; the draft was "
                            "prepared from the details the page published itself."
                        ),
                    }
                ],
            }
        )
        provider_metadata = metadata or JobImportProviderMetadata()
        completed = await self.import_service.record_extraction_result(
            draft_id,
            partial,
            owner_user_id=owner_user_id,
            provider_metadata=provider_metadata.model_copy(
                update={
                    "metadata": {
                        **provider_metadata.metadata,
                        "processing_outcome": "structured_data_fallback",
                        "extraction_completeness": "partial",
                        "fallback_source": "schema_org_job_posting",
                        "failed_stage_code": error_code,
                    }
                }
            ),
            expected_processing_attempt_id=processing_attempt_id,
        )
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
