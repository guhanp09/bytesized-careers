from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError

from app.core.job_domain_taxonomy import (
    CREATIVE_AUTONOMY_LEVELS,
    CREATOR_CONTENT_NICHES,
    CREATOR_EXPERIENCE_BANDS,
    CREATOR_JOB_FORMATS,
    CREATOR_JOB_PLATFORMS,
    DELIVERABLE_FREQUENCIES,
    DELIVERABLE_TYPES,
    DURATION_TYPES,
    DURATION_UNITS,
    EMPLOYER_CONTEXT_TYPES,
    HIRING_PROCESS_STAGES,
    REVISION_POLICIES,
    SKILL_KEYS,
    SOURCE_INPUT_TYPES,
    START_TIMINGS,
    TRIAL_ATTRIBUTION_TERMS,
    TRIAL_COMPENSATION_BASES,
    TRIAL_EFFORT_UNITS,
    TRIAL_PORTFOLIO_PERMISSIONS,
    TRIAL_STATUSES,
    TRIAL_WORK_USAGE,
)
from app.core.job_import_body_sections import experience_from_body
from app.core.job_import_inference import (
    confidence_at_least,
    infer_compensation_currency,
    provider_confidence_label,
)
from app.core.job_import_native_values import coerce_to_native
from app.core.job_import_policy import (
    AUTO_TRACKED_MISSING_FIELDS,
    JOB_IMPORT_FIELD_POLICIES,
    LEGACY_COMPATIBILITY_IMPORT_FIELDS,
    SYSTEM_OWNED_IMPORT_FIELDS,
    JobImportFieldPolicy,
    import_field_policy,
    is_early_recruiter_question,
)
from app.core.job_import_structured_fields import fields_from_structured_context
from app.core.job_import_title_signals import title_signals
from app.core.job_taxonomy import (
    COMPENSATION_MODES,
    COMPENSATION_UNITS,
    CURRENT_LISTING_SCHEMA_VERSION,
    ENGAGEMENT_TYPES,
    TURNAROUND_BASES,
    TURNAROUND_UNITS,
    WORK_MODES,
)
from app.core.tool_catalog import TOOL_CATALOG, find_tool_by_key
from app.models import Job, JobImportDraft, JobImportField, JobImportSource
from app.repositories.job_import_repository import JobImportRepository
from app.schemas.job import JobCreate, JobUpdate
from app.schemas.job_import import (
    CURRENT_EXTRACTION_SCHEMA_VERSION,
    JobImportApplyRequest,
    JobImportConflictResolutionRequest,
    JobImportDraftInitialize,
    JobImportDraftRead,
    JobImportEvidence,
    JobImportExtractionField,
    JobImportExtractionRequest,
    JobImportExtractionResponse,
    JobImportFieldDefinition,
    JobImportFieldRead,
    JobImportFieldReviewRequest,
    JobImportProcessingWarning,
    JobImportProviderConfidence,
    JobImportProviderMetadata,
    JobImportSourceCreate,
    JobImportSourceRead,
    JobImportSourceRepresentation,
)
from app.services.job_service import (
    JobAuthRequiredError,
    JobForbiddenError,
    JobNotFoundError,
    JobService,
    JobValidationError,
    JobVerificationRequiredError,
)

_NESTED_FIELD_KEYS: dict[str, frozenset[str]] = {
    "deliverables": frozenset(
        {"type", "custom_type", "quantity", "frequency", "custom_frequency", "notes"}
    ),
    "source_inputs": frozenset({"type", "custom_label", "sensitive_access_confirmed"}),
    "hiring_process": frozenset({"stage", "custom_label", "notes"}),
    "screening_questions": frozenset({"prompt", "required", "response_guidance"}),
    "reference_videos": frozenset(
        {
            "id",
            "title",
            "url",
            "thumbnail_url",
            "platform",
            "description",
            "what_to_reference",
            "timestamp_notes",
        }
    ),
}
_REFERENCE_TIMESTAMP_KEYS = frozenset({"id", "time", "seconds", "title", "description"})
_CUSTOM_LABEL_LIST_FIELDS = frozenset(
    {
        "other_required_tools",
        "other_required_skills",
        "other_preferred_skills",
    }
)
_CREATOR_CONTEXT_FIELDS = frozenset({"content_niches", "content_genres", "formats_hired_for"})
_STRUCTURED_EMPLOYMENT_ALIASES = {
    "full_time": ("full time", "fulltime"),
    "part_time": ("part time", "parttime"),
    "internship": ("intern", "internship"),
}


def _structured_engagement_matches(value: object) -> set[str]:
    raw_values = value if isinstance(value, list) else [value]
    normalized = " ".join(item for item in raw_values if isinstance(item, str))
    padded = f" {re.sub(r'[^a-z]+', ' ', normalized.casefold()).strip()} "
    return {
        engagement
        for engagement, aliases in _STRUCTURED_EMPLOYMENT_ALIASES.items()
        if any(f" {alias} " in padded for alias in aliases)
    }


def _structured_engagement_type(value: object) -> str | None:
    matches = _structured_engagement_matches(value)
    return next(iter(matches)) if len(matches) == 1 else None


def _valid_import_string_list(value: object) -> bool:
    return bool(
        isinstance(value, list)
        and value
        and all(isinstance(item, str) and item.strip() for item in value)
    )


class JobImportError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 422,
        details: object | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details

    def as_detail(self) -> dict[str, object]:
        detail: dict[str, object] = {"code": self.code, "message": self.message}
        if self.details is not None:
            detail["details"] = self.details
        return detail


