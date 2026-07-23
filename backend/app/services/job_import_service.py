from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from pydantic import TypeAdapter, ValidationError

from app.core.job_domain_taxonomy import (
    CREATIVE_AUTONOMY_LEVELS,
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
from app.core.job_import_policy import (
    AUTO_TRACKED_MISSING_FIELDS,
    JOB_IMPORT_FIELD_POLICIES,
    LEGACY_COMPATIBILITY_IMPORT_FIELDS,
    SYSTEM_OWNED_IMPORT_FIELDS,
    JobImportFieldPolicy,
    import_field_policy,
)
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
    JobImportExtractionRequest,
    JobImportExtractionResponse,
    JobImportFieldDefinition,
    JobImportFieldRead,
    JobImportFieldReviewRequest,
    JobImportProviderMetadata,
    JobImportSourceCreate,
    JobImportSourceRead,
    JobImportSourceRepresentation,
)
from app.services.job_service import (
    JobForbiddenError,
    JobService,
    JobValidationError,
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
        source = await self.repository.create_source(data)
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
        source = await self.get_source(source_id, owner_user_id=owner_user_id)
        now = datetime.now(UTC)
        drafts = await self.repository.list_drafts_for_source(source.id, owner_user_id)
        for draft in drafts:
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
                    },
                )
            await self.repository.update_draft(
                draft,
                {
                    "machine_output": None,
                    "provider_metadata": None,
                    "processing_warnings": [],
                },
            )
        await self.repository.update_source(
            source,
            {
                "source_title": None,
                "original_text": None,
                "source_url": None,
                "original_filename": None,
                "content_type": None,
                "storage_references": [],
                "processing_state": "deleted",
                "content_redacted_at": now,
                "deleted_at": now,
            },
        )
        await self.repository.session.commit()

    async def initialize_draft(
        self,
        source_id: UUID,
        payload: JobImportDraftInitialize,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        source = await self.get_source(source_id, owner_user_id=owner_user_id)
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

        if payload.idempotency_key:
            existing = await self.repository.get_draft_by_request_id(
                owner_user_id,
                payload.idempotency_key,
            )
            if existing is not None:
                if (
                    existing.source_id != source.id
                    or existing.extraction_schema_version
                    != payload.extraction_schema_version
                    or existing.target_listing_schema_version
                    != payload.target_listing_schema_version
                    or existing.supersedes_draft_id != payload.supersedes_draft_id
                ):
                    raise JobImportError(
                        "JOB_IMPORT_IDEMPOTENCY_CONFLICT",
                        "This idempotency key was already used for a different import draft.",
                        status_code=409,
                    )
                return existing

        superseded: JobImportDraft | None = None
        if payload.supersedes_draft_id is not None:
            superseded = await self.repository.get_draft_for_owner(
                payload.supersedes_draft_id,
                owner_user_id,
            )
            if superseded is None or superseded.source_id != source.id:
                raise JobImportError(
                    "JOB_IMPORT_SUPERSEDED_DRAFT_NOT_FOUND",
                    "The draft to supersede was not found for this source.",
                    status_code=404,
                )

        draft = await self.repository.create_draft(
            {
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
        )
        if superseded is not None and superseded.processing_status not in {
            "applied_to_native_draft",
            "discarded",
        }:
            await self.repository.update_draft(
                superseded,
                {"processing_status": "superseded"},
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
        definitions = [
            JobImportFieldDefinition(
                field_path=policy.field_path,
                confirmation_policy=policy.confirmation_policy,
                missing_requirement=policy.missing_requirement,
                review_section=policy.review_section,
                custom_values_allowed=policy.custom_values_allowed,
            )
            for policy in JOB_IMPORT_FIELD_POLICIES.values()
        ]
        return JobImportExtractionRequest(
            extraction_schema_version=draft.extraction_schema_version,
            target_listing_schema_version=draft.target_listing_schema_version,
            source=JobImportSourceRepresentation(
                source_type=source.source_type,
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
                "Consequential fields must remain explicitly reviewable and must never be marked authoritative.",
                "Use stable taxonomy keys; do not generate database identifiers.",
                "Represent contradictory source statements as conflicts instead of selecting one.",
                "Represent absent publication-relevant information as missing instead of inventing it.",
            ],
            output_validation_instructions=[
                "Return only the CreatorJobs extraction response contract.",
                "Bound evidence to short excerpts and source locations.",
                "Do not reproduce the full source inside field evidence.",
                "Treat any confidence value as provider-reported metadata only.",
            ],
        )

    async def begin_processing(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        draft = await self.get_draft(draft_id, owner_user_id=owner_user_id)
        if draft.processing_status not in {"awaiting_processing", "processing_failed"}:
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "This import draft cannot begin processing from its current state.",
                status_code=409,
            )
        source = await self.get_source(draft.source_id, owner_user_id=owner_user_id)
        await self.repository.update_draft(
            draft,
            {
                "processing_status": "processing",
                "validation_status": "not_validated",
            },
        )
        await self.repository.update_source(source, {"processing_state": "processing"})
        await self.repository.session.commit()
        return draft

    async def mark_processing_failed(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
        error_code: str,
        message: str,
    ) -> JobImportDraft:
        draft = await self.get_draft(draft_id, owner_user_id=owner_user_id)
        if draft.processing_status not in {"awaiting_processing", "processing"}:
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "This import draft cannot be marked failed from its current state.",
                status_code=409,
            )
        source = await self.get_source(draft.source_id, owner_user_id=owner_user_id)
        safe_message = " ".join(message.split())[:500]
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
            },
        )
        await self.repository.update_source(source, {"processing_state": "failed"})
        await self.repository.session.commit()
        return draft

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

        assert policy.native_field is not None
        try:
            adapter = self._adapter_for_native_field(policy.native_field)
            validated = adapter.validate_python(value)
            normalized = adapter.dump_python(validated, mode="json")
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
        return normalized, []

    @staticmethod
    def _provider_inference_errors(
        policy: JobImportFieldPolicy,
        provenance: str,
    ) -> list[str]:
        if (
            provenance == "suggested_inference"
            and policy.confirmation_policy == "extract_when_explicit"
        ):
            return ["This field may only be extracted from explicit source wording."]
        return []

    async def record_extraction_result(
        self,
        draft_id: UUID,
        response: JobImportExtractionResponse,
        *,
        owner_user_id: UUID,
        provider_metadata: JobImportProviderMetadata | None = None,
    ) -> JobImportDraft:
        draft = await self.repository.get_draft_for_owner(
            draft_id,
            owner_user_id,
            for_update=True,
        )
        if draft is None:
            raise JobImportError(
                "JOB_IMPORT_DRAFT_NOT_FOUND",
                "Import draft not found.",
                status_code=404,
            )
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

        all_paths = {
            *(item.field_path for item in response.fields),
            *(item.field_path for item in response.conflicts),
            *(item.field_path for item in response.missing_fields),
        }
        unknown_paths = sorted(path for path in all_paths if import_field_policy(path) is None)
        if unknown_paths:
            server_owned = sorted(set(unknown_paths) & SYSTEM_OWNED_IMPORT_FIELDS)
            legacy_compatibility = sorted(
                set(unknown_paths) & LEGACY_COMPATIBILITY_IMPORT_FIELDS
            )
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
            normalized, errors = await self._validate_field_value(policy, item.value)
            errors.extend(self._provider_inference_errors(policy, item.provenance))
            rows.append(
                {
                    "draft_id": draft.id,
                    "field_path": item.field_path,
                    "proposed_value": normalized,
                    "provenance_state": item.provenance,
                    "evidence": [
                        evidence.model_dump(mode="json") for evidence in item.evidence
                    ],
                    "conflicting_values": [],
                    "explanation": item.explanation,
                    "provider_confidence": (
                        item.provider_confidence.model_dump(mode="json")
                        if item.provider_confidence
                        else None
                    ),
                    "missing_requirement": policy.missing_requirement,
                    "requires_confirmation": True,
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
                errors.extend(
                    f"Alternative {index + 1}: {error}" for error in alternative_errors
                )
                normalized_values.append(
                    {
                        "value": normalized,
                        "evidence": [
                            evidence.model_dump(mode="json")
                            for evidence in alternative.evidence
                        ],
                    }
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
                        conflict.provider_confidence.model_dump(mode="json")
                        if conflict.provider_confidence
                        else None
                    ),
                    "missing_requirement": policy.missing_requirement,
                    "requires_confirmation": True,
                    "validation_errors": errors,
                }
            )

        explicit_missing = {item.field_path: item for item in response.missing_fields}
        missing_paths = [
            *explicit_missing,
            *(
                path
                for path in AUTO_TRACKED_MISSING_FIELDS
                if path not in all_paths
            ),
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

        await self.repository.create_fields(rows)
        metadata = provider_metadata or JobImportProviderMetadata()
        now = datetime.now(UTC)
        await self.repository.update_draft(
            draft,
            {
                "provider_name": metadata.provider_name,
                "model_name": metadata.model_name,
                "model_version": metadata.model_version,
                "instruction_version": metadata.instruction_version,
                "provider_metadata": metadata.metadata or None,
                "machine_output": response.model_dump(mode="json"),
                "processing_warnings": [
                    warning.model_dump(mode="json") for warning in response.warnings
                ],
                "processing_status": "awaiting_recruiter_review",
                "processed_at": now,
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
            policy = JOB_IMPORT_FIELD_POLICIES[field.field_path]
            if field.field_path == "primary_role_key":
                role = await self.repository.get_active_role_by_key(str(value))
                if role is None:
                    continue
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
            if field.validation_errors
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
            draft_errors["title"] = [
                "Confirm or enter a job title before creating a native draft."
            ]
        elif not field_errors and not unresolved:
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

        can_apply = bool(
            draft_payload is not None
            and not field_errors
            and not unresolved
            and not draft_errors
        )
        can_publish = bool(can_apply and not publication_errors)
        if field_errors or draft_errors:
            validation_status = "invalid"
        elif unresolved:
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
        }:
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "This import draft is not open for recruiter review.",
                status_code=409,
            )

    async def review_field(
        self,
        draft_id: UUID,
        field_path: str,
        payload: JobImportFieldReviewRequest,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        draft = await self.get_draft(draft_id, owner_user_id=owner_user_id)
        self._assert_reviewable(draft)
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
        await self.repository.session.commit()
        return draft

    async def resolve_conflict(
        self,
        draft_id: UUID,
        field_path: str,
        payload: JobImportConflictResolutionRequest,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        draft = await self.get_draft(draft_id, owner_user_id=owner_user_id)
        self._assert_reviewable(draft)
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
            normalized, errors = await self._validate_field_value(policy, selected)
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
        await self.repository.session.commit()
        return draft

    async def discard_draft(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> JobImportDraft:
        draft = await self.get_draft(draft_id, owner_user_id=owner_user_id)
        if draft.processing_status in {
            "applied_to_native_draft",
            "discarded",
            "superseded",
        }:
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "This import draft cannot be discarded from its current state.",
                status_code=409,
            )
        await self.repository.update_draft(
            draft,
            {
                "processing_status": "discarded",
                "discarded_at": datetime.now(UTC),
                "can_apply_to_native_draft": False,
                "can_publish_directly": False,
            },
        )
        await self.repository.session.commit()
        return draft

    async def delete_draft(
        self,
        draft_id: UUID,
        *,
        owner_user_id: UUID,
    ) -> None:
        draft = await self.get_draft(draft_id, owner_user_id=owner_user_id)
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
            },
        )
        await self.repository.session.commit()

    async def apply_to_native_draft(
        self,
        draft_id: UUID,
        payload: JobImportApplyRequest,
        *,
        owner_user_id: UUID,
    ) -> tuple[JobImportDraft, Job, bool]:
        del payload  # create_new is the only accepted mode in this phase.
        draft = await self.repository.get_draft_for_owner(
            draft_id,
            owner_user_id,
            for_update=True,
        )
        if draft is None:
            raise JobImportError(
                "JOB_IMPORT_DRAFT_NOT_FOUND",
                "Import draft not found.",
                status_code=404,
            )
        if draft.target_job_id is not None:
            job = await self.job_service.get_job_internal(draft.target_job_id)
            return draft, job, False
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
        await self._refresh_draft_state(draft, owner_user_id=owner_user_id)
        if not draft.can_apply_to_native_draft or draft.processing_status != "ready_to_apply":
            raise JobImportError(
                "JOB_IMPORT_DRAFT_NOT_READY",
                "Resolve or review the remaining import fields before creating a native draft.",
                status_code=409,
                details={
                    "validation_errors": draft.validation_errors,
                    "review_sections": draft.review_sections,
                },
            )
        fields = await self.repository.list_fields(draft.id)
        native_payload = await self._effective_native_payload(fields)
        job_payload = JobCreate.model_validate({**native_payload, "status": "draft"})
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
            },
        )
        await self.repository.session.commit()
        return draft, job, True

    @staticmethod
    def _authority_state(field: JobImportField) -> str:
        return {
            "confirmed": "confirmed_by_recruiter",
            "edited": "edited_by_recruiter",
            "rejected": "rejected_by_recruiter",
        }.get(field.review_status, "unconfirmed")

    @classmethod
    def _field_read(cls, field: JobImportField) -> JobImportFieldRead:
        return JobImportFieldRead(
            id=field.id,
            field_path=field.field_path,
            proposed_value=field.proposed_value,
            provenance_state=field.provenance_state,
            review_status=field.review_status,
            authority_state=cls._authority_state(field),
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
        )

    @staticmethod
    def source_read(source: JobImportSource) -> JobImportSourceRead:
        return JobImportSourceRead.model_validate(source)
