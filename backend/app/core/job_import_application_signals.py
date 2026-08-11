"""Small, grounded application signals a provider is allowed to miss.

The model normally separates application materials from application routing. A
miss cannot make an explicit request disappear, though: if a source says
"submit your resume and cover letter to ...", CreatorJobs already has native
fields for both materials. This module recovers only those canonical fields.

It deliberately does not infer from qualifications. "Candidates need two years
of experience" describes eligibility; "submit your relevant experience" asks
for application material. A transmission verb is therefore required before a
sentence can contribute a fallback.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.job_application_classification import (
    classify_application_instructions,
    sanitize_application_requirement_keys,
)
from app.core.job_application_instructions import separate_application_instructions

_MAX_SEGMENTS = 256
_MAX_SEGMENT_LENGTH = 1_000

_APPLICATION_TRANSMISSION = re.compile(
    r"\b(?:apply|attach|e-?mail|email|forward|include|mail|provide|send|share|"
    r"submit|upload)\b",
    re.IGNORECASE,
)
_NEGATED_TRANSMISSION = re.compile(
    r"\b(?:do\s+not|don't|need(?:s|ed)?\s+not|no\s+need\s+to)\s+"
    r"(?:apply|attach|e-?mail|email|forward|include|mail|provide|send|share|"
    r"submit|upload)\b|\b(?:resume|résumé|cv|cover[\s-]+letter)\s+"
    r"(?:is|are)\s+(?:not\s+required|optional)\b",
    re.IGNORECASE,
)
_OPTIONAL_OR_NON_REQUIRED_TRANSMISSION = re.compile(
    r"\bnot\s+(?:required|necessary|mandatory)\s+to\s+"
    r"(?:apply|attach|e-?mail|email|forward|include|mail|provide|send|share|"
    r"submit|upload)\b|"
    r"\b(?:(?:you|applicants?|candidates?)\s+may|you\s+can|"
    r"(?:you\s+)?could)\s+(?:also\s+)?"
    r"(?:apply|attach|e-?mail|email|forward|include|mail|provide|send|share|"
    r"submit|upload)\b|"
    r"\b(?:feel\s+free\s+to|(?:you\s+are\s+)?welcome\s+to|optionally\s*,?|"
    r"if\s+(?:you\s+)?(?:wish|desired))\s*,?\s*"
    r"(?:apply|attach|e-?mail|email|forward|include|mail|provide|send|share|"
    r"submit|upload)\b|"
    r"\b(?:if\s+(?:available|you\s+have\s+one)|where\s+possible)\b|"
    r"\b(?:candidates?|applicants?|you)\s+(?:are\s+)?encouraged\s+to\s+"
    r"(?:apply|attach|e-?mail|email|forward|include|mail|provide|send|share|"
    r"submit|upload)\b|"
    r"\b(?:we\s+)?encourage\s+(?:you|candidates?|applicants?)\s+to\s+"
    r"(?:apply|attach|e-?mail|email|forward|include|mail|provide|send|share|"
    r"submit|upload)\b|"
    r"\b(?:resume|résumé|cv|cover[\s-]+letter)\s+(?:is\s+)?optional\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ExplicitApplicationRequirements:
    """Canonical requirements plus the exact source segments that prove them."""

    keys: list[str]
    evidence_snippets: list[str]


def _source_segments(text: str) -> list[str]:
    """Return bounded sentence/line segments without rewriting source evidence."""

    segments: list[str] = []
    for line in text.splitlines():
        for part in re.split(r"(?<=[.!?])\s+", line):
            segment = part.strip()
            if not segment or len(segment) > _MAX_SEGMENT_LENGTH:
                continue
            segments.append(segment)
            if len(segments) >= _MAX_SEGMENTS:
                return segments
    return segments


def explicit_application_requirements(
    source_text: str | None,
) -> ExplicitApplicationRequirements:
    """Recover explicitly requested native materials from application wording.

    The returned snippets are exact substrings of ``source_text``. Destinations
    may remain in those private evidence snippets, but only canonical material
    keys leave this function and reach a native job.
    """

    if not source_text or not source_text.strip():
        return ExplicitApplicationRequirements(keys=[], evidence_snippets=[])

    keys: list[str] = []
    evidence: list[str] = []
    for segment in _source_segments(source_text):
        if (
            not _APPLICATION_TRANSMISSION.search(segment)
            or _NEGATED_TRANSMISSION.search(segment)
            or _OPTIONAL_OR_NON_REQUIRED_TRANSMISSION.search(segment)
        ):
            continue
        separated = separate_application_instructions(segment)
        classified = classify_application_instructions(
            " ".join(separated.safe_sentences) or None
        )
        recovered = sanitize_application_requirement_keys(classified.requirement_keys)
        if not recovered:
            continue
        added = False
        for key in recovered:
            if key not in keys:
                keys.append(key)
                added = True
        if added and segment not in evidence:
            evidence.append(segment)
        if len(keys) >= 10 or len(evidence) >= 5:
            break

    return ExplicitApplicationRequirements(
        keys=keys[:10],
        evidence_snippets=evidence[:5],
    )
