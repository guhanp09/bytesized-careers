"""Facts a page states in its body rather than in its markup or its title.

Structured markup is the best source and the title is the most reliable one, but
neither is complete. A page can carry a plainly labelled "Experience" section,
state a requirement in it, omit that requirement from its JSON-LD, and leave no
trace of it in the title. Read from the title alone, such a page looks like it
never mentioned experience — and the recruiter is asked to supply a fact the
page put in a heading.

Title reading is deliberately conservative because a body *mention* is weak
evidence: a page describing a team can say "remote" without the job being
remote. This module is the narrow exception, and it stays narrow by only
matching phrasings that cannot mean anything else. "25 years of professional
experience" is a requirement however it is worded around; "remote" is not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

#: A stated experience requirement, in the phrasings pages actually use.
#:
#: Every branch requires both a figure and the word "experience" nearby, which
#: is what makes a body match safe here. A bare number, or the word on its own,
#: matches nothing.
_EXPERIENCE = re.compile(
    r"(?:(minimum|at\s+least|min\.?)\s+)?"
    r"(\d{1,2})\s*(?:[-–—]|to)\s*(\d{1,2})\s*(\+?)\s*years?"
    r"(?:\s+(?:[\w-]+\s+){0,3}?experience)"
    r"|(?:(minimum|at\s+least|min\.?)\s+)?"
    r"(\d{1,2})\s*(\+?)\s*years?(?:\s+(?:of\s+)?(?:[\w-]+\s+){0,2}?experience)",
    re.IGNORECASE,
)


#: A quantity that can stand on its own as the value of an ``Experience`` row.
#:
#: This is deliberately stricter than the prose reader above. The label has
#: already established what the number measures, so common board abbreviations
#: (``yr``/``yrs``) are safe here, but the whole value still has to be a coherent
#: requirement. That keeps ``Experience: great attitude`` from becoming an
#: experience level merely because it happened to follow the right heading.
_EXPERIENCE_VALUE = re.compile(
    r"^\s*"
    r"(?P<qualifier>minimum(?:\s+of)?|min\.?|at\s+least|"
    r"up\s+to|maximum(?:\s+of)?|max\.?)?\s*"
    r"(?P<minimum>\d{1,3})\s*"
    r"(?:(?P<plus>\+)|"
    r"(?P<separator>[-\u2013\u2014]|to)\s*(?P<maximum>\d{1,3}))?\s*"
    r"(?P<unit>years?|yrs?|months?|mos?)\b"
    r"(?:\s+(?:of\s+)?(?:[\w'\u2019-]+\s+){0,5}experience)?"
    r"\s*$",
    re.IGNORECASE,
)

#: Explicit non-numeric answers to "how much experience?". These say there is
#: no fixed minimum (or that prior experience is merely preferred); they do not
#: fabricate a number. The portfolio wording is included because creator work
#: is often demonstrated by the work itself rather than a tenure count.
_NON_NUMERIC_EXPERIENCE = re.compile(
    r"^(?:"
    r"(?:strong\s+)?portfolio(?:\s+(?:required|preferred))?[;,: -]+"
    r"no\s+(?:prior\s+experience|minimum\s+(?:years?|experience))\s+required"
    r"|no\s+(?:prior\s+)?experience\s+(?:required|needed|necessary)"
    r"|no\s+minimum\s+(?:years?|experience)\s+required"
    r"|experience\s+(?:preferred|optional|not\s+required)"
    r"|fresher(?:s)?"
    r"|entry[-\s]?level"
    r"|any\s+(?:experience\s+level|level\s+of\s+experience)"
    r")$",
    re.IGNORECASE,
)

#: Only a dedicated row owns this interpretation. A prose sentence containing
#: "experience" is intentionally left to :func:`experience_from_body`, whose
#: grammar requires the word and number to belong to the same claim.
_LABELLED_EXPERIENCE = re.compile(
    r"^[ \t]*(?:required[ \t]+)?experience"
    r"(?:[ \t]+(?:required|requirement|level))?"
    r"[ \t]*(?:(?::|[-\u2013\u2014])[ \t]*\n?[ \t]*|\n[ \t]*)"
    r"(?P<value>[^\n]{1,120})[ \t]*$",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass(frozen=True)
class LabelledExperience:
    """One dedicated experience row, normalized without losing its evidence."""

    value: str
    #: Exact source row, kept separately from the normalized field value.
    evidence: str


def normalize_experience_requirement(value: str | None) -> str | None:
    """Normalize a self-contained experience answer without narrowing it.

    Only spelling and punctuation change: ``1 to 2 yrs`` becomes
    ``1–2 years`` and ``12+ months of relevant editing experience`` becomes
    ``12+ months``. A floor remains a floor, a ceiling remains a ceiling, and a
    non-numeric no-minimum statement stays in the source's own words.
    """

    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        return None

    match = _EXPERIENCE_VALUE.fullmatch(cleaned)
    if match is None:
        return cleaned if _NON_NUMERIC_EXPERIENCE.fullmatch(cleaned) else None

    minimum = int(match.group("minimum"))
    maximum = int(match.group("maximum")) if match.group("maximum") is not None else None
    unit = match.group("unit").casefold()
    canonical_unit = "month" if unit.startswith("mo") else "year"
    upper_bound = 600 if canonical_unit == "month" else 60
    if minimum > upper_bound or maximum is not None and maximum > upper_bound:
        return None
    if maximum is not None and minimum > maximum:
        return None

    qualifier = (match.group("qualifier") or "").casefold()
    if qualifier.startswith(("minimum", "min")):
        prefix = "Minimum "
    elif qualifier == "at least":
        prefix = "At least "
    elif qualifier.startswith(("maximum", "max")):
        prefix = "Maximum "
    elif qualifier == "up to":
        prefix = "Up to "
    else:
        prefix = ""

    # A plus already expresses a lower bound. Keeping a second, synonymous
    # qualifier would add noise, while combining it with an upper-bound phrase
    # would be contradictory and therefore invalid.
    plus = bool(match.group("plus"))
    if plus and prefix in {"Maximum ", "Up to "}:
        return None
    if plus:
        prefix = ""

    if maximum is not None:
        quantity = f"{minimum}\u2013{maximum}"
        plural = True
    else:
        quantity = f"{minimum}{'+' if plus else ''}"
        plural = minimum != 1 or plus
    unit_word = f"{canonical_unit}{'s' if plural else ''}"
    return f"{prefix}{quantity} {unit_word}"


def labelled_experience(text: str | None) -> LabelledExperience | None:
    """Read one unambiguous anchored ``Experience`` fact.

    Repeated rows that normalize to the same value are redundant evidence. Two
    distinct dedicated rows are equally authoritative and therefore a genuine
    source conflict; choosing the first would silently discard the second and
    could overwrite a provider conflict later in reconciliation.
    """

    rows = _labelled_experience_rows(text)
    if not rows:
        return None
    distinct = {row.value for row in rows}
    return rows[0] if len(distinct) == 1 else None


def has_conflicting_labelled_experience(text: str | None) -> bool:
    """Whether the source has two authoritative Experience rows that disagree.

    ``labelled_experience`` intentionally returns ``None`` for both absence and
    conflict. Callers considering weaker prose need this distinction: falling
    through on a conflict would silently promote a third, lower-authority
    sentence over both dedicated facts.
    """

    return len({row.value for row in _labelled_experience_rows(text)}) > 1


def labelled_experience_requirements(text: str | None) -> tuple[LabelledExperience, ...]:
    """Public, immutable view of dedicated rows for conflict presentation."""

    distinct: list[LabelledExperience] = []
    seen: set[str] = set()
    for row in _labelled_experience_rows(text):
        if row.value in seen:
            continue
        seen.add(row.value)
        distinct.append(row)
    return tuple(distinct)


def _labelled_experience_rows(text: str | None) -> tuple[LabelledExperience, ...]:
    """Every valid dedicated experience row, in source order."""

    if not text:
        return ()
    rows: list[LabelledExperience] = []
    for match in _LABELLED_EXPERIENCE.finditer(text):
        normalized = normalize_experience_requirement(match.group("value"))
        if normalized is None:
            continue
        rows.append(
            LabelledExperience(
                value=normalized,
                evidence=match.group(0).strip(),
            )
        )
    return tuple(rows)


#: How a matched qualifier is written back, so the phrasing stays consistent
#: whichever synonym the page happened to use.
_QUALIFIER_WORDING: Final[dict[str, str]] = {
    "minimum": "Minimum",
    "min": "Minimum",
    "min.": "Minimum",
    "at": "At least",
}


def experience_from_body(text: str | None) -> str | None:
    """The experience requirement a body states, verbatim in its own terms.

    Returned as the source phrased it — "25 years" stays "25 years". Judging
    that a page meant "2-5" and mistyped it is a person's call, and shaping the
    figure into a value the editor accepts is a separate step that happens
    later, on the way to the draft.
    """

    if not text:
        return None
    dedicated_rows = _labelled_experience_rows(text)
    if dedicated_rows:
        distinct = {row.value for row in dedicated_rows}
        # A dedicated row outranks weaker prose only when the dedicated source
        # itself agrees. Comparable labelled contradictions belong in a real
        # conflict, never in a first-match fallback.
        return dedicated_rows[0].value if len(distinct) == 1 else None
    requirements = experience_requirements_from_body(text)
    if len(requirements) != 1:
        return None
    return requirements[0]


def experience_requirements_from_body(text: str | None) -> tuple[str, ...]:
    """Every distinct explicit prose requirement, without choosing a winner.

    A page can state ``1–2 years`` in one paragraph and ``3–5 years`` in
    another.  Both are source facts of equal authority.  Returning the first
    made a contradiction look settled merely because it appeared first in the
    HTML.  Callers that need one value may use this only when the tuple has one
    member; callers that support review can surface all of them.
    """

    if not text:
        return ()
    values: list[str] = []
    for match in _EXPERIENCE.finditer(text):
        normalized = _experience_match_value(match)
        if normalized and normalized not in values:
            values.append(normalized)
    return tuple(values)


def _experience_match_value(match: re.Match[str]) -> str | None:
    """Normalize one match while retaining its open/closed bounds."""

    range_qualifier, low, high, range_plus = match.group(1, 2, 3, 4)
    single_qualifier, single, single_plus = match.group(5, 6, 7)

    # A qualifier is part of the claim, not decoration around it. "At least five
    # years" and "five years" are different requirements, and dropping the words
    # in front quietly turns an open floor into an exact figure.
    qualifier = range_qualifier or single_qualifier
    prefix = f"{_QUALIFIER_WORDING[qualifier.lower().split()[0]]} " if qualifier else ""

    if low and high:
        return f"{prefix}{low}–{high} years"
    if single:
        return f"{prefix}{single}{'+' if single_plus else ''} years"
    return None
