from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.job_import import (
    MAX_EVIDENCE_SNIPPET_LENGTH,
    MAX_EXTRACTION_RESPONSE_BYTES,
    MAX_FIELD_JSON_BYTES,
    JobImportExtractionResponse,
)


class OpenAIJobImportEvidenceLocation(BaseModel):
    """Structured-output-safe evidence location.

    The provider-neutral contract uses ``HttpUrl`` for source URLs, whose JSON
    Schema ``uri`` format is not accepted by OpenAI Structured Outputs. The
    adapter validates this plain string through the domain model after parsing.
    """

    model_config = ConfigDict(extra="forbid")

    char_start: int | None = Field(default=None, ge=0)
    char_end: int | None = Field(default=None, ge=0)
    document_page: int | None = Field(default=None, ge=1, le=10_000)
    screenshot_index: int | None = Field(default=None, ge=0, le=999)
    source_url: str | None = Field(default=None, max_length=2048)


class OpenAIJobImportEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snippet: str = Field(min_length=1, max_length=MAX_EVIDENCE_SNIPPET_LENGTH)
    location: OpenAIJobImportEvidenceLocation | None = None


class OpenAIJobImportProviderConfidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: float | None = Field(default=None, ge=0, le=1)
    label: str | None = Field(default=None, max_length=40)


class OpenAIJobImportExtractionField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_path: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_]*$")
    value_json: str = Field(
        min_length=1,
        max_length=MAX_FIELD_JSON_BYTES,
        description=(
            "One compact valid JSON document encoding the native field value; "
            "for example \"\\\"Video Editor\\\"\", \"35000\", or \"[\\\"youtube\\\"]\"."
        ),
    )
    provenance: Literal[
        "directly_supplied",
        "extracted_from_source",
        "suggested_inference",
    ]
    evidence: list[OpenAIJobImportEvidence] = Field(default_factory=list, max_length=5)
    explanation: str | None = Field(default=None, max_length=1000)
    provider_confidence: OpenAIJobImportProviderConfidence | None = None


class OpenAIJobImportConflictValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value_json: str = Field(
        min_length=1,
        max_length=MAX_FIELD_JSON_BYTES,
        description="One compact valid JSON document encoding this conflict alternative.",
    )
    evidence: list[OpenAIJobImportEvidence] = Field(min_length=1, max_length=5)


class OpenAIJobImportConflict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_path: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_]*$")
    values: list[OpenAIJobImportConflictValue] = Field(min_length=2, max_length=8)
    explanation: str | None = Field(default=None, max_length=1000)
    provider_confidence: OpenAIJobImportProviderConfidence | None = None


class OpenAIJobImportMissingField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_path: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_]*$")
    explanation: str | None = Field(default=None, max_length=1000)
    evidence: list[OpenAIJobImportEvidence] = Field(default_factory=list, max_length=3)


class OpenAIJobImportProcessingWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9_.-]*$")
    message: str = Field(min_length=1, max_length=500)
    field_path: str | None = Field(
        default=None,
        max_length=120,
        pattern=r"^[a-z][a-z0-9_]*$",
    )
    evidence: list[OpenAIJobImportEvidence] = Field(default_factory=list, max_length=3)


class OpenAIJobImportExtractionResponse(BaseModel):
    """OpenAI wire shape translated into the provider-neutral domain response.

    Arbitrary ``JsonValue`` produces an unconstrained ``{}`` definition in the
    SDK's strict JSON Schema, which OpenAI rejects. Values therefore cross the
    provider boundary as bounded JSON documents and are immediately decoded and
    validated by ``JobImportExtractionResponse`` before entering the service.
    """

    model_config = ConfigDict(extra="forbid")

    extraction_schema_version: int = Field(ge=1)
    target_listing_schema_version: int = Field(ge=1)
    fields: list[OpenAIJobImportExtractionField] = Field(default_factory=list, max_length=100)
    conflicts: list[OpenAIJobImportConflict] = Field(default_factory=list, max_length=30)
    missing_fields: list[OpenAIJobImportMissingField] = Field(default_factory=list, max_length=100)
    warnings: list[OpenAIJobImportProcessingWarning] = Field(default_factory=list, max_length=30)

    @staticmethod
    def _decode_value(value_json: str) -> object:
        if len(value_json.encode("utf-8")) > MAX_FIELD_JSON_BYTES:
            raise ValueError("provider field value is too large")
        return json.loads(value_json)

    def to_domain_response(self) -> JobImportExtractionResponse:
        payload = self.model_dump(mode="json")
        for field in payload["fields"]:
            field["value"] = self._decode_value(field.pop("value_json"))
        for conflict in payload["conflicts"]:
            for alternative in conflict["values"]:
                alternative["value"] = self._decode_value(
                    alternative.pop("value_json")
                )
        return JobImportExtractionResponse.model_validate(payload)

    @model_validator(mode="after")
    def bound_wire_response(self) -> OpenAIJobImportExtractionResponse:
        raw = self.model_dump_json()
        if len(raw.encode("utf-8")) > MAX_EXTRACTION_RESPONSE_BYTES:
            raise ValueError("extraction response is too large")
        return self
