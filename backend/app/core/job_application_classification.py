"""Telling a thing a candidate attaches from a thing a candidate answers.

A source's application paragraph mixes two kinds of instruction and the product
has two different homes for them.

*Standard details* — a portfolio, an expected rate, availability, the tools
someone works in — are the same request for every applicant. They belong in the
structured requirements, where the application form can collect them properly:
a rate lands in a rate field, a portfolio in the portfolio picker.

*Evaluative questions* — why this role, how you would approach it, what your part
in that project was — need prose only that candidate can write. They belong in
private screening, answered once and read in the Inbox.

Putting the first kind in the second is the failure that motivated this. A
recruiter who meets "Screening questions" before anywhere to request a portfolio
types "Upload your portfolio" as a question, and it stops being a field the form
can fill: it becomes a sentence someone types an answer to, uncollected and
unsearchable. Importing did the same thing whenever a source phrased a
requirement as a question.

Grammar alone does not decide it. "What is your expected rate?" ends in a
question mark and is still a standard detail — every applicant has a rate and the
form has a box for it. What matters is whether the answer is a *fact the product
already models* or a *judgement only prose can carry*.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Final

#: Canonical applicant-requirement keys, mirroring lib/firstMessageRequirements.
#:
#: Deliberately the same vocabulary the application form already collects, so a
#: mapped requirement activates an input the candidate already knows how to fill
#: rather than inventing a second way to ask.
#: Only keys a *job* can actually ask for.
#:
#: The catalog is shared with talent listings and not every entry belongs to
#: both. ``reference_links`` is talent-only: emitting it for a job produced a
#: requirement `sanitizeRequirementKeys(..., "job")` silently discarded, so the
#: candidate was never asked and the recruiter never received it — a phantom
#: selection that looked right in the payload and did nothing.
#:
#: Work links are asked for on the job side through ``relevant_portfolio``,
#: which is the portfolio mechanism the application form already renders.
REQUIREMENT_KEYS: Final[tuple[str, ...]] = (
    "expected_rate",
    "relevant_portfolio",
    "turnaround",
    "working_hours",
    "relevant_experience",
    "tools_workflow",
    "start_availability",
)

#: Wording that names a standard detail, whatever grammar wraps it.
_REQUIREMENT_PATTERNS: Final[tuple[tuple[str, str], ...]] = (
    ("expected_rate", r"\b(?:expected\s+)?(?:rate|rates|pricing|quote|budget expectation|fee|charges?)\b"),
    ("relevant_portfolio", r"\b(?:portfolio|showreel|show\s?reel|demo\s?reel|work\s+samples?|samples?\s+of\s+(?:your\s+)?work)\b"),
    ("relevant_portfolio", r"\b(?:cv|resume|résumé|curriculum\s+vitae)\b"),
    ("turnaround", r"\b(?:turnaround|turn\s?around|delivery\s+time|how\s+(?:quickly|fast))\b"),
    ("working_hours", r"\b(?:working\s+hours|work\s+hours|hours\s+(?:you|per)|time\s?zone|timezone|overlap)\b"),
    ("relevant_experience", r"\b(?:years?\s+of\s+experience|relevant\s+experience|prior\s+experience)\b"),
    ("tools_workflow", r"\b(?:tools?|software|workflow|editing\s+suite|stack)\b"),
    ("relevant_portfolio", r"\b(?:links?\s+to|previous\s+work|past\s+work|references?)\b"),
    ("start_availability", r"\b(?:availability|available\s+(?:from|to\s+start)|notice\s+period|start\s+date)\b"),
)

#: Openers that ask for a judgement rather than a fact.
#:
#: Each of these needs a sentence only the candidate can write. "Why", "how",
#: "describe", "explain", "tell us" — none of them has an answer the product
#: could store in a field, which is exactly what makes them screening material.
_EVALUATIVE_OPENERS: Final[tuple[str, ...]] = (
    "why",
    "how would",
    "how do",
    "how did",
    "how have",
    "describe",
    "explain",
    "tell us",
    "tell me",
    "walk us",
    "what was your",
    "what is your approach",
    "what would you",
    "which",
    "what draws you",
    "what interests you",
    "share your thoughts",
)

#: Openers that ask specifically for the candidate's reasoning.
#:
#: Narrower than the list above, and used only when a sentence *also* names a
#: standard detail. "Tell us your years of experience" wants a number the form
#: can store; "Explain why you chose those tools" wants the thinking behind one.
#: Both mention a structured field, and only the second is a screening question.
_JUDGEMENT_OPENERS: Final[tuple[str, ...]] = (
    "why",
    "which",
    "how would",
    "how do",
    "how did",
    "how have",
    "describe",
    "explain",
    "walk us",
    "what was your",
    "what would you",
)

#: Imperatives that request an attachment. Never a question, whatever follows.
_MATERIAL_VERBS = re.compile(
    r"^\s*(?:please\s+)?(?:upload|attach|include|share|send|provide|submit|state|list|add)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ClassifiedInstructions:
    """Where each part of a source's application paragraph belongs."""

    #: Canonical requirement keys the application form can collect.
    requirement_keys: list[str] = field(default_factory=list)
    #: Genuine evaluative prompts, for private screening.
    screening_questions: list[str] = field(default_factory=list)
    #: Material details with no structured home, for the public note.
    unstructured_materials: list[str] = field(default_factory=list)


