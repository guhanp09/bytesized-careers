from __future__ import annotations

import unicodedata

import pytest

from app.integrations.openai.job_import_evidence import (
    MAX_EVIDENCE_CONTEXT_LENGTH,
    EvidenceAnchoringError,
    anchor_evidence_quote,
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
