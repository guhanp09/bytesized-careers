from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.job_application_classification import (
    REQUIREMENT_KEYS as APPLICATION_REQUIREMENT_KEYS,
)
from app.core.job_application_classification import (
    classify_application_instructions,
    sanitize_application_requirement_keys,
)
from app.core.job_application_instructions import separate_application_instructions
from app.core.job_apply_note import compose_public_apply_note
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
from app.core.job_import_application_signals import explicit_application_requirements
from app.core.job_import_attempt_liveness import assess_attempt
from app.core.job_import_body_sections import (
    entailed_work_mode_from_body,
    experience_from_body,
    normalize_leading_experience_requirement,
)
from app.core.job_import_candidate_copy import candidate_native_copy
from app.core.job_import_facts import outranks as fact_outranks
from app.core.job_import_inference import (
    confidence_at_least,
    infer_compensation_currency,
    provider_confidence_label,
)
from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_location_resolution import city_for_location, resolve_locations
from app.core.job_import_location_signals import JobCityResolution, resolve_job_city
from app.core.job_import_native_values import convert_to_native
from app.core.job_import_policy import (
    AUTO_TRACKED_MISSING_FIELDS,
    JOB_IMPORT_FIELD_POLICIES,
    LEGACY_COMPATIBILITY_IMPORT_FIELDS,
    SYSTEM_OWNED_IMPORT_FIELDS,
    JobImportFieldPolicy,
    import_field_policy,
    is_early_recruiter_question,
)
from app.core.job_import_screening_safety import safe_imported_screening_questions
from app.core.job_import_structured_fields import (
    fields_from_structured_context,
    structured_compensation_has_inverted_range,
)
from app.core.job_import_title_signals import title_signals
from app.core.job_import_weekly_hours import infer_weekly_hours
from app.core.job_taxonomy import (
    COMPENSATION_MODES,
    COMPENSATION_UNITS,
    CURRENT_LISTING_SCHEMA_VERSION,
    ENGAGEMENT_TYPES,
    TURNAROUND_BASES,
    TURNAROUND_UNITS,
    WORK_MODES,
)
from app.core.tool_catalog import TOOL_CATALOG, find_tool, find_tool_by_key
from app.models import Job, JobImportDraft, JobImportField, JobImportSource
from app.repositories.job_import_repository import JobImportRepository
from app.schemas.job import (
    JobCreate,
    JobUpdate,
    source_input_label_needs_sensitive_confirmation,
)
from app.schemas.job_import import (
    CURRENT_EXTRACTION_SCHEMA_VERSION,
    JobImportApplyRequest,
    JobImportConflict,
    JobImportConflictResolutionRequest,
    JobImportConflictValue,
    JobImportDraftInitialize,
    JobImportDraftRead,
    JobImportEvidence,
    JobImportExtractionField,
    JobImportExtractionRequest,
    JobImportExtractionResponse,
    JobImportFieldDefinition,
    JobImportFieldRead,
    JobImportFieldReviewRequest,
    JobImportMissingField,
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

logger = logging.getLogger(__name__)

_WORKPLACE_COMMUNITY_SIGNALS = (
    re.compile(r"\boffice\s+operations?\b", re.IGNORECASE),
    re.compile(r"\b(?:facilit(?:y|ies)|workplace\s+strategy)\b", re.IGNORECASE),
    re.compile(r"\b(?:supplies|vendors?|mail)\b", re.IGNORECASE),
    re.compile(r"\b(?:space\s+planning|seating|shared\s+spaces?)\b", re.IGNORECASE),
    re.compile(r"\b(?:visitors?|office\s+tours?|in[- ]office\s+five\s+days)\b", re.IGNORECASE),
)


def _is_workplace_community_role(source_text: str | None) -> bool:
    """Whether Community Manager clearly means running an office, not an audience."""

    if not source_text or not re.search(
        r"\bcommunity\s+manager\b", source_text, re.IGNORECASE
    ):
        return False
    return sum(bool(pattern.search(source_text)) for pattern in _WORKPLACE_COMMUNITY_SIGNALS) >= 2

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
    "ongoing_freelance": ("contractor", "freelance"),
    "fixed_term": ("contract", "temporary", "fixed term"),
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
        return await self._reclaim_if_abandoned(draft, owner_user_id=owner_user_id)

    async def _reclaim_if_abandoned(
        self,
        draft: JobImportDraft,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        """Settle a ``processing`` draft whose attempt can no longer be running.

        The deliberate failure paths all write a truthful status, and none of
        them survives the process dying mid-extraction. What is left is a row
        claiming work is in progress with nothing anywhere that will finish it —
        so every later read reports processing, and the screen waits on it
        forever because waiting is the correct response to that status.

        Reading is where it gets noticed, so reading is where it gets settled.
        """

        settings = get_settings()
        liveness = assess_attempt(
            processing_status=draft.processing_status,
            provider_metadata=draft.provider_metadata,
            request_timeout_seconds=settings.openai_request_timeout_seconds,
            max_retries=settings.openai_max_retries,
        )
        if not liveness.abandoned:
            return draft

        logger.warning(
            "job_import.attempt_abandoned",
            extra={
                "draft_id": str(draft.id),
                "age_seconds": liveness.age_seconds,
                "budget_seconds": liveness.budget_seconds,
            },
        )
        try:
            return await self.mark_processing_failed(
                draft.id,
                owner_user_id=owner_user_id,
                error_code="JOB_IMPORT_PROCESSING_ABANDONED",
                message="Draft preparation stopped before it finished.",
            )
        except JobImportError:
            # A concurrent attempt claimed the draft between the assessment and
            # the write. That attempt is live and owns the outcome, so the row
            # is left exactly as it is rather than failed out from under it.
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
            "application_requirement_keys": list(APPLICATION_REQUIREMENT_KEYS),
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
            if policy.allowed_origins - {"explicit"}:
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
                "Use suggested_inference provenance only when the field's allowed_decision_origins permits the matching contextual_inference, semantic_inference, or suggestion origin.",
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

        if policy.field_path == "experience_level" and isinstance(value, str):
            compact_experience = normalize_leading_experience_requirement(value)
            if compact_experience is not None:
                value = compact_experience

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
    def _pending_sensitive_source_inputs(
        value: object,
    ) -> list[dict[str, object]] | None:
        """Validate an explicit access request without fabricating consent.

        The native ``JobSourceInput`` correctly refuses account access until a
        recruiter confirms it. That same rule cannot make an explicit source
        fact disappear during import review. For a provider-extracted source
        row, validate the row *as if* consent were present, then deliberately
        store it with consent false so the conversation can ask exactly once.
        This helper is never used for native job writes.
        """

        if not isinstance(value, list) or not value:
            return None
        validation_rows: list[dict[str, object]] = []
        sensitive_indexes: set[int] = set()
        for index, item in enumerate(value):
            if not isinstance(item, dict):
                return None
            item_type = item.get("type")
            if not isinstance(item_type, str) or item_type not in SOURCE_INPUT_TYPES:
                return None
            custom_label = item.get("custom_label")
            custom_sensitive = bool(
                item_type == "other"
                and isinstance(custom_label, str)
                and source_input_label_needs_sensitive_confirmation(custom_label)
            )
            is_sensitive = item_type in {"analytics_access", "account_access"} or custom_sensitive
            row = dict(item)
            if is_sensitive:
                row["sensitive_access_confirmed"] = True
                sensitive_indexes.add(index)
            validation_rows.append(row)
        if not sensitive_indexes:
            return None
        try:
            validated = JobUpdate.model_validate({"source_inputs": validation_rows})
        except (ValidationError, ValueError, TypeError):
            return None
        normalized = validated.model_dump(mode="json", exclude_unset=True)["source_inputs"]
        if not isinstance(normalized, list):
            return None
        pending: list[dict[str, object]] = []
        for index, item in enumerate(normalized):
            if not isinstance(item, dict):
                return None
            row = dict(item)
            if index in sensitive_indexes:
                row["sensitive_access_confirmed"] = False
            pending.append(row)
        return pending

    @staticmethod
    def _provider_screening_questions(
        value: object,
        evidence: list[JobImportEvidence],
    ) -> object:
        """Keep requiredness only when that question's own evidence says so."""

        if not isinstance(value, list):
            return value

        def requiredness_is_explicit(prompt: object) -> bool:
            if not isinstance(prompt, str) or not prompt.strip():
                return False
            needle = " ".join(prompt.split()).casefold()
            for item in evidence:
                snippet = " ".join(item.snippet.split())
                folded = snippet.casefold()
                start = folded.find(needle)
                if start < 0:
                    continue
                left_boundaries = [folded.rfind(mark, 0, start) for mark in ".!?;\n"]
                clause_start = max(left_boundaries) + 1
                after = start + len(needle)
                right_boundaries = [
                    index
                    for mark in ".!?;\n"
                    if (index := folded.find(mark, after)) >= 0
                ]
                clause_end = min(right_boundaries) + 1 if right_boundaries else len(folded)
                clause = folded[clause_start:clause_end]
                if re.search(
                    r"\b(?:required|mandatory|must\s+(?:answer|complete|provide|respond))\b",
                    clause,
                ):
                    return True
            return False

        return [
            {
                **item,
                "required": bool(item.get("required"))
                and requiredness_is_explicit(item.get("prompt")),
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

    @staticmethod
    def _exact_source_evidence(
        source: JobImportSource,
        snippets: list[str],
    ) -> list[JobImportEvidence]:
        """Evidence rows for exact source lines, never reconstructed prose."""

        source_text = source.original_text or ""
        evidence: list[JobImportEvidence] = []
        for snippet in dict.fromkeys(item.strip() for item in snippets if item.strip()):
            start = source_text.find(snippet)
            if start < 0:
                continue
            evidence.append(
                JobImportEvidence.model_validate(
                    {
                        "snippet": snippet,
                        "location": {
                            "char_start": start,
                            "char_end": start + len(snippet),
                        },
                    }
                )
            )
            if len(evidence) >= 5:
                break
        return evidence

    @classmethod
    def _with_deterministic_context(
        cls,
        response: JobImportExtractionResponse,
        source: JobImportSource,
        *,
        allowed_role_keys: set[str] | frozenset[str] | None = None,
    ) -> JobImportExtractionResponse:
        """Add only server-owned, policy-approved contextual decisions."""

        weekly_hours = infer_weekly_hours(source.original_text)
        weekly_hour_paths = {
            "expected_weekly_hours_min",
            "expected_weekly_hours_max",
        }
        # Numeric hours suggested from general wording such as "full-time" are
        # not source facts. Only this server-owned exact-schedule parser may
        # introduce an inferred weekly total.
        removed_unsupported_hours = any(
            field.field_path in weekly_hour_paths
            and field.provenance == "suggested_inference"
            for field in response.fields
        )
        fields = [
            field
            for field in response.fields
            if not (
                field.field_path in weekly_hour_paths
                and field.provenance == "suggested_inference"
            )
        ]
        workplace_community_role = _is_workplace_community_role(source.original_text)
        removed_automatic_other_role = any(
            field.field_path == "primary_role_key"
            and field.value == "other-creator-role"
            and field.provenance == "suggested_inference"
            for field in fields
        )
        removed_workplace_community_role = any(
            field.field_path == "primary_role_key"
            and field.value == "community-manager"
            and field.provenance == "suggested_inference"
            and workplace_community_role
            for field in fields
        )
        if removed_automatic_other_role or removed_workplace_community_role:
            # ``Other Creator Role`` is the recruiter's escape hatch, not a
            # catch-all classifier. A live non-creator control (Backend
            # Engineer) was otherwise filed in the creator marketplace merely
            # because the provider could not find a more specific role key.
            # Exact supported creator titles are still resolved below; an
            # unsupported title remains honestly unclassified for the editor.
            fields = [
                field
                for field in fields
                if not (
                    field.field_path == "primary_role_key"
                    and field.provenance == "suggested_inference"
                    and (
                        field.value == "other-creator-role"
                        or (
                            field.value == "community-manager"
                            and workplace_community_role
                        )
                    )
                )
            ]
        conflicts = list(response.conflicts)
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
        try:
            structured_values = fields_from_structured_context(context)
        except Exception:  # pragma: no cover - context enrichment is best effort
            structured_values = {}
        if work_mode is None:
            structured_work_mode = structured_values.get("work_mode")
            work_mode = (
                structured_work_mode
                if isinstance(structured_work_mode, str)
                else None
            )
        missing_fields = list(response.missing_fields)
        warnings = list(response.warnings)

        # A tenure line under "preferred" is not a minimum candidates must
        # already have. A live extraction promoted a clearly labelled preferred
        # 3+ years into the candidate experience filter, changing who would
        # self-select for the job. The fetcher has already separated required
        # and preferred qualification sections, so use that owned structure to
        # prevent the provider from escalating authority.
        preferred_qualifications = context.get("preferred_qualifications")
        required_qualifications = context.get("qualifications")

        def experience_signatures(value: object) -> set[str]:
            values = value if isinstance(value, list) else [value]
            signatures: set[str] = set()
            for raw in values:
                if not isinstance(raw, str):
                    continue
                normalized = normalize_leading_experience_requirement(raw)
                if normalized is not None:
                    signatures.add(normalized.casefold())
            return signatures

        experience_field = by_path.get("experience_level")
        provider_experience_signatures = experience_signatures(
            experience_field.value if experience_field is not None else None
        )
        preferred_experience_signatures = experience_signatures(
            preferred_qualifications
        )
        required_experience_signatures = experience_signatures(
            required_qualifications
        )
        preferred_only_experience = bool(
            experience_field is not None
            and provider_experience_signatures
            and provider_experience_signatures <= preferred_experience_signatures
            and provider_experience_signatures.isdisjoint(required_experience_signatures)
            and not isinstance(context.get("experience_requirement"), str)
            and not context.get("experience_requirement_conflicts")
        )
        if preferred_only_experience and experience_field is not None:
            fields = [item for item in fields if item is not experience_field]
            by_path.pop("experience_level", None)
            occupied_paths.discard("experience_level")
            missing_fields = [
                item
                for item in missing_fields
                if item.field_path != "experience_level"
            ]
            missing_fields.append(
                JobImportMissingField(
                    field_path="experience_level",
                    explanation=(
                        "The source states numeric tenure only as a preferred "
                        "qualification, not a candidate requirement."
                    ),
                    epistemic_status="absent",
                )
            )
            if len(warnings) < 30:
                warnings.append(
                    JobImportProcessingWarning(
                        code="preferred_experience_not_promoted",
                        message=(
                            "Preferred tenure was kept out of the required "
                            "candidate experience field."
                        ),
                        field_path="experience_level",
                    )
                )
        if removed_automatic_other_role or removed_workplace_community_role:
            missing_fields = [
                item for item in missing_fields if item.field_path != "primary_role_key"
            ]
            missing_fields.append(
                JobImportMissingField(
                    field_path="primary_role_key",
                    explanation=(
                        "The source title does not establish a supported creator role."
                    ),
                    epistemic_status="absent",
                )
            )
            if len(warnings) < 30:
                warnings.append(
                    JobImportProcessingWarning(
                        code=(
                            "automatic_other_creator_role_removed"
                            if removed_automatic_other_role
                            else "workplace_community_role_inference_removed"
                        ),
                        message=(
                            "An unsupported automatic creator-role inference was "
                            "removed; the recruiter may classify it in the editor."
                        ),
                        field_path="primary_role_key",
                    )
                )
        if removed_unsupported_hours and len(warnings) < 30:
            warnings.append(
                JobImportProcessingWarning(
                    code="unsupported_weekly_hours_inference_removed",
                    message=(
                        "Provider-inferred weekly hours were removed; only an exact "
                        "server-verified daily schedule may set them."
                    ),
                    field_path="expected_weekly_hours_min",
                )
            )

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

        # A five-day in-office requirement is not a low-confidence semantic
        # guess: it entails onsite work. A live page stated that exact schedule,
        # but the provider attached a low confidence label and Bea asked the
        # recruiter whether the role might be remote. Upgrade only the same
        # value (or a true omission) from exact source text; a disagreeing
        # explicit source reading remains untouched for conflict handling.
        entailed_work_mode = entailed_work_mode_from_body(source.original_text)
        if entailed_work_mode is not None:
            work_mode_evidence = cls._exact_source_evidence(
                source,
                [entailed_work_mode.evidence],
            )
            existing_work_mode = by_path.get("work_mode")
            grounded_work_mode = JobImportExtractionField(
                field_path="work_mode",
                value=entailed_work_mode.value,
                provenance="suggested_inference",
                evidence=work_mode_evidence,
                explanation=(
                    "The source requires a full five-day office week, which "
                    "entails onsite work."
                ),
                provider_confidence=JobImportProviderConfidence(
                    score=1,
                    label="high",
                    metadata={
                        "origin": "contextual_inference",
                        "rationale_code": "onsite_from_full_office_week",
                    },
                ),
                epistemic_status="logically_entailed",
                inference_type="full_week_office_requirement",
            )
            if work_mode_evidence and existing_work_mode is None:
                append_context_field(grounded_work_mode)
            elif (
                work_mode_evidence
                and existing_work_mode is not None
                and existing_work_mode.provenance == "suggested_inference"
                and existing_work_mode.value == entailed_work_mode.value
            ):
                field_index = next(
                    index
                    for index, item in enumerate(fields)
                    if item is existing_work_mode
                )
                fields[field_index] = grounded_work_mode
                by_path["work_mode"] = grounded_work_mode
                missing_fields = [
                    item
                    for item in missing_fields
                    if item.field_path != "work_mode"
                ]

        def force_context_conflict(
            field_path: str,
            alternatives: list[tuple[object, list[JobImportEvidence]]],
            *,
            explanation: str,
        ) -> None:
            """Replace a model choice with explicit structured disagreement."""

            nonlocal missing_fields
            valid = [(value, evidence) for value, evidence in alternatives if evidence]
            serialized = {
                json.dumps(value, ensure_ascii=False, sort_keys=True) for value, _ in valid
            }
            if len(serialized) < 2:
                return
            existing = by_path.pop(field_path, None)
            if existing is not None:
                fields[:] = [item for item in fields if item is not existing]
            conflicts[:] = [item for item in conflicts if item.field_path != field_path]
            conflicts.append(
                JobImportConflict(
                    field_path=field_path,
                    values=[
                        JobImportConflictValue(value=value, evidence=evidence[:5])
                        for value, evidence in valid[:8]
                    ],
                    explanation=explanation,
                    epistemic_status="conflicting",
                )
            )
            occupied_paths.add(field_path)
            missing_fields = [
                item for item in missing_fields if item.field_path != field_path
            ]

        def upgrade_exact_context_match(
            field_path: str,
            expected_value: object,
            *,
            evidence: list[JobImportEvidence],
            origin: str,
            rationale_code: str,
            explanation: str,
            epistemic_status: str,
            inference_type: str,
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
                    "epistemic_status": epistemic_status,
                    "inference_type": inference_type,
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
            epistemic_status: str | None = None,
            inference_type: str | None = None,
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
                epistemic_status=epistemic_status,
                inference_type=inference_type,
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

        structured_employment_claim = context.get("employment_type")
        employment_matches = sorted(
            _structured_engagement_matches(structured_employment_claim)
        )
        if len(employment_matches) > 1:
            employment_values = (
                [structured_employment_claim]
                if isinstance(structured_employment_claim, str)
                else [
                    item
                    for item in structured_employment_claim or []
                    if isinstance(item, str)
                ]
                if isinstance(structured_employment_claim, list)
                else []
            )
            evidence = [
                item
                for value in employment_values[:5]
                for item in cls._structured_source_evidence(
                    source,
                    label="Structured employment type",
                    value=value,
                )
            ][:5]
            force_context_conflict(
                "engagement_type",
                [(value, evidence) for value in employment_matches],
                explanation=(
                    "The page declares multiple incompatible structured employment types."
                ),
            )

        experience_conflicts = context.get("experience_requirement_conflicts")
        if isinstance(experience_conflicts, list):
            alternatives: list[tuple[object, list[JobImportEvidence]]] = []
            for value in experience_conflicts[:8]:
                if not isinstance(value, str) or not value.strip():
                    continue
                evidence = cls._structured_source_evidence(
                    source,
                    label="Structured conflicting experience requirement",
                    value=value,
                )
                alternatives.append((value, evidence))
            force_context_conflict(
                "experience_level",
                alternatives,
                explanation=(
                    "The source states multiple incompatible experience requirements."
                ),
            )

        role_locations = context.get("role_locations")
        if isinstance(role_locations, list) and work_mode in {"onsite", "hybrid"}:
            alternatives = []
            seen_locations: set[str] = set()
            for raw_location in role_locations[:8]:
                if not isinstance(raw_location, str):
                    continue
                city = city_for_location(raw_location)
                if not city or city.casefold() in seen_locations:
                    continue
                seen_locations.add(city.casefold())
                alternatives.append(
                    (
                        city,
                        cls._structured_source_evidence(
                            source,
                            label="Structured role location",
                            value=raw_location,
                        ),
                    )
                )
            force_context_conflict(
                "location",
                alternatives,
                explanation="The page declares multiple distinct role locations.",
            )

        if weekly_hours is not None:
            evidence = cls._exact_source_evidence(
                source,
                list(weekly_hours.evidence_snippets),
            )
            if evidence:
                explanation = (
                    f"The source states {weekly_hours.days_per_week} days per week "
                    f"and {weekly_hours.hours_per_day} hours per day, which equals "
                    f"{weekly_hours.weekly_hours} hours per week."
                )
                for field_path in (
                    "expected_weekly_hours_min",
                    "expected_weekly_hours_max",
                ):
                    append_context_field(
                        JobImportExtractionField(
                            field_path=field_path,
                            value=weekly_hours.weekly_hours,
                            provenance="suggested_inference",
                            evidence=evidence,
                            explanation=explanation,
                            provider_confidence=JobImportProviderConfidence(
                                score=1,
                                label="high",
                                metadata={
                                    "origin": "contextual_inference",
                                    "rationale_code": (
                                        "weekly_hours_from_explicit_schedule"
                                    ),
                                    "days_per_week": weekly_hours.days_per_week,
                                    "hours_per_day": weekly_hours.hours_per_day,
                                },
                            ),
                            epistemic_status="logically_entailed",
                            inference_type="schedule_arithmetic",
                        )
                    )

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
                and not (
                    role_key == "community-manager" and workplace_community_role
                )
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
                        origin="contextual_inference",
                        rationale_code="structured_title_role_normalized",
                        epistemic_status="logically_entailed",
                        inference_type="role_title_entailment",
                    )
                )
                if not repaired_role and not upgrade_exact_context_match(
                    "primary_role_key",
                    role_key,
                    evidence=title_evidence,
                    origin="contextual_inference",
                    rationale_code="structured_title_single_role",
                    explanation=role_explanation,
                    epistemic_status="logically_entailed",
                    inference_type="role_title_entailment",
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
                                    "origin": "contextual_inference",
                                    "rationale_code": "structured_title_single_role",
                                },
                            ),
                            epistemic_status="logically_entailed",
                            inference_type="role_title_entailment",
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
                        origin="contextual_inference",
                        rationale_code="structured_employment_type_normalized",
                        epistemic_status="logically_entailed",
                        inference_type="structured_employment_mapping",
                    )
                )
                if not repaired_engagement and not upgrade_exact_context_match(
                    "engagement_type",
                    engagement_type,
                    evidence=evidence,
                    origin="contextual_inference",
                    rationale_code="structured_employment_type",
                    explanation=engagement_explanation,
                    epistemic_status="logically_entailed",
                    inference_type="structured_employment_mapping",
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
                                    "origin": "contextual_inference",
                                    "rationale_code": "structured_employment_type",
                                },
                            ),
                            epistemic_status="logically_entailed",
                            inference_type="structured_employment_mapping",
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

        def merge_structured_list_field(
            field_path: str,
            values: list[str],
            evidence: list[JobImportEvidence],
            *,
            rationale_code: str,
        ) -> None:
            """Retain provider items and append exact structured omissions.

            A provider returning the first of three source bullets used to block
            the other two wholesale because the field path was occupied.  The
            structured list is publisher-owned evidence, so exact missing items
            are merged without deleting a provider interpretation or a conflict.
            """

            if not values or not evidence or field_path in {
                conflict.field_path for conflict in response.conflicts
            }:
                return
            existing = by_path.get(field_path)
            if existing is None:
                append_context_field(
                    JobImportExtractionField(
                        field_path=field_path,
                        value=values,
                        provenance="extracted_from_source",
                        evidence=evidence,
                    )
                )
                return
            if not _valid_import_string_list(existing.value):
                replace_invalid_context_field(
                    field_path,
                    values,
                    provenance="extracted_from_source",
                    evidence=evidence,
                    rationale_code=rationale_code,
                )
                return

            existing_values = [str(item).strip() for item in existing.value]
            merged = list(existing_values)
            seen = {item.casefold() for item in merged}
            for value in values:
                if value.casefold() not in seen:
                    merged.append(value)
                    seen.add(value.casefold())
            source_keys = {item.casefold() for item in values}
            all_existing_are_exact = all(
                item.casefold() in source_keys for item in existing_values
            )
            needs_upgrade = (
                merged != existing_values
                or (
                    all_existing_are_exact
                    and existing.provenance == "suggested_inference"
                )
            )
            if not needs_upgrade:
                return
            merged_evidence = [*existing.evidence]
            for item in evidence:
                if item not in merged_evidence:
                    merged_evidence.append(item)
                if len(merged_evidence) >= 5:
                    break
            update: dict[str, object] = {
                "value": merged,
                "evidence": merged_evidence[:5],
            }
            if all_existing_are_exact:
                update.update(
                    {
                        "provenance": "extracted_from_source",
                        "provider_confidence": None,
                        "epistemic_status": "normalized_explicit",
                        "inference_type": "structured_list_normalization",
                        "explanation": None,
                    }
                )
            upgraded = existing.model_copy(update=update)
            field_index = next(index for index, item in enumerate(fields) if item is existing)
            fields[field_index] = upgraded
            by_path[field_path] = upgraded
            missing_fields[:] = [
                item for item in missing_fields if item.field_path != field_path
            ]

        responsibilities, responsibility_evidence = grounded_structured_list(
            "responsibilities",
            label="Structured responsibility",
        )
        merge_structured_list_field(
            "responsibilities",
            responsibilities,
            responsibility_evidence,
            rationale_code="structured_responsibilities_repaired",
        )

        requirements, requirement_evidence = grounded_structured_list(
            "qualifications",
            label="Structured qualification",
        )
        merge_structured_list_field(
            "requirements",
            requirements,
            requirement_evidence,
            rationale_code="structured_requirements_repaired",
        )

        preferred, preferred_evidence = grounded_structured_list(
            "preferred_qualifications",
            label="Structured preferred qualification",
        )
        preferred = [item for item in preferred if len(item) <= 120]
        merge_structured_list_field(
            "other_preferred_skills",
            preferred,
            preferred_evidence,
            rationale_code="structured_preferred_qualifications_repaired",
        )

        structured_skills = context.get("skills")
        if isinstance(structured_skills, str):
            tool_keys: list[str] = []
            for token in re.split(r"[,;|]+", structured_skills):
                entry = find_tool(token)
                if entry is not None and entry.key not in tool_keys:
                    tool_keys.append(entry.key)
            tool_evidence = cls._structured_source_evidence(
                source,
                label="Structured skills",
                value=structured_skills,
            )
            merge_structured_list_field(
                "required_tool_keys",
                tool_keys,
                tool_evidence,
                rationale_code="structured_skill_tool_aliases_repaired",
            )

        exact_structured_sources: dict[str, tuple[str, object]] = {}
        compensation_source = context.get("compensation")
        if isinstance(compensation_source, str):
            for field_path in (
                "compensation_mode",
                "budget_amount",
                "budget_max",
                "budget_currency",
                "budget_unit",
            ):
                if field_path in structured_values:
                    exact_structured_sources[field_path] = (
                        "Structured compensation",
                        compensation_source,
                    )
        work_hours_source = context.get("work_hours")
        if isinstance(work_hours_source, str):
            for field_path in (
                "expected_weekly_hours_min",
                "expected_weekly_hours_max",
            ):
                if field_path in structured_values:
                    exact_structured_sources[field_path] = (
                        "Structured work hours",
                        work_hours_source,
                    )
        deadline_source = context.get("valid_through")
        if isinstance(deadline_source, str) and "deadline_at" in structured_values:
            exact_structured_sources["deadline_at"] = (
                "Structured application valid through",
                deadline_source,
            )
        start_source = context.get("job_start_date")
        if isinstance(start_source, str):
            for field_path in ("start_timing", "start_date"):
                if field_path in structured_values:
                    exact_structured_sources[field_path] = (
                        "Structured job start date",
                        start_source,
                    )

        response_conflict_paths = {item.field_path for item in conflicts}
        for field_path, (label, source_value) in exact_structured_sources.items():
            if field_path in response_conflict_paths:
                continue
            evidence = cls._structured_source_evidence(
                source,
                label=label,
                value=source_value,
            )
            if not evidence:
                continue
            value = structured_values[field_path]
            if field_path in by_path:
                replace_invalid_context_field(
                    field_path,
                    value,
                    provenance="extracted_from_source",
                    evidence=evidence,
                    rationale_code=f"structured_{field_path}_authoritative",
                    epistemic_status="normalized_explicit",
                    inference_type="structured_value_normalization",
                )
            else:
                append_context_field(
                    JobImportExtractionField(
                        field_path=field_path,
                        value=value,
                        provenance="extracted_from_source",
                        evidence=evidence,
                        epistemic_status="normalized_explicit",
                        inference_type="structured_value_normalization",
                    )
                )

        if (
            isinstance(compensation_source, str)
            and structured_compensation_has_inverted_range(compensation_source)
        ):
            for field_path in ("budget_amount", "budget_max"):
                existing = by_path.pop(field_path, None)
                if existing is not None:
                    fields[:] = [item for item in fields if item is not existing]
                occupied_paths.discard(field_path)
            if len(warnings) < 30:
                warnings.append(
                    JobImportProcessingWarning(
                        code="structured_compensation_range_inverted",
                        message=(
                            "The source states a compensation range whose lower bound "
                            "exceeds its upper bound; numeric values require review."
                        ),
                        field_path="budget_amount",
                        evidence=cls._structured_source_evidence(
                            source,
                            label="Structured compensation",
                            value=compensation_source,
                        )[:3],
                    )
                )

        structured_summary = structured_values.get("about_channel")
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

        structured_location = structured_values.get("location")
        if isinstance(structured_location, str):
            location_context_key = (
                "remote_eligibility" if work_mode == "remote" else "role_location"
            )
            structured_location_source = context.get(location_context_key)
            evidence = cls._structured_source_evidence(
                source,
                label=(
                    "Structured remote eligibility"
                    if work_mode == "remote"
                    else "Structured role location"
                ),
                value=(
                    structured_location_source
                    if isinstance(structured_location_source, str)
                    else structured_location
                ),
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
                        structured_location,
                        provenance="extracted_from_source",
                        evidence=evidence,
                        rationale_code="structured_role_location_repaired",
                    )
                )
                if not repaired_location:
                    append_context_field(
                        JobImportExtractionField(
                            field_path="location",
                            value=structured_location,
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
                        origin="semantic_inference",
                        rationale_code="structured_industry_niche_normalized",
                        epistemic_status="plausible_interpretation",
                        inference_type="industry_niche_mapping",
                    )
                )
                if not repaired_niches and not upgrade_exact_context_match(
                    "content_niches",
                    matched_niches,
                    evidence=evidence,
                    origin="semantic_inference",
                    rationale_code="industry_exact_niche_match",
                    explanation=niche_explanation,
                    epistemic_status="plausible_interpretation",
                    inference_type="industry_niche_mapping",
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
                                    "origin": "semantic_inference",
                                    "rationale_code": "industry_exact_niche_match",
                                },
                            ),
                            epistemic_status="plausible_interpretation",
                            inference_type="industry_niche_mapping",
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
                        epistemic_status=(
                            "plausible_interpretation"
                            if provenance == "suggested_inference"
                            else None
                        ),
                        inference_type=(
                            "experience_band_suggestion"
                            if provenance == "suggested_inference"
                            else None
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
                            epistemic_status=(
                                "plausible_interpretation"
                                if provenance == "suggested_inference"
                                else None
                            ),
                            inference_type=(
                                "experience_band_suggestion"
                                if provenance == "suggested_inference"
                                else None
                            ),
                        )
                    )

        if role_location is None and isinstance(structured_location, str):
            role_location = structured_location
        if (
            role_location is None
            and work_mode != "remote"
            and isinstance(context.get("role_location"), str)
        ):
            role_location = context["role_location"]
        employer_location = (
            context.get("employer_location")
            if isinstance(context.get("employer_location"), str)
            else None
        )
        # Structured compensation is merged after the initial provider scan.
        # Recompute here so an exact JSON-LD amount can support a contextual
        # currency decision, and an exact structured currency can never be
        # mistaken for provider omission from the stale pre-merge snapshot.
        amount_present = any(
            isinstance(field.value, (int, float, str))
            and not isinstance(field.value, bool)
            and str(field.value).strip() not in {"", "0", "0.0"}
            for path in ("budget_amount", "budget_max")
            if (field := by_path.get(path)) is not None
        )
        explicit_currency_field = by_path.get("budget_currency")
        explicit_currency = (
            str(explicit_currency_field.value)
            if explicit_currency_field is not None
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
                        epistemic_status="logically_entailed",
                        inference_type="location_currency_mapping",
                    )
                )

        # Provider omission must not erase an application material the source
        # asks for explicitly. This fallback is intentionally narrower than a
        # second extraction pass: it accepts only transmission-shaped source
        # wording ("submit your resume", "attach a cover letter") and emits
        # only the canonical inputs CreatorJobs already collects. The source's
        # email, form, board, or other destination stays private in evidence.
        application_signals = explicit_application_requirements(source.original_text)
        application_evidence = cls._exact_source_evidence(
            source,
            application_signals.evidence_snippets,
        )
        if application_signals.keys and application_evidence:
            existing_application = by_path.get("application_requirements")
            existing_keys = sanitize_application_requirement_keys(
                existing_application.value
                if existing_application is not None
                else []
            )
            merged_keys = sanitize_application_requirement_keys(
                [*existing_keys, *application_signals.keys]
            )
            if existing_application is not None and merged_keys != existing_keys:
                merged_evidence = [
                    *existing_application.evidence,
                    *(
                        item
                        for item in application_evidence
                        if item not in existing_application.evidence
                    ),
                ][:5]
                merged_application = existing_application.model_copy(
                    update={
                        "value": merged_keys,
                        "provenance": "extracted_from_source",
                        "evidence": merged_evidence,
                        "explanation": (
                            "The source explicitly asks candidates to provide "
                            "these application materials."
                        ),
                        "provider_confidence": None,
                        "epistemic_status": "normalized_explicit",
                        "inference_type": "application_material_classification",
                    }
                )
                field_index = next(
                    index
                    for index, item in enumerate(fields)
                    if item is existing_application
                )
                fields[field_index] = merged_application
                by_path["application_requirements"] = merged_application
            elif existing_application is None:
                append_context_field(
                    JobImportExtractionField(
                        field_path="application_requirements",
                        value=merged_keys,
                        provenance="extracted_from_source",
                        evidence=application_evidence,
                        epistemic_status="normalized_explicit",
                        inference_type="application_material_classification",
                    )
                )
        return JobImportExtractionResponse.model_validate(
            {
                **response.model_dump(mode="json"),
                "fields": fields,
                "conflicts": conflicts,
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
        epistemic_state = item.epistemic_status or (
            "plausible_interpretation"
            if item.provenance == "suggested_inference"
            else "explicit"
        )
        # The typed epistemic claim is the provider's highest-authority account
        # of what it knows.  Free-form confidence metadata is diagnostic only
        # and must never upgrade a merely plausible interpretation into a
        # logically entailed fact.  Metadata remains a compatibility fallback
        # solely for provider-neutral legacy rows that predate the annotation.
        if epistemic_state in {"explicit", "normalized_explicit"}:
            origin = "explicit"
        elif epistemic_state == "logically_entailed":
            origin = "contextual_inference"
        elif epistemic_state == "plausible_interpretation":
            origin = "semantic_inference"
        elif item.provenance == "suggested_inference":
            reported_origin = provider_metadata.get("origin")
            origin = (
                reported_origin
                if reported_origin in {"contextual_inference", "semantic_inference"}
                else "semantic_inference"
            )
        else:
            origin = "explicit"
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
            "epistemic_state": epistemic_state,
            **(
                {"inference_type": item.inference_type}
                if item.inference_type is not None
                else {}
            ),
        }
        return auto_fill, metadata

    @staticmethod
    def _provider_inference_errors(
        policy: JobImportFieldPolicy,
        provenance: str,
        value: object,
        provider_confidence: JobImportProviderConfidence | None = None,
        epistemic_status: str | None = None,
    ) -> list[str]:
        errors: list[str] = []
        if provenance == "suggested_inference":
            if epistemic_status == "logically_entailed":
                origin = "contextual_inference"
            elif epistemic_status == "plausible_interpretation":
                origin = "semantic_inference"
            else:
                reported_origin = (
                    provider_confidence.metadata.get("origin")
                    if provider_confidence is not None
                    else None
                )
                origin = (
                    reported_origin
                    if reported_origin in {"contextual_inference", "semantic_inference"}
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
            # Naming a field we do not support is a quality failure, not an
            # integrity one, and the two are handled differently on purpose.
            # Forged evidence is checked above and still refuses the whole reply,
            # because a reply that lies about its sources cannot be trusted in
            # part. A stray field name tells us nothing about the other
            # twenty-three, and discarding them turned one intermittent quirk
            # into a failed import the recruiter had to start over.
            #
            # Observed live: the same page imported cleanly on one run and
            # failed on the next, purely on which field names came back.
            server_owned = sorted(set(unknown_paths) & SYSTEM_OWNED_IMPORT_FIELDS)
            legacy_compatibility = sorted(set(unknown_paths) & LEGACY_COMPATIBILITY_IMPORT_FIELDS)

            # Reaching for a field the server owns is different in kind. A reply
            # trying to set publication status, or to claim a verified hiring
            # identity, is not a quality slip — it is the model asking for
            # authority it must never have, and that reply is refused whole.
            if server_owned or legacy_compatibility:
                raise JobImportError(
                    "JOB_IMPORT_UNSUPPORTED_FIELD",
                    "Extraction output contains unsupported or server-owned fields.",
                    details={
                        "fields": unknown_paths,
                        "server_owned_fields": server_owned,
                        "legacy_compatibility_fields": legacy_compatibility,
                    },
                )

            logger.info(
                "job_import_dropped_unsupported_fields",
                extra={
                    "unsupported_fields": unknown_paths,
                    "server_owned_fields": server_owned,
                },
            )
            unsupported = set(unknown_paths)
            response = response.model_copy(
                update={
                    "fields": [
                        item for item in response.fields
                        if item.field_path not in unsupported
                    ],
                    "conflicts": [
                        item for item in response.conflicts
                        if item.field_path not in unsupported
                    ],
                    "missing_fields": [
                        item for item in response.missing_fields
                        if item.field_path not in unsupported
                    ],
                }
            )
            if not response.fields and not response.conflicts:
                # Nothing usable survived, which is a genuine extraction failure
                # rather than something to paper over with an empty draft.
                raise JobImportError(
                    "JOB_IMPORT_UNSUPPORTED_FIELD",
                    "Extraction output contained no fields this product supports.",
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
            pending_sensitive_source_inputs = (
                self._pending_sensitive_source_inputs(provider_value)
                if item.field_path == "source_inputs"
                and item.provenance in {"directly_supplied", "extracted_from_source"}
                else None
            )
            if pending_sensitive_source_inputs is not None:
                normalized, errors = pending_sensitive_source_inputs, []
            else:
                normalized, errors = await self._validate_field_value(
                    policy, provider_value
                )
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
                    (
                        normalized
                        if pending_sensitive_source_inputs is not None
                        else provider_value
                    ),
                    item.provider_confidence,
                    item.epistemic_status,
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
                force_review=(
                    currency_conflict or pending_sensitive_source_inputs is not None
                ),
            )
            if pending_sensitive_source_inputs is not None:
                decision_metadata = {
                    **decision_metadata,
                    "sensitive_access_confirmation_required": True,
                    "needs_review": True,
                }
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
                            "epistemic_state": conflict.epistemic_status,
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
                    "provider_confidence": {
                        "origin": "unknown",
                        "confidence": None,
                        "rationale_code": (
                            "provider_source_technically_unavailable"
                            if item is not None
                            and item.epistemic_status == "technically_unavailable"
                            else "source_value_absent"
                        ),
                        "epistemic_state": (
                            item.epistemic_status if item is not None else "absent"
                        ),
                        "needs_review": True,
                        "risk": policy.inference_risk,
                    },
                    "missing_requirement": policy.missing_requirement,
                    "requires_confirmation": False,
                    "validation_errors": [],
                }
            )

        rows = self._resolve_semantically_equivalent_conflicts(rows)
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
        effective_role_slug: str | None = None
        effective_work_mode = next(
            (
                value
                for field in fields
                if field.field_path == "work_mode"
                and isinstance((value := self._effective_field_value(field)), str)
            ),
            None,
        )
        for field in fields:
            value = self._effective_field_value(field)
            if value is None:
                continue
            # A value the editor will refuse is worth less than no value: the
            # recruiter gets a validation error *and* still has to answer. So a
            # derived value is either represented truthfully or left out — and
            # never bent into a neighbouring value to make it fit, which would
            # publish a claim the source never made.
            conversion = convert_to_native(
                field.field_path,
                value,
                work_mode=effective_work_mode,
            )
            if not conversion.writable:
                continue
            value = conversion.native_value
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
                effective_role_slug = role.slug
            elif policy.native_field is not None:
                payload[policy.native_field] = value
        payload = self._without_inactive_native_dependents(
            payload, effective_role_slug=effective_role_slug
        )
        # Two boundaries, in order: what a candidate is asked to do, then
        # what a candidate reads. Both exist because everything upstream can
        # put something in a field that should never reach a listing.
        return candidate_native_copy(self._safe_application_payload(payload))

    @staticmethod
    def _without_inactive_native_dependents(
        payload: dict[str, object], *, effective_role_slug: str | None = None
    ) -> dict[str, object]:
        """Omit values made inapplicable by a newer controlling decision.

        Imported rows are an audit history, so answering "no trial" must not
        delete an earlier source-stated trial amount.  Native conversion is a
        different boundary: emitting both would create an internally
        contradictory draft that Post Job cannot save.  Controllers therefore
        filter their inactive descendants only in the conversion copy.

        This mirrors the native form's conditional serialization without
        fabricating, clearing, or overwriting any stored source/recruiter value.
        """

        cleaned = dict(payload)

        mode = cleaned.get("compensation_mode")
        if mode == "negotiable":
            cleaned.pop("budget_amount", None)
            cleaned.pop("budget_max", None)
        elif mode in {"fixed", "approximate"}:
            cleaned.pop("budget_max", None)
        if cleaned.get("budget_unit") != "custom":
            cleaned.pop("budget_unit_custom", None)

        if cleaned.get("revision_policy") != "fixed":
            cleaned.pop("revision_rounds", None)

        if cleaned.get("start_timing") != "specific_date":
            cleaned.pop("start_date", None)

        duration_type = cleaned.get("duration_type")
        if duration_type == "fixed_period":
            cleaned.pop("engagement_end_date", None)
        elif duration_type == "until_date":
            cleaned.pop("duration_value", None)
            cleaned.pop("duration_unit", None)
        else:
            cleaned.pop("duration_value", None)
            cleaned.pop("duration_unit", None)
            cleaned.pop("engagement_end_date", None)

        trial_status = cleaned.get("trial_status")
        trial_details = {
            "trial_scope",
            "trial_effort_value",
            "trial_effort_unit",
            "trial_compensation_amount",
            "trial_compensation_currency",
            "trial_compensation_basis",
            "trial_work_usage",
            "trial_portfolio_permission",
            "trial_attribution",
            "unpaid_trial_confirmed",
            "trial_notes",
        }
        if trial_status not in {"paid", "unpaid"}:
            for field in trial_details:
                cleaned.pop(field, None)
        elif trial_status == "unpaid":
            for field in {
                "trial_compensation_amount",
                "trial_compensation_currency",
                "trial_compensation_basis",
            }:
                cleaned.pop(field, None)
        else:
            cleaned.pop("unpaid_trial_confirmed", None)

        if effective_role_slug is not None and effective_role_slug != "other-creator-role":
            cleaned.pop("role_specialization", None)

        return cleaned

    @staticmethod
    def _safe_application_payload(payload: dict[str, object]) -> dict[str, object]:
        """Make the application instructions safe before they become a draft.

        This is the boundary the sanitizer was missing. Everything upstream —
        the model, the structured reader, the recruiter's answers — can put an
        off-platform instruction into ``how_to_apply``, and until this ran the
        draft simply carried it. A page saying "share it on WhatsApp only"
        published that sentence, sending candidates somewhere the platform
        cannot follow and cannot record.

        Three things happen here, in the one place every import passes through.

        The note is recomposed from permitted parts only: what the source asked
        candidates to include, plus a deadline if it stated one. The destination
        is dropped rather than edited into the sentence, because a half-removed
        instruction reads worse than none.

        The route is forced internal. ``application_mode`` and
        ``external_apply_url`` are platform-decided, so an imported value for
        either is a claim about someone else's hiring process, not a setting.

        A validated deadline remains the native deadline field.  Candidate
        surfaces already render that field, so copying it into prose would both
        duplicate it and lose the machine-readable application boundary.
        """

        deadline = payload.get("deadline_at")
        stated = payload.get("how_to_apply")
        parsed_deadline: datetime | None = None
        if isinstance(deadline, datetime):
            parsed_deadline = deadline
        elif isinstance(deadline, str):
            try:
                candidate = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
            except ValueError:
                candidate = None
            if candidate is not None and candidate.tzinfo is not None:
                parsed_deadline = candidate.astimezone(UTC)
        if parsed_deadline is not None and parsed_deadline > datetime.now(UTC):
            payload["deadline_at"] = parsed_deadline
        else:
            payload.pop("deadline_at", None)
        source_text = stated if isinstance(stated, str) else None

        # A request the application form can already collect becomes a structured
        # requirement rather than a sentence. A rate then lands in a rate field
        # and a portfolio in the portfolio picker, instead of being prose the
        # candidate has to notice and the recruiter has to read.
        #
        # The priority is what stops anything appearing twice: a structured key
        # wins, the note takes what has no structured home, and a screening
        # question is only created for something neither could hold.
        # Classify what survives sanitisation, not the raw source. Reading the
        # original would let "on WhatsApp only" fall out as an unstructured
        # material and land straight back in the note it was removed from.
        # The provider-facing schema necessarily accepts strings here, but the
        # native candidate form accepts only canonical requirement keys. Treat
        # arbitrary entries as untrusted source prose: recover known materials,
        # discard destinations, and never publish the raw sentence as a label.
        existing_raw = payload.get("application_requirements")
        existing_values = list(existing_raw) if isinstance(existing_raw, list) else []
        canonical_requirements = sanitize_application_requirement_keys(existing_values)
        for raw_requirement in existing_values:
            if (
                not isinstance(raw_requirement, str)
                or raw_requirement in canonical_requirements
            ):
                continue
            safe_requirement = separate_application_instructions(raw_requirement)
            recovered = classify_application_instructions(
                " ".join(safe_requirement.safe_sentences) or None
            )
            for key in recovered.requirement_keys:
                if key not in canonical_requirements:
                    canonical_requirements.append(key)
        if canonical_requirements:
            payload["application_requirements"] = canonical_requirements
        else:
            payload.pop("application_requirements", None)

        separated = separate_application_instructions(source_text)
        classified = classify_application_instructions(
            " ".join(separated.safe_sentences) or None
        )
        if classified.requirement_keys:
            existing = payload.get("application_requirements")
            merged = list(existing) if isinstance(existing, list) else []
            for key in classified.requirement_keys:
                if key not in merged:
                    merged.append(key)
            payload["application_requirements"] = merged

        existing_questions = payload.get("screening_questions")
        question_rows = (
            list(existing_questions) if isinstance(existing_questions, list) else []
        )
        known_prompts = {
            row.get("prompt") for row in question_rows if isinstance(row, dict)
        }
        for prompt in classified.screening_questions:
            if prompt not in known_prompts:
                question_rows.append({"prompt": prompt, "required": False})

        safe_screening = safe_imported_screening_questions(question_rows)
        if safe_screening.requirement_keys:
            existing = payload.get("application_requirements")
            merged = list(existing) if isinstance(existing, list) else []
            for key in safe_screening.requirement_keys:
                if key not in merged:
                    merged.append(key)
            payload["application_requirements"] = merged

        if safe_screening.questions:
            payload["screening_questions"] = safe_screening.questions
        else:
            payload.pop("screening_questions", None)

        # The note carries only what nothing else can hold. Repeating a request
        # the form already collects makes a candidate answer it twice, and an
        # evaluative question published here would be asked of everyone who reads
        # the listing rather than of everyone who applies.
        note_materials = [
            *classified.unstructured_materials,
            *safe_screening.unstructured_materials,
        ]
        # The final imported boundary is fail-closed: only a classified
        # material request or an exact deadline can become public copy. Raw
        # provider prose never passes through merely because no known rule
        # rejected it; that was how novel links, handles and route imperatives
        # kept finding new spellings around a destination blacklist.
        note = compose_public_apply_note(
            materials=note_materials,
            deadline=None,
        )
        if note:
            payload["how_to_apply"] = note
        else:
            payload.pop("how_to_apply", None)

        # Never inherited from a source. The candidate applies here.
        payload["application_mode"] = "internal"
        payload.pop("external_apply_url", None)
        if "application_requirements" in payload:
            allowed = sanitize_application_requirement_keys(
                payload.get("application_requirements")
            )
            if allowed:
                payload["application_requirements"] = allowed
            else:
                payload.pop("application_requirements", None)
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

        if existing.get("review_status") != "pending":
            return False

        # A row that cannot reach the draft is not a reading worth protecting,
        # whatever provenance it claims. Two live runs proved the cost: a title
        # row arrived holding nothing and still blocked the page's own
        # JobPosting title, so an authoritative fact was lost *and* the
        # recruiter was asked to supply it. And an experience row arrived with
        # sixty-plus characters of prose that the sixty-four-character column
        # refuses, so a correctly-read "25 years" was dropped at conversion
        # while the page had said it plainly.
        #
        # An empty, rejected or unrepresentable value therefore yields to the
        # explicit source fact. A settled, usable reading still wins, and a
        # recruiter still wins over both through the prefill merge below.
        if not JobImportService._value_reaches_the_draft(existing):
            return True

        return state == "suggested_inference" and (
            bool(existing.get("validation_errors"))
            or existing.get("proposed_value") in (None, "")
        )

    @staticmethod
    def _structured_declaration_outranks(field_path: str, context: dict[str, Any]) -> bool:
        """Whether the page itself declared this field in its JobPosting markup.

        Publisher markup outranks a model's reading of the same page's prose.
        Live evidence for why: a page whose markup said "At least 60 months of
        experience" was consistently given "5–8 years" by the provider — a
        ceiling that appears nowhere on the page — and because that value was
        perfectly usable it won. The recruiter would have advertised a maximum
        the employer never set.

        Deliberately narrow: only fields the markup states outright, and only
        against a machine reading. A recruiter answer and a genuine conflict
        both still win, which the caller enforces.
        """

        declared = {
            "title": "job_title",
            "experience_level": "experience_requirement",
            "compensation_mode": "compensation",
            "budget_amount": "compensation",
            "budget_max": "compensation",
            "budget_currency": "compensation",
            "budget_unit": "compensation",
            "engagement_type": "employment_type",
            "expected_weekly_hours_min": "work_hours",
            "expected_weekly_hours_max": "work_hours",
            "deadline_at": "valid_through",
            "start_timing": "job_start_date",
            "start_date": "job_start_date",
        }
        key = declared.get(field_path)
        return bool(key and str(context.get(key) or "").strip())

    @staticmethod
    def _value_reaches_the_draft(existing: dict[str, Any]) -> bool:
        """Whether this row's value could actually become part of the draft."""

        if existing.get("validation_errors"):
            return False
        value = existing.get("proposed_value")
        if value in (None, ""):
            return False
        field_path = existing.get("field_path")
        if not isinstance(field_path, str):
            return True
        # The same gate conversion applies, asked early: a value the native
        # field will refuse is not a value the draft can hold.
        return convert_to_native(field_path, value).writable

    @staticmethod
    def _resolve_semantically_equivalent_conflicts(
        rows: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Settle conflicts whose alternatives name the same physical city.

        Provider output is deliberately preserved unchanged on the draft for
        audit.  The field row, however, is the product's decision layer.  When
        two source strings are merely a city alias or a neighbourhood inside
        that city, presenting them as competing recruiter choices is false
        uncertainty and creates avoidable work.

        This rule is intentionally limited to exact, curated geographic
        equivalence.  Different cities, remote roles, unknown place names, and
        every other field remain unresolved for a human decision.
        """

        work_mode = next(
            (
                row.get("confirmed_value") or row.get("proposed_value")
                for row in rows
                if row.get("field_path") == "work_mode"
                and row.get("provenance_state") != "conflicting_source_values"
            ),
            None,
        )
        work_mode = work_mode if isinstance(work_mode, str) else None

        for row in rows:
            if (
                row.get("field_path") != "location"
                or row.get("provenance_state") != "conflicting_source_values"
            ):
                continue
            alternatives = row.get("conflicting_values")
            if not isinstance(alternatives, list):
                continue
            stated = [
                item.get("value")
                for item in alternatives
                if isinstance(item, dict)
                and isinstance(item.get("value"), str)
                and item.get("value", "").strip()
            ]
            # A city and a remote applicant country are different semantic
            # dimensions, even if the city happens to be inside that country.
            # A live "San Francisco, CA or Remote, US" posting was collapsed to
            # San Francisco because the non-remote normalizer discarded the
            # country-only alternative before comparing. Only city-resolvable
            # alternatives may enter this city-equivalence shortcut; the
            # workplace question keeps city-vs-remote geography intact.
            if work_mode != "remote" and any(
                city_for_location(value) is None for value in stated
            ):
                continue
            resolution = resolve_locations(stated, work_mode=work_mode)
            if not resolution.confident or resolution.recommended is None:
                continue
            conversion = convert_to_native("location", resolution.recommended)
            if not conversion.writable:
                continue

            evidence: list[dict[str, object]] = []
            for alternative in alternatives:
                if not isinstance(alternative, dict):
                    continue
                for item in alternative.get("evidence") or []:
                    if isinstance(item, dict) and item not in evidence:
                        evidence.append(item)

            metadata = row.get("provider_confidence")
            provider_confidence = dict(metadata) if isinstance(metadata, dict) else {}
            provider_confidence.update(
                {
                    "origin": "contextual_inference",
                    "confidence": "high",
                    "rationale_code": "semantically_equivalent_location_values",
                    "epistemic_state": "logically_entailed",
                    "needs_review": False,
                    "risk": JOB_IMPORT_FIELD_POLICIES["location"].inference_risk,
                    "server_grounded_match": True,
                    "location_audit": resolution.audit(),
                }
            )
            row.update(
                {
                    "provenance_state": "extracted_from_source",
                    "proposed_value": conversion.native_value,
                    "confirmed_value": conversion.native_value,
                    "review_status": "confirmed",
                    "requires_confirmation": False,
                    "validation_errors": [],
                    "evidence": evidence[:8],
                    "conflicting_values": [],
                    "explanation": (
                        "The source's location alternatives resolve to the same city."
                    ),
                    "provider_confidence": provider_confidence,
                }
            )
        return rows

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
        if not isinstance(context, dict):
            context = {}

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

            # Facts the employer printed under a label in their own copy.
            #
            # Markup is generated by whoever syndicated the listing; the labelled
            # copy is written by the employer about their own job. A live page
            # carried no compensation in its JSON-LD and declared
            # employmentType INTERN, while its visible copy said
            # "Compensation ₹5,000 / mo" and "Type Part-time / Freelance". Read
            # from markup alone the draft had no pay — so the assistant asked how
            # pay was measured, about a page that had answered exactly that — and
            # called a paid freelance brief an internship.
            #
            # So a labelled fact fills what the markup omits, and wins where the
            # two disagree, because the employer is the better authority on their
            # own offer.
            labelled = labelled_facts(source.original_text)
            labelled_conflict_paths = set((labelled.conflicts or {}).keys())
            for path, value in (
                ("experience_level", labelled.experience_level),
                ("engagement_type", labelled.engagement_type),
                ("budget_amount", labelled.budget_amount),
                ("budget_max", labelled.budget_max),
                ("budget_currency", labelled.budget_currency),
                ("budget_unit", labelled.budget_unit),
                ("compensation_mode", labelled.compensation_mode),
            ):
                if value is not None and path not in labelled_conflict_paths:
                    structured[path] = value

            effective_work_mode = structured.get("work_mode")
            if not isinstance(effective_work_mode, str):
                existing_work_mode = next(
                    (
                        row.get("confirmed_value") or row.get("proposed_value")
                        for row in rows
                        if row.get("field_path") == "work_mode"
                    ),
                    None,
                )
                effective_work_mode = (
                    existing_work_mode if isinstance(existing_work_mode, str) else None
                )
            city_resolution = (
                resolve_job_city(
                    source.original_text,
                    context,
                    work_mode=effective_work_mode,
                )
                if effective_work_mode in {"hybrid", "onsite"}
                else JobCityResolution(
                    rationale_code=(
                        "remote_geography_preserved"
                        if effective_work_mode == "remote"
                        else "work_mode_required_before_physical_city"
                    )
                )
            )
            if city_resolution.resolved:
                structured["location"] = city_resolution.city
        except Exception:  # pragma: no cover - enrichment must never break import
            # Enrichment is a bonus. A malformed structured block must never
            # turn a successful extraction into a failure.
            return rows

        labelled_paths = {
            path
            for path, value in (
                ("experience_level", labelled.experience_level),
                ("engagement_type", labelled.engagement_type),
                ("budget_amount", labelled.budget_amount),
                ("budget_max", labelled.budget_max),
                ("budget_currency", labelled.budget_currency),
                ("budget_unit", labelled.budget_unit),
                ("compensation_mode", labelled.compensation_mode),
            )
            if value is not None and path not in labelled_conflict_paths
        }
        by_path = {row["field_path"]: row for row in rows}
        for field_path, alternatives in (labelled.conflicts or {}).items():
            policy = JOB_IMPORT_FIELD_POLICIES.get(field_path)
            if policy is None:
                continue
            existing = by_path.get(field_path)
            if existing is not None and existing.get("authority_state") in {
                "confirmed_by_recruiter",
                "edited_by_recruiter",
                "rejected_by_recruiter",
            }:
                continue
            normalized_values: list[dict[str, object]] = []
            validation_errors: list[str] = []
            seen: set[str] = set()
            for index, (raw_value, excerpt) in enumerate(alternatives[:8]):
                normalized, errors = await self._validate_field_value(policy, raw_value)
                key = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
                if key in seen:
                    continue
                seen.add(key)
                evidence = self._exact_source_evidence(source, [excerpt])
                if not evidence:
                    continue
                normalized_values.append(
                    {
                        "value": normalized,
                        "evidence": [item.model_dump(mode="json") for item in evidence],
                    }
                )
                validation_errors.extend(
                    f"Alternative {index + 1}: {error}" for error in errors
                )
            if len(normalized_values) < 2:
                continue
            conflict_row = {
                "draft_id": draft.id,
                "field_path": field_path,
                "proposed_value": None,
                "confirmed_value": None,
                "provenance_state": "conflicting_source_values",
                "evidence": [],
                "conflicting_values": normalized_values,
                "explanation": (
                    "The page contains multiple dedicated labelled values for this field."
                ),
                "provider_confidence": {
                    "origin": "explicit",
                    "confidence": "high",
                    "rationale_code": "conflicting_labelled_source_values",
                    "epistemic_state": "conflicting",
                    "needs_review": True,
                    "risk": policy.inference_risk,
                },
                "review_status": "pending",
                "missing_requirement": policy.missing_requirement,
                "requires_confirmation": True,
                "validation_errors": validation_errors,
            }
            if existing is not None:
                existing.update(conflict_row)
            else:
                rows.append(conflict_row)
                by_path[field_path] = conflict_row
        context_resolved_paths = {
            "location"
        } if city_resolution.resolved else set()
        for field_path, value in structured.items():
            policy = JOB_IMPORT_FIELD_POLICIES.get(field_path)
            if policy is None:
                continue
            existing = by_path.get(field_path)
            if existing is not None and not self._structured_value_may_fill(existing):
                # Publisher markup outranks a machine reading of the same page's
                # prose, but never a recruiter and never a real conflict.
                # A fact the employer printed under a label settles a
                # disagreement about their own job. A page whose syndicated
                # markup said INTERN while its own copy said "Type Part-time /
                # Freelance" otherwise reached the recruiter as a question about
                # something the page had stated plainly — a source-known
                # interruption, and the one kind this product refuses to make.
                employer_labelled = field_path in labelled_paths
                # A freshly built row carries no review_status at all — conflict
                # rows in particular are constructed without one. Comparing
                # against "pending" therefore skipped precedence for exactly the
                # rows that needed it, which is why a labelled fact won on some
                # runs and became a recruiter question on others.
                untouched = existing.get("review_status") in (None, "", "pending")
                # Only a recruiter outranks what the employer printed. A row the
                # extraction filled is marked "confirmed" too, and treating that
                # as settled handed the decision to whichever reading arrived
                # first: a page whose markup said INTERN while its own copy said
                # "Type Part-time / Freelance" still reached the recruiter as an
                # internship, because the extraction had faithfully read the
                # markup and its row was therefore "confirmed". Machine
                # agreement with the wrong source is not a settled fact.
                #
                # Nothing recruiter-owned is at risk here: this merge runs
                # before the prefill merge, so a recruiter answer overwrites
                # whatever this produces. The check is belt-and-braces for any
                # later caller that reaches these rows after a recruiter has.
                recruiter_owned = existing.get("authority_state") in {
                    "confirmed_by_recruiter",
                    "edited_by_recruiter",
                    "rejected_by_recruiter",
                }
                # Precedence is about evidence, not about which kind of code
                # produced the reading. A labelled fact wins because the
                # employer printed it under a label about their own job — not
                # because a regex found it. The distinction matters the moment
                # the deterministic reader is the weaker one: it had no way to
                # read "Up to ₹20,000 a month" at all, and a reader that finds
                # nothing has reported on its own coverage, not on the page.
                #
                # `labelled_paths` therefore contains only fields the labelled
                # reader actually *found*. A field absent from it contributes no
                # opinion here, and cannot displace an evidenced extraction.
                context_resolved = field_path in context_resolved_paths
                may_replace = (
                    not recruiter_owned
                    and context_resolved
                ) or fact_outranks(
                    "labelled_source" if employer_labelled else "heuristic",
                    "recruiter" if recruiter_owned else "evidenced_interpretation",
                )
                outranks = may_replace or (
                    untouched
                    and self._structured_declaration_outranks(field_path, context)
                    and existing.get("provenance_state")
                    != "conflicting_source_values"
                )
                if not outranks:
                    continue

            normalized, errors = await self._validate_field_value(policy, value)
            if errors or normalized is None:
                continue

            evidence: list[JobImportEvidence] = []
            rationale_code = "structured_source_value"
            origin = "explicit"
            epistemic_state = "normalized_explicit"
            explanation = "Read from the job page's structured details."
            labelled_evidence = (
                (labelled.evidence or {}).get(field_path)
                if field_path in labelled_paths
                else None
            )
            if isinstance(labelled_evidence, str):
                evidence = self._exact_source_evidence(source, [labelled_evidence])
                rationale_code = f"labelled_{field_path}_authoritative"
                epistemic_state = "normalized_explicit"
                explanation = "Read from the job page's dedicated labelled field."
            if field_path in context_resolved_paths:
                evidence = self._exact_source_evidence(source, city_resolution.evidence)
                rationale_code = city_resolution.rationale_code or "corroborated_city"
                origin = "contextual_inference"
                epistemic_state = "logically_entailed"
                explanation = (
                    "The source's title and location details resolve to one city."
                )
            filled = {
                "provenance_state": "extracted_from_source",
                "proposed_value": normalized,
                "confirmed_value": normalized,
                "review_status": "confirmed",
                "requires_confirmation": False,
                "validation_errors": [],
                "explanation": explanation,
                "conflicting_values": [],
            }
            # When an authoritative labelled/contextual decision replaces a
            # provider reading, replace its stale evidence and review metadata
            # as well. Ordinary exact structured enrichment keeps provider
            # evidence on an existing row, matching the pre-existing contract.
            if existing is None or field_path in labelled_paths | context_resolved_paths:
                filled["evidence"] = [
                    item.model_dump(mode="json") for item in evidence
                ]
                filled["provider_confidence"] = {
                    "score": 1.0,
                    "label": "high",
                    "metadata": {
                        "origin": origin,
                        "confidence": "high",
                        "rationale_code": rationale_code,
                        "epistemic_state": epistemic_state,
                        "needs_review": False,
                        "risk": policy.inference_risk,
                        "server_grounded_match": True,
                    },
                    "origin": origin,
                    "confidence": "high",
                    "rationale_code": rationale_code,
                    "epistemic_state": epistemic_state,
                    "needs_review": False,
                    "risk": policy.inference_risk,
                }
            if existing is not None:
                existing.update(filled)
                continue
            rows.append(
                {
                    "draft_id": draft.id,
                    "field_path": field_path,
                    "missing_requirement": policy.missing_requirement,
                    "edited_value": None,
                    **filled,
                }
            )

        if labelled.invalid_compensation_range:
            validation_message = (
                "The stated compensation range has a lower bound above its upper bound."
            )
            for field_path in ("budget_amount", "budget_max", "compensation_mode"):
                existing = by_path.get(field_path)
                if existing is None or existing.get("authority_state") in {
                    "confirmed_by_recruiter",
                    "edited_by_recruiter",
                    "rejected_by_recruiter",
                }:
                    continue
                metadata = existing.get("provider_confidence")
                provider_confidence = (
                    dict(metadata) if isinstance(metadata, dict) else {}
                )
                provider_confidence.update(
                    {
                        "origin": "explicit",
                        "confidence": "high",
                        "rationale_code": "inverted_labelled_compensation_range",
                        "epistemic_state": "conflicting",
                        "needs_review": True,
                        "risk": JOB_IMPORT_FIELD_POLICIES[field_path].inference_risk,
                    }
                )
                validation_errors = list(existing.get("validation_errors") or [])
                if validation_message not in validation_errors:
                    validation_errors.append(validation_message)
                existing.update(
                    {
                        "confirmed_value": None,
                        "review_status": "pending",
                        "requires_confirmation": True,
                        "validation_errors": validation_errors,
                        "provider_confidence": provider_confidence,
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
                confidence = (
                    field.provider_confidence
                    if isinstance(field.provider_confidence, dict)
                    else {}
                )
                if (
                    field.field_path == "source_inputs"
                    and confidence.get("sensitive_access_confirmation_required") is True
                ):
                    # A provider may preserve the explicit fact that account or
                    # analytics access is needed, but clicking “accept” must not
                    # turn its proposed Boolean into recruiter consent. Requiring
                    # an edited native value makes that consent explicit and runs
                    # the ordinary JobSourceInput validator over it.
                    raise JobImportError(
                        "JOB_IMPORT_FIELD_REQUIRES_EXPLICIT_EDIT",
                        "Sensitive source access must be confirmed through an explicit recruiter edit.",
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

    @staticmethod
    def _epistemic_state(field: JobImportField, *, origin: str) -> str:
        metadata = field.provider_confidence if isinstance(field.provider_confidence, dict) else {}
        state = metadata.get("epistemic_state")
        if state in {
            "explicit",
            "normalized_explicit",
            "logically_entailed",
            "plausible_interpretation",
            "ambiguous",
            "conflicting",
            "absent",
            "technically_unavailable",
        }:
            return str(state)
        if field.provenance_state == "conflicting_source_values":
            return "conflicting"
        if field.provenance_state == "missing":
            return "absent"
        if origin == "contextual_inference":
            return "logically_entailed"
        if field.provenance_state == "suggested_inference":
            return "plausible_interpretation"
        return "explicit"

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
            epistemic_state=cls._epistemic_state(field, origin=origin),
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
