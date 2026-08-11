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
    "resume",
    "cover_letter",
    "relevant_portfolio",
    "fit_note",
    "turnaround",
    "working_hours",
    "relevant_experience",
    "tools_workflow",
    "start_availability",
)

_REQUIREMENT_KEY_SET: Final[frozenset[str]] = frozenset(REQUIREMENT_KEYS)

#: Wording that names a standard detail, whatever grammar wraps it.
_REQUIREMENT_PATTERNS: Final[tuple[tuple[str, str], ...]] = (
    ("expected_rate", r"\b(?:expected\s+)?(?:rate|rates|pricing|quote|budget expectation|fee|charges?)\b"),
    ("resume", r"\b(?:cv|resume|résumé|curriculum\s+vitae)\b"),
    (
        "cover_letter",
        r"\b(?:cover[\s-]+(?:letter|note)|motivation(?:al)?[\s-]+letter|"
        r"letter\s+of\s+(?:interest|motivation)|statement\s+of\s+(?:interest|purpose))\b",
    ),
    ("relevant_portfolio", r"\b(?:portfolio|showreel|show\s?reel|demo\s?reel|reel|work\s+samples?|samples?\s+of\s+(?:your\s+)?work)\b"),
    (
        "fit_note",
        r"\b(?:fit[\s-]+note|why\s+(?:you(?:'re|\s+are)|this\s+role)|"
        r"why\s+you\s+(?:fit|are\s+a\s+fit))\b",
    ),
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
    # The routing verbs are here too, deliberately. A source that says "DM your
    # Instagram work" is asking for the work; the verb is a destination, and
    # leaving it in produced "Please include DM your Instagram work" — a note
    # that both reads wrong and repeats the routing.
    r"^\s*(?:please\s+)?(?:we\s+would\s+like\s+to\s+see|we'?d\s+like\s+to\s+see|"
    r"show\s+us|let\s+us\s+see|upload|attach|bring|enclose|include|share|send|"
    r"provide|submit|complete|fill(?:\s+(?:out|in))?|forward|apply|contact|"
    r"reach\s+out|email|get\s+in\s+touch|"
    r"state|list|add|drop|dm|whats-?app|message|text|ping|mail|e-?mail)\b",
    re.IGNORECASE,
)

