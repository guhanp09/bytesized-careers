from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.core.config import settings
from app.core.job_import_availability import refuse_if_disabled
from app.core.job_import_execution import attempts_remain
from app.core.operational_metrics import MetricOutcome, record_ai_provider_call
from app.models import JobImportDraft
from app.repositories.job_import_execution_repository import (
    claim_draft_for_processing,
    schedule_retry_after_failure,
    settle_finished_attempt,
)
from app.repositories.job_import_quota_repository import (
    consume_import_quota,
    release_import_quota,
)
from app.schemas.job_import import JobImportProviderMetadata
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
    #: State and ownership failures that cannot be rewritten as a provider-stage
    #: failure because another attempt, terminal state, or redaction already owns
    #: the draft lifecycle.
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
            # Already prepared. Returned even while the kill switch is off,
            # because reading a finished draft starts no provider work and
            # taking it away helps nobody.
            return current

        refuse_if_disabled(operation="job_import.process")

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

        # Charged before ownership, so a request that is about to be refused for
        # quota never takes a lease it would have to hand back. Refunded below
        # if no provider call ends up happening — the unit stands for a call,
        # not for an attempt to ask.
        quota_now = datetime.now(UTC)
        quota = await consume_import_quota(
            self.import_service.repository.session,
            owner_user_id,
            limit=settings.job_import_daily_quota,
            window=timedelta(hours=settings.job_import_quota_window_hours),
            now=quota_now,
        )
        if not quota.allowed:
            raise JobImportError(
                "JOB_IMPORT_QUOTA_EXCEEDED",
                "You have prepared as many drafts as this account can today.",
                status_code=429,
            )

        processing_attempt_id = uuid4()
        worker_id = f"request-{processing_attempt_id.hex[:12]}"
        # Durable ownership, taken before the status transition below. The
        # existing mutation token serializes writers inside one transaction; it
        # says nothing once the transaction ends, so a process that dies here
        # used to leave a draft marked `processing` that nothing would ever look
        # at again. The lease is what a later sweep can see has lapsed.
        leased = await claim_draft_for_processing(
            self.import_service.repository.session,
            draft_id,
            worker_id=worker_id,
            now=datetime.now(UTC),
        )
        if leased is None:
            # No provider call will happen, so the unit goes back.
            await release_import_quota(
                self.import_service.repository.session, owner_user_id, now=quota_now
            )
            # Whatever the reason, this request must not call the provider.
            raced = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
            # The established contract answers the common cases: a draft already
            # `processing` returns `already_processing`, a finished one returns
            # `already_processed`. Both are 200, and this must not quietly become
            # a 409 for callers that already handle them.
            raced_outcome = self._current_outcome(raced)
            if raced_outcome is not None:
                return raced_outcome

            if not attempts_remain(raced.processing_attempts or 0):
                # Said plainly rather than dressed up as "try again": five
                # attempts have been spent, and the sixth would fail the same
                # way while costing another provider call.
                raise JobImportError(
                    "JOB_IMPORT_ATTEMPTS_EXHAUSTED",
                    "This import could not be prepared after several attempts.",
                    status_code=409,
                )

            # The remaining case is the narrow window where ownership has been
            # taken but the status transition has not landed yet.
            raise JobImportError(
                "JOB_IMPORT_ALREADY_PROCESSING",
                "This draft is already being prepared.",
                status_code=409,
            )

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

        provider_started = time.perf_counter()
        try:
            provider_result = await self.provider.extract(request)
        except asyncio.CancelledError:
            record_ai_provider_call(
                outcome=MetricOutcome.CANCELLED,
                elapsed_seconds=time.perf_counter() - provider_started,
            )
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
            record_ai_provider_call(
                outcome=MetricOutcome.FAILED,
                elapsed_seconds=time.perf_counter() - provider_started,
            )
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
            record_ai_provider_call(
                outcome=MetricOutcome.FAILED,
                elapsed_seconds=time.perf_counter() - provider_started,
            )
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
        else:
            record_ai_provider_call(
                outcome=MetricOutcome.SUCCESS,
                elapsed_seconds=time.perf_counter() - provider_started,
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

        # The attempt produced a draft, so the lease has nothing left to protect.
        # Released without a retry time: this import is done, and a row that
        # still looks due would be picked up and spent again.
        await self._release_lease(draft_id, retry=False)
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
        """Stop honestly when the provider did not finish reading the source.

        The invariant this exists to hold:

            provider failure  !=  a valid extraction containing zero fields

        An earlier version of this code turned every provider failure into an
        empty-but-"successful" draft. That looked resilient and was the opposite:
        the recruiter was handed a draft with nothing in it and an assistant that
        asked about everything the page already said, while the system reported
        success. A timeout became the recruiter's data-entry job.

        A structured page fragment can safely enrich a completed extraction, but
        it cannot establish what the provider failed to read from prose. Turning
        that fragment into a completed processing result would make every
        uncovered fact the recruiter's problem. Preserve the source and surface
        the existing retry, paste-text, and manual-continuation recovery instead.
        """

        logger.warning(
            "job_import_provider_failed",
            extra={"failure_code": error_code, "draft_id": str(draft_id)},
        )

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

    async def _release_lease(self, draft_id: UUID, *, retry: bool) -> None:
        """Hand the row back once this attempt has an outcome.

        Always attempted, including on the failure paths: a lease left behind
        makes the draft look busy to every later sweep, which is the same
        "nobody will ever look at this again" state the lease exists to end.

        Not scoped to this worker's id on purpose. If the lease already lapsed
        and someone else took over, `processing_worker_id` no longer matches and
        the update simply affects nothing — which is the intended outcome, and
        cheaper to reason about than a second read to find out.
        """

        session = self.import_service.repository.session
        try:
            if retry:
                await schedule_retry_after_failure(
                    session, draft_id, now=datetime.now(UTC)
                )
            else:
                await settle_finished_attempt(session, draft_id)
            await session.commit()
        except Exception:  # noqa: BLE001 - releasing must not mask the outcome
            await session.rollback()
            logger.warning("job_import_lease_release_failed", extra={"draft_id": str(draft_id)})

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
            # Scheduled rather than immediate: a provider that just failed is
            # the worst possible thing to call again straight away.
            await self._release_lease(draft_id, retry=True)
        except JobImportError as error:
            if error.code not in {
                "JOB_IMPORT_DRAFT_NOT_FOUND",
                "JOB_IMPORT_INVALID_TRANSITION",
                "JOB_IMPORT_STALE_PROCESSING_RESULT",
            }:
                raise
