from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.integrations.openai.job_import_spans import (
    EVIDENCE_SPAN_ID_PATTERN,
    MAX_EVIDENCE_SPANS_PER_REFERENCE,
    EvidenceSpanSet,
    evidence_reference_diagnostics,
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


class OpenAIJobImportPostParseError(ValueError):
    """A bounded diagnostic failure that never retains provider or source text."""

    def __init__(
        self,
        reason: str,
        *,
        diagnostics: dict[str, object] | None = None,
    ) -> None:
        super().__init__(reason)
        self.reason = reason
        self.diagnostics = diagnostics or {}


def _safe_field_path(payload: object, location: tuple[object, ...]) -> str | None:
    if not isinstance(payload, dict) or len(location) < 2:
        return None
    collection_name, raw_index = location[0], location[1]
    if collection_name not in {"fields", "conflicts", "missing_fields", "warnings"}:
        return None
    collection = payload.get(collection_name)
    if not isinstance(collection, list) or not isinstance(raw_index, int):
        return None
    if raw_index < 0 or raw_index >= len(collection):
        return None
    item = collection[raw_index]
    if not isinstance(item, dict):
        return None
    field_path = item.get("field_path")
    if not isinstance(field_path, str) or len(field_path) > 120:
        return None
    return field_path if field_path.replace("_", "").isalnum() else None


def wire_validation_failure(
    error: ValidationError,
    *,
    payload: object,
    span_set: EvidenceSpanSet | None = None,
) -> OpenAIJobImportPostParseError:
    """Classify strict-wire failures without retaining values from the response."""

    errors = error.errors(
        include_url=False,
        include_context=False,
        include_input=False,
    )
    first = errors[0] if errors else {}
    location = tuple(first.get("loc", ()))
    error_type = str(first.get("type") or "")
    message = str(first.get("msg") or "").casefold()
    reason = "provider_wire_schema_failure"
    if "evidence_span_ids" in location:
        if error_type in {"too_long", "list_too_long"} or "at most" in message:
            reason = "excessive_span_ids"
        elif error_type in {
            "string_pattern_mismatch",
            "string_too_long",
            "string_too_short",
        }:
            reason = "malformed_span_id"
        elif error_type == "extra_forbidden":
            reason = "evidence_not_allowed"
        else:
            reason = "invalid_evidence_reference"
    elif (
        location
        and location[0] == "fields"
        and error_type
        in {
            "too_long",
            "list_too_long",
        }
    ):
        reason = "excessive_field_count"
    elif location and location[0] == "conflicts":
        reason = (
            "excessive_conflict_count"
            if len(location) == 1 and "at most" in message
            else "malformed_conflict"
        )
    elif (
        location
        and location[0] == "warnings"
        and error_type
        in {
            "too_long",
            "list_too_long",
        }
    ):
        reason = "excessive_warning_count"
    elif location and location[0] == "missing_fields":
        reason = "malformed_missing_field"
    elif "field_path" in location:
        reason = "invalid_field_path"
    elif error_type == "recursion_loop" or "recursion" in message:
        reason = "excessive_nesting"

    field_path = _safe_field_path(payload, location)
    diagnostics: dict[str, object] = {
        "processing_stage": "provider_wire_validation",
        "failure_subreason": reason,
        "validation_error_count": len(errors),
        **raw_evidence_diagnostics(payload, span_set=span_set),
    }
    if field_path is not None:
        diagnostics["affected_field_path"] = field_path
    if location and location[0] in {"fields", "conflicts", "warnings", "missing_fields"}:
        diagnostics["affected_structure"] = str(location[0])
    if len(location) > 1 and isinstance(location[1], int):
        diagnostics["affected_structure_index"] = location[1]
    return OpenAIJobImportPostParseError(reason, diagnostics=diagnostics)


def raw_evidence_diagnostics(
    payload: object,
    *,
    span_set: EvidenceSpanSet | None,
) -> dict[str, object]:
    """Count evidence references in an untrusted wire payload without retaining it."""

    if not isinstance(payload, dict):
        return {}
    groups: list[object] = []
    fields = payload.get("fields")
    conflicts = payload.get("conflicts")
    warnings = payload.get("warnings")
    if isinstance(fields, list):
        groups.extend(item.get("evidence_span_ids") for item in fields if isinstance(item, dict))
    if isinstance(conflicts, list):
        for conflict in conflicts:
            if not isinstance(conflict, dict):
                continue
            alternatives = conflict.get("values")
            if isinstance(alternatives, list):
                groups.extend(
                    alternative.get("evidence_span_ids")
                    for alternative in alternatives
                    if isinstance(alternative, dict)
                )
    if isinstance(warnings, list):
        groups.extend(item.get("evidence_span_ids") for item in warnings if isinstance(item, dict))

    returned_count = 0
    invalid_count = 0
    unknown_count = 0
    duplicate_count = 0
    invalid_ids: list[str] = []
    for raw_ids in groups:
        if not isinstance(raw_ids, list):
            continue
        returned_count += len(raw_ids)
        span_ids = [item for item in raw_ids if isinstance(item, str)]
        invalid_count += len(raw_ids) - len(span_ids)
        if span_set is None:
            continue
        group = evidence_reference_diagnostics(span_set, span_ids)
        invalid_count += int(group["invalid_evidence_id_count"])
        unknown_count += int(group["unknown_evidence_id_count"])
        duplicate_count += int(group["duplicate_evidence_id_count"])
        for span_id in group.get("invalid_evidence_span_ids", []):
            if isinstance(span_id, str) and span_id not in invalid_ids:
                invalid_ids.append(span_id)

    return {
        "returned_evidence_id_count": returned_count,
        "invalid_evidence_id_count": invalid_count,
        "unknown_evidence_id_count": unknown_count,
        "duplicate_evidence_id_count": duplicate_count,
        **({"invalid_evidence_span_ids": invalid_ids[:5]} if invalid_ids else {}),
    }


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
            'for example "\\"Video Editor\\"", "35000", or "[\\"youtube\\"]".'
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
    def _decode_value(
        value_json: str,
        *,
        diagnostic_context: dict[str, object],
    ) -> object:
        if len(value_json.encode("utf-8")) > MAX_FIELD_JSON_BYTES:
            raise OpenAIJobImportPostParseError(
                "invalid_value_size",
                diagnostics={
                    "processing_stage": "provider_value_decoding",
                    "failure_subreason": "invalid_value_size",
                    **diagnostic_context,
                },
            )
        try:
            return json.loads(value_json)
        except json.JSONDecodeError as exc:
            raise OpenAIJobImportPostParseError(
                "invalid_json_value",
                diagnostics={
                    "processing_stage": "provider_value_decoding",
                    "failure_subreason": "invalid_json_value",
                    **diagnostic_context,
                },
            ) from exc
        except RecursionError as exc:
            raise OpenAIJobImportPostParseError(
                "excessive_nesting",
                diagnostics={
                    "processing_stage": "provider_value_decoding",
                    "failure_subreason": "excessive_nesting",
                    **diagnostic_context,
                },
            ) from exc

    @staticmethod
    def _resolve_evidence(
        span_ids: list[str],
        *,
        span_set: EvidenceSpanSet,
        maximum: int = MAX_EVIDENCE_SPANS_PER_REFERENCE,
        diagnostic_context: dict[str, object] | None = None,
    ) -> list[dict[str, object]]:
        return [
            evidence.model_dump(mode="json")
            for evidence in resolve_evidence_span_ids(
                span_set,
                span_ids,
                maximum=maximum,
                diagnostic_context=diagnostic_context,
            )
        ]

    def evidence_diagnostics(self, *, span_set: EvidenceSpanSet) -> dict[str, object]:
        groups = [
            *(field.evidence_span_ids for field in self.fields),
            *(
                alternative.evidence_span_ids
                for conflict in self.conflicts
                for alternative in conflict.values
            ),
            *(warning.evidence_span_ids for warning in self.warnings),
        ]
        returned_count = 0
        invalid_count = 0
        unknown_count = 0
        duplicate_count = 0
        invalid_ids: list[str] = []
        for span_ids in groups:
            group = evidence_reference_diagnostics(span_set, span_ids)
            returned_count += int(group["reference_evidence_id_count"])
            invalid_count += int(group["invalid_evidence_id_count"])
            unknown_count += int(group["unknown_evidence_id_count"])
            duplicate_count += int(group["duplicate_evidence_id_count"])
            for span_id in group.get("invalid_evidence_span_ids", []):
                if isinstance(span_id, str) and span_id not in invalid_ids:
                    invalid_ids.append(span_id)
        return {
            "span_count": len(span_set.spans),
            "returned_evidence_id_count": returned_count,
            "invalid_evidence_id_count": invalid_count,
            "unknown_evidence_id_count": unknown_count,
            "duplicate_evidence_id_count": duplicate_count,
            "provider_field_count": len(self.fields),
            "provider_conflict_count": len(self.conflicts),
            "provider_missing_field_count": len(self.missing_fields),
            "provider_warning_count": len(self.warnings),
            **({"invalid_evidence_span_ids": invalid_ids[:5]} if invalid_ids else {}),
        }

    @staticmethod
    def _domain_validation_failure(
        error: ValidationError,
        *,
        payload: dict[str, object],
    ) -> OpenAIJobImportPostParseError:
        errors = error.errors(
            include_url=False,
            include_context=False,
            include_input=False,
        )
        first = errors[0] if errors else {}
        location = tuple(first.get("loc", ()))
        message = str(first.get("msg") or "").casefold()
        error_type = str(first.get("type") or "")
        reason = "provider_neutral_schema_failure"
        if "require evidence" in message:
            reason = "missing_required_evidence"
        elif "each field path may appear only once" in message:
            reason = "duplicate_field_path"
        elif "conflicts require at least two distinct values" in message:
            reason = "malformed_conflict"
        elif "extraction response" in message and "too large" in message:
            reason = "response_size_exceeded"
        elif error_type == "recursion_loop" or "recursion" in message:
            reason = "excessive_nesting"

        field_path = _safe_field_path(payload, location)
        diagnostics: dict[str, object] = {
            "processing_stage": "provider_neutral_validation",
            "failure_subreason": reason,
            "validation_error_count": len(errors),
        }
        if field_path is not None:
            diagnostics["affected_field_path"] = field_path
        if location and location[0] in {"fields", "conflicts", "warnings", "missing_fields"}:
            diagnostics["affected_structure"] = str(location[0])
        if len(location) > 1 and isinstance(location[1], int):
            diagnostics["affected_structure_index"] = location[1]
        return OpenAIJobImportPostParseError(reason, diagnostics=diagnostics)

    @staticmethod
    def _normalize_duplicate_field_paths(
        payload: dict[str, object],
    ) -> dict[str, object]:
        """Repair only duplicate paths whose meaning is unambiguous.

        Structured output cannot express the cross-collection invariant that a
        field path appears once across ``fields``, ``conflicts`` and
        ``missing_fields``. A provider can therefore return a perfectly useful
        extracted field and also repeat the path as missing, or emit the exact
        same field twice. Neither case should discard the rest of the job.

        This deliberately does *not* choose between distinct proposed values,
        nor between a field and a conflict. Those remain invalid and are
        rejected by the provider-neutral contract below.
        """

        fields = payload.get("fields")
        conflicts = payload.get("conflicts")
        missing_fields = payload.get("missing_fields")
        warnings = payload.get("warnings")
        if not all(
            isinstance(items, list) for items in (fields, conflicts, missing_fields, warnings)
        ):
            return payload

        assert isinstance(fields, list)
        assert isinstance(conflicts, list)
        assert isinstance(missing_fields, list)
        assert isinstance(warnings, list)

        def canonical(value: object) -> str:
            return json.dumps(
                value,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )

        def merge_evidence(
            first: dict[str, object],
            duplicate: dict[str, object],
        ) -> None:
            merged: list[object] = []
            seen: set[str] = set()
            for raw_evidence in (
                *(first.get("evidence") if isinstance(first.get("evidence"), list) else []),
                *(
                    duplicate.get("evidence")
                    if isinstance(duplicate.get("evidence"), list)
                    else []
                ),
            ):
                fingerprint = canonical(raw_evidence)
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                merged.append(raw_evidence)
                if len(merged) >= MAX_EVIDENCE_SPANS_PER_REFERENCE:
                    break
            first["evidence"] = merged

        def confidence_rank(value: dict[str, object]) -> tuple[float, float]:
            label = value.get("label")
            label_rank = {
                "low": 0.0,
                "medium": 0.5,
                "high": 1.0,
            }.get(label.strip().casefold() if isinstance(label, str) else "")
            score = value.get("score")
            numeric_score = (
                float(score)
                if isinstance(score, (int, float)) and not isinstance(score, bool)
                else 0.0
            )
            return (
                label_rank if label_rank is not None else numeric_score,
                numeric_score,
            )

        def merge_ancillary_values(
            first: dict[str, object],
            duplicate: dict[str, object],
        ) -> None:
            merge_evidence(first, duplicate)
            explanation = first.get("explanation")
            duplicate_explanation = duplicate.get("explanation")
            if (
                not isinstance(explanation, str)
                or not explanation.strip()
            ) and isinstance(duplicate_explanation, str) and duplicate_explanation.strip():
                first["explanation"] = duplicate_explanation

            confidence_values = [
                value
                for value in (
                    first.get("provider_confidence"),
                    duplicate.get("provider_confidence"),
                )
                if isinstance(value, dict)
            ]
            if confidence_values:
                # The lower provider-reported confidence is the safe choice;
                # deterministic server evidence may raise it later under the
                # domain policy, but duplicate provider output may not.
                first["provider_confidence"] = min(
                    confidence_values,
                    key=confidence_rank,
                )

        normalized_paths: set[str] = set()
        first_field_by_path: dict[str, dict[str, object]] = {}
        normalized_fields: list[object] = []
        for raw_field in fields:
            if not isinstance(raw_field, dict):
                normalized_fields.append(raw_field)
                continue
            field_path = raw_field.get("field_path")
            if not isinstance(field_path, str):
                normalized_fields.append(raw_field)
                continue
            previous = first_field_by_path.get(field_path)
            if previous is None:
                first_field_by_path[field_path] = raw_field
                normalized_fields.append(raw_field)
                continue
            if (
                canonical(previous.get("value")) == canonical(raw_field.get("value"))
                and previous.get("provenance") == raw_field.get("provenance")
            ):
                merge_ancillary_values(previous, raw_field)
                normalized_paths.add(field_path)
                continue
            # Keep distinct duplicates so the strict domain validator rejects
            # them instead of silently choosing one provider value.
            normalized_fields.append(raw_field)

        occupied_paths = {
            item.get("field_path")
            for item in normalized_fields
            if isinstance(item, dict) and isinstance(item.get("field_path"), str)
        } | {
            item.get("field_path")
            for item in conflicts
            if isinstance(item, dict) and isinstance(item.get("field_path"), str)
        }
        seen_missing: set[str] = set()
        normalized_missing: list[object] = []
        for raw_missing in missing_fields:
            if not isinstance(raw_missing, dict):
                normalized_missing.append(raw_missing)
                continue
            field_path = raw_missing.get("field_path")
            if not isinstance(field_path, str):
                normalized_missing.append(raw_missing)
                continue
            if field_path in occupied_paths or field_path in seen_missing:
                normalized_paths.add(field_path)
                continue
            seen_missing.add(field_path)
            normalized_missing.append(raw_missing)

        normalized = {
            **payload,
            "fields": normalized_fields,
            "missing_fields": normalized_missing,
        }
        normalized_warnings = list(warnings)
        for field_path in sorted(normalized_paths):
            if len(normalized_warnings) >= 30:
                break
            warning = {
                "code": "provider_duplicate_path_normalized",
                "message": "Repeated provider output for this field was normalized safely.",
                "field_path": field_path,
                "evidence": [],
            }
            candidate = {**normalized, "warnings": [*normalized_warnings, warning]}
            if (
                len(
                    json.dumps(
                        candidate,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode("utf-8")
                )
                > MAX_EXTRACTION_RESPONSE_BYTES
            ):
                break
            normalized_warnings.append(warning)
        normalized["warnings"] = normalized_warnings
        return normalized

    def to_domain_response(self, *, span_set: EvidenceSpanSet) -> JobImportExtractionResponse:
        payload = self.model_dump(mode="json")
        for field_index, field in enumerate(payload["fields"]):
            field_context = {
                "affected_structure": "fields",
                "affected_structure_index": field_index,
                "affected_field_path": field["field_path"],
            }
            field["value"] = self._decode_value(
                field.pop("value_json"),
                diagnostic_context=field_context,
            )
            field["evidence"] = self._resolve_evidence(
                field.pop("evidence_span_ids"),
                span_set=span_set,
                diagnostic_context=field_context,
            )
        for conflict_index, conflict in enumerate(payload["conflicts"]):
            for alternative_index, alternative in enumerate(conflict["values"]):
                conflict_context = {
                    "affected_structure": "conflicts",
                    "affected_structure_index": conflict_index,
                    "affected_conflict_alternative_index": alternative_index,
                    "affected_field_path": conflict["field_path"],
                }
                alternative["value"] = self._decode_value(
                    alternative.pop("value_json"),
                    diagnostic_context=conflict_context,
                )
                alternative["evidence"] = self._resolve_evidence(
                    alternative.pop("evidence_span_ids"),
                    span_set=span_set,
                    diagnostic_context=conflict_context,
                )
        for missing in payload["missing_fields"]:
            missing["evidence"] = []
        for warning_index, warning in enumerate(payload["warnings"]):
            warning["evidence"] = self._resolve_evidence(
                warning.pop("evidence_span_ids"),
                span_set=span_set,
                maximum=3,
                diagnostic_context={
                    "affected_structure": "warnings",
                    "affected_structure_index": warning_index,
                    **(
                        {"affected_field_path": warning["field_path"]}
                        if warning.get("field_path") is not None
                        else {}
                    ),
                },
            )
        payload = self._normalize_duplicate_field_paths(payload)
        try:
            return JobImportExtractionResponse.model_validate(payload)
        except ValidationError as exc:
            raise self._domain_validation_failure(exc, payload=payload) from exc

    @model_validator(mode="after")
    def bound_wire_response(self) -> OpenAIJobImportExtractionResponse:
        raw = self.model_dump_json()
        if len(raw.encode("utf-8")) > MAX_EXTRACTION_RESPONSE_BYTES:
            raise ValueError("extraction response is too large")
        return self
