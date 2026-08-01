from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.integrations.openai import job_import_spans as spans_module
from app.integrations.openai.job_import_output import (
    OpenAIJobImportExtractionResponse,
    OpenAIJobImportPostParseError,
)
from app.integrations.openai.job_import_spans import (
    EVIDENCE_SEGMENTATION_VERSION,
    MAX_EVIDENCE_SPAN_COUNT,
    MAX_EVIDENCE_SPAN_LENGTH,
    MAX_EVIDENCE_SPAN_TEXT_LENGTH,
    EvidenceSpanError,
    build_evidence_span_set,
    evidence_reference_diagnostics,
    resolve_evidence_span_ids,
)


@pytest.mark.parametrize(
    "source",
    [
        "A single creator-job sentence.",
        "First sentence. Second sentence! Is this third?",
        "Role\nVideo Editor\n\nResponsibilities\nEdit weekly videos",
        "- Edit talking-head footage\n• Add B-roll\n1. Create captions",
        "Heading\r\n\r\nLine with\ttabs\r\nFinal line",
        "Budget ₹35,000–₹45,000; $1,000, £900, or €950 — editor's rate.",
        "Apply at https://example.com/jobs/editor?source=creator&role=video",
        "<h1>Video Editor</h1>\nProficiency in Premiere Pro & After Effects.",
        (
            'JobPosting: {"title":"Video Editor","jobLocationType":"TELECOMMUTE"}\n'
            "Description: Paid-social videos (remote)."
        ),
        "Repeated requirement.\nRepeated requirement.",
    ],
)
def test_segmentation_preserves_exact_source_slices(source: str) -> None:
    span_set = build_evidence_span_set(source)

    assert span_set.segmentation_version == EVIDENCE_SEGMENTATION_VERSION
    assert 1 <= len(span_set.spans) <= MAX_EVIDENCE_SPAN_COUNT
    assert [span.span_id for span in span_set.spans] == [
        f"E{index:04d}" for index in range(1, len(span_set.spans) + 1)
    ]
    for index, span in enumerate(span_set.spans):
        assert span.order == index
        assert 0 < len(span.text) <= MAX_EVIDENCE_SPAN_LENGTH
        assert source[span.char_start : span.char_end] == span.text


def test_oversized_paragraph_splits_without_rewriting_or_omitting_words() -> None:
    source = " ".join(f"creatorword{index}" for index in range(180))
    span_set = build_evidence_span_set(source)

    assert len(span_set.spans) > 1
    assert all(len(span.text) <= MAX_EVIDENCE_SPAN_LENGTH for span in span_set.spans)
    reconstructed_words = [
        word for span in span_set.spans for word in span.text.split()
    ]
    assert reconstructed_words == source.split()


def test_segmentation_is_deterministic_and_source_bound() -> None:
    source = "Video Editor\nPremiere Pro required."
    first = build_evidence_span_set(source)
    second = build_evidence_span_set(source)
    changed = build_evidence_span_set(source + "\nRemote role.")

    assert first == second
    assert first.source_fingerprint == second.source_fingerprint
    assert changed.source_fingerprint != first.source_fingerprint
    assert changed.spans[: len(first.spans)] == first.spans


def test_provider_payload_contains_only_version_ids_and_exact_text() -> None:
    span_set = build_evidence_span_set("Video Editor\nRemote role")
    payload = span_set.provider_payload()
    serialized = json.dumps(payload)

    assert payload["segmentation_version"] == EVIDENCE_SEGMENTATION_VERSION
    assert payload["evidence_spans"] == [
        {"span_id": "E0001", "text": "Video Editor"},
        {"span_id": "E0002", "text": "Remote role"},
    ]
    assert "char_start" not in serialized
    assert "char_end" not in serialized
    assert "source_fingerprint" not in serialized


