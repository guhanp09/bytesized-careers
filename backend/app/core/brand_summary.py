"""Whether a generated brand description says anything the evidence does not.

An About field that quietly invents "India's largest financial education channel
with millions of subscribers" is worse than an empty one. The empty field costs a
recruiter thirty seconds; the invented one is a false claim published under their
brand, and neither they nor a candidate has any way to know it was invented.

So a summary is not accepted because a model produced it. It is accepted because
every claim in it is traceable to the retrieved official page, and rejected
otherwise — the model proposes, this decides.

The check is deliberately about *content words*, not phrasing. Requiring the
summary to quote the page would defeat the point of summarising; requiring every
noun to appear in it catches the failure that matters, which is specificity
arriving from nowhere. Numbers, superlatives and named entities are where
fabrication actually shows up, and each is handled explicitly below.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

#: Roughly three short sentences. A brand biography is not the job.
MAX_SUMMARY_CHARS: Final[int] = 420
MAX_SUMMARY_SENTENCES: Final[int] = 3

#: Words that make a claim about rank or scale. Every one of these needs the
#: page to have said it, because they are the most tempting thing to add and the
#: least likely to be true.
_SUPERLATIVES: Final[frozenset[str]] = frozenset(
    {
        "largest", "biggest", "leading", "top", "best", "premier", "foremost",
        "number", "no1", "first", "fastest", "most", "award", "awarded",
        "winning", "renowned", "acclaimed", "trusted", "innovative", "pioneer",
        "pioneering", "revolutionary", "cutting", "edge", "world", "global",
        "million", "millions", "billion", "billions", "thousands", "founded",
        "headquartered", "revenue", "funding", "valuation", "unicorn",
    }
)

#: Framing that reports on the retrieval instead of describing the brand.
_PROVENANCE_FRAMING: Final[re.Pattern[str]] = re.compile(
    r"\b(?:according\s+to|based\s+on|per\s+(?:their|its|the)\s+(?:website|site|page)|"
    r"the\s+(?:company|brand)\s+claims|their\s+website\s+(?:says|states)|"
    r"as\s+stated\s+on|ai[-\s]generated|automatically\s+generated|"
    r"this\s+(?:summary|description)\s+was)\b",
    re.IGNORECASE,
)

#: Ordinary words that carry no factual weight, so they need no support.
_FUNCTION_WORDS: Final[frozenset[str]] = frozenset(
    {
        "the", "and", "for", "with", "that", "this", "its", "their", "they",
        "are", "was", "were", "has", "have", "had", "from", "into",
        "about", "which", "who", "whose", "them", "these", "those", "also",
        "more", "than", "such", "including", "include", "includes", "across",
        "through", "using", "used", "make", "makes", "making", "help", "helps",
        "helping", "provide", "provides", "providing", "create", "creates",
        "creating", "produce", "produces", "producing", "publish", "publishes",
        "publishing", "focus", "focuses", "focused", "focusing", "aimed",
        "designed", "content", "online", "digital", "audience", "audiences",
        "people", "topics", "material", "work", "works", "over", "under",
        "between", "well", "very", "some", "many", "other", "others", "each",
        "both", "while", "where", "when", "what", "how", "why", "not", "can",
        "will", "would", "may", "might", "should", "must", "does", "did",
    }
)

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
_NUMBER = re.compile(r"\d[\d,.]*")


@dataclass(frozen=True)
class SummaryVerdict:
    """Whether a summary may be published, and why not when it may not."""

    accepted: bool
    summary: str | None
    #: Internal diagnostics. Never candidate copy.
    reason: str
    unsupported: tuple[str, ...] = ()


def _content_words(text: str) -> set[str]:
    return {
        word.casefold()
        for word in _WORD.findall(text)
        if len(word) > 2 and word.casefold() not in _FUNCTION_WORDS
    }


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]


def verify_summary(
    summary: str | None, *, evidence: str, brand_name: str
) -> SummaryVerdict:
    """Accept a brand summary only if the evidence supports all of it."""

    text = (summary or "").strip()
    if not text:
        return SummaryVerdict(False, None, "the model returned no summary")

    if _PROVENANCE_FRAMING.search(text):
        # Candidate copy is the job speaking, not a report on how it was
        # assembled. Same rule the imported listing copy already follows.
        return SummaryVerdict(False, None, "summary describes its own retrieval")

    if len(text) > MAX_SUMMARY_CHARS:
        return SummaryVerdict(False, None, f"summary exceeds {MAX_SUMMARY_CHARS} characters")
    if len(_sentences(text)) > MAX_SUMMARY_SENTENCES:
        return SummaryVerdict(False, None, "summary is longer than three sentences")

    supported = _content_words(evidence) | _content_words(brand_name)
    if not supported:
        return SummaryVerdict(False, None, "no usable evidence was retrieved")

    unsupported = sorted(word for word in _content_words(text) if word not in supported)
    if unsupported:
        # A word the page never used is a claim the page never made. Being
        # strict here is the whole mechanism: a summary that only recombines
        # what was retrieved cannot invent a fact.
        return SummaryVerdict(
            False,
            None,
            "summary contains claims the evidence does not support",
            tuple(unsupported[:8]),
        )

    stated = _content_words(evidence)
    boasts = sorted(word for word in _content_words(text) if word in _SUPERLATIVES and word not in stated)
    if boasts:
        return SummaryVerdict(False, None, "summary makes unsupported claims of scale", tuple(boasts))

    numbers = {number for number in _NUMBER.findall(text)}
    evidence_numbers = set(_NUMBER.findall(evidence))
    invented = sorted(numbers - evidence_numbers)
    if invented:
        return SummaryVerdict(False, None, "summary states figures the evidence does not", tuple(invented))

    return SummaryVerdict(True, text, "every claim is supported by the retrieved page")


def evidence_is_substantial(evidence: str) -> bool:
    """Whether a page said enough about itself to describe.

    "Welcome to Acme." is a page, not a description. Padding it into a paragraph
    is exactly the failure this feature must not have, so thin evidence stops
    enrichment before a model is ever asked.
    """

    words = _content_words(evidence)
    return len(evidence.split()) >= 25 and len(words) >= 12
