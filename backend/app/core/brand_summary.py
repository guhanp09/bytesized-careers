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

#: Two to four concise sentences. A brand biography is not the job.
MAX_SUMMARY_CHARS: Final[int] = 500
MAX_SUMMARY_WORDS: Final[int] = 90
MAX_SUMMARY_SENTENCES: Final[int] = 4

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
    r"this\s+(?:summary|description)\s+was|the\s+source\s+says|"
    r"the\s+job\s+post\s+describes|our\s+search\s+found|"
    r"based\s+on\s+publicly\s+available\s+information|"
    r"the\s+official\s+website\s+(?:says|states))\b",
    re.IGNORECASE,
)

_GENERIC_FILLER: Final[tuple[re.Pattern[str], ...]] = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bdynamic\s+and\s+innovative\b",
        r"\b(?:dynamic|innovative|leading|premier)\s+(?:brand|company|organisation|organization|team)\b",
        r"\bcommitted\s+to\s+excellence\b",
        r"\bdedicated\s+to\s+(?:delivering|providing)\b",
        r"\bcutting[-\s]edge\s+solutions?\b",
        r"\bhigh[-\s]quality\s+(?:content|services|solutions?)\b",
        r"\bpassionate\s+about\s+empowering\b",
        r"\bfostering\s+innovation\b",
        r"\bstate[-\s]of[-\s]the[-\s]art\b",
    )
)

_DIRECTIVE_FRAMING: Final[re.Pattern[str]] = re.compile(
    r"\b(?:ignore\s+(?:all\s+)?previous\s+instructions?|system\s*:|"
    r"apply\s+(?:at|by|through|via)|click\s+here|send\s+(?:an?|your)\s+"
    r"(?:application|email|portfolio|resume)|contact\s+us\s+(?:at|via)|"
    r"you\s+must\s+(?:apply|send|contact))\b",
    re.IGNORECASE,
)

#: Narrow paraphrase families that preserve meaning. This allows ordinary prose
#: such as "collaboration software" when the evidence says "collaboration tools"
#: without granting the model a general licence to invent adjacent concepts.
_SEMANTIC_EQUIVALENTS: Final[tuple[frozenset[str], ...]] = (
    frozenset({"tool", "tools", "software", "platform"}),
    frozenset({"video", "videos"}),
    frozenset({"customer", "customers", "client", "clients"}),
    frozenset({"viewer", "viewers", "audience", "audiences"}),
    frozenset({"business", "businesses", "company", "companies"}),
    frozenset({"education", "educational", "learning"}),
    frozenset({"analysis", "analytics", "analyse", "analyze"}),
    frozenset({"apparel", "clothes", "clothing"}),
    frozenset({"footwear", "shoe", "shoes"}),
    frozenset(
        {
            "create", "creates", "created", "creating", "creation", "creations",
            "produce", "produces", "produced", "producing",
            "publish", "publishes", "published", "publishing",
        }
    ),
    frozenset({"offer", "offers", "offered", "offering", "provide", "provides", "providing"}),
    frozenset({"use", "uses", "used", "using"}),
    frozenset({"contain", "contains", "contained", "containing", "inside"}),
    frozenset({"keep", "keeps", "kept", "stay", "stays", "stayed"}),
    frozenset(
        {
            "go", "goes", "going", "move", "moves", "moving", "moved",
            "take", "takes", "taking", "taken",
        }
    ),
    frozenset(
        {
            "able", "allow", "allows", "allowed", "allowing", "enable",
            "enables", "enabled", "enabling",
        }
    ),
)

#: Ordinary words that carry no factual weight, so they need no support.
_FUNCTION_WORDS: Final[frozenset[str]] = frozenset(
    {
        "the", "and", "for", "with", "that", "this", "its", "their", "they",
        "are", "was", "were", "has", "have", "had", "from", "into",
        "about", "which", "who", "whose", "them", "these", "those", "also",
        "more", "than", "such", "including", "include", "includes", "across",
        "alongside",
        "through", "make", "makes", "making", "help", "helps",
        "provide", "provides", "providing",
        "helping", "focus", "focuses", "focused", "focusing", "aimed",
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
        if (len(word) > 2 or word.casefold() == "go")
        and word.casefold() not in _FUNCTION_WORDS
    }


def _morphology_keys(word: str) -> set[str]:
    """Collapse ordinary English inflection, not semantic neighbours.

    This accepts ``feature/features`` and ``connect/connects/connected`` while
    still refusing a new concept such as ``analytics`` when the page only said
    ``video``. Numbers, names and scale claims keep their independent guards.
    """

    keys = {word.casefold()}
    for _round in range(2):
        for value in tuple(keys):
            if len(value) > 4 and value.endswith("ies"):
                keys.add(f"{value[:-3]}y")
            if len(value) > 5 and value.endswith("ing"):
                root = value[:-3]
                if len(root) > 2 and root[-1] == root[-2] and not root.endswith("ss"):
                    root = root[:-1]
                keys.update({root, f"{root}e"})
            if len(value) > 4 and value.endswith("ed"):
                root = value[:-2]
                if len(root) > 2 and root[-1] == root[-2] and not root.endswith("ss"):
                    root = root[:-1]
                keys.update({root, f"{root}e"})
            if len(value) > 4 and value.endswith(("ses", "xes", "zes", "ches", "shes")):
                keys.add(value[:-2])
            if len(value) > 3 and value.endswith("s") and not value.endswith("ss"):
                keys.add(value[:-1])
    return keys


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

    if any(pattern.search(text) for pattern in _GENERIC_FILLER):
        return SummaryVerdict(False, None, "summary is generic promotional filler")

    if _DIRECTIVE_FRAMING.search(text):
        return SummaryVerdict(False, None, "summary contains an instruction rather than brand copy")

    if len(text) > MAX_SUMMARY_CHARS:
        return SummaryVerdict(False, None, f"summary exceeds {MAX_SUMMARY_CHARS} characters")
    if len(text.split()) > MAX_SUMMARY_WORDS:
        return SummaryVerdict(False, None, f"summary exceeds {MAX_SUMMARY_WORDS} words")
    if len(_sentences(text)) > MAX_SUMMARY_SENTENCES:
        return SummaryVerdict(False, None, "summary is longer than four sentences")

    brand_words = _content_words(brand_name)
    useful_summary_words = _content_words(text) - brand_words
    if len(useful_summary_words) < 3:
        return SummaryVerdict(False, None, "summary is too thin to help a candidate")

    supported = _content_words(evidence) | brand_words
    for family in _SEMANTIC_EQUIVALENTS:
        if family & supported:
            supported.update(family)
    if not supported:
        return SummaryVerdict(False, None, "no usable evidence was retrieved")

    supported_keys = {
        key
        for word in supported
        for key in _morphology_keys(word)
    }
    unsupported = sorted(
        word
        for word in _content_words(text)
        if not (_morphology_keys(word) & supported_keys)
    )
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
    # A precise official sentence can be enough (for example, "Acme builds
    # video collaboration tools for creative teams"). Word count alone must
    # not force a model to pad it; requiring several distinct content words
    # still rejects navigation, slogans and "Welcome to Acme" shells.
    return len(evidence.split()) >= 7 and len(words) >= 5
