from __future__ import annotations

from app.schemas.job_import import (
    MAX_EVIDENCE_SNIPPET_LENGTH,
    JobImportEvidence,
)

MAX_EVIDENCE_CONTEXT_LENGTH = 160


class EvidenceAnchoringError(ValueError):
    """Safe deterministic evidence failure without source or quote disclosure."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _validate_candidate_text(
    value: str | None,
    *,
    label: str,
    maximum: int,
    required: bool,
) -> None:
    if value is None:
        if required:
            raise EvidenceAnchoringError(f"{label}_missing")
        return
    if not value or not value.strip():
        raise EvidenceAnchoringError(f"{label}_empty")
    if len(value) > maximum:
        raise EvidenceAnchoringError(f"{label}_too_long")


def _exact_occurrences(source_text: str, quote: str) -> list[int]:
    occurrences: list[int] = []
    search_from = 0
    while True:
        start = source_text.find(quote, search_from)
        if start < 0:
            return occurrences
        occurrences.append(start)
        search_from = start + 1


def anchor_evidence_quote(
    source_text: str,
    *,
    quote: str,
    prefix: str | None = None,
    suffix: str | None = None,
) -> JobImportEvidence:
    """Anchor a verbatim provider quote against the exact provider source text.

    Matching is deliberately exact. Optional context must be immediately adjacent
    to the quote and is used only to disambiguate repeated exact occurrences.
    """

    _validate_candidate_text(
        quote,
        label="quote",
        maximum=MAX_EVIDENCE_SNIPPET_LENGTH,
        required=True,
    )
    _validate_candidate_text(
        prefix,
        label="prefix",
        maximum=MAX_EVIDENCE_CONTEXT_LENGTH,
        required=False,
    )
    _validate_candidate_text(
        suffix,
        label="suffix",
        maximum=MAX_EVIDENCE_CONTEXT_LENGTH,
        required=False,
    )

    occurrences = _exact_occurrences(source_text, quote)
    if not occurrences:
        raise EvidenceAnchoringError("quote_not_found")
    if len(occurrences) == 1:
        start = occurrences[0]
        end = start + len(quote)
        if source_text[start:end] != quote:  # Defensive invariant at the boundary.
            raise EvidenceAnchoringError("anchor_mismatch")
        return JobImportEvidence(
            snippet=quote,
            location={"char_start": start, "char_end": end},
        )

    contextual_matches: list[int] = []
    for start in occurrences:
        end = start + len(quote)
        if prefix is not None and source_text[max(0, start - len(prefix)) : start] != prefix:
            continue
        if suffix is not None and source_text[end : end + len(suffix)] != suffix:
            continue
        contextual_matches.append(start)

    if not contextual_matches:
        raise EvidenceAnchoringError("context_mismatch")
    if len(contextual_matches) != 1:
        raise EvidenceAnchoringError("quote_ambiguous")

    start = contextual_matches[0]
    end = start + len(quote)
    if source_text[start:end] != quote:  # Defensive invariant at the boundary.
        raise EvidenceAnchoringError("anchor_mismatch")
    return JobImportEvidence(
        snippet=quote,
        location={"char_start": start, "char_end": end},
    )