def _requirement_keys_in(sentence: str) -> list[str]:
    found: list[str] = []
    for key, pattern in _REQUIREMENT_PATTERNS:
        if key not in found and re.search(pattern, sentence, re.IGNORECASE):
            found.append(key)
    return found


#: Platforms whose names carry information a generic requirement cannot.
#:
#: "reference_links" tells a candidate to send links. It cannot tell them the
#: recruiter wants YouTube and Instagram specifically, which is the part that
#: changes what they send — so a phrase naming one survives into the note even
#: though the structured key already covers the general request.
_PORTFOLIO_PLATFORMS: Final[tuple[str, ...]] = (
    "youtube",
    "instagram",
    "tiktok",
    "github",
    "linkedin",
    "behance",
    "dribbble",
    "vimeo",
    "twitch",
    "substack",
    "spotify",
)


def _names_a_platform(fragment: str) -> bool:
    lowered = fragment.lower()
    return any(re.search(rf"\b{name}\b", lowered) for name in _PORTFOLIO_PLATFORMS)


def _unmatched_items(sentence: str) -> str | None:
    """The requested things in a sentence that no structured field can hold.

    Returned as a phrase rather than a sentence, so the note composer can put it
    behind "Please include …" alongside anything else that survived.
    """

    body = _MATERIAL_VERBS.sub("", sentence.strip(), count=1)
    body = re.sub(r"^(?:the\s+requested\s+|your\s+)", "", body, flags=re.IGNORECASE)
    body = re.sub(r"[.!?]+$", "", body).strip()

    kept: list[str] = []
    for piece in re.split(r",|\band\b|\bor\b", body):
        item = piece.strip().strip(".,;:")
        if len(re.findall(r"[A-Za-z]{2,}", item)) < 1:
            continue
        # A piece the structured key already covers is dropped — unless it names
        # a platform, because that detail is exactly what the key cannot hold.
        if not _names_a_platform(item) and any(
            re.search(pattern, item, re.IGNORECASE) for _key, pattern in _REQUIREMENT_PATTERNS
        ):
            continue
        kept.append(item)
    if not kept:
        return None
    if len(kept) == 1:
        return kept[0]
    return f"{', '.join(kept[:-1])} and {kept[-1]}"


def _is_evaluative(sentence: str) -> bool:
    """Whether a sentence wants a judgement rather than a fact.

    An imperative asking for something is never evaluative, however it ends —
    "List the tools you use." requests a standard detail. An opener like "why"
    or "describe" is evaluative even without a question mark, because the answer
    is prose either way.
    """

    stripped = sentence.strip()
    if _MATERIAL_VERBS.match(stripped):
        return False
    lowered = stripped.lower()
    return any(lowered.startswith(opener) for opener in _EVALUATIVE_OPENERS)


def classify_application_instructions(text: str | None) -> ClassifiedInstructions:
    """Sort one application paragraph into its two destinations, without overlap.

    The priority is fixed, and it is what prevents the same request appearing
    twice: an exact structured requirement wins; otherwise a material detail goes
    to the public note; a screening question is only ever created for something
    neither of those could hold.
    """

    if not text or not text.strip():
        return ClassifiedInstructions()

    keys: list[str] = []
    questions: list[str] = []
    leftovers: list[str] = []

    for raw in re.split(r"(?<=[.!?])\s+|\n+", text.strip()):
        sentence = raw.strip()
        if not sentence:
            continue

        matched = _requirement_keys_in(sentence)
        lowered_start = sentence.strip().lower()
        asks_for_reasoning = any(
            lowered_start.startswith(opener) for opener in _JUDGEMENT_OPENERS
        )
        if matched and not asks_for_reasoning:
            # A standard detail, whatever grammar it arrived in. "What is your
            # expected rate?" is a rate field, not a question to answer in prose.
            for key in matched:
                if key not in keys:
                    keys.append(key)
            # One sentence often asks for several things, and only some of them
            # have a structured home. "Portfolio, samples, personal details, and
            # an AI-video confirmation" maps two and would silently drop the
            # other two if the whole sentence were treated as handled.
            remainder = _unmatched_items(sentence)
            if remainder:
                leftovers.append(remainder)
            continue

        if _is_evaluative(sentence):
            # Only prose the candidate writes can answer this.
            if sentence not in questions:
                questions.append(sentence)
            continue

        if len(re.findall(r"[A-Za-z]{2,}", sentence)) >= 3:
            leftovers.append(sentence)

    return ClassifiedInstructions(
        requirement_keys=keys,
        screening_questions=questions,
        unstructured_materials=leftovers,
    )