# A source can request material without using an imperative: “Your YouTube
# selected work would help us decide.”  That sentence is still an application
# ask, but treating every “would help” sentence as one would turn ordinary fit
# prose (“Your attention to detail would help us succeed”) into a required
# attachment.  Keep this grammar narrow: the candidate owns the object and the
# object is explicitly offered as evidence for a hiring decision.
_DECLARATIVE_MATERIAL_REQUEST = re.compile(
    r"^\s*(?:your|their|his|her|the\s+candidate'?s)\s+"
    r"(?P<material>.+?)\s+"
    r"(?:would|will|can|could)\s+help\s+"
    r"(?:us|me|the\s+(?:hiring\s+)?team)\s+"
    r"(?:decide|assess|evaluate|review)(?:\s+(?:your|their)\s+(?:application|fit))?"
    r"[.!?]?\s*$",
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


#: Verbs that describe the work rather than request material from a candidate.
#:
#: "You will build a portfolio of finished pieces for the brand" names a
#: responsibility, and reading it as a request turned twenty-two generated job
#: descriptions into an application requirement — the recruiter's own
#: description of the role, deleted and replaced by a demand for a portfolio.
#:
#: The distinction is the verb, not the noun. A candidate *provides* a
#: portfolio; a job *builds* one.
_DESCRIBES_THE_WORK = re.compile(
    r"\b(?:will|would|shall)\s+(?:be\s+)?(?:"
    r"build|building|produce|producing|create|creating|maintain|maintaining|"
    r"own|owning|manage|managing|grow|growing|develop|developing|run|running|"
    r"deliver|delivering|curate|curating|expand|expanding"
    r")\b"
    # Two words, because a work noun is often two: "our demo reel is",
    # "our past work is".
    r"|^\s*(?:the\s+role|this\s+role|the\s+job|we\s+keep|"
    r"our\s+\w+(?:\s+\w+)?\s+(?:is|are|was|were)|"
    r"you'?ll\s+(?:build|own|manage|produce|create|grow|run))\b",
    re.IGNORECASE,
)

# Application vocabulary is ordinary work vocabulary too.  These noun/verb
# collisions describe the job even though they contain words such as
# ``portfolio``, ``cover letter`` or ``prior experience`` that the application
# form also knows how to collect.  The boundary must prefer omission over
# turning a responsibility into a candidate requirement.
_RESPONSIBILITY_NOUN_COLLISION = re.compile(
    r"^\s*(?:please\s+)?(?:"
    r"provide\s+portfolio\s+(?:management|strategy|operations?|support|services?)|"
    r"include\s+cover[\s-]+letter\s+(?:animations?|designs?|graphics?|"
    r"layouts?|motion|sequences?|styles?|templates?)|"
    r"apply\s+(?:your\s+)?(?:prior|relevant)\s+experience\s+to\s+"
    r"(?:build|create|develop|edit|manage|produce|run)"
    r")\b",
    re.IGNORECASE,
)


def _describes_the_work(sentence: str) -> bool:
    """Whether a sentence describes the job rather than asking for material."""

    return bool(
        _DESCRIBES_THE_WORK.search(sentence)
        or _RESPONSIBILITY_NOUN_COLLISION.search(sentence)
    )


def _requirement_keys_in(sentence: str) -> list[str]:
    found: list[str] = []
    for key, pattern in _REQUIREMENT_PATTERNS:
        if (
            key in _REQUIREMENT_KEY_SET
            and key not in found
            and re.search(pattern, sentence, re.IGNORECASE)
        ):
            found.append(key)
    return found


def sanitize_application_requirement_keys(values: object) -> list[str]:
    """Keep only canonical job requirement keys, once and in source order.

    Imported values are not trusted merely because they arrived in the field
    named ``application_requirements``.  This function is intentionally strict:
    prose, routing clauses, misspellings, and keys the candidate form cannot
    render are all excluded rather than copied into a public job contract.
    """

    if not isinstance(values, (list, tuple)):
        return []

    sanitized: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        key = value.strip()
        if key in _REQUIREMENT_KEY_SET and key not in sanitized:
            sanitized.append(key)
    return sanitized


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


#: "your Behance profile", "their TikTok channel" — a proper noun sitting in
#: front of a word that means the candidate's own work.
#:
#: Structural, because the named list below is not the web. Twenty-six generated
#: sentences lost their platform simply because it was WhatsApp or Discord
#: rather than YouTube — a recruiter asking for someone's Telegram channel work
#: got a generic "portfolio" requirement and no mention of Telegram at all.
_PLATFORM_IN_WORK_CONTEXT = re.compile(
    # Single capital allowed: "your X work" names a platform, not a letter.
    r"\b[A-Z][\w.+-]{0,20}\s+"
    r"(?:work|works|channel|channels|profile|profiles|page|pages|account|"
    r"accounts|content|posts?|reels?|videos?|clips?|edits?|handle|handles|"
    r"portfolio|feed|presence)\b"
)


def _names_a_platform(fragment: str) -> bool:
    lowered = fragment.lower()
    if any(re.search(rf"\b{name}\b", lowered) for name in _PORTFOLIO_PLATFORMS):
        return True
    return bool(_PLATFORM_IN_WORK_CONTEXT.search(fragment))


#: Stand-ins that carry no requirement of their own.
_NAMES_NOTHING: Final[frozenset[str]] = frozenset(
    {
        "everything",
        "it",
        "them",
        "these",
        "those",
        "all",
        "all of it",
        "the above",
        "the below",
        "anything",
        "something",
        "this",
        "that",
    }
)


def _material_object(sentence: str) -> str | None:
    """Return the requested material from a supported request grammar."""

    declarative = _DECLARATIVE_MATERIAL_REQUEST.match(sentence)
    if declarative:
        return declarative.group("material").strip().strip(".,;:") or None
    if _MATERIAL_VERBS.match(sentence):
        return _MATERIAL_VERBS.sub("", sentence.strip(), count=1)
    return None


def _unmatched_items(sentence: str) -> str | None:
    """The requested things in a sentence that no structured field can hold.

    Returned as a phrase rather than a sentence, so the note composer can put it
    behind "Please include …" alongside anything else that survived.
    """

    body = _material_object(sentence)
    if body is None:
        return None
    body = re.sub(r"^(?:the\s+requested\s+|your\s+)", "", body, flags=re.IGNORECASE)
    body = re.sub(r"[.!?]+$", "", body).strip()

    kept: list[str] = []
    for piece in re.split(r",|\band\b|\bor\b", body):
        item = piece.strip().strip(".,;:")
        if len(re.findall(r"[A-Za-z]{2,}", item)) < 1:
            continue
        # A word that stands in for the materials rather than naming one.
        # "Send everything to our careers page" reduces to "everything", and
        # "Please include everything with your CreatorJobs application" tells a
        # candidate nothing at all — it reads as an instruction while carrying
        # no instruction.
        if item.casefold() in _NAMES_NOTHING:
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

    # One sentence often carries a material ask and a judgement ask joined by a
    # conjunction: "Send two caption examples and tell us why you want the job."
    # Splitting only on sentence boundaries sent the whole thing to one
    # destination, so the judgement half was published in the public note
    # instead of being asked privately once.
    prepared = re.sub(
        r",?\s+\band\s+(?=(?:tell us|tell me|answer|explain|describe|let us know|share your thoughts)\b)",
        ". ",
        text.strip(),
        flags=re.IGNORECASE,
    )
    for raw in re.split(r"(?<=[.!?])\s+|\n+", prepared):
        sentence = raw.strip()
        if not sentence:
            continue

        if _describes_the_work(sentence):
            # A responsibility, not a request. It belongs in the job's own
            # description and must not become something the candidate is asked
            # to send.
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
            #
            # Sanitised on the way in. A screening question is candidate-facing,
            # so a destination that rode along with the judgement clause — "tell
            # us why you want the job on WhatsApp" — would route applicants off
            # the platform from inside a private question, which is the one
            # place nobody thought to look for it.
            from app.core.job_application_instructions import (
                separate_application_instructions,
            )

            # A screening question is candidate-facing and is, by definition,
            # part of the how-to-apply block. A channel on the end of one is a
            # delivery instruction rather than vocabulary, so routing is
            # assumed here where it is inferred everywhere else.
            separated = separate_application_instructions(
                sentence, assume_routing=True
            )
            cleaned = (separated.safe_sentences or [sentence])[0].strip()
            if cleaned and cleaned not in questions:
                questions.append(cleaned)
            continue

        # Fail closed at the imported application boundary. Arbitrary prose in
        # a provider's ``how_to_apply`` field is not automatically an
        # application material: responsibilities and novel route imperatives
        # are both ordinary sentences too. Only a transmission-shaped request
        # can become candidate-facing residual material.
        if _MATERIAL_VERBS.match(sentence) or _DECLARATIVE_MATERIAL_REQUEST.match(
            sentence
        ):
            remainder = _unmatched_items(sentence)
            if remainder:
                leftovers.append(remainder)

    return ClassifiedInstructions(
        requirement_keys=sanitize_application_requirement_keys(keys),
        screening_questions=questions,
        unstructured_materials=leftovers,
    )
