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
    match = _EXPERIENCE.search(text)
    if not match:
        return None
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