class JobImportService:
    def __init__(
        self,
        repository: JobImportRepository,
        job_service: JobService,
    ) -> None:
        self.repository = repository
        self.job_service = job_service

    @staticmethod
    def _source_fingerprint(payload: JobImportSourceCreate) -> str:
        canonical = payload.model_dump(
            mode="json",
            exclude={"idempotency_key"},
        )
        encoded = json.dumps(
            canonical,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    async def create_source(
        self,
        payload: JobImportSourceCreate,
        *,
        owner_user_id: UUID,
    ) -> JobImportSource:
        fingerprint = self._source_fingerprint(payload)
        if payload.idempotency_key:
            existing = await self.repository.get_source_by_request_id(
                owner_user_id,
                payload.idempotency_key,
            )
            if existing is not None:
                if existing.content_fingerprint != fingerprint:
                    raise JobImportError(
                        "JOB_IMPORT_IDEMPOTENCY_CONFLICT",
                        "This idempotency key was already used for different source content.",
                        status_code=409,
                    )
                return existing

        data = payload.model_dump(
            mode="json",
            exclude={"idempotency_key"},
        )
        data.update(
            {
                "owner_user_id": owner_user_id,
                "content_fingerprint": fingerprint,
                "client_request_id": payload.idempotency_key,
            }
        )
        try:
            source = await self.repository.create_source(data)
        except IntegrityError as exc:
            await self.repository.session.rollback()
            if payload.idempotency_key:
                existing = await self.repository.get_source_by_request_id(
                    owner_user_id,
                    payload.idempotency_key,
                )
                if existing is not None:
                    if existing.content_fingerprint != fingerprint:
                        raise JobImportError(
                            "JOB_IMPORT_IDEMPOTENCY_CONFLICT",
                            "This idempotency key was already used for different source content.",
                            status_code=409,
                        ) from exc
                    return existing
            raise JobImportError(
                "JOB_IMPORT_SOURCE_CREATE_CONFLICT",
                "The import source could not be created because its request conflicts with an existing record.",
                status_code=409,
            ) from exc
        await self.repository.session.commit()
        return source

    async def get_source(
        self,
        source_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> JobImportSource:
        source = await self.repository.get_source_for_owner(source_id, owner_user_id)
        if source is None:
            raise JobImportError(
                "JOB_IMPORT_SOURCE_NOT_FOUND",
                "Import source not found.",
                status_code=404,
            )
        return source

    async def redact_source(
        self,
        source_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> None:
        source = await self.repository.claim_source_mutation(
            source_id,
            owner_user_id,
        )
        if source is None:
            existing = await self.repository.get_source_for_owner(
                source_id,
                owner_user_id,
                include_deleted=True,
            )
            if existing is not None and existing.deleted_at is not None:
                return
            raise JobImportError(
                "JOB_IMPORT_SOURCE_NOT_FOUND",
                "Import source not found.",
                status_code=404,
            )
        try:
            now = datetime.now(UTC)
            drafts = await self.repository.list_drafts_for_source(
                source.id,
                owner_user_id,
            )
            for listed_draft in drafts:
                claim_token = uuid4()
                draft = await self.repository.claim_draft_mutation(
                    listed_draft.id,
                    owner_user_id,
                    claim_token,
                )
                if draft is None:
                    raise JobImportError(
                        "JOB_IMPORT_CONCURRENT_MUTATION",
                        "An import draft changed while its source was being redacted. Retry the deletion.",
                        status_code=409,
                    )
                fields = await self.repository.list_fields(draft.id)
                for field in fields:
                    redacted_conflicts = [
                        {
                            "value": item.get("value"),
                            "evidence": [],
                        }
                        for item in field.conflicting_values
                        if isinstance(item, dict)
                    ]
                    await self.repository.update_field(
                        field,
                        {
                            "evidence": [],
                            "conflicting_values": redacted_conflicts,
                            "explanation": None,
                            "provider_confidence": None,
                            "validation_errors": [],
                        },
                    )
                redacted_missing_fields = [
                    {
                        "field_path": item.get("field_path"),
                        "requirement": item.get("requirement"),
                    }
                    for item in draft.missing_fields
                    if isinstance(item, dict)
                ]
                await self.repository.update_draft(
                    draft,
                    {
                        "processing_status": (
                            draft.processing_status
                            if draft.processing_status
                            in {
                                "applied_to_native_draft",
                                "discarded",
                                "superseded",
                            }
                            else "discarded"
                        ),
                        "machine_output": None,
                        "provider_metadata": None,
                        "processing_warnings": [],
                        "missing_fields": redacted_missing_fields,
                        "validation_errors": {},
                        "can_apply_to_native_draft": False,
                        "can_publish_directly": False,
                        "discarded_at": (
                            draft.discarded_at
                            or (
                                now
                                if draft.processing_status
                                not in {
                                    "applied_to_native_draft",
                                    "superseded",
                                }
                                else None
                            )
                        ),
                        "mutation_claim_token": None,
                    },
                )
            await self.repository.update_source(
                source,
                {
                    "source_title": None,
                    "original_text": None,
                    "source_url": None,
                    "final_source_url": None,
                    "retrieved_at": None,
                    "retrieval_metadata": None,
                    "original_filename": None,
                    "content_type": None,
                    "storage_references": [],
                    "content_fingerprint": "0" * 64,
                    "client_request_id": None,
                    "processing_state": "deleted",
                    "content_redacted_at": now,
                    "deleted_at": now,
                },
            )
            await self.repository.session.commit()
        except Exception:
            await self.repository.session.rollback()
            raise

    async def initialize_draft(
        self,
        source_id: UUID,
        payload: JobImportDraftInitialize,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        if payload.extraction_schema_version != CURRENT_EXTRACTION_SCHEMA_VERSION:
            raise JobImportError(
                "JOB_IMPORT_EXTRACTION_SCHEMA_UNSUPPORTED",
                "Unsupported extraction schema version.",
                details={"supported": CURRENT_EXTRACTION_SCHEMA_VERSION},
            )
        if payload.target_listing_schema_version != CURRENT_LISTING_SCHEMA_VERSION:
            raise JobImportError(
                "JOB_IMPORT_TARGET_SCHEMA_UNSUPPORTED",
                "New import drafts must target the current listing schema.",
                details={"supported": CURRENT_LISTING_SCHEMA_VERSION},
            )

        source = await self.repository.claim_source_mutation(
            source_id,
            owner_user_id,
        )
        if source is None:
            await self.repository.session.rollback()
            raise JobImportError(
                "JOB_IMPORT_SOURCE_NOT_FOUND",
                "Import source not found.",
                status_code=404,
            )

        if payload.idempotency_key:
            existing = await self.repository.get_draft_by_request_id(
                owner_user_id,
                payload.idempotency_key,
            )
            if existing is not None:
                if (
                    existing.source_id != source.id
                    or existing.extraction_schema_version != payload.extraction_schema_version
                    or existing.target_listing_schema_version
                    != payload.target_listing_schema_version
                    or existing.supersedes_draft_id != payload.supersedes_draft_id
                ):
                    await self.repository.session.rollback()
                    raise JobImportError(
                        "JOB_IMPORT_IDEMPOTENCY_CONFLICT",
                        "This idempotency key was already used for a different import draft.",
                        status_code=409,
                    )
                await self.repository.session.commit()
                return existing

        superseded: JobImportDraft | None = None
        if payload.supersedes_draft_id is not None:
            superseded = await self.repository.claim_draft_mutation(
                payload.supersedes_draft_id,
                owner_user_id,
                uuid4(),
            )
            if superseded is None or superseded.source_id != source.id:
                await self.repository.session.rollback()
                raise JobImportError(
                    "JOB_IMPORT_SUPERSEDED_DRAFT_NOT_FOUND",
                    "The draft to supersede was not found for this source.",
                    status_code=404,
                )

        draft_data = {
            "owner_user_id": owner_user_id,
            "source_id": source.id,
            "supersedes_draft_id": payload.supersedes_draft_id,
            "extraction_schema_version": payload.extraction_schema_version,
            "target_listing_schema_version": payload.target_listing_schema_version,
            "client_request_id": payload.idempotency_key,
            "processing_warnings": [],
            "missing_fields": [],
            "validation_errors": {},
            "review_sections": [],
        }
        try:
            draft = await self.repository.create_draft(draft_data)
        except IntegrityError as exc:
            await self.repository.session.rollback()
            if payload.idempotency_key:
                existing = await self.repository.get_draft_by_request_id(
                    owner_user_id,
                    payload.idempotency_key,
                )
                if existing is not None:
                    if (
                        existing.source_id != source_id
                        or existing.extraction_schema_version != payload.extraction_schema_version
                        or existing.target_listing_schema_version
                        != payload.target_listing_schema_version
                        or existing.supersedes_draft_id != payload.supersedes_draft_id
                    ):
                        raise JobImportError(
                            "JOB_IMPORT_IDEMPOTENCY_CONFLICT",
                            "This idempotency key was already used for a different import draft.",
                            status_code=409,
                        ) from exc
                    return existing
            raise JobImportError(
                "JOB_IMPORT_DRAFT_CREATE_CONFLICT",
                "The import draft could not be created because its request conflicts with an existing record.",
                status_code=409,
            ) from exc
        if superseded is not None and superseded.processing_status not in {
            "applied_to_native_draft",
            "discarded",
        }:
            await self.repository.update_draft(
                superseded,
                {
                    "processing_status": "superseded",
                    "can_apply_to_native_draft": False,
                    "can_publish_directly": False,
                    "mutation_claim_token": None,
                },
            )
        elif superseded is not None:
            await self.repository.update_draft(
                superseded,
                {"mutation_claim_token": None},
            )
        await self.repository.session.commit()
        return draft

    async def get_draft(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        draft = await self.repository.get_draft_for_owner(draft_id, owner_user_id)
        if draft is None:
            raise JobImportError(
                "JOB_IMPORT_DRAFT_NOT_FOUND",
                "Import draft not found.",
                status_code=404,
            )
        return draft

    async def get_draft_for_target_job(
        self,
        target_job_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> tuple[JobImportDraft, JobImportSource]:
        draft = await self.repository.get_draft_by_target_job(
            target_job_id,
            owner_user_id,
        )
        if draft is None:
            raise JobImportError(
                "JOB_IMPORT_DRAFT_NOT_FOUND",
                "No import context exists for this job draft.",
                status_code=404,
            )
        source = await self.get_source(draft.source_id, owner_user_id=owner_user_id)
        return draft, source

    async def build_extraction_request(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> JobImportExtractionRequest:
        draft = await self.get_draft(draft_id, owner_user_id=owner_user_id)
        source = await self.get_source(draft.source_id, owner_user_id=owner_user_id)
        roles = await self.repository.list_active_roles()
        allowed_taxonomies = {
            "roles": [role.slug for role in roles],
            "platforms": list(CREATOR_JOB_PLATFORMS),
            "formats": list(CREATOR_JOB_FORMATS),
            "content_niches": list(CREATOR_CONTENT_NICHES),
            "experience_levels": list(CREATOR_EXPERIENCE_BANDS),
            "compensation_modes": list(COMPENSATION_MODES),
            "compensation_units": list(COMPENSATION_UNITS),
            "engagement_types": list(ENGAGEMENT_TYPES),
            "work_modes": list(WORK_MODES),
            "turnaround_units": list(TURNAROUND_UNITS),
            "turnaround_bases": list(TURNAROUND_BASES),
            "deliverable_types": list(DELIVERABLE_TYPES),
            "deliverable_frequencies": list(DELIVERABLE_FREQUENCIES),
            "skill_keys": list(SKILL_KEYS),
            "tool_keys": [tool.key for tool in TOOL_CATALOG],
            "revision_policies": list(REVISION_POLICIES),
            "source_input_types": list(SOURCE_INPUT_TYPES),
            "creative_autonomy": list(CREATIVE_AUTONOMY_LEVELS),
            "trial_statuses": list(TRIAL_STATUSES),
            "trial_effort_units": list(TRIAL_EFFORT_UNITS),
            "trial_compensation_bases": list(TRIAL_COMPENSATION_BASES),
            "trial_work_usage": list(TRIAL_WORK_USAGE),
            "trial_portfolio_permissions": list(TRIAL_PORTFOLIO_PERMISSIONS),
            "trial_attribution": list(TRIAL_ATTRIBUTION_TERMS),
            "start_timings": list(START_TIMINGS),
            "duration_types": list(DURATION_TYPES),
            "duration_units": list(DURATION_UNITS),
            "hiring_process_stages": list(HIRING_PROCESS_STAGES),
            "employer_context_types": list(EMPLOYER_CONTEXT_TYPES),
        }
        definitions: list[JobImportFieldDefinition] = []
        for policy in JOB_IMPORT_FIELD_POLICIES.values():
            if policy.field_path == "primary_role_key":
                value_schema: dict[str, object] = {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                }
            else:
                assert policy.native_field is not None
                value_schema = self._adapter_for_native_field(policy.native_field).json_schema()
            allowed_provenance = [
                "directly_supplied",
                "extracted_from_source",
            ]
            if "semantic_inference" in policy.allowed_origins:
                allowed_provenance.append("suggested_inference")
            definitions.append(
                JobImportFieldDefinition(
                    field_path=policy.field_path,
                    native_field=policy.native_field,
                    value_schema=value_schema,
                    confirmation_policy=policy.confirmation_policy,
                    nested_confirmation_policies=dict(policy.nested_confirmation_policies),
                    allowed_provenance=allowed_provenance,
                    evidence_required_for_extraction=True,
                    requires_recruiter_review=(
                        policy.auto_fill_confidence is None
                        or bool(policy.nested_confirmation_policies)
                    ),
                    missing_requirement=policy.missing_requirement,
                    review_section=policy.review_section,
                    custom_values_allowed=policy.custom_values_allowed,
                    inference_risk=policy.inference_risk,
                    allowed_decision_origins=sorted(policy.allowed_origins),
                    auto_fill_confidence=policy.auto_fill_confidence,
                    suggestion_confidence=policy.suggestion_confidence,
                )
            )
        return JobImportExtractionRequest(
            extraction_schema_version=draft.extraction_schema_version,
            target_listing_schema_version=draft.target_listing_schema_version,
            source=JobImportSourceRepresentation(
                # Public URL records retain their retrieval origin in storage,
                # while providers receive only the bounded normalized text.
                source_type=(
                    "external_listing_text"
                    if source.source_type == "public_url"
                    else source.source_type
                ),
                original_text=source.original_text,
                source_url=source.source_url,
                original_filename=source.original_filename,
                content_type=source.content_type,
                storage_references=source.storage_references,
            ),
            allowed_taxonomies=allowed_taxonomies,
            field_definitions=definitions,
            inference_restrictions=[
                "Never emit CreatorJobs-owned identity, verification, status, ownership, counters, or trust fields.",
                "Use suggested inference only where that field's allowed_decision_origins includes semantic_inference.",
                "High-risk and explicit-only fields must never be guessed, defaulted, or derived from market norms.",
                "Use stable taxonomy keys; do not generate database identifiers.",
                "Represent contradictory source statements as conflicts instead of selecting one.",
                "Represent absent publication-relevant information as missing instead of inventing it.",
                "Cadence and turnaround are different; never derive one from the other.",
                "Do not add role-default tools unless the source explicitly requires them.",
                "Screening questions must preserve source wording and cannot invent requiredness or rejection logic.",
            ],
            output_validation_instructions=[
                "Return only the CreatorJobs extraction response contract.",
                "Cite only server-supplied evidence span IDs; never return quotations or offsets.",
                "Do not invent, approximate, or rewrite evidence span IDs.",
                "Treat any confidence value as provider-reported metadata only.",
            ],
        )

    async def begin_processing(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
        processing_attempt_id: UUID | None = None,
    ) -> JobImportDraft:
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            uuid4(),
            allowed_statuses={"awaiting_processing", "processing_failed"},
        )
        if draft is None:
            existing = await self.repository.get_draft_for_owner(
                draft_id,
                owner_user_id,
            )
            if existing is None:
                raise JobImportError(
                    "JOB_IMPORT_DRAFT_NOT_FOUND",
                    "Import draft not found.",
                    status_code=404,
                )
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "This import draft cannot begin processing from its current state.",
                status_code=409,
            )
        try:
            source = await self.get_source(
                draft.source_id,
                owner_user_id=owner_user_id,
            )
            now = datetime.now(UTC)
            existing_metadata = (
                draft.provider_metadata if isinstance(draft.provider_metadata, dict) else {}
            )
            previous_attempts = existing_metadata.get("processing_attempt_count", 0)
            attempt_count = (
                previous_attempts
                if isinstance(previous_attempts, int) and previous_attempts >= 0
                else 0
            ) + 1
            processing_metadata = (
                {
                    "processing_attempt_id": str(processing_attempt_id),
                    "processing_attempt_count": attempt_count,
                    "processing_started_at": now.isoformat(),
                    "processing_outcome": "processing",
                }
                if processing_attempt_id is not None
                else draft.provider_metadata
            )
            await self.repository.update_draft(
                draft,
                {
                    "processing_status": "processing",
                    "validation_status": "not_validated",
                    "provider_metadata": processing_metadata,
                    "mutation_claim_token": None,
                },
            )
            await self.repository.update_source(
                source,
                {"processing_state": "processing"},
            )
            await self.repository.session.commit()
            return draft
        except Exception:
            await self.repository.session.rollback()
            raise

    async def mark_processing_failed(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
        error_code: str,
        message: str,
        expected_processing_attempt_id: UUID | None = None,
        provider_audit: JobImportProviderMetadata | None = None,
    ) -> JobImportDraft:
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            uuid4(),
            allowed_statuses={"awaiting_processing", "processing"},
        )
        if draft is None:
            existing = await self.repository.get_draft_for_owner(
                draft_id,
                owner_user_id,
            )
            if existing is None:
                raise JobImportError(
                    "JOB_IMPORT_DRAFT_NOT_FOUND",
                    "Import draft not found.",
                    status_code=404,
                )
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "This import draft cannot be marked failed from its current state.",
                status_code=409,
            )
        try:
            self._assert_processing_attempt(
                draft,
                expected_processing_attempt_id,
            )
            source = await self.get_source(
                draft.source_id,
                owner_user_id=owner_user_id,
            )
            safe_message = " ".join(message.split())[:500]
            current_metadata = (
                draft.provider_metadata if isinstance(draft.provider_metadata, dict) else {}
            )
            failed_metadata = {
                **current_metadata,
                **(provider_audit.metadata if provider_audit else {}),
                "processing_completed_at": datetime.now(UTC).isoformat(),
                "processing_outcome": "failed",
                "failure_code": error_code[:80],
            }
            await self.repository.update_draft(
                draft,
                {
                    "processing_status": "processing_failed",
                    "validation_status": "invalid",
                    "validation_errors": {
                        "processing": {
                            "code": error_code[:80],
                            "message": safe_message,
                        }
                    },
                    "provider_name": (
                        provider_audit.provider_name if provider_audit else draft.provider_name
                    ),
                    "model_name": (
                        provider_audit.model_name if provider_audit else draft.model_name
                    ),
                    "model_version": (
                        provider_audit.model_version if provider_audit else draft.model_version
                    ),
                    "instruction_version": (
                        provider_audit.instruction_version
                        if provider_audit
                        else draft.instruction_version
                    ),
                    "provider_metadata": failed_metadata,
                    "mutation_claim_token": None,
                },
            )
            await self.repository.update_source(
                source,
                {"processing_state": "failed"},
            )
            await self.repository.session.commit()
            return draft
        except Exception:
            await self.repository.session.rollback()
            raise

    @staticmethod
    def _assert_processing_attempt(
        draft: JobImportDraft,
        expected_processing_attempt_id: UUID | None,
    ) -> None:
        if expected_processing_attempt_id is None:
            return
        metadata = draft.provider_metadata if isinstance(draft.provider_metadata, dict) else {}
        if metadata.get("processing_attempt_id") != str(expected_processing_attempt_id):
            raise JobImportError(
                "JOB_IMPORT_STALE_PROCESSING_RESULT",
                "This processing result belongs to an outdated import attempt.",
                status_code=409,
            )

    @staticmethod
    def _adapter_for_native_field(field_name: str) -> TypeAdapter[Any]:
        field_info = JobUpdate.model_fields[field_name]
        annotation: object = field_info.annotation
        if field_info.metadata:
            annotation = Annotated[field_info.annotation, *field_info.metadata]
        return TypeAdapter(annotation)

    async def _validate_field_value(
        self,
        policy: JobImportFieldPolicy,
        value: object,
    ) -> tuple[object, list[str]]:
        if policy.field_path == "primary_role_key":
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > 160:
                return value, ["Select a valid creator role key."]
            role = await self.repository.get_active_role_by_key(value)
            if role is None:
                return value, ["The proposed creator role key is unknown or inactive."]
            return role.slug, []

        if policy.field_path == "screening_questions" and isinstance(value, list):
            value = [
                ({**item, "required": False} if "required" not in item else dict(item))
                if isinstance(item, dict)
                else item
                for item in value
            ]

        nested_errors = self._nested_shape_errors(policy.field_path, value)
        if nested_errors:
            return value, nested_errors
        if policy.field_path in _CUSTOM_LABEL_LIST_FIELDS and isinstance(value, list):
            oversized = [
                index
                for index, item in enumerate(value)
                if isinstance(item, str) and len(" ".join(item.split())) > 120
            ]
            if oversized:
                return value, [
                    f"Custom label at index {index} must be 120 characters or fewer."
                    for index in oversized
                ]
        if policy.field_path in _CREATOR_CONTEXT_FIELDS and isinstance(value, list):
            oversized = [
                index
                for index, item in enumerate(value)
                if isinstance(item, str) and len(" ".join(item.split())) > 40
            ]
            if oversized:
                return value, [
                    f"Creator-context label at index {index} must be 40 characters or fewer."
                    for index in oversized
                ]

        assert policy.native_field is not None
        try:
            validated_update = JobUpdate.model_validate({policy.native_field: value})
            normalized = validated_update.model_dump(
                mode="json",
                exclude_unset=True,
            )[policy.native_field]
        except (ValidationError, ValueError, TypeError) as exc:
            return value, [str(exc)]

        if policy.field_path == "required_tool_keys":
            unknown = [
                str(item)
                for item in normalized or []
                if not isinstance(item, str) or find_tool_by_key(item) is None
            ]
            if unknown:
                return normalized, [f"Unknown tool key: {item}" for item in unknown]
        if policy.field_path == "platforms":
            unknown = [str(item) for item in normalized or [] if item not in CREATOR_JOB_PLATFORMS]
            if unknown:
                return normalized, [f"Unknown platform key: {item}" for item in unknown]
        return normalized, []

    @staticmethod
    def _provider_screening_questions(
        value: object,
        evidence: list[JobImportEvidence],
    ) -> object:
        """Keep imported requiredness only when the owned source says so."""

        if not isinstance(value, list):
            return value
        evidence_text = " ".join(item.snippet for item in evidence).casefold()
        requiredness_is_explicit = bool(
            re.search(
                r"\b(required|mandatory|must\s+(?:answer|complete|provide|respond))\b",
                evidence_text,
            )
        )
        return [
            {
                **item,
                "required": bool(item.get("required")) and requiredness_is_explicit,
            }
            if isinstance(item, dict)
            else item
            for item in value
        ]

    @staticmethod
    def _nested_shape_errors(field_path: str, value: object) -> list[str]:
        allowed_keys = _NESTED_FIELD_KEYS.get(field_path)
        if allowed_keys is None or not isinstance(value, list):
            return []
        errors: list[str] = []
        for index, item in enumerate(value):
            if field_path == "reference_videos" and isinstance(item, str):
                continue
            if not isinstance(item, dict):
                continue
            unexpected = sorted(set(item) - allowed_keys)
            errors.extend(
                f"Unsupported nested key at {field_path}[{index}].{key}." for key in unexpected
            )
            if field_path == "reference_videos":
                timestamp_notes = item.get("timestamp_notes")
                if isinstance(timestamp_notes, list):
                    for note_index, note in enumerate(timestamp_notes):
                        if not isinstance(note, dict):
                            continue
                        nested_unexpected = sorted(set(note) - _REFERENCE_TIMESTAMP_KEYS)
                        errors.extend(
                            "Unsupported nested key at "
                            f"{field_path}[{index}].timestamp_notes"
                            f"[{note_index}].{key}."
                            for key in nested_unexpected
                        )
        return errors

    @staticmethod
    def _structured_source_evidence(
        source: JobImportSource,
        *,
        label: str,
        value: str,
    ) -> list[JobImportEvidence]:
        source_text = source.original_text or ""
        snippet = f"{label}: {value}"
        start = source_text.find(snippet)
        if start < 0:
            return []
        return [
            JobImportEvidence.model_validate(
                {
                    "snippet": snippet,
                    "location": {
                        "char_start": start,
                        "char_end": start + len(snippet),
                    },
                }
            )
        ]

    @classmethod
    def _with_deterministic_context(
        cls,
        response: JobImportExtractionResponse,
        source: JobImportSource,
        *,
        allowed_role_keys: set[str] | frozenset[str] | None = None,
    ) -> JobImportExtractionResponse:
        """Add only server-owned, policy-approved contextual decisions."""

        fields = list(response.fields)
        by_path = {field.field_path: field for field in fields}
        occupied_paths = {
            *by_path,
            *(conflict.field_path for conflict in response.conflicts),
        }
        amount_present = any(
            isinstance(field.value, (int, float, str))
            and not isinstance(field.value, bool)
            and str(field.value).strip() not in {"", "0", "0.0"}
            for path in ("budget_amount", "budget_max")
            if (field := by_path.get(path)) is not None
        )
        explicit_currency_field = by_path.get("budget_currency")
        explicit_currency = (
            str(explicit_currency_field.value) if explicit_currency_field is not None else None
        )
        location_field = by_path.get("location")
        role_location = (
            str(location_field.value)
            if location_field is not None
            and location_field.provenance in {"directly_supplied", "extracted_from_source"}
            else None
        )
        work_mode_field = by_path.get("work_mode")
        work_mode = str(work_mode_field.value) if work_mode_field is not None else None
        retrieval = source.retrieval_metadata if isinstance(source.retrieval_metadata, dict) else {}
        structured = retrieval.get("structured_context")
        context = structured if isinstance(structured, dict) else {}
        missing_fields = list(response.missing_fields)
        warnings = list(response.warnings)

        def append_context_field(field: JobImportExtractionField) -> None:
            nonlocal missing_fields
            if field.field_path in occupied_paths or len(fields) >= 100:
                return
            fields.append(field)
            by_path[field.field_path] = field
            occupied_paths.add(field.field_path)
            missing_fields = [
                item for item in missing_fields if item.field_path != field.field_path
            ]

        def upgrade_exact_context_match(
            field_path: str,
            expected_value: object,
            *,
            evidence: list[JobImportEvidence],
            origin: str,
            rationale_code: str,
            explanation: str,
        ) -> bool:
            existing = by_path.get(field_path)
            if (
                existing is None
                or existing.provenance != "suggested_inference"
                or existing.value != expected_value
                or not evidence
            ):
                return False

            merged_evidence: list[JobImportEvidence] = []
            seen_evidence: set[str] = set()
            for item in [*existing.evidence, *evidence]:
                fingerprint = json.dumps(
                    item.model_dump(mode="json"),
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                if fingerprint in seen_evidence:
                    continue
                seen_evidence.add(fingerprint)
                merged_evidence.append(item)
                if len(merged_evidence) >= 5:
                    break

            previous_confidence = existing.provider_confidence
            metadata = dict(previous_confidence.metadata) if previous_confidence else {}
            if previous_confidence is not None:
                if previous_confidence.score is not None:
                    metadata["provider_reported_score"] = previous_confidence.score
                if previous_confidence.label:
                    metadata["provider_reported_label"] = previous_confidence.label
            metadata.update(
                {
                    "origin": origin,
                    "rationale_code": rationale_code,
                    "server_grounded_match": True,
                }
            )
            upgraded = existing.model_copy(
                update={
                    "evidence": merged_evidence,
                    "explanation": existing.explanation or explanation,
                    "provider_confidence": JobImportProviderConfidence(
                        score=0.99,
                        label="high",
                        metadata=metadata,
                    ),
                }
            )
            field_index = next(
                index for index, item in enumerate(fields) if item is existing
            )
            fields[field_index] = upgraded
            by_path[field_path] = upgraded
            return True

        def replace_invalid_context_field(
            field_path: str,
            value: object,
            *,
            provenance: str,
            evidence: list[JobImportEvidence],
            explanation: str | None = None,
            origin: str | None = None,
            rationale_code: str,
            confidence_score: float = 0.99,
            confidence_label: str = "high",
        ) -> bool:
            existing = by_path.get(field_path)
            if existing is None or not evidence:
                return False
            provider_confidence = (
                JobImportProviderConfidence(
                    score=confidence_score,
                    label=confidence_label,
                    metadata={
                        "origin": origin,
                        "rationale_code": rationale_code,
                        "server_grounded_match": True,
                    },
                )
                if provenance == "suggested_inference" and origin is not None
                else None
            )
            replacement = JobImportExtractionField(
                field_path=field_path,
                value=value,
                provenance=provenance,
                evidence=evidence[:5],
                explanation=explanation,
                provider_confidence=provider_confidence,
            )
            field_index = next(
                index for index, item in enumerate(fields) if item is existing
            )
            fields[field_index] = replacement
            by_path[field_path] = replacement
            if len(warnings) < 30:
                warnings.append(
                    JobImportProcessingWarning(
                        code="structured_context_provider_value_repaired",
                        message=(
                            "A provider value was normalized or replaced with exact "
                            "structured source data."
                        ),
                        field_path=field_path,
                        evidence=evidence[:3],
                    )
                )
            return True

        structured_title = context.get("job_title")
        title_evidence: list[JobImportEvidence] = []
        if isinstance(structured_title, str):
            title_evidence = cls._structured_source_evidence(
                source,
                label="Structured job title",
                value=structured_title,
            )
            existing_title = by_path.get("title")
            if existing_title is not None and (
                not isinstance(existing_title.value, str)
                or len(existing_title.value.strip()) < 3
            ):
                replace_invalid_context_field(
                    "title",
                    structured_title,
                    provenance="extracted_from_source",
                    evidence=title_evidence,
                    rationale_code="structured_title_malformed_provider_value",
                )
            elif "title" not in occupied_paths and title_evidence:
                append_context_field(
                    JobImportExtractionField(
                        field_path="title",
                        value=structured_title,
                        provenance="extracted_from_source",
                        evidence=title_evidence,
                    )
                )

        if isinstance(structured_title, str):
            role_signals = title_signals(structured_title)
            role_key = role_signals.settled.get(
                "primary_role_key",
                role_signals.suggested.get("primary_role_key"),
            )
            role_key_is_allowed = bool(
                isinstance(role_key, str)
                and (allowed_role_keys is None or role_key in allowed_role_keys)
            )
            if role_key_is_allowed and isinstance(role_key, str) and title_evidence:
                role_explanation = (
                    "The structured job title names exactly one CreatorJobs role."
                )
                existing_role = by_path.get("primary_role_key")
                existing_role_token = (
                    re.sub(r"[^a-z0-9]+", "-", existing_role.value.casefold()).strip("-")
                    if existing_role is not None and isinstance(existing_role.value, str)
                    else None
                )
                existing_role_is_unknown = bool(
                    existing_role is not None
                    and isinstance(existing_role.value, str)
                    and allowed_role_keys is not None
                    and existing_role.value not in allowed_role_keys
                )
                repaired_role = bool(
                    existing_role is not None
                    and (
                        not isinstance(existing_role.value, str)
                        or existing_role_is_unknown
                        or (
                            existing_role.value != role_key
                            and existing_role_token == role_key
                        )
                    )
                    and replace_invalid_context_field(
                        "primary_role_key",
                        role_key,
                        provenance="suggested_inference",
                        evidence=title_evidence,
                        explanation=role_explanation,
                        origin="semantic_inference",
                        rationale_code="structured_title_role_normalized",
                    )
                )
                if not repaired_role and not upgrade_exact_context_match(
                    "primary_role_key",
                    role_key,
                    evidence=title_evidence,
                    origin="semantic_inference",
                    rationale_code="structured_title_single_role",
                    explanation=role_explanation,
                ):
                    append_context_field(
                        JobImportExtractionField(
                            field_path="primary_role_key",
                            value=role_key,
                            provenance="suggested_inference",
                            evidence=title_evidence,
                            explanation=role_explanation,
                            provider_confidence=JobImportProviderConfidence(
                                score=0.99,
                                label="high",
                                metadata={
                                    "origin": "semantic_inference",
                                    "rationale_code": "structured_title_single_role",
                                },
                            ),
                        ),
                    )

        structured_employment = context.get("employment_type")
        if isinstance(structured_employment, (str, list)):
            engagement_type = _structured_engagement_type(structured_employment)
            employment_values = (
                [structured_employment]
                if isinstance(structured_employment, str)
                else [item for item in structured_employment if isinstance(item, str)][:5]
            )
            evidence = [
                evidence_item
                for value in employment_values
                for evidence_item in cls._structured_source_evidence(
                    source,
                    label="Structured employment type",
                    value=value,
                )
            ][:5]
            if engagement_type is not None and evidence:
                engagement_explanation = (
                    "The structured employment type maps exactly to this engagement."
                )
                existing_engagement = by_path.get("engagement_type")
                existing_engagement_matches = (
                    _structured_engagement_matches(existing_engagement.value)
                    if existing_engagement is not None
                    else set()
                )
                normalized_existing_engagement = (
                    next(iter(existing_engagement_matches))
                    if len(existing_engagement_matches) == 1
                    else None
                )
                existing_engagement_is_canonical = bool(
                    existing_engagement is not None
                    and isinstance(existing_engagement.value, str)
                    and existing_engagement.value in ENGAGEMENT_TYPES
                )
                repaired_engagement = bool(
                    existing_engagement is not None
                    and (
                        (
                            normalized_existing_engagement == engagement_type
                            and existing_engagement.value != engagement_type
                        )
                        or (
                            not existing_engagement_is_canonical
                            and not existing_engagement_matches
                            and normalized_existing_engagement is None
                        )
                    )
                    and replace_invalid_context_field(
                        "engagement_type",
                        engagement_type,
                        provenance="suggested_inference",
                        evidence=evidence,
                        explanation=engagement_explanation,
                        origin="semantic_inference",
                        rationale_code="structured_employment_type_normalized",
                    )
                )
                if not repaired_engagement and not upgrade_exact_context_match(
                    "engagement_type",
                    engagement_type,
                    evidence=evidence,
                    origin="semantic_inference",
                    rationale_code="structured_employment_type",
                    explanation=engagement_explanation,
                ):
                    append_context_field(
                        JobImportExtractionField(
                            field_path="engagement_type",
                            value=engagement_type,
                            provenance="suggested_inference",
                            evidence=evidence,
                            explanation=engagement_explanation,
                            provider_confidence=JobImportProviderConfidence(
                                score=0.99,
                                label="high",
                                metadata={
                                    "origin": "semantic_inference",
                                    "rationale_code": "structured_employment_type",
                                },
                            ),
                        ),
                    )

        def grounded_structured_list(
            key: str,
            *,
            label: str,
        ) -> tuple[list[str], list[JobImportEvidence]]:
            raw_values = context.get(key)
            if not isinstance(raw_values, list):
                return [], []
            values: list[str] = []
            evidence_items: list[JobImportEvidence] = []
            for raw_value in raw_values[:5]:
                if not isinstance(raw_value, str) or not raw_value.strip():
                    continue
                evidence = cls._structured_source_evidence(
                    source,
                    label=label,
                    value=raw_value,
                )
                if not evidence:
                    continue
                values.append(raw_value)
                evidence_items.extend(evidence)
            return values, evidence_items[:5]

        responsibilities, responsibility_evidence = grounded_structured_list(
            "responsibilities",
            label="Structured responsibility",
        )
        if responsibilities and responsibility_evidence:
            existing_responsibilities = by_path.get("responsibilities")
            repaired_responsibilities = bool(
                existing_responsibilities is not None
                and (
                    not _valid_import_string_list(existing_responsibilities.value)
                    or (
                        existing_responsibilities.value == responsibilities
                        and existing_responsibilities.provenance == "suggested_inference"
                    )
                )
                and replace_invalid_context_field(
                    "responsibilities",
                    responsibilities,
                    provenance="extracted_from_source",
                    evidence=responsibility_evidence,
                    rationale_code="structured_responsibilities_repaired",
                )
            )
            if not repaired_responsibilities:
                append_context_field(
                    JobImportExtractionField(
                        field_path="responsibilities",
                        value=responsibilities,
                        provenance="extracted_from_source",
                        evidence=responsibility_evidence,
                    )
                )

        requirements, requirement_evidence = grounded_structured_list(
            "qualifications",
            label="Structured qualification",
        )
        if requirements and requirement_evidence:
            existing_requirements = by_path.get("requirements")
            repaired_requirements = bool(
                existing_requirements is not None
                and (
                    not _valid_import_string_list(existing_requirements.value)
                    or (
                        existing_requirements.value == requirements
                        and existing_requirements.provenance == "suggested_inference"
                    )
                )
                and replace_invalid_context_field(
                    "requirements",
                    requirements,
                    provenance="extracted_from_source",
                    evidence=requirement_evidence,
                    rationale_code="structured_requirements_repaired",
                )
            )
            if not repaired_requirements:
                append_context_field(
                    JobImportExtractionField(
                        field_path="requirements",
                        value=requirements,
                        provenance="extracted_from_source",
                        evidence=requirement_evidence,
                    )
                )

        structured_summary = context.get("about_summary")
        if (
            isinstance(structured_summary, str)
            and len(structured_summary.strip()) >= 20
        ):
            evidence = cls._structured_source_evidence(
                source,
                label="Structured employer summary",
                value=structured_summary,
            )
            if evidence:
                existing_about = by_path.get("about_channel")
                repaired_about = bool(
                    existing_about is not None
                    and (
                        not isinstance(existing_about.value, str)
                        or len(existing_about.value.strip()) < 20
                    )
                    and replace_invalid_context_field(
                        "about_channel",
                        structured_summary,
                        provenance="extracted_from_source",
                        evidence=evidence,
                        rationale_code="structured_employer_summary_repaired",
                    )
                )
                if not repaired_about:
                    append_context_field(
                        JobImportExtractionField(
                            field_path="about_channel",
                            value=structured_summary,
                            provenance="extracted_from_source",
                            evidence=evidence,
                        )
                    )

        structured_role_location = context.get("role_location")
        if isinstance(structured_role_location, str):
            evidence = cls._structured_source_evidence(
                source,
                label="Structured role location",
                value=structured_role_location,
            )
            if evidence:
                existing_location = by_path.get("location")
                repaired_location = bool(
                    existing_location is not None
                    and (
                        not isinstance(existing_location.value, str)
                        or not existing_location.value.strip()
                    )
                    and replace_invalid_context_field(
                        "location",
                        structured_role_location,
                        provenance="extracted_from_source",
                        evidence=evidence,
                        rationale_code="structured_role_location_repaired",
                    )
                )
                if not repaired_location:
                    append_context_field(
                        JobImportExtractionField(
                            field_path="location",
                            value=structured_role_location,
                            provenance="extracted_from_source",
                            evidence=evidence,
                        )
                    )
                location_field = by_path.get("location")
                role_location = (
                    location_field.value
                    if location_field is not None
                    and isinstance(location_field.value, str)
                    and location_field.provenance
                    in {"directly_supplied", "extracted_from_source"}
                    else None
                )

        structured_industry = context.get("industry")
        if isinstance(structured_industry, str):
            industry_tokens = {
                token.strip().casefold()
                for token in re.split(r"[,/|;&]+", structured_industry)
                if token.strip()
            }
            matched_niches = [
                niche for niche in CREATOR_CONTENT_NICHES if niche.casefold() in industry_tokens
            ]
            evidence = cls._structured_source_evidence(
                source,
                label="Structured industry",
                value=structured_industry,
            )
            if matched_niches and evidence:
                niche_explanation = (
                    "The structured job industry exactly matches a CreatorJobs niche."
                )
                existing_niches = by_path.get("content_niches")
                normalized_existing_niches = (
                    [existing_niches.value]
                    if existing_niches is not None
                    and isinstance(existing_niches.value, str)
                    and existing_niches.value.casefold()
                    in {item.casefold() for item in matched_niches}
                    else None
                )
                repaired_niches = bool(
                    existing_niches is not None
                    and (
                        normalized_existing_niches == matched_niches
                        or not _valid_import_string_list(existing_niches.value)
                    )
                    and replace_invalid_context_field(
                        "content_niches",
                        matched_niches,
                        provenance="suggested_inference",
                        evidence=evidence,
                        explanation=niche_explanation,
                        origin="contextual_inference",
                        rationale_code="structured_industry_niche_normalized",
                    )
                )
                if not repaired_niches and not upgrade_exact_context_match(
                    "content_niches",
                    matched_niches,
                    evidence=evidence,
                    origin="contextual_inference",
                    rationale_code="industry_exact_niche_match",
                    explanation=niche_explanation,
                ):
                    append_context_field(
                        JobImportExtractionField(
                            field_path="content_niches",
                            value=matched_niches,
                            provenance="suggested_inference",
                            evidence=evidence,
                            explanation=niche_explanation,
                            provider_confidence=JobImportProviderConfidence(
                                score=0.99,
                                label="high",
                                metadata={
                                    "origin": "contextual_inference",
                                    "rationale_code": "industry_exact_niche_match",
                                },
                            ),
                        ),
                    )

        structured_experience = context.get("experience_requirement")
        if isinstance(structured_experience, str):
            experience_value: str | None = None
            provenance = "extracted_from_source"
            explanation: str | None = None
            provider_confidence: JobImportProviderConfidence | None = None
            if re.fullmatch(
                r"\d{1,2}\u2013\d{1,2} years of experience",
                structured_experience,
            ):
                experience_value = structured_experience
            else:
                months_match = re.fullmatch(
                    r"At least (\d{1,3}) months of experience",
                    structured_experience,
                )
                if months_match:
                    months = int(months_match.group(1))
                    experience_value = (
                        CREATOR_EXPERIENCE_BANDS[0]
                        if months < 12
                        else CREATOR_EXPERIENCE_BANDS[1]
                        if months < 36
                        else CREATOR_EXPERIENCE_BANDS[2]
                        if months < 60
                        else CREATOR_EXPERIENCE_BANDS[3]
                        if months < 96
                        else None
                    )
                    if experience_value is not None:
                        provenance = "suggested_inference"
                        explanation = (
                            "The structured minimum months fit this supported experience band."
                        )
                        provider_confidence = JobImportProviderConfidence(
                            score=0.7,
                            label="medium",
                            metadata={
                                "origin": "contextual_inference",
                                "rationale_code": "minimum_months_experience_band",
                                "minimum_months": months,
                            },
                        )
            evidence = cls._structured_source_evidence(
                source,
                label="Structured experience requirement",
                value=structured_experience,
            )
            if experience_value is not None and evidence:
                existing_experience = by_path.get("experience_level")
                repaired_experience = bool(
                    existing_experience is not None
                    and (
                        not isinstance(existing_experience.value, str)
                        or not existing_experience.value.strip()
                        or (
                            existing_experience.value == experience_value
                            and provenance == "extracted_from_source"
                            and existing_experience.provenance == "suggested_inference"
                        )
                    )
                    and replace_invalid_context_field(
                        "experience_level",
                        experience_value,
                        provenance=provenance,
                        evidence=evidence,
                        explanation=explanation,
                        origin=(
                            "contextual_inference"
                            if provenance == "suggested_inference"
                            else None
                        ),
                        rationale_code=(
                            "minimum_months_experience_band"
                            if provenance == "suggested_inference"
                            else "structured_experience_requirement_repaired"
                        ),
                        confidence_score=(
                            provider_confidence.score
                            if provider_confidence is not None
                            and provider_confidence.score is not None
                            else 0.99
                        ),
                        confidence_label=(
                            provider_confidence.label
                            if provider_confidence is not None
                            and provider_confidence.label is not None
                            else "high"
                        ),
                    )
                )
                if not repaired_experience:
                    append_context_field(
                        JobImportExtractionField(
                            field_path="experience_level",
                            value=experience_value,
                            provenance=provenance,
                            evidence=evidence,
                            explanation=explanation,
                            provider_confidence=provider_confidence,
                        )
                    )

        if role_location is None and isinstance(context.get("role_location"), str):
            role_location = context["role_location"]
        employer_location = (
            context.get("employer_location")
            if isinstance(context.get("employer_location"), str)
            else None
        )
        decision = infer_compensation_currency(
            explicit_currency=explicit_currency,
            amount_present=amount_present,
            role_location=role_location,
            work_mode=work_mode,
            employer_location=employer_location,
        )

        if decision.conflict_currency and explicit_currency_field is not None:
            warning_evidence = [
                *explicit_currency_field.evidence,
                *(location_field.evidence if location_field is not None else []),
            ][:3]
            warnings.append(
                JobImportProcessingWarning(
                    code="currency_location_conflict",
                    message=(
                        "The stated currency conflicts with the role location. "
                        "The stated currency was preserved."
                    ),
                    field_path="budget_currency",
                    evidence=warning_evidence,
                )
            )
        if (
            explicit_currency_field is None
            and "budget_currency" not in occupied_paths
            and decision.currency is not None
            and decision.origin == "contextual_inference"
            and len(fields) < 100
        ):
            evidence = list(location_field.evidence) if location_field is not None else []
            if not evidence and role_location:
                evidence = cls._structured_source_evidence(
                    source,
                    label="Structured role location",
                    value=role_location,
                )
            if not evidence and employer_location:
                evidence = cls._structured_source_evidence(
                    source,
                    label="Structured employer location",
                    value=employer_location,
                )
            if evidence:
                append_context_field(
                    JobImportExtractionField(
                        field_path="budget_currency",
                        value=decision.currency,
                        provenance="suggested_inference",
                        evidence=evidence,
                        explanation=(
                            f"{decision.currency} inferred from the job's role location."
                            if decision.rationale_code == "currency_from_role_country"
                            else f"{decision.currency} inferred from the local employer location."
                        ),
                        provider_confidence=JobImportProviderConfidence(
                            score=1,
                            label="high",
                            metadata={
                                "origin": "contextual_inference",
                                "rationale_code": decision.rationale_code,
                                "country_code": decision.country_code,
                            },
                        ),
                    )
                )
        return JobImportExtractionResponse.model_validate(
            {
                **response.model_dump(mode="json"),
                "fields": fields,
                "missing_fields": missing_fields,
                "warnings": warnings[:30],
            }
        )

    @staticmethod
    def _field_decision(
        policy: JobImportFieldPolicy,
        item: JobImportExtractionField,
        *,
        validation_errors: list[str],
        force_review: bool = False,
    ) -> tuple[bool, dict[str, object]]:
        provider_metadata = (
            item.provider_confidence.metadata if item.provider_confidence is not None else {}
        )
        contextual = provider_metadata.get("origin") == "contextual_inference"
        origin = (
            "contextual_inference"
            if contextual
            else "semantic_inference"
            if item.provenance == "suggested_inference"
            else "explicit"
        )
        confidence = (
            "high"
            if origin == "explicit"
            else provider_confidence_label(
                item.provider_confidence.score if item.provider_confidence else None,
                item.provider_confidence.label if item.provider_confidence else None,
            )
        )
        allowed = origin in policy.allowed_origins
        auto_fill = bool(
            not validation_errors
            and not force_review
            and allowed
            and (origin == "explicit" or bool(item.evidence))
            and (
                origin == "explicit" or confidence_at_least(confidence, policy.auto_fill_confidence)
            )
        )
        rationale = provider_metadata.get("rationale_code")
        if not isinstance(rationale, str):
            rationale = (
                "explicit_source_value" if origin == "explicit" else f"semantic_{policy.field_path}"
            )
        metadata = {
            **(
                item.provider_confidence.model_dump(mode="json") if item.provider_confidence else {}
            ),
            "origin": origin,
            "confidence": confidence,
            "rationale_code": rationale,
            "needs_review": not auto_fill,
            "risk": policy.inference_risk,
        }
        return auto_fill, metadata

    @staticmethod
    def _provider_inference_errors(
        policy: JobImportFieldPolicy,
        provenance: str,
        value: object,
        provider_confidence: JobImportProviderConfidence | None = None,
    ) -> list[str]:
        errors: list[str] = []
        if provenance == "suggested_inference":
            origin = (
                "contextual_inference"
                if provider_confidence is not None
                and provider_confidence.metadata.get("origin") == "contextual_inference"
                else "semantic_inference"
            )
            if origin not in policy.allowed_origins:
                errors.append("This field may only be extracted from explicit source wording.")
            if policy.field_path == "source_inputs" and isinstance(value, list):
                sensitive = any(
                    isinstance(item, dict)
                    and (
                        item.get("type") in {"account_access", "analytics_access"}
                        or item.get("sensitive_access_confirmed") is True
                    )
                    for item in value
                )
                if sensitive:
                    errors.append(
                        "Sensitive source access may only be extracted from explicit source wording."
                    )
        if policy.field_path == "source_inputs" and isinstance(value, list):
            provider_asserted_sensitive_confirmation = any(
                isinstance(item, dict) and item.get("sensitive_access_confirmed") is True
                for item in value
            )
            if provider_asserted_sensitive_confirmation:
                errors.append(
                    "Sensitive source access must be confirmed through an explicit recruiter edit."
                )
        return list(dict.fromkeys(errors))

    @staticmethod
    def _validate_evidence_references(
        response: JobImportExtractionResponse,
        source: JobImportSource,
    ) -> None:
        evidence_items = [
            *(evidence for field in response.fields for evidence in field.evidence),
            *(
                evidence
                for conflict in response.conflicts
                for alternative in conflict.values
                for evidence in alternative.evidence
            ),
            *(evidence for missing in response.missing_fields for evidence in missing.evidence),
            *(evidence for warning in response.warnings for evidence in warning.evidence),
        ]
        errors: list[dict[str, object]] = []
        text_length = len(source.original_text) if source.original_text is not None else None
        source_url = str(source.source_url).rstrip("/") if source.source_url else None
        for index, evidence in enumerate(evidence_items):
            location = evidence.location
            if location is None:
                continue
            if location.char_start is not None:
                if text_length is None:
                    errors.append(
                        {
                            "evidence_index": index,
                            "location": "character_range",
                            "message": "Character offsets require source text.",
                        }
                    )
                elif (
                    location.char_start >= text_length
                    or location.char_end is None
                    or location.char_end > text_length
                ):
                    errors.append(
                        {
                            "evidence_index": index,
                            "location": "character_range",
                            "message": "Character offsets fall outside the owned source text.",
                        }
                    )
                elif (
                    source.original_text[location.char_start : location.char_end]
                    != evidence.snippet
                ):
                    errors.append(
                        {
                            "evidence_index": index,
                            "location": "character_range",
                            "message": "Evidence does not exactly match the owned source text.",
                        }
                    )
            if location.screenshot_index is not None and (
                source.source_type not in {"screenshot", "screenshots"}
                or location.screenshot_index >= len(source.storage_references)
            ):
                errors.append(
                    {
                        "evidence_index": index,
                        "location": "screenshot_index",
                        "message": "Screenshot index does not reference this import source.",
                    }
                )
            if location.document_page is not None and source.source_type not in {"document", "pdf"}:
                errors.append(
                    {
                        "evidence_index": index,
                        "location": "document_page",
                        "message": "Document page does not reference this import source.",
                    }
                )
            if location.source_url is not None:
                evidence_url = str(location.source_url).rstrip("/")
                if source_url is None or evidence_url != source_url:
                    errors.append(
                        {
                            "evidence_index": index,
                            "location": "source_url",
                            "message": "Evidence URL does not match this import source.",
                        }
                    )
        if errors:
            raise JobImportError(
                "JOB_IMPORT_EVIDENCE_REFERENCE_INVALID",
                "Extraction evidence contains a reference outside its owned source.",
                details={"references": errors},
            )

    async def record_extraction_result(
        self,
        draft_id: UUID,
        response: JobImportExtractionResponse,
        *,
        owner_user_id: UUID,
        provider_metadata: JobImportProviderMetadata | None = None,
        expected_processing_attempt_id: UUID | None = None,
    ) -> JobImportDraft:
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            uuid4(),
            allowed_statuses=(
                {"processing"}
                if expected_processing_attempt_id is not None
                else {
                    "awaiting_processing",
                    "processing",
                    "processing_failed",
                }
            ),
        )
        if draft is None:
            existing = await self.repository.get_draft_for_owner(
                draft_id,
                owner_user_id,
            )
            if existing is not None:
                raise JobImportError(
                    "JOB_IMPORT_MACHINE_OUTPUT_IMMUTABLE",
                    "Processed import drafts are immutable; create a superseding draft to reprocess.",
                    status_code=409,
                )
            raise JobImportError(
                "JOB_IMPORT_DRAFT_NOT_FOUND",
                "Import draft not found.",
                status_code=404,
            )
        try:
            self._assert_processing_attempt(
                draft,
                expected_processing_attempt_id,
            )
            return await self._record_extraction_result_claimed(
                draft,
                response,
                owner_user_id=owner_user_id,
                provider_metadata=provider_metadata,
            )
        except Exception:
            await self.repository.session.rollback()
            raise

    async def _record_extraction_result_claimed(
        self,
        draft: JobImportDraft,
        response: JobImportExtractionResponse,
        *,
        owner_user_id: UUID,
        provider_metadata: JobImportProviderMetadata | None,
    ) -> JobImportDraft:
        if draft.processing_status not in {
            "awaiting_processing",
            "processing",
            "processing_failed",
        }:
            raise JobImportError(
                "JOB_IMPORT_MACHINE_OUTPUT_IMMUTABLE",
                "Processed import drafts are immutable; create a superseding draft to reprocess.",
                status_code=409,
            )
        if response.extraction_schema_version != draft.extraction_schema_version:
            raise JobImportError(
                "JOB_IMPORT_EXTRACTION_SCHEMA_MISMATCH",
                "Extraction response schema does not match the import draft.",
            )
        if response.target_listing_schema_version != draft.target_listing_schema_version:
            raise JobImportError(
                "JOB_IMPORT_TARGET_SCHEMA_MISMATCH",
                "Extraction response target schema does not match the import draft.",
            )
        if await self.repository.list_fields(draft.id):
            raise JobImportError(
                "JOB_IMPORT_MACHINE_OUTPUT_IMMUTABLE",
                "This import draft already has machine output.",
                status_code=409,
            )
        source = await self.get_source(draft.source_id, owner_user_id=owner_user_id)
        active_roles = await self.repository.list_active_roles()
        response = self._with_deterministic_context(
            response,
            source,
            allowed_role_keys={role.slug for role in active_roles},
        )
        self._validate_evidence_references(response, source)

        all_paths = {
            *(item.field_path for item in response.fields),
            *(item.field_path for item in response.conflicts),
            *(item.field_path for item in response.missing_fields),
        }
        unknown_paths = sorted(path for path in all_paths if import_field_policy(path) is None)
        if unknown_paths:
            server_owned = sorted(set(unknown_paths) & SYSTEM_OWNED_IMPORT_FIELDS)
            legacy_compatibility = sorted(set(unknown_paths) & LEGACY_COMPATIBILITY_IMPORT_FIELDS)
            raise JobImportError(
                "JOB_IMPORT_UNSUPPORTED_FIELD",
                "Extraction output contains unsupported or server-owned fields.",
                details={
                    "fields": unknown_paths,
                    "server_owned_fields": server_owned,
                    "legacy_compatibility_fields": legacy_compatibility,
                },
            )

        rows: list[dict[str, Any]] = []
        for item in response.fields:
            policy = JOB_IMPORT_FIELD_POLICIES[item.field_path]
            provider_value = (
                self._provider_screening_questions(item.value, item.evidence)
                if item.field_path == "screening_questions"
                else item.value
            )
            normalized, errors = await self._validate_field_value(policy, provider_value)
            unsupported_nested = [
                error for error in errors if error.startswith("Unsupported nested key")
            ]
            if unsupported_nested:
                raise JobImportError(
                    "JOB_IMPORT_UNSUPPORTED_NESTED_FIELD",
                    "Extraction output contains unsupported nested fields.",
                    details={
                        "field_path": item.field_path,
                        "errors": unsupported_nested,
                    },
                )
            errors.extend(
                self._provider_inference_errors(
                    policy,
                    item.provenance,
                    provider_value,
                    item.provider_confidence,
                )
            )
            currency_conflict = bool(
                item.field_path == "budget_currency"
                and any(
                    warning.code == "currency_location_conflict" for warning in response.warnings
                )
            )
            auto_fill, decision_metadata = self._field_decision(
                policy,
                item,
                validation_errors=errors,
                force_review=currency_conflict,
            )
            rows.append(
                {
                    "draft_id": draft.id,
                    "field_path": item.field_path,
                    "proposed_value": normalized,
                    "provenance_state": item.provenance,
                    "evidence": [evidence.model_dump(mode="json") for evidence in item.evidence],
                    "conflicting_values": [],
                    "explanation": item.explanation,
                    "provider_confidence": decision_metadata,
                    "review_status": "confirmed" if auto_fill else "pending",
                    "confirmed_value": normalized if auto_fill else None,
                    "missing_requirement": policy.missing_requirement,
                    "requires_confirmation": not auto_fill,
                    "validation_errors": errors,
                }
            )

        for conflict in response.conflicts:
            policy = JOB_IMPORT_FIELD_POLICIES[conflict.field_path]
            normalized_values: list[dict[str, object]] = []
            errors: list[str] = []
            for index, alternative in enumerate(conflict.values):
                normalized, alternative_errors = await self._validate_field_value(
                    policy,
                    alternative.value,
                )
                unsupported_nested = [
                    error
                    for error in alternative_errors
                    if error.startswith("Unsupported nested key")
                ]
                if unsupported_nested:
                    raise JobImportError(
                        "JOB_IMPORT_UNSUPPORTED_NESTED_FIELD",
                        "Extraction output contains unsupported nested fields.",
                        details={
                            "field_path": conflict.field_path,
                            "alternative_index": index,
                            "errors": unsupported_nested,
                        },
                    )
                errors.extend(f"Alternative {index + 1}: {error}" for error in alternative_errors)
                normalized_values.append(
                    {
                        "value": normalized,
                        "evidence": [
                            evidence.model_dump(mode="json") for evidence in alternative.evidence
                        ],
                    }
                )
            normalized_distinct = {
                json.dumps(item["value"], ensure_ascii=False, sort_keys=True)
                for item in normalized_values
            }
            if len(normalized_distinct) < 2:
                raise JobImportError(
                    "JOB_IMPORT_CONFLICT_VALUES_NOT_DISTINCT",
                    "Conflicting alternatives must remain distinct after CreatorJobs normalization.",
                    details={"field_path": conflict.field_path},
                )
            rows.append(
                {
                    "draft_id": draft.id,
                    "field_path": conflict.field_path,
                    "proposed_value": None,
                    "provenance_state": "conflicting_source_values",
                    "evidence": [],
                    "conflicting_values": normalized_values,
                    "explanation": conflict.explanation,
                    "provider_confidence": (
                        {
                            **(
                                conflict.provider_confidence.model_dump(mode="json")
                                if conflict.provider_confidence
                                else {}
                            ),
                            "origin": "explicit",
                            "confidence": "high",
                            "rationale_code": "conflicting_explicit_source_values",
                            "needs_review": True,
                            "risk": policy.inference_risk,
                        }
                    ),
                    "missing_requirement": policy.missing_requirement,
                    "requires_confirmation": True,
                    "validation_errors": errors,
                }
            )

        explicit_missing = {item.field_path: item for item in response.missing_fields}
        missing_paths = [
            *explicit_missing,
            *(path for path in AUTO_TRACKED_MISSING_FIELDS if path not in all_paths),
        ]
        for field_path in dict.fromkeys(missing_paths):
            policy = JOB_IMPORT_FIELD_POLICIES[field_path]
            item = explicit_missing.get(field_path)
            rows.append(
                {
                    "draft_id": draft.id,
                    "field_path": field_path,
                    "proposed_value": None,
                    "provenance_state": "missing",
                    "evidence": (
                        [evidence.model_dump(mode="json") for evidence in item.evidence]
                        if item
                        else []
                    ),
                    "conflicting_values": [],
                    "explanation": item.explanation if item else "Not found in the source.",
                    "provider_confidence": None,
                    "missing_requirement": policy.missing_requirement,
                    "requires_confirmation": False,
                    "validation_errors": [],
                }
            )

        rows = await self._merge_structured_page_signals(draft, rows, owner_user_id)
        rows = self._merge_recruiter_prefill(draft, rows)

        await self.repository.create_fields(rows)
        metadata = provider_metadata or JobImportProviderMetadata()
        now = datetime.now(UTC)
        current_metadata = (
            draft.provider_metadata if isinstance(draft.provider_metadata, dict) else {}
        )
        completed_metadata = {
            **current_metadata,
            **(metadata.metadata or {}),
            "processing_completed_at": now.isoformat(),
            "processing_outcome": "processed",
        }
        await self.repository.update_draft(
            draft,
            {
                "provider_name": metadata.provider_name,
                "model_name": metadata.model_name,
                "model_version": metadata.model_version,
                "instruction_version": metadata.instruction_version,
                "provider_metadata": completed_metadata,
                "machine_output": response.model_dump(mode="json"),
                "processing_warnings": [
                    warning.model_dump(mode="json") for warning in response.warnings
                ],
                "processing_status": "awaiting_recruiter_review",
                "processed_at": now,
                "mutation_claim_token": None,
            },
        )
        await self.repository.update_source(source, {"processing_state": "processed"})
        await self._refresh_draft_state(draft, owner_user_id=owner_user_id)
        await self.repository.session.commit()
        return draft

    @staticmethod
    def _effective_field_value(field: JobImportField) -> object | None:
        if field.review_status == "edited":
            return field.edited_value
        if field.review_status == "confirmed":
            return field.confirmed_value
        return None

    async def _effective_native_payload(
        self,
        fields: list[JobImportField],
    ) -> dict[str, object]:
        payload: dict[str, object] = {}
        for field in fields:
            value = self._effective_field_value(field)
            if value is None:
                continue
            # A value the editor will refuse is worth less than no value: the
            # recruiter gets a validation error *and* still has to answer. So a
            # derived value is either shaped into the native vocabulary or left
            # out, and never passed through to fail on arrival.
            value = coerce_to_native(field.field_path, value)
            if value is None:
                continue
            policy = JOB_IMPORT_FIELD_POLICIES[field.field_path]
            if field.field_path == "primary_role_key":
                role = await self.repository.get_active_role_by_key(str(value))
                if role is None:
                    raise JobImportError(
                        "JOB_IMPORT_ROLE_UNAVAILABLE",
                        "The confirmed creator role is no longer active. Select another role before conversion.",
                        status_code=409,
                        details={"field_path": "primary_role_key"},
                    )
                payload["primary_role_id"] = role.id
            elif policy.native_field is not None:
                payload[policy.native_field] = value
        return payload

    @staticmethod
    def _pydantic_errors(exc: ValidationError) -> dict[str, list[str]]:
        errors: dict[str, list[str]] = {}
        for item in exc.errors(include_url=False):
            location = ".".join(str(part) for part in item.get("loc", ())) or "draft"
            errors.setdefault(location, []).append(str(item.get("msg") or "Invalid value"))
        return errors

    async def _native_validation(
        self,
        payload: dict[str, object],
        *,
        owner_user_id: UUID,
        status: str,
    ) -> tuple[JobCreate | None, dict[str, list[str]]]:
        try:
            job_payload = JobCreate.model_validate({**payload, "status": status})
            await self.job_service.prepare_job_create(
                job_payload,
                actor_user_id=owner_user_id,
            )
            return job_payload, {}
        except ValidationError as exc:
            return None, self._pydantic_errors(exc)
        except JobValidationError as exc:
            return None, exc.field_errors
        except JobForbiddenError as exc:
            return None, {"owner": [str(exc)]}

    async def _refresh_draft_state(
        self,
        draft: JobImportDraft,
        *,
        owner_user_id: UUID,
    ) -> None:
        if draft.processing_status in {
            "applied_to_native_draft",
            "discarded",
            "superseded",
        }:
            return
        fields = await self.repository.list_fields(draft.id)
        field_errors = {
            field.field_path: list(field.validation_errors)
            for field in fields
            if field.validation_errors and field.review_status != "rejected"
        }
        unresolved = [
            field
            for field in fields
            if field.provenance_state != "missing" and field.review_status == "pending"
        ]
        actionable = [
            field
            for field in fields
            if field.provenance_state != "missing" or field.review_status != "pending"
        ]
        reviewed = [field for field in actionable if field.review_status != "pending"]
        payload = await self._effective_native_payload(fields)

        draft_errors: dict[str, list[str]] = {}
        draft_payload: JobCreate | None = None
        if "title" not in payload:
            draft_errors["title"] = ["Confirm or enter a job title before creating a native draft."]
        else:
            draft_payload, draft_errors = await self._native_validation(
                payload,
                owner_user_id=owner_user_id,
                status="draft",
            )

        publication_errors: dict[str, list[str]] = {}
        if draft_payload is not None:
            _published, publication_errors = await self._native_validation(
                payload,
                owner_user_id=owner_user_id,
                status="published",
            )

        can_apply = bool(draft_payload is not None and not draft_errors)
        # Imports can only create private native drafts. Publication readiness is
        # retained in validation_errors["publication"], never exposed as authority.
        can_publish = False
        if draft_errors:
            validation_status = "invalid"
        elif field_errors or unresolved:
            validation_status = "needs_review"
        else:
            validation_status = "valid"

        if not actionable or not reviewed:
            confirmation_state = "unreviewed"
        elif len(reviewed) == len(actionable):
            confirmation_state = "confirmed"
        else:
            confirmation_state = "partial"

        if can_apply:
            processing_status = "ready_to_apply"
        elif reviewed:
            processing_status = "partially_reviewed"
        else:
            processing_status = "awaiting_recruiter_review"

        missing_fields = [
            {
                "field_path": field.field_path,
                "requirement": field.missing_requirement,
                "explanation": field.explanation,
            }
            for field in fields
            if field.provenance_state == "missing"
            and field.review_status in {"pending", "rejected"}
        ]

        section_items: dict[str, list[str]] = {}
        for field in fields:
            policy = JOB_IMPORT_FIELD_POLICIES[field.field_path]
            needs_attention = bool(
                field.validation_errors
                or (
                    field.review_status == "pending"
                    and (
                        field.provenance_state != "missing"
                        or field.missing_requirement
                        in {"publication_blocker", "conditionally_required"}
                    )
                )
            )
            if needs_attention:
                section_items.setdefault(policy.review_section, []).append(field.field_path)
        review_sections = [
            {"section": section, "fields": sorted(paths)}
            for section, paths in sorted(section_items.items())
        ]
        validation_errors: dict[str, object] = {}
        if field_errors:
            validation_errors["fields"] = field_errors
        if draft_errors:
            validation_errors["draft"] = draft_errors
        if publication_errors:
            validation_errors["publication"] = publication_errors

        await self.repository.update_draft(
            draft,
            {
                "processing_status": processing_status,
                "validation_status": validation_status,
                "confirmation_state": confirmation_state,
                "can_apply_to_native_draft": can_apply,
                "can_publish_directly": can_publish,
                "missing_fields": missing_fields,
                "validation_errors": validation_errors,
                "review_sections": review_sections,
            },
        )

    @staticmethod
    def _assert_reviewable(draft: JobImportDraft) -> None:
        if draft.processing_status not in {
            "awaiting_recruiter_review",
            "partially_reviewed",
            "ready_to_apply",
            "applied_to_native_draft",
        }:
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "This import draft is not open for recruiter review.",
                status_code=409,
            )

    @staticmethod
    def _recruiter_prefill_values(draft: JobImportDraft) -> dict[str, object]:
        stored = draft.recruiter_prefill
        if not isinstance(stored, dict):
            return {}
        return {
            field_path: value
            for field_path, value in stored.items()
            if isinstance(field_path, str) and field_path in JOB_IMPORT_FIELD_POLICIES
        }

    @staticmethod
    def _structured_value_may_fill(existing: dict[str, Any]) -> bool:
        """Whether a machine-readable page fact may take this row.

        A page's own ``JobPosting`` block is explicit publisher data, so it
        outranks an unconfirmed *guess* about the same field — especially one the
        field policy has already refused. Without this, an inference that could
        never be used still occupied the row, the explicit value was skipped, and
        the field reached the draft empty.

        It never displaces a settled reading of the source, and never a recruiter.
        """

        state = existing.get("provenance_state")
        if state == "missing":
            return True
        if state != "suggested_inference":
            return False
        if existing.get("review_status") != "pending":
            return False
        # Only where the guess is unusable anyway: rejected, or holding nothing.
        return bool(existing.get("validation_errors")) or existing.get(
            "proposed_value"
        ) in (None, "")

    async def _merge_structured_page_signals(
        self,
        draft: JobImportDraft,
        rows: list[dict[str, Any]],
        owner_user_id: UUID,
    ) -> list[dict[str, Any]]:
        """Fill from the page's own machine-readable job data.

        A public job page usually publishes a schema.org ``JobPosting`` block:
        employment type, salary, location, experience. The fetcher already reads
        it, but only as text for the model to re-read — so whenever the model
        missed one, the assistant asked the recruiter for something the page had
        stated outright. That is the whole reason a URL import could feel like a
        scraper rather than a reader.

        These values are applied only where the machine produced nothing, so a
        model reading of the prose still wins, and a recruiter answer still wins
        over both through the prefill merge that runs after this one. Each value
        is validated exactly as any other, so nothing can enter here that could
        not enter through ordinary review.
        """

        try:
            source = await self.get_source(draft.source_id, owner_user_id=owner_user_id)
        except JobImportError:
            # Source retention may have ended. Structured enrichment is a bonus,
            # never a reason to fail an extraction that already succeeded.
            return rows

        metadata = source.retrieval_metadata
        context = metadata.get("structured_context") if isinstance(metadata, dict) else None
        if not isinstance(context, dict) or not context:
            return rows

        try:
            structured = fields_from_structured_context(context)
            # Markup is the better source, so it wins where it speaks at all.
            # Where it is silent, a plainly stated body requirement is still a
            # stated fact, and asking for it would be asking the recruiter to
            # retype something the page put under a heading.
            if "experience_level" not in structured:
                stated = experience_from_body(source.original_text)
                if stated:
                    structured["experience_level"] = stated
        except Exception:  # pragma: no cover - enrichment must never break import
            # Enrichment is a bonus. A malformed structured block must never
            # turn a successful extraction into a failure.
            return rows

        by_path = {row["field_path"]: row for row in rows}
        for field_path, value in structured.items():
            policy = JOB_IMPORT_FIELD_POLICIES.get(field_path)
            if policy is None:
                continue
            existing = by_path.get(field_path)
            if existing is not None and not self._structured_value_may_fill(existing):
                continue

            normalized, errors = await self._validate_field_value(policy, value)
            if errors or normalized is None:
                continue

            filled = {
                "provenance_state": "extracted_from_source",
                "proposed_value": normalized,
                "confirmed_value": normalized,
                "review_status": "confirmed",
                "requires_confirmation": False,
                "validation_errors": [],
                "explanation": "Read from the job page's structured details.",
                "conflicting_values": [],
            }
            if existing is not None:
                existing.update(filled)
                continue
            rows.append(
                {
                    "draft_id": draft.id,
                    "field_path": field_path,
                    "evidence": [],
                    "provider_confidence": None,
                    "missing_requirement": policy.missing_requirement,
                    "edited_value": None,
                    **filled,
                }
            )
        return rows

    @classmethod
    def _merge_recruiter_prefill(
        cls,
        draft: JobImportDraft,
        rows: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Let answers given during processing win over the machine's proposal.

        The recruiter answered before extraction returned, so their value is the
        decision and the provider result is at most corroboration. The machine
        proposal, evidence, and confidence stay on the row for private audit; only
        the effective value changes. Values were validated when they were stored,
        so no field can enter the draft here that could not enter it through the
        ordinary review path.
        """

        prefill = cls._recruiter_prefill_values(draft)
        if not prefill:
            return rows

        by_path = {row["field_path"]: row for row in rows}
        for field_path, value in prefill.items():
            policy = JOB_IMPORT_FIELD_POLICIES[field_path]
            existing = by_path.get(field_path)
            if existing is not None:
                existing.update(
                    {
                        "review_status": "edited",
                        "edited_value": value,
                        "confirmed_value": None,
                        "requires_confirmation": False,
                        "validation_errors": [],
                    }
                )
                if existing["provenance_state"] == "missing":
                    # The machine found nothing, so this value's only origin is the
                    # recruiter. Leaving it "missing" would misreport a field that
                    # now has an answer, and would keep it in the missing counts.
                    existing["provenance_state"] = "directly_supplied"
                    existing["explanation"] = (
                        "You answered this while the draft was being prepared."
                    )
                continue
            row: dict[str, Any] = {
                "draft_id": draft.id,
                "field_path": field_path,
                "proposed_value": None,
                "provenance_state": "directly_supplied",
                "evidence": [],
                "conflicting_values": [],
                "explanation": "You answered this while the draft was being prepared.",
                "provider_confidence": None,
                "review_status": "edited",
                "edited_value": value,
                "confirmed_value": None,
                "missing_requirement": policy.missing_requirement,
                "requires_confirmation": False,
                "validation_errors": [],
            }
            rows.append(row)
            by_path[field_path] = row
        return rows

    async def set_recruiter_prefill(
        self,
        draft_id: UUID,
        field_path: str,
        value: object,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        """Record a recruiter answer that precedes machine output.

        This exists because ``record_extraction_result`` refuses to write machine
        output once any field row exists. Storing the answer on the draft keeps
        that immutability rule intact while making the answer durable across
        refresh and independent of any one browser tab.
        """

        if not is_early_recruiter_question(field_path):
            raise JobImportError(
                "JOB_IMPORT_FIELD_NOT_EARLY_ANSWERABLE",
                "This detail cannot be answered before the draft has been prepared.",
                status_code=409,
                details={"field_path": field_path},
            )
        policy = JOB_IMPORT_FIELD_POLICIES[field_path]
        normalized, errors = await self._validate_field_value(policy, value)
        if errors:
            raise JobImportError(
                "JOB_IMPORT_FIELD_INVALID",
                "The recruiter-supplied value is invalid.",
                details={"errors": errors},
            )

        claim_token = uuid4()
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            claim_token,
            allowed_statuses={"awaiting_processing", "processing", "processing_failed"},
        )
        if draft is None:
            existing = await self.repository.get_draft_for_owner(draft_id, owner_user_id)
            if existing is None:
                raise JobImportError(
                    "JOB_IMPORT_DRAFT_NOT_FOUND",
                    "Import draft not found.",
                    status_code=404,
                )
            # Extraction already landed, so the ordinary review path owns this field.
            raise JobImportError(
                "JOB_IMPORT_PREFILL_WINDOW_CLOSED",
                "This draft is already prepared; review the field normally instead.",
                status_code=409,
            )
        try:
            current = self._recruiter_prefill_values(draft)
            await self.repository.update_draft(
                draft,
                {
                    "recruiter_prefill": {**current, field_path: normalized},
                    "recruiter_prefill_updated_at": datetime.now(UTC),
                    "mutation_claim_token": None,
                },
            )
            await self.repository.session.commit()
        except Exception:
            await self.repository.session.rollback()
            raise
        return draft

    async def review_field(
        self,
        draft_id: UUID,
        field_path: str,
        payload: JobImportFieldReviewRequest,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        claim_token = uuid4()
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            claim_token,
            allowed_statuses={
                "awaiting_recruiter_review",
                "partially_reviewed",
                "ready_to_apply",
                "applied_to_native_draft",
            },
        )
        if draft is None:
            existing = await self.repository.get_draft_for_owner(
                draft_id,
                owner_user_id,
            )
            if existing is None:
                raise JobImportError(
                    "JOB_IMPORT_DRAFT_NOT_FOUND",
                    "Import draft not found.",
                    status_code=404,
                )
            self._assert_reviewable(existing)
            raise JobImportError(
                "JOB_IMPORT_CONCURRENT_MUTATION",
                "This import draft is being changed by another request. Retry the review action.",
                status_code=409,
            )
        try:
            source = await self.repository.get_source_for_owner(
                draft.source_id,
                owner_user_id,
            )
            if source is None:
                raise JobImportError(
                    "JOB_IMPORT_SOURCE_REDACTED",
                    "A redacted source cannot be reviewed.",
                    status_code=409,
                )
            field = await self.repository.get_field(draft.id, field_path)
            if field is None:
                raise JobImportError(
                    "JOB_IMPORT_FIELD_NOT_FOUND",
                    "Import field not found.",
                    status_code=404,
                )
            now = datetime.now(UTC)
            updates: dict[str, object | None] = {
                "reviewed_by_user_id": owner_user_id,
                "reviewed_at": now,
                "selected_conflict_index": None,
            }
            if payload.action == "accept":
                if field.provenance_state in {"missing", "conflicting_source_values"}:
                    raise JobImportError(
                        "JOB_IMPORT_FIELD_REQUIRES_EDIT_OR_RESOLUTION",
                        "Missing and conflicting fields cannot be accepted as-is.",
                        status_code=409,
                    )
                if field.validation_errors:
                    raise JobImportError(
                        "JOB_IMPORT_FIELD_INVALID",
                        "The proposed value is invalid and must be edited or rejected.",
                        status_code=409,
                        details={"errors": field.validation_errors},
                    )
                updates.update(
                    {
                        "review_status": "confirmed",
                        "confirmed_value": field.proposed_value,
                        "edited_value": None,
                    }
                )
            elif payload.action == "edit":
                policy = JOB_IMPORT_FIELD_POLICIES[field.field_path]
                normalized, errors = await self._validate_field_value(
                    policy,
                    payload.edited_value,
                )
                if errors:
                    raise JobImportError(
                        "JOB_IMPORT_FIELD_INVALID",
                        "The recruiter-edited value is invalid.",
                        details={"errors": errors},
                    )
                updates.update(
                    {
                        "review_status": "edited",
                        "confirmed_value": None,
                        "edited_value": normalized,
                        "validation_errors": [],
                    }
                )
            elif payload.action == "reject":
                updates.update(
                    {
                        "review_status": "rejected",
                        "confirmed_value": None,
                        "edited_value": None,
                    }
                )
            else:
                updates.update(
                    {
                        "review_status": "pending",
                        "confirmed_value": None,
                        "edited_value": None,
                        "reviewed_by_user_id": None,
                        "reviewed_at": None,
                    }
                )
            await self.repository.update_field(field, updates)
            await self._refresh_draft_state(draft, owner_user_id=owner_user_id)
            await self.repository.update_draft(
                draft,
                {"mutation_claim_token": None},
            )
            await self.repository.session.commit()
            return draft
        except Exception:
            await self.repository.session.rollback()
            raise

    async def resolve_conflict(
        self,
        draft_id: UUID,
        field_path: str,
        payload: JobImportConflictResolutionRequest,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        claim_token = uuid4()
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            claim_token,
            allowed_statuses={
                "awaiting_recruiter_review",
                "partially_reviewed",
                "ready_to_apply",
                "applied_to_native_draft",
            },
        )
        if draft is None:
            existing = await self.repository.get_draft_for_owner(
                draft_id,
                owner_user_id,
            )
            if existing is None:
                raise JobImportError(
                    "JOB_IMPORT_DRAFT_NOT_FOUND",
                    "Import draft not found.",
                    status_code=404,
                )
            self._assert_reviewable(existing)
            raise JobImportError(
                "JOB_IMPORT_CONCURRENT_MUTATION",
                "This import draft is being changed by another request. Retry the conflict resolution.",
                status_code=409,
            )
        try:
            source = await self.repository.get_source_for_owner(
                draft.source_id,
                owner_user_id,
            )
            if source is None:
                raise JobImportError(
                    "JOB_IMPORT_SOURCE_REDACTED",
                    "A redacted source cannot be reviewed.",
                    status_code=409,
                )
            field = await self.repository.get_field(draft.id, field_path)
            if field is None:
                raise JobImportError(
                    "JOB_IMPORT_FIELD_NOT_FOUND",
                    "Import field not found.",
                    status_code=404,
                )
            if field.provenance_state != "conflicting_source_values":
                raise JobImportError(
                    "JOB_IMPORT_FIELD_NOT_CONFLICTING",
                    "This field does not contain conflicting source values.",
                    status_code=409,
                )

            policy = JOB_IMPORT_FIELD_POLICIES[field.field_path]
            selected_index = payload.selected_value_index
            if selected_index is not None:
                if selected_index >= len(field.conflicting_values):
                    raise JobImportError(
                        "JOB_IMPORT_CONFLICT_INDEX_INVALID",
                        "The selected conflicting value does not exist.",
                    )
                selected = field.conflicting_values[selected_index].get("value")
                normalized, errors = await self._validate_field_value(
                    policy,
                    selected,
                )
                review_status = "confirmed"
                confirmed_value = normalized
                edited_value = None
            else:
                normalized, errors = await self._validate_field_value(
                    policy,
                    payload.replacement_value,
                )
                review_status = "edited"
                confirmed_value = None
                edited_value = normalized
            if errors:
                raise JobImportError(
                    "JOB_IMPORT_FIELD_INVALID",
                    "The selected conflict resolution is invalid.",
                    details={"errors": errors},
                )
            await self.repository.update_field(
                field,
                {
                    "review_status": review_status,
                    "confirmed_value": confirmed_value,
                    "edited_value": edited_value,
                    "selected_conflict_index": selected_index,
                    "validation_errors": [],
                    "reviewed_by_user_id": owner_user_id,
                    "reviewed_at": datetime.now(UTC),
                },
            )
            await self._refresh_draft_state(draft, owner_user_id=owner_user_id)
            await self.repository.update_draft(
                draft,
                {"mutation_claim_token": None},
            )
            await self.repository.session.commit()
            return draft
        except Exception:
            await self.repository.session.rollback()
            raise

    async def discard_draft(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        claim_token = uuid4()
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            claim_token,
            allowed_statuses={
                "awaiting_processing",
                "processing",
                "processing_failed",
                "awaiting_recruiter_review",
                "partially_reviewed",
                "ready_to_apply",
            },
        )
        if draft is None:
            existing = await self.repository.get_draft_for_owner(
                draft_id,
                owner_user_id,
            )
            if existing is None:
                raise JobImportError(
                    "JOB_IMPORT_DRAFT_NOT_FOUND",
                    "Import draft not found.",
                    status_code=404,
                )
            if existing.processing_status == "discarded":
                return existing
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "This import draft cannot be discarded from its current state.",
                status_code=409,
            )
        try:
            await self.repository.update_draft(
                draft,
                {
                    "processing_status": "discarded",
                    "discarded_at": datetime.now(UTC),
                    "can_apply_to_native_draft": False,
                    "can_publish_directly": False,
                    "mutation_claim_token": None,
                },
            )
            await self.repository.session.commit()
            return draft
        except Exception:
            await self.repository.session.rollback()
            raise

    async def delete_draft(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> None:
        existing = await self.repository.get_draft_for_owner(
            draft_id,
            owner_user_id,
            include_deleted=True,
        )
        if existing is None:
            raise JobImportError(
                "JOB_IMPORT_DRAFT_NOT_FOUND",
                "Import draft not found.",
                status_code=404,
            )
        if existing.deleted_at is not None:
            return
        claim_token = uuid4()
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            claim_token,
        )
        if draft is None:
            raise JobImportError(
                "JOB_IMPORT_CONCURRENT_MUTATION",
                "This import draft is being changed by another request. Retry the deletion.",
                status_code=409,
            )
        try:
            await self.repository.delete_fields(draft.id)
            now = datetime.now(UTC)
            await self.repository.update_draft(
                draft,
                {
                    "processing_status": (
                        draft.processing_status
                        if draft.processing_status == "applied_to_native_draft"
                        else "discarded"
                    ),
                    "validation_status": "not_validated",
                    "confirmation_state": "unreviewed",
                    "can_apply_to_native_draft": False,
                    "can_publish_directly": False,
                    "provider_metadata": None,
                    "machine_output": None,
                    "processing_warnings": [],
                    "missing_fields": [],
                    "validation_errors": {},
                    "review_sections": [],
                    "discarded_at": draft.discarded_at or now,
                    "deleted_at": now,
                    "mutation_claim_token": None,
                },
            )
            await self.repository.session.commit()
        except Exception:
            await self.repository.session.rollback()
            raise

    async def apply_to_native_draft(
        self,
        draft_id: UUID,
        payload: JobImportApplyRequest,
        *,
        owner_user_id: UUID,
    ) -> tuple[JobImportDraft, Job, bool]:
        del payload  # create_new is the only accepted mode in this phase.
        claim_token = uuid4()
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            claim_token,
            allowed_statuses={"ready_to_apply"},
            require_target_unset=True,
        )
        if draft is None:
            existing = await self.repository.get_draft_for_owner(
                draft_id,
                owner_user_id,
            )
            if existing is None:
                raise JobImportError(
                    "JOB_IMPORT_DRAFT_NOT_FOUND",
                    "Import draft not found.",
                    status_code=404,
                )
            if existing.target_job_id is not None:
                try:
                    job = await self.job_service.get_job_internal(existing.target_job_id)
                except JobNotFoundError as exc:
                    raise JobImportError(
                        "JOB_IMPORT_TARGET_JOB_NOT_FOUND",
                        "The native job linked to this import draft no longer exists.",
                        status_code=409,
                    ) from exc
                if job.posted_by_user_id != owner_user_id:
                    raise JobImportError(
                        "JOB_IMPORT_TARGET_OWNERSHIP_MISMATCH",
                        "The native job linked to this import draft is not owned by the recruiter.",
                        status_code=409,
                    )
                return existing, job, False
            raise JobImportError(
                "JOB_IMPORT_DRAFT_NOT_READY",
                "Resolve or review the remaining import fields before creating a native draft.",
                status_code=409,
                details={
                    "validation_errors": existing.validation_errors,
                    "review_sections": existing.review_sections,
                },
            )
        try:
            source = await self.repository.get_source_for_owner(
                draft.source_id,
                owner_user_id,
            )
            if source is None:
                raise JobImportError(
                    "JOB_IMPORT_SOURCE_REDACTED",
                    "A deleted source cannot be applied to a native job draft.",
                    status_code=409,
                )
            fields = await self.repository.list_fields(draft.id)
            native_payload = await self._effective_native_payload(fields)
            job_payload, native_errors = await self._native_validation(
                native_payload,
                owner_user_id=owner_user_id,
                status="draft",
            )
            if job_payload is None or native_errors:
                raise JobImportError(
                    "JOB_IMPORT_NATIVE_DRAFT_VALIDATION_FAILED",
                    "Confirmed import values do not form a valid native job draft.",
                    details={"field_errors": native_errors},
                )
            job = await self.job_service.create_job(
                job_payload,
                actor_user_id=owner_user_id,
                commit_transaction=False,
            )
            await self.repository.update_draft(
                draft,
                {
                    "target_job_id": job.id,
                    "processing_status": "applied_to_native_draft",
                    "applied_at": datetime.now(UTC),
                    "can_apply_to_native_draft": False,
                    "can_publish_directly": False,
                    "mutation_claim_token": None,
                },
            )
            await self.repository.session.commit()
            return draft, job, True
        except JobImportError:
            await self.repository.session.rollback()
            raise
        except ValidationError as exc:
            await self.repository.session.rollback()
            raise JobImportError(
                "JOB_IMPORT_NATIVE_DRAFT_VALIDATION_FAILED",
                "Confirmed import values do not form a valid native job draft.",
                details={"field_errors": self._pydantic_errors(exc)},
            ) from exc
        except (JobValidationError, JobForbiddenError) as exc:
            await self.repository.session.rollback()
            details = (
                {"field_errors": exc.field_errors}
                if isinstance(exc, JobValidationError)
                else {"field_errors": {"owner": [str(exc)]}}
            )
            raise JobImportError(
                "JOB_IMPORT_NATIVE_DRAFT_VALIDATION_FAILED",
                "The native job service rejected the confirmed import values.",
                details=details,
            ) from exc
        except (
            JobAuthRequiredError,
            JobVerificationRequiredError,
            JobNotFoundError,
        ) as exc:
            await self.repository.session.rollback()
            raise JobImportError(
                "JOB_IMPORT_NATIVE_DRAFT_CREATION_FAILED",
                "The native job draft could not be created.",
                status_code=409,
            ) from exc
        except Exception:
            await self.repository.session.rollback()
            raise

    async def attach_to_native_job(
        self,
        draft_id: UUID,
        target_job_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> tuple[JobImportDraft, Job, bool]:
        """Retain import context after the normal job API saved a partial import.

        This operation never creates, updates, validates, or publishes a job. It
        only links an existing owned canonical job to its existing owned import
        draft so provenance survives refresh and reopening.
        """

        claim_token = uuid4()
        draft = await self.repository.claim_draft_mutation(
            draft_id,
            owner_user_id,
            claim_token,
            allowed_statuses={
                "processing_failed",
                "awaiting_recruiter_review",
                "partially_reviewed",
                "ready_to_apply",
            },
            require_target_unset=True,
        )
        if draft is None:
            existing = await self.repository.get_draft_for_owner(draft_id, owner_user_id)
            if existing is None:
                raise JobImportError(
                    "JOB_IMPORT_DRAFT_NOT_FOUND",
                    "Import draft not found.",
                    status_code=404,
                )
            if existing.target_job_id == target_job_id:
                try:
                    job = await self.job_service.get_job_internal(target_job_id)
                except JobNotFoundError as exc:
                    raise JobImportError(
                        "JOB_IMPORT_TARGET_JOB_NOT_FOUND",
                        "The linked canonical job no longer exists.",
                        status_code=409,
                    ) from exc
                if job.posted_by_user_id != owner_user_id or job.deleted_at is not None:
                    raise JobImportError(
                        "JOB_IMPORT_TARGET_JOB_NOT_FOUND",
                        "The linked canonical job no longer exists.",
                        status_code=404,
                    )
                return existing, job, False
            raise JobImportError(
                "JOB_IMPORT_DRAFT_NOT_ATTACHABLE",
                "This import draft cannot be attached to that job.",
                status_code=409,
            )

        try:
            try:
                job = await self.job_service.get_job_internal(target_job_id)
            except JobNotFoundError as exc:
                raise JobImportError(
                    "JOB_IMPORT_TARGET_JOB_NOT_FOUND",
                    "The canonical job was not found.",
                    status_code=404,
                ) from exc
            if job.posted_by_user_id != owner_user_id or job.deleted_at is not None:
                raise JobImportError(
                    "JOB_IMPORT_TARGET_JOB_NOT_FOUND",
                    "The canonical job was not found.",
                    status_code=404,
                )
            target_draft = await self.repository.get_draft_by_target_job(
                target_job_id,
                owner_user_id,
            )
            if target_draft is not None and target_draft.id != draft.id:
                raise JobImportError(
                    "JOB_IMPORT_TARGET_ALREADY_LINKED",
                    "That job already has import context.",
                    status_code=409,
                )
            await self.repository.update_draft(
                draft,
                {
                    "target_job_id": job.id,
                    "processing_status": "applied_to_native_draft",
                    "applied_at": datetime.now(UTC),
                    "can_apply_to_native_draft": False,
                    "can_publish_directly": False,
                    "mutation_claim_token": None,
                },
            )
            await self.repository.session.commit()
            return draft, job, True
        except JobImportError:
            await self.repository.session.rollback()
            raise
        except Exception:
            await self.repository.session.rollback()
            raise

    @staticmethod
    def _authority_state(field: JobImportField) -> str:
        if (
            field.review_status == "confirmed"
            and field.reviewed_by_user_id is None
            and not field.requires_confirmation
        ):
            return "prefilled_by_import"
        return {
            "confirmed": "confirmed_by_recruiter",
            "edited": "edited_by_recruiter",
            "rejected": "rejected_by_recruiter",
        }.get(field.review_status, "unconfirmed")

    @staticmethod
    def _decision_read(field: JobImportField) -> tuple[str, str | None, bool, str | None]:
        metadata = field.provider_confidence if isinstance(field.provider_confidence, dict) else {}
        origin = metadata.get("origin")
        if origin not in {
            "explicit",
            "contextual_inference",
            "semantic_inference",
            "suggestion",
            "unknown",
        }:
            origin = (
                "unknown"
                if field.provenance_state == "missing"
                else "suggestion"
                if field.provenance_state == "suggested_inference"
                else "explicit"
            )
        confidence = metadata.get("confidence")
        if confidence not in {"high", "medium", "low"}:
            confidence = None if origin == "unknown" else "high"
        rationale = metadata.get("rationale_code")
        if not isinstance(rationale, str) or not rationale:
            rationale = None
        raw_needs_review = metadata.get("needs_review")
        needs_review = (
            raw_needs_review
            if isinstance(raw_needs_review, bool)
            else bool(
                field.validation_errors
                or field.provenance_state in {"conflicting_source_values", "missing"}
                or field.review_status == "pending"
            )
        )
        return str(origin), confidence, needs_review, rationale

    @classmethod
    def _field_read(cls, field: JobImportField) -> JobImportFieldRead:
        origin, confidence, needs_review, rationale = cls._decision_read(field)
        return JobImportFieldRead(
            id=field.id,
            field_path=field.field_path,
            proposed_value=field.proposed_value,
            provenance_state=field.provenance_state,
            review_status=field.review_status,
            authority_state=cls._authority_state(field),
            decision_origin=origin,
            decision_confidence=confidence,
            needs_review=needs_review,
            rationale_code=rationale,
            evidence=field.evidence,
            conflicting_values=field.conflicting_values,
            explanation=field.explanation,
            provider_confidence=field.provider_confidence,
            confirmed_value=field.confirmed_value,
            edited_value=field.edited_value,
            effective_value=cls._effective_field_value(field),
            missing_requirement=field.missing_requirement,
            requires_confirmation=field.requires_confirmation,
            validation_errors=field.validation_errors,
            selected_conflict_index=field.selected_conflict_index,
            reviewed_at=field.reviewed_at,
            created_at=field.created_at,
            updated_at=field.updated_at,
        )

    async def draft_read(
        self,
        draft: JobImportDraft,
    ) -> JobImportDraftRead:
        fields = await self.repository.list_fields(draft.id)
        return JobImportDraftRead(
            id=draft.id,
            owner_user_id=draft.owner_user_id,
            source_id=draft.source_id,
            supersedes_draft_id=draft.supersedes_draft_id,
            extraction_schema_version=draft.extraction_schema_version,
            target_listing_schema_version=draft.target_listing_schema_version,
            processing_status=draft.processing_status,
            validation_status=draft.validation_status,
            confirmation_state=draft.confirmation_state,
            can_apply_to_native_draft=draft.can_apply_to_native_draft,
            can_publish_directly=draft.can_publish_directly,
            provider_name=draft.provider_name,
            model_name=draft.model_name,
            model_version=draft.model_version,
            instruction_version=draft.instruction_version,
            provider_metadata=draft.provider_metadata,
            processing_warnings=draft.processing_warnings,
            missing_fields=draft.missing_fields,
            validation_errors=draft.validation_errors,
            review_sections=draft.review_sections,
            target_job_id=draft.target_job_id,
            processed_at=draft.processed_at,
            applied_at=draft.applied_at,
            discarded_at=draft.discarded_at,
            created_at=draft.created_at,
            updated_at=draft.updated_at,
            fields=[self._field_read(field) for field in fields],
            recruiter_prefill=self._recruiter_prefill_values(draft),
        )

    @staticmethod
    def source_read(source: JobImportSource) -> JobImportSourceRead:
        return JobImportSourceRead.model_validate(source)
