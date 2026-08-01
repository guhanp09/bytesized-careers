from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from app.schemas.job_import import JobImportEvidence

EVIDENCE_SEGMENTATION_VERSION = "job-import-evidence-spans-v1"
MAX_EVIDENCE_SPAN_LENGTH = 480
MAX_EVIDENCE_SPAN_COUNT = 512
MAX_EVIDENCE_SPAN_TEXT_LENGTH = 100_000
MAX_EVIDENCE_SPANS_PER_REFERENCE = 5
EVIDENCE_SPAN_ID_PATTERN = r"^E[0-9]{4}$"

_SPAN_ID_RE = re.compile(EVIDENCE_SPAN_ID_PATTERN)
_BULLET_RE = re.compile(r"^(?:[-*•‣▪◦]|[0-9]{1,3}[.)])(?:\s+|$)")
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])(?=\s+)")
_NONEMPTY_LINE_RE = re.compile(r"[^\r\n]+")


class EvidenceSpanError(ValueError):
    """Bounded span construction or resolution failure without source disclosure."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class EvidenceSpan:
    span_id: str
    text: str
    char_start: int
    char_end: int
    order: int


@dataclass(frozen=True)
class EvidenceSpanSet:
    segmentation_version: str
    source_fingerprint: str
    source_text: str
    spans: tuple[EvidenceSpan, ...]

    @property
    def by_id(self) -> dict[str, EvidenceSpan]:
        return {span.span_id: span for span in self.spans}

    def provider_payload(self) -> dict[str, object]:
        return {
            "segmentation_version": self.segmentation_version,
            "evidence_spans": [
                {"span_id": span.span_id, "text": span.text}
                for span in self.spans
            ],
        }


def _trimmed_range(source_text: str, start: int, end: int) -> tuple[int, int] | None:
    while start < end and source_text[start].isspace():
        start += 1
    while end > start and source_text[end - 1].isspace():
        end -= 1
    return (start, end) if start < end else None


def _split_oversized_range(
    source_text: str,
    start: int,
    end: int,
) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    cursor = start
    while end - cursor > MAX_EVIDENCE_SPAN_LENGTH:
        hard_end = cursor + MAX_EVIDENCE_SPAN_LENGTH
        split_at = hard_end
        for index in range(hard_end, cursor, -1):
            if source_text[index - 1].isspace():
                split_at = index - 1
                break
        if split_at <= cursor:
            split_at = hard_end
        trimmed = _trimmed_range(source_text, cursor, split_at)
        if trimmed is not None:
            ranges.append(trimmed)
        cursor = split_at
        while cursor < end and source_text[cursor].isspace():
            cursor += 1
    trimmed = _trimmed_range(source_text, cursor, end)
    if trimmed is not None:
        ranges.append(trimmed)
    return ranges


def _semantic_ranges_for_line(
    source_text: str,
    start: int,
    end: int,
) -> list[tuple[int, int]]:
    trimmed = _trimmed_range(source_text, start, end)
    if trimmed is None:
        return []
    start, end = trimmed
    text = source_text[start:end]
    if _BULLET_RE.match(text) or len(text) <= MAX_EVIDENCE_SPAN_LENGTH:
        candidates = [(start, end)]
    else:
        candidates = []
        relative_start = 0
        for boundary in _SENTENCE_BOUNDARY_RE.finditer(text):
            relative_end = boundary.start()
            candidate = _trimmed_range(
                source_text,
                start + relative_start,
                start + relative_end,
            )
            if candidate is not None:
                candidates.append(candidate)
            relative_start = boundary.end()
        candidate = _trimmed_range(source_text, start + relative_start, end)
        if candidate is not None:
            candidates.append(candidate)

    bounded: list[tuple[int, int]] = []
    for candidate_start, candidate_end in candidates:
        bounded.extend(
            _split_oversized_range(source_text, candidate_start, candidate_end)
        )
    return bounded


def build_evidence_span_set(source_text: str) -> EvidenceSpanSet:
    """Segment an exact canonical source without rewriting any evidence text."""

    ranges: list[tuple[int, int]] = []
    for line in _NONEMPTY_LINE_RE.finditer(source_text):
        ranges.extend(
            _semantic_ranges_for_line(source_text, line.start(), line.end())
        )

    if not ranges:
        raise EvidenceSpanError("no_meaningful_spans")
    if len(ranges) > MAX_EVIDENCE_SPAN_COUNT:
        raise EvidenceSpanError("span_count_exceeded")

    total_text_length = sum(end - start for start, end in ranges)
    if total_text_length > MAX_EVIDENCE_SPAN_TEXT_LENGTH:
        raise EvidenceSpanError("span_text_limit_exceeded")

    spans: list[EvidenceSpan] = []
    for order, (start, end) in enumerate(ranges):
        text = source_text[start:end]
        if not text or len(text) > MAX_EVIDENCE_SPAN_LENGTH:
            raise EvidenceSpanError("span_length_invalid")
        if source_text[start:end] != text:
            raise EvidenceSpanError("span_source_mismatch")
        spans.append(
            EvidenceSpan(
                span_id=f"E{order + 1:04d}",
                text=text,
                char_start=start,
                char_end=end,
                order=order,
            )
        )

    fingerprint = hashlib.sha256(
        f"{EVIDENCE_SEGMENTATION_VERSION}\0{source_text}".encode()
    ).hexdigest()
    return EvidenceSpanSet(
        segmentation_version=EVIDENCE_SEGMENTATION_VERSION,
        source_fingerprint=fingerprint,
        source_text=source_text,
        spans=tuple(spans),
    )


def resolve_evidence_span_ids(
    span_set: EvidenceSpanSet,
    span_ids: list[str],
    *,
    maximum: int = MAX_EVIDENCE_SPANS_PER_REFERENCE,
) -> list[JobImportEvidence]:
    if len(span_ids) > maximum:
        raise EvidenceSpanError("span_reference_count_exceeded")
    if len(span_ids) != len(set(span_ids)):
        raise EvidenceSpanError("duplicate_span_id")

    mapping = span_set.by_id
    resolved: list[EvidenceSpan] = []
    for span_id in span_ids:
        if not _SPAN_ID_RE.fullmatch(span_id):
            raise EvidenceSpanError("malformed_span_id")
        span = mapping.get(span_id)
        if span is None:
            raise EvidenceSpanError("unknown_span_id")
        if span_set.source_text[span.char_start : span.char_end] != span.text:
            raise EvidenceSpanError("span_source_mismatch")
        resolved.append(span)

    # CreatorJobs, not the provider, owns deterministic evidence ordering.
    resolved.sort(key=lambda item: item.order)
    return [
        JobImportEvidence(
            snippet=span.text,
            location={
                "char_start": span.char_start,
                "char_end": span.char_end,
            },
        )
        for span in resolved
    ]