def test_blank_source_and_span_count_limit_fail_safely(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(EvidenceSpanError, match="no_meaningful_spans"):
        build_evidence_span_set(" \r\n\t\n")

    monkeypatch.setattr(spans_module, "MAX_EVIDENCE_SPAN_COUNT", 1)
    with pytest.raises(EvidenceSpanError, match="span_count_exceeded"):
        build_evidence_span_set("First line\nSecond line")


def test_total_provider_evidence_text_limit_is_enforced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(spans_module, "MAX_EVIDENCE_SPAN_TEXT_LENGTH", 8)
    with pytest.raises(EvidenceSpanError, match="span_text_limit_exceeded"):
        build_evidence_span_set("Video Editor")
    assert MAX_EVIDENCE_SPAN_TEXT_LENGTH == 100_000


def test_one_and_multiple_span_ids_resolve_in_server_source_order() -> None:
    source = "Title: Video Editor\nTool: Premiere Pro\nTool: After Effects"
    span_set = build_evidence_span_set(source)

    one = resolve_evidence_span_ids(span_set, ["E0002"])
    several = resolve_evidence_span_ids(span_set, ["E0003", "E0001"])

    assert [item.snippet for item in one] == ["Tool: Premiere Pro"]
    assert [item.snippet for item in several] == [
        "Title: Video Editor",
        "Tool: After Effects",
    ]
    for evidence in [*one, *several]:
        assert evidence.location is not None
        assert source[evidence.location.char_start : evidence.location.char_end] == (
            evidence.snippet
        )


@pytest.mark.parametrize(
    ("span_ids", "reason"),
    [
        (["E0001", "E0001"], "duplicate_span_id"),
        (["E9999"], "unknown_span_id"),
        (["E0002"], "unknown_span_id"),
        (["E1"], "malformed_span_id"),
        (["../../etc/passwd"], "malformed_span_id"),
    ],
)
def test_invalid_span_references_fail_closed(
    span_ids: list[str],
    reason: str,
) -> None:
    span_set = build_evidence_span_set("Only one current-request span")
    with pytest.raises(EvidenceSpanError, match=reason):
        resolve_evidence_span_ids(span_set, span_ids)


def _wire_payload(
    *,
    field_path: str = "title",
    value_json: str = '"Video Editor"',
    provenance: str = "extracted_from_source",
    evidence_span_ids: list[str] | None = None,
    conflicts: list[dict[str, object]] | None = None,
    missing_fields: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "extraction_schema_version": 1,
        "target_listing_schema_version": 3,
        "fields": [
            {
                "field_path": field_path,
                "value_json": value_json,
                "provenance": provenance,
                "evidence_span_ids": (
                    ["E0001"]
                    if evidence_span_ids is None
                    else evidence_span_ids
                ),
                "explanation": (
                    "Review-only contextual suggestion"
                    if provenance == "suggested_inference"
                    else None
                ),
                "provider_confidence": None,
            }
        ],
        "conflicts": conflicts or [],
        "missing_fields": missing_fields or [],
        "warnings": [],
    }


def test_direct_field_resolves_server_owned_evidence() -> None:
    source = "Video Editor\nPremiere Pro\nAfter Effects"
    span_set = build_evidence_span_set(source)
    wire = OpenAIJobImportExtractionResponse.model_validate(
        _wire_payload(
            value_json='["premiere-pro","after-effects"]',
            field_path="required_tool_keys",
            evidence_span_ids=["E0003", "E0002"],
        )
    )

    domain = wire.to_domain_response(span_set=span_set)

    assert domain.fields[0].value == ["premiere-pro", "after-effects"]
    assert [item.snippet for item in domain.fields[0].evidence] == [
        "Premiere Pro",
        "After Effects",
    ]


def test_direct_field_without_span_fails_provider_neutral_validation() -> None:
    span_set = build_evidence_span_set("Video Editor")
    wire = OpenAIJobImportExtractionResponse.model_validate(
        _wire_payload(evidence_span_ids=[])
    )
    with pytest.raises(OpenAIJobImportPostParseError) as caught:
        wire.to_domain_response(span_set=span_set)
    assert caught.value.reason == "missing_required_evidence"
    assert caught.value.diagnostics["affected_field_path"] == "title"


def test_evidence_diagnostics_do_not_double_count_duplicate_unknown_ids() -> None:
    span_set = build_evidence_span_set("Known evidence")

    diagnostics = evidence_reference_diagnostics(
        span_set,
        ["E0001", "E0001", "E9999", "E9999", "bad"],
    )

    assert diagnostics == {
        "reference_evidence_id_count": 5,
        "invalid_evidence_id_count": 4,
        "unknown_evidence_id_count": 2,
        "duplicate_evidence_id_count": 2,
        "invalid_evidence_span_ids": ["E9999"],
    }


@pytest.mark.parametrize("with_span", [True, False])
def test_inference_remains_inferential_with_optional_context(
    with_span: bool,
) -> None:
    span_set = build_evidence_span_set("Educational finance videos")
    wire = OpenAIJobImportExtractionResponse.model_validate(
        _wire_payload(
            field_path="primary_role_key",
            value_json='"video-editor"',
            provenance="suggested_inference",
            evidence_span_ids=["E0001"] if with_span else [],
        )
    )

    field = wire.to_domain_response(span_set=span_set).fields[0]
    assert field.provenance == "suggested_inference"
    assert len(field.evidence) == int(with_span)


def test_conflict_alternatives_resolve_independent_spans() -> None:
    span_set = build_evidence_span_set("Budget ₹35,000\nBudget ₹45,000")
    payload = _wire_payload()
    payload["fields"] = []
    payload["conflicts"] = [
        {
            "field_path": "budget_amount",
            "values": [
                {"value_json": "35000", "evidence_span_ids": ["E0001"]},
                {"value_json": "45000", "evidence_span_ids": ["E0002"]},
            ],
            "explanation": "The source states two amounts.",
            "provider_confidence": None,
        }
    ]
    wire = OpenAIJobImportExtractionResponse.model_validate(payload)

    conflict = wire.to_domain_response(span_set=span_set).conflicts[0]
    assert conflict.values[0].evidence[0].snippet == "Budget ₹35,000"
    assert conflict.values[1].evidence[0].snippet == "Budget ₹45,000"


def test_invalid_conflict_span_rejects_entire_response() -> None:
    span_set = build_evidence_span_set("Budget 10\nBudget 20")
    payload = _wire_payload()
    payload["fields"] = []
    payload["conflicts"] = [
        {
            "field_path": "budget_amount",
            "values": [
                {"value_json": "10", "evidence_span_ids": ["E0001"]},
                {"value_json": "20", "evidence_span_ids": ["E9999"]},
            ],
            "explanation": None,
            "provider_confidence": None,
        }
    ]
    wire = OpenAIJobImportExtractionResponse.model_validate(payload)

    with pytest.raises(EvidenceSpanError, match="unknown_span_id"):
        wire.to_domain_response(span_set=span_set)


def test_repeated_source_text_is_unambiguous_by_server_id() -> None:
    source = "Remote role\nRemote role"
    span_set = build_evidence_span_set(source)
    evidence = resolve_evidence_span_ids(span_set, ["E0002"])[0]

    assert evidence.location is not None
    assert evidence.location.char_start == source.rindex("Remote role")


def test_missing_field_has_no_provider_evidence_surface() -> None:
    span_set = build_evidence_span_set("Video Editor")
    payload = _wire_payload(missing_fields=[{"field_path": "deadline_at", "explanation": None}])
    wire = OpenAIJobImportExtractionResponse.model_validate(payload)
    domain = wire.to_domain_response(span_set=span_set)
    assert domain.missing_fields[0].evidence == []

    payload["missing_fields"] = [
        {
            "field_path": "deadline_at",
            "explanation": None,
            "evidence_span_ids": ["E0001"],
        }
    ]
    with pytest.raises(ValidationError):
        OpenAIJobImportExtractionResponse.model_validate(payload)


@pytest.mark.parametrize(
    "span_ids",
    [
        [""],
        ["E00001"],
        ["A0001"],
        [f"E{index:04d}" for index in range(1, 7)],
    ],
)
def test_wire_schema_bounds_span_ids_and_counts(span_ids: list[str]) -> None:
    with pytest.raises(ValidationError):
        OpenAIJobImportExtractionResponse.model_validate(
            _wire_payload(evidence_span_ids=span_ids)
        )


def test_wire_contract_rejects_invalid_path_and_excessive_nesting() -> None:
    with pytest.raises(ValidationError):
        OpenAIJobImportExtractionResponse.model_validate(
            _wire_payload(field_path="status.nested")
        )

    nested: object = "leaf"
    for _ in range(300):
        nested = [nested]
    span_set = build_evidence_span_set("Video Editor")
    wire = OpenAIJobImportExtractionResponse.model_validate(
        _wire_payload(value_json=json.dumps(nested))
    )
    with pytest.raises(OpenAIJobImportPostParseError) as caught:
        wire.to_domain_response(span_set=span_set)
    assert caught.value.reason == "excessive_nesting"


def test_markup_and_malicious_json_remain_inert_exact_span_text() -> None:
    source = '<script>alert("x")</script> {"role":"editor"}'
    span_set = build_evidence_span_set(source)
    evidence = resolve_evidence_span_ids(span_set, ["E0001"])[0]

    assert evidence.snippet == source
    assert evidence.location is not None
    assert source[evidence.location.char_start : evidence.location.char_end] == source
