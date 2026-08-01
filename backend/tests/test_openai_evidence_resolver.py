from __future__ import annotations

import json
import unicodedata

import pytest
from pydantic import ValidationError

from app.integrations.openai.job_import_evidence import (
    MAX_EVIDENCE_CONTEXT_LENGTH,
    EvidenceAnchoringError,
    anchor_evidence_quote,
)
from app.integrations.openai.job_import_output import (
    OpenAIJobImportExtractionResponse,
)
from app.schemas.job_import import MAX_EVIDENCE_SNIPPET_LENGTH


@pytest.mark.parametrize(
    ("source", "quote"),
    [
        ("Normal punctuation: edit, caption, and deliver.", "edit, caption, and deliver."),
        ("Budget: ₹35,000–₹45,000 per month.", "₹35,000–₹45,000"),
        ("Short-form — creator's cut & polish", "Short-form — creator's cut & polish"),
        ("Café videos need हिन्दी captions.", "Café videos need हिन्दी captions."),
        ("first line\nsecond line\nthird line", "first line\nsecond line"),
        ("beginning evidence, then context", "beginning evidence"),
        ("context before end evidence", "end evidence"),
    ],
)
def test_unique_quote_anchors_exact_python_character_offsets(
    source: str,
    quote: str,
) -> None:
    evidence = anchor_evidence_quote(source, quote=quote)

    assert evidence.location is not None
    assert evidence.location.char_start == source.index(quote)
    assert evidence.location.char_end == source.index(quote) + len(quote)
    assert evidence.snippet == quote
    assert source[evidence.location.char_start : evidence.location.char_end] == quote


def test_absent_quote_never_fabricates_an_offset() -> None:
    with pytest.raises(EvidenceAnchoringError, match="quote_not_found"):
        anchor_evidence_quote("Premiere Pro is required.", quote="After Effects")


def test_repeated_quote_is_ambiguous_without_exact_context() -> None:
    source = "Edit videos weekly. Review. Edit videos weekly."

    with pytest.raises(EvidenceAnchoringError, match="quote_ambiguous"):
        anchor_evidence_quote(source, quote="Edit videos weekly.")


@pytest.mark.parametrize(
    ("prefix", "suffix", "expected_start"),
    [
        ("Review. ", None, 28),
        (None, " Review.", 0),
    ],
)
def test_exact_adjacent_context_disambiguates_repeated_quote(
    prefix: str | None,
    suffix: str | None,
    expected_start: int,
) -> None:
    source = "Edit videos weekly. Review. Edit videos weekly."
    evidence = anchor_evidence_quote(
        source,
        quote="Edit videos weekly.",
        prefix=prefix,
        suffix=suffix,
    )

    assert evidence.location is not None
    assert evidence.location.char_start == expected_start


@pytest.mark.parametrize(
    ("prefix", "suffix"),
    [
        ("Wrong ", None),
        (None, " Wrong"),
        ("Start role. ", None),
        (None, "End role."),
    ],
)
def test_invalid_or_other_location_context_fails_closed(
    prefix: str | None,
    suffix: str | None,
) -> None:
    source = "Start role. Middle role. End role."
    with pytest.raises(EvidenceAnchoringError, match="context_mismatch"):
        anchor_evidence_quote(
            source,
            quote="role.",
            prefix=prefix,
            suffix=suffix,
        )


def test_unique_quote_anchors_without_relying_on_unneeded_context() -> None:
    source = "Only one exact supporting quote."
    evidence = anchor_evidence_quote(
        source,
        quote="supporting quote",
        prefix="provider context is not authoritative ",
        suffix=" and cannot move a unique exact quote",
    )

    assert evidence.location is not None
    assert source[evidence.location.char_start : evidence.location.char_end] == ("supporting quote")


def test_context_that_matches_every_occurrence_remains_ambiguous() -> None:
    source = "A role. A role."
    with pytest.raises(EvidenceAnchoringError, match="quote_ambiguous"):
        anchor_evidence_quote(source, quote="role.", prefix="A ")


def test_context_bounds_and_presence_are_enforced() -> None:
    with pytest.raises(EvidenceAnchoringError, match="prefix_too_long"):
        anchor_evidence_quote(
            "prefix quote",
            quote="quote",
            prefix="x" * (MAX_EVIDENCE_CONTEXT_LENGTH + 1),
        )
    with pytest.raises(EvidenceAnchoringError, match="suffix_empty"):
        anchor_evidence_quote("quote", quote="quote", suffix="\t")


