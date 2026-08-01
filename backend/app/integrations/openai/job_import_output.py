from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.integrations.openai.job_import_spans import (
    EVIDENCE_SPAN_ID_PATTERN,
    MAX_EVIDENCE_SPANS_PER_REFERENCE,
    EvidenceSpanSet,
    resolve_evidence_span_ids,
)
from app.schemas.job_import import (
    MAX_EXTRACTION_RESPONSE_BYTES,
    MAX_FIELD_JSON_BYTES,
    JobImportExtractionResponse,
)

_SpanId = Annotated[
    str,
    Field(
        min_length=5,
        max_length=5,
        pattern=EVIDENCE_SPAN_ID_PATTERN,
    ),
]


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
    evidence_span_ids: list[_SpanId] = Field(
        default_factory=list,
        max_length=MAX_EVIDENCE_SPANS_PER_REFERENCE,
    )
    explanation: str | None = Field(default=None, max_length=1000)
    provider_confidence: OpenAIJobImportProviderConfidence | None = None


class OpenAIJobImportConflictValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value_json: str = Field(
        min_length=1,
        max_length=MAX_FIELD_JSON_BYTES,
        description="One compact valid JSON document encoding this conflict alternative.",
    )
    evidence_span_ids: list[_SpanId] = Field(
        min_length=1,
        max_length=MAX_EVIDENCE_SPANS_PER_REFERENCE,
    )


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


class OpenAIJobImportProcessingWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9_.-]*$")
    message: str = Field(min_length=1, max_length=500)
    field_path: str | None = Field(
        default=None,
        max_length=120,
        pattern=r"^[a-z][a-z0-9_]*$",
    )
    evidence_span_ids: list[_SpanId] = Field(
        default_factory=list,
        max_length=3,
    )


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

    @staticmethod
    def _resolve_evidence(
        span_ids: list[str],
        *,
        span_set: EvidenceSpanSet,
        maximum: int = MAX_EVIDENCE_SPANS_PER_REFERENCE,
    ) -> list[dict[str, object]]:
        return [
            evidence.model_dump(mode="json")
            for evidence in resolve_evidence_span_ids(
                span_set,
                span_ids,
                maximum=maximum,
            )
        ]

    def to_domain_response(self, *, span_set: EvidenceSpanSet) -> JobImportExtractionResponse:
        payload = self.model_dump(mode="json")
        for field in payload["fields"]:
            field["value"] = self._decode_value(field.pop("value_json"))
            field["evidence"] = self._resolve_evidence(
                field.pop("evidence_span_ids"),
                span_set=span_set,
            )
        for conflict in payload["conflicts"]:
            for alternative in conflict["values"]:
                alternative["value"] = self._decode_value(
                    alternative.pop("value_json")
                )
                alternative["evidence"] = self._resolve_evidence(
                    alternative.pop("evidence_span_ids"),
                    span_set=span_set,
                )
        for missing in payload["missing_fields"]:
            missing["evidence"] = []
        for warning in payload["warnings"]:
            warning["evidence"] = self._resolve_evidence(
                warning.pop("evidence_span_ids"),
                span_set=span_set,
                maximum=3,
            )
        return JobImportExtractionResponse.model_validate(payload)

    @model_validator(mode="after")
    def bound_wire_response(self) -> OpenAIJobImportExtractionResponse:
        raw = self.model_dump_json()
        if len(raw.encode("utf-8")) > MAX_EXTRACTION_RESPONSE_BYTES:
            raise ValueError("extraction response is too large")
        return self
