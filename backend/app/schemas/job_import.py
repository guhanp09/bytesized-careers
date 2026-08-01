from __future__ import annotations

import html
import json
import re
import uuid
from datetime import datetime
from pathlib import PurePosixPath
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    JsonValue,
    field_validator,
    model_validator,
)

from app.core.job_domain_taxonomy import AIConfirmationPolicy
from app.core.job_import_inference import (
    ImportDecisionConfidence,
    ImportDecisionOrigin,
)
from app.core.job_import_policy import MissingRequirement, ReviewSection
from app.core.job_taxonomy import CURRENT_LISTING_SCHEMA_VERSION
from app.schemas.job import JobRead

CURRENT_EXTRACTION_SCHEMA_VERSION = 1
MAX_IMPORT_SOURCE_TEXT_LENGTH = 100_000
MAX_EVIDENCE_SNIPPET_LENGTH = 500
MAX_FIELD_JSON_BYTES = 16_384
MAX_MACHINE_METADATA_BYTES = 16_384
MAX_EXTRACTION_RESPONSE_BYTES = 1_000_000

JobImportSourceType = Literal[
    "pasted_text",
    "rough_description",
    "external_listing_text",
    "public_url",
    "screenshot",
    "screenshots",
    "document",
    "pdf",
    "other",
]
JobImportProcessingStatus = Literal[
    "awaiting_processing",
    "processing",
    "processing_failed",
    "awaiting_recruiter_review",
    "partially_reviewed",
    "ready_to_apply",
    "applied_to_native_draft",
    "discarded",
    "superseded",
]
JobImportValidationStatus = Literal[
    "not_validated",
    "invalid",
    "needs_review",
    "valid",
]
JobImportProvenanceState = Literal[
    "directly_supplied",
    "extracted_from_source",
    "suggested_inference",
    "conflicting_source_values",
    "missing",
]
JobImportReviewStatus = Literal["pending", "confirmed", "edited", "rejected"]
JobImportAuthorityState = Literal[
    "unconfirmed",
    "prefilled_by_import",
    "confirmed_by_recruiter",
    "edited_by_recruiter",
    "rejected_by_recruiter",
]


def _bounded_json(value: object, *, maximum: int, label: str) -> object:
    try:
        raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValueError(f"{label} must be JSON serializable") from exc
    if len(raw.encode("utf-8")) > maximum:
        raise ValueError(f"{label} is too large")
    return value


def _safe_provider_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = "".join(character for character in value if character >= " " or character in "\n\t")
    cleaned = cleaned.strip()
    return html.escape(cleaned, quote=True) or None


def _validate_storage_reference(value: str) -> str:
    normalized = value.strip()
    if (
        not normalized
        or len(normalized) > 512
        or "\\" in normalized
        or "://" in normalized
        or normalized.startswith("/")
        or any(part in {"", ".", ".."} for part in PurePosixPath(normalized).parts)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", normalized)
    ):
        raise ValueError("storage references must be safe private object keys")
    return normalized


class JobImportSourceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_type: JobImportSourceType
    source_title: str | None = Field(default=None, max_length=255)
    original_text: str | None = Field(
        default=None,
        max_length=MAX_IMPORT_SOURCE_TEXT_LENGTH,
    )
    source_url: HttpUrl | None = Field(default=None, max_length=2048)
    original_filename: str | None = Field(default=None, max_length=255)
    content_type: str | None = Field(default=None, max_length=128)
    storage_references: list[str] = Field(default_factory=list, max_length=20)
    idempotency_key: str | None = Field(
        default=None,
        min_length=8,
        max_length=80,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )

    @field_validator("source_title", "original_text", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return value.strip() or None

    @field_validator("original_filename")
    @classmethod
    def validate_filename(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if (
            not normalized
            or "/" in normalized
            or "\\" in normalized
            or normalized in {".", ".."}
            or any(ord(character) < 32 for character in normalized)
        ):
            raise ValueError("original_filename must be a plain filename")
        return normalized

    @field_validator("content_type")
    @classmethod
    def validate_content_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*", normalized):
            raise ValueError("content_type must be a valid media type")
        return normalized

    @field_validator("storage_references")
    @classmethod
    def validate_storage_references(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in value:
            item = _validate_storage_reference(raw)
            if item in seen:
                continue
            seen.add(item)
            normalized.append(item)
        return normalized

    @model_validator(mode="after")
    def validate_source_content(self) -> JobImportSourceCreate:
        text_types = {"pasted_text", "rough_description", "external_listing_text"}
        file_types = {"screenshot", "screenshots", "document", "pdf"}
        if self.source_type in text_types and not self.original_text:
            raise ValueError("original_text is required for text import sources")
        if self.source_type == "public_url" and self.source_url is None:
            raise ValueError("source_url is required for public URL sources")
        if self.source_type in file_types and not self.storage_references:
            raise ValueError("a private storage reference is required for file sources")
        if self.source_type == "screenshots" and len(self.storage_references) < 2:
            raise ValueError("multiple screenshot sources require at least two storage references")
        if self.source_type in file_types and (not self.original_filename or not self.content_type):
            raise ValueError("file sources require original_filename and content_type")
        if (
            self.source_type == "other"
            and not self.original_text
            and self.source_url is None
            and not self.storage_references
        ):
            raise ValueError("other sources require text, a URL, or a storage reference")
        return self


class JobImportUrlSourceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_url: HttpUrl = Field(max_length=2048)
    source_title: str | None = Field(default=None, max_length=255)
    idempotency_key: str | None = Field(
        default=None,
        min_length=8,
        max_length=80,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )

    @field_validator("source_title", mode="before")
    @classmethod
    def normalize_source_title(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return value.strip() or None


class JobImportSourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: uuid.UUID
    owner_user_id: uuid.UUID
    source_type: JobImportSourceType
    source_title: str | None = None
    original_text: str | None = None
    source_url: str | None = None
    final_source_url: str | None = None
    retrieved_at: datetime | None = None
    retrieval_metadata: dict[str, object] | None = None
    original_filename: str | None = None
    content_type: str | None = None
    storage_references: list[str]
    processing_state: str
    retention_policy: str
    content_redacted_at: datetime | None = None
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class JobImportDraftInitialize(BaseModel):
    model_config = ConfigDict(extra="forbid")

    extraction_schema_version: int = Field(
        default=CURRENT_EXTRACTION_SCHEMA_VERSION,
        ge=1,
    )
    target_listing_schema_version: int = Field(
        default=CURRENT_LISTING_SCHEMA_VERSION,
        ge=1,
    )
    supersedes_draft_id: uuid.UUID | None = None
    idempotency_key: str | None = Field(
        default=None,
        min_length=8,
        max_length=80,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )


class JobImportEvidenceLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    char_start: int | None = Field(default=None, ge=0)
    char_end: int | None = Field(default=None, ge=0)
    document_page: int | None = Field(default=None, ge=1, le=10_000)
    screenshot_index: int | None = Field(default=None, ge=0, le=999)
    source_url: HttpUrl | None = None

    @model_validator(mode="after")
    def validate_character_range(self) -> JobImportEvidenceLocation:
        if self.char_end is not None and self.char_start is None:
            raise ValueError("char_start is required when char_end is supplied")
        if (
            self.char_start is not None
            and self.char_end is not None
            and self.char_end <= self.char_start
        ):
            raise ValueError("char_end must be greater than char_start")
        return self


class JobImportEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snippet: str = Field(min_length=1, max_length=MAX_EVIDENCE_SNIPPET_LENGTH)
    location: JobImportEvidenceLocation | None = None

    @field_validator("snippet")
    @classmethod
    def validate_verbatim_snippet(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("evidence snippet cannot be empty")
        if any(ord(character) < 32 and character not in "\n\r\t" for character in value):
            raise ValueError("evidence snippet contains unsupported control characters")
        # React renders this value as text, and JSON serialization escapes it. Keep
        # the exact source quote so stored offsets retain a byte-for-byte invariant.
        return value


class JobImportProviderConfidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: float | None = Field(default=None, ge=0, le=1)
    label: str | None = Field(default=None, max_length=40)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    @field_validator("label")
    @classmethod
    def sanitize_label(cls, value: str | None) -> str | None:
        return _safe_provider_text(value)

    @field_validator("metadata")
    @classmethod
    def bound_metadata(cls, value: dict[str, JsonValue]) -> dict[str, JsonValue]:
        return _bounded_json(
            value,
            maximum=MAX_MACHINE_METADATA_BYTES,
            label="provider confidence metadata",
        )  # type: ignore[return-value]


class JobImportExtractionField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_path: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_]*$")
    value: JsonValue
    provenance: Literal[
        "directly_supplied",
        "extracted_from_source",
        "suggested_inference",
    ]
    evidence: list[JobImportEvidence] = Field(default_factory=list, max_length=5)
    explanation: str | None = Field(default=None, max_length=1000)
    provider_confidence: JobImportProviderConfidence | None = None

    @field_validator("value")
    @classmethod
    def bound_value(cls, value: JsonValue) -> JsonValue:
        if value is None:
            raise ValueError("proposed fields require a non-null value")
        return _bounded_json(
            value,
            maximum=MAX_FIELD_JSON_BYTES,
            label="proposed field value",
        )  # type: ignore[return-value]

    @field_validator("explanation")
    @classmethod
    def sanitize_explanation(cls, value: str | None) -> str | None:
        return _safe_provider_text(value)

    @model_validator(mode="after")
    def require_extraction_evidence(self) -> JobImportExtractionField:
        if self.provenance in {"directly_supplied", "extracted_from_source"} and not self.evidence:
            raise ValueError("directly supplied and extracted fields require evidence")
        if self.provenance == "suggested_inference" and not self.explanation:
            raise ValueError("suggested inferences require an explanation")
        return self


class JobImportConflictValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: JsonValue
    evidence: list[JobImportEvidence] = Field(min_length=1, max_length=5)

    @field_validator("value")
    @classmethod
    def bound_value(cls, value: JsonValue) -> JsonValue:
        if value is None:
            raise ValueError("conflicting values cannot be null")
        return _bounded_json(
            value,
            maximum=MAX_FIELD_JSON_BYTES,
            label="conflicting field value",
        )  # type: ignore[return-value]


class JobImportConflict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_path: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_]*$")
    values: list[JobImportConflictValue] = Field(min_length=2, max_length=8)
    explanation: str | None = Field(default=None, max_length=1000)
    provider_confidence: JobImportProviderConfidence | None = None

    @field_validator("explanation")
    @classmethod
    def sanitize_explanation(cls, value: str | None) -> str | None:
        return _safe_provider_text(value)

    @model_validator(mode="after")
    def require_distinct_values(self) -> JobImportConflict:
        serialized = {
            json.dumps(item.value, ensure_ascii=False, sort_keys=True) for item in self.values
        }
        if len(serialized) < 2:
            raise ValueError("conflicts require at least two distinct values")
        return self


class JobImportMissingField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_path: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_]*$")
    explanation: str | None = Field(default=None, max_length=1000)
    evidence: list[JobImportEvidence] = Field(default_factory=list, max_length=3)

    @field_validator("explanation")
    @classmethod
    def sanitize_explanation(cls, value: str | None) -> str | None:
        return _safe_provider_text(value)


class JobImportProcessingWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9_.-]*$")
    message: str = Field(min_length=1, max_length=500)
    field_path: str | None = Field(
        default=None,
        max_length=120,
        pattern=r"^[a-z][a-z0-9_]*$",
    )
    evidence: list[JobImportEvidence] = Field(default_factory=list, max_length=3)

    @field_validator("message")
    @classmethod
    def sanitize_message(cls, value: str) -> str:
        sanitized = _safe_provider_text(value)
        if sanitized is None:
            raise ValueError("warning message cannot be empty")
        return sanitized


class JobImportExtractionResponse(BaseModel):
    """CreatorJobs-owned response contract for a future provider adapter."""

    model_config = ConfigDict(extra="forbid")

    extraction_schema_version: int = Field(ge=1)
    target_listing_schema_version: int = Field(ge=1)
    fields: list[JobImportExtractionField] = Field(default_factory=list, max_length=100)
    conflicts: list[JobImportConflict] = Field(default_factory=list, max_length=30)
    missing_fields: list[JobImportMissingField] = Field(default_factory=list, max_length=100)
    warnings: list[JobImportProcessingWarning] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def enforce_unique_field_paths(self) -> JobImportExtractionResponse:
        paths = [
            *(field.field_path for field in self.fields),
            *(conflict.field_path for conflict in self.conflicts),
            *(missing.field_path for missing in self.missing_fields),
        ]
        if len(paths) != len(set(paths)):
            raise ValueError("each field path may appear only once in an extraction response")
        _bounded_json(
            self.model_dump(mode="json"),
            maximum=MAX_EXTRACTION_RESPONSE_BYTES,
            label="extraction response",
        )
        return self


class JobImportProviderMetadata(BaseModel):
    """Audit metadata supplied only by a future trusted provider adapter."""

    model_config = ConfigDict(extra="forbid")

    provider_name: str | None = Field(default=None, max_length=80)
    model_name: str | None = Field(default=None, max_length=120)
    model_version: str | None = Field(default=None, max_length=80)
    instruction_version: str | None = Field(default=None, max_length=80)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    @field_validator(
        "provider_name",
        "model_name",
        "model_version",
        "instruction_version",
        mode="before",
    )
    @classmethod
    def normalize_metadata_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return value.strip() or None

    @field_validator("metadata")
    @classmethod
    def bound_metadata(cls, value: dict[str, JsonValue]) -> dict[str, JsonValue]:
        return _bounded_json(
            value,
            maximum=MAX_MACHINE_METADATA_BYTES,
            label="provider metadata",
        )  # type: ignore[return-value]


class JobImportSourceRepresentation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_type: JobImportSourceType
    original_text: str | None = Field(default=None, max_length=MAX_IMPORT_SOURCE_TEXT_LENGTH)
    source_url: str | None = Field(default=None, max_length=2048)
    original_filename: str | None = Field(default=None, max_length=255)
    content_type: str | None = Field(default=None, max_length=128)
    storage_references: list[str] = Field(default_factory=list, max_length=20)


class JobImportFieldDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_path: str
    native_field: str | None
    value_schema: dict[str, JsonValue]
    confirmation_policy: AIConfirmationPolicy
    nested_confirmation_policies: dict[str, AIConfirmationPolicy]
    allowed_provenance: list[
        Literal["directly_supplied", "extracted_from_source", "suggested_inference"]
    ]
    evidence_required_for_extraction: bool
    requires_recruiter_review: bool
    missing_requirement: MissingRequirement
    review_section: ReviewSection
    custom_values_allowed: bool
    inference_risk: Literal["low", "medium", "high"]
    allowed_decision_origins: list[ImportDecisionOrigin]
    auto_fill_confidence: ImportDecisionConfidence | None = None
    suggestion_confidence: ImportDecisionConfidence | None = None


class JobImportExtractionRequest(BaseModel):
    """Provider-neutral input contract produced for a future adapter."""

    model_config = ConfigDict(extra="forbid")

    extraction_schema_version: int
    target_listing_schema_version: int
    source: JobImportSourceRepresentation
    allowed_taxonomies: dict[str, list[str]]
    field_definitions: list[JobImportFieldDefinition]
    inference_restrictions: list[str]
    output_validation_instructions: list[str]


class JobImportFieldReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["accept", "edit", "reject", "reset"]
    edited_value: JsonValue | None = None

    @field_validator("edited_value")
    @classmethod
    def bound_edited_value(cls, value: JsonValue | None) -> JsonValue | None:
        if value is None:
            return None
        return _bounded_json(
            value,
            maximum=MAX_FIELD_JSON_BYTES,
            label="edited field value",
        )  # type: ignore[return-value]

    @model_validator(mode="after")
    def validate_action_value(self) -> JobImportFieldReviewRequest:
        if self.action == "edit" and self.edited_value is None:
            raise ValueError("edited_value is required for edit actions")
        if self.action != "edit" and self.edited_value is not None:
            raise ValueError("edited_value is only valid for edit actions")
        return self


class JobImportConflictResolutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected_value_index: int | None = Field(default=None, ge=0, le=7)
    replacement_value: JsonValue | None = None

    @field_validator("replacement_value")
    @classmethod
    def bound_replacement_value(cls, value: JsonValue | None) -> JsonValue | None:
        if value is None:
            return None
        return _bounded_json(
            value,
            maximum=MAX_FIELD_JSON_BYTES,
            label="conflict replacement value",
        )  # type: ignore[return-value]

    @model_validator(mode="after")
    def require_exactly_one_resolution(self) -> JobImportConflictResolutionRequest:
        if (self.selected_value_index is None) == (self.replacement_value is None):
            raise ValueError("select one conflicting value or provide one replacement value")
        return self


class JobImportApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["create_new"] = "create_new"


class JobImportProcessRequest(BaseModel):
    """Strict empty body: provider, model, and metadata are server-owned."""

    model_config = ConfigDict(extra="forbid")


class JobImportFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: uuid.UUID
    field_path: str
    proposed_value: Any | None = None
    provenance_state: JobImportProvenanceState
    review_status: JobImportReviewStatus
    authority_state: JobImportAuthorityState
    decision_origin: ImportDecisionOrigin
    decision_confidence: ImportDecisionConfidence | None = None
    needs_review: bool
    rationale_code: str | None = None
    evidence: list[dict[str, object]]
    conflicting_values: list[dict[str, object]]
    explanation: str | None = None
    provider_confidence: dict[str, object] | None = None
    confirmed_value: Any | None = None
    edited_value: Any | None = None
    effective_value: Any | None = None
    missing_requirement: MissingRequirement
    requires_confirmation: bool
    validation_errors: list[str]
    selected_conflict_index: int | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class JobImportDraftRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: uuid.UUID
    owner_user_id: uuid.UUID
    source_id: uuid.UUID
    supersedes_draft_id: uuid.UUID | None = None
    extraction_schema_version: int
    target_listing_schema_version: int
    processing_status: JobImportProcessingStatus
    validation_status: JobImportValidationStatus
    confirmation_state: Literal["unreviewed", "partial", "confirmed"]
    can_apply_to_native_draft: bool
    can_publish_directly: bool
    provider_name: str | None = None
    model_name: str | None = None
    model_version: str | None = None
    instruction_version: str | None = None
    provider_metadata: dict[str, object] | None = None
    processing_warnings: list[dict[str, object]]
    missing_fields: list[dict[str, object]]
    validation_errors: dict[str, object]
    review_sections: list[dict[str, object]]
    target_job_id: uuid.UUID | None = None
    processed_at: datetime | None = None
    applied_at: datetime | None = None
    discarded_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    fields: list[JobImportFieldRead]


class JobImportDraftContextRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft: JobImportDraftRead
    source_type: JobImportSourceType
    source_label: str
    source_url: str | None = None


class JobImportApplyResponse(BaseModel):
    draft: JobImportDraftRead
    job: JobRead
    created: bool


class JobImportProcessResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal["processed", "already_processing", "already_processed"]
    draft: JobImportDraftRead