@pytest.mark.parametrize(
    ("source", "quote"),
    [
        ("line one\r\nline two", "one\r\nline"),
        ("two  spaces", "two  spaces"),
        ("tab\tseparated", "tab\tseparated"),
        ("<h1>Video Editor</h1>", "<h1>Video Editor</h1>"),
        ('Text with {"role":"editor"}', '{"role":"editor"}'),
    ],
)
def test_matching_preserves_whitespace_markup_and_json_content(
    source: str,
    quote: str,
) -> None:
    evidence = anchor_evidence_quote(source, quote=quote)
    assert evidence.location is not None
    assert source[evidence.location.char_start : evidence.location.char_end] == quote


def test_unicode_normalization_is_not_silently_changed() -> None:
    composed = "Café editor"
    decomposed = unicodedata.normalize("NFD", composed)
    assert composed != decomposed

    with pytest.raises(EvidenceAnchoringError, match="quote_not_found"):
        anchor_evidence_quote(composed, quote=decomposed)


@pytest.mark.parametrize("quote", ["", "   ", "x" * (MAX_EVIDENCE_SNIPPET_LENGTH + 1)])
def test_empty_or_oversized_quotes_are_rejected(quote: str) -> None:
    with pytest.raises(EvidenceAnchoringError):
        anchor_evidence_quote("x" * 1_000, quote=quote)


def _wire_payload(
    *,
    quote: str = "Video Editor",
    provenance: str = "extracted_from_source",
    evidence: list[dict[str, str | None]] | None = None,
    field_path: str = "title",
    value_json: str = '"Video Editor"',
) -> dict[str, object]:
    return {
        "extraction_schema_version": 1,
        "target_listing_schema_version": 3,
        "fields": [
            {
                "field_path": field_path,
                "value_json": value_json,
                "provenance": provenance,
                "evidence": evidence
                if evidence is not None
                else [{"quote": quote, "prefix": None, "suffix": None}],
                "explanation": "Review-only suggestion"
                if provenance == "suggested_inference"
                else None,
                "provider_confidence": None,
            }
        ],
        "conflicts": [],
        "missing_fields": [],
        "warnings": [],
    }


def test_wire_response_anchors_before_provider_neutral_validation() -> None:
    source = "Hiring a Video Editor now."
    response = OpenAIJobImportExtractionResponse.model_validate(_wire_payload())
    domain = response.to_domain_response(canonical_source=source)

    evidence = domain.fields[0].evidence[0]
    assert evidence.location is not None
    assert source[evidence.location.char_start : evidence.location.char_end] == evidence.snippet


def test_quote_from_another_source_rejects_the_whole_response() -> None:
    response = OpenAIJobImportExtractionResponse.model_validate(_wire_payload(quote="Premiere Pro"))
    with pytest.raises(EvidenceAnchoringError, match="quote_not_found"):
        response.to_domain_response(canonical_source="After Effects is required.")


def test_duplicate_anchored_evidence_rejects_the_whole_response() -> None:
    duplicate = {"quote": "Video Editor", "prefix": None, "suffix": None}
    response = OpenAIJobImportExtractionResponse.model_validate(
        _wire_payload(evidence=[duplicate, duplicate])
    )
    with pytest.raises(EvidenceAnchoringError, match="duplicate_evidence"):
        response.to_domain_response(canonical_source="Video Editor")


def test_inference_stays_inferential_and_has_no_quote_evidence() -> None:
    response = OpenAIJobImportExtractionResponse.model_validate(
        _wire_payload(
            quote="unsupported quote",
            provenance="suggested_inference",
        )
    )
    domain = response.to_domain_response(canonical_source="Video editing role")

    assert domain.fields[0].provenance == "suggested_inference"
    assert domain.fields[0].evidence == []


def test_direct_extraction_without_evidence_fails_domain_validation() -> None:
    response = OpenAIJobImportExtractionResponse.model_validate(_wire_payload(evidence=[]))
    with pytest.raises(ValidationError, match="require evidence"):
        response.to_domain_response(canonical_source="Video Editor")


def test_wire_contract_rejects_bounds_invalid_paths_and_nested_values() -> None:
    excessive_evidence = [
        {"quote": f"quote-{index}", "prefix": None, "suffix": None} for index in range(6)
    ]
    with pytest.raises(ValidationError):
        OpenAIJobImportExtractionResponse.model_validate(_wire_payload(evidence=excessive_evidence))
    with pytest.raises(ValidationError):
        OpenAIJobImportExtractionResponse.model_validate(_wire_payload(field_path="status.nested"))

    nested: object = "leaf"
    for _ in range(300):
        nested = [nested]
    response = OpenAIJobImportExtractionResponse.model_validate(
        _wire_payload(value_json=json.dumps(nested))
    )
    with pytest.raises((ValidationError, ValueError, RecursionError)):
        response.to_domain_response(canonical_source="Video Editor")
