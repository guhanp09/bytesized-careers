"""Job copy a candidate reads, with the import machinery kept out of it.

A candidate opened a CreatorJobs listing and read:

    ₹22,000+ per month · The post also states: From ₹22,000.00 per month.

Two separate faults in one line, and neither is a parsing bug.

**The listing talked about itself.** "The post also states" is the import
describing where it got something. That sentence exists nowhere in this
repository — the model wrote it into ``budget_note``, which is free text with no
contract about who reads it. Provenance is real and worth keeping, but it is
*internal*: a CreatorJobs listing is the job, not a commentary on another job
board, and copy that says otherwise makes the whole automated draft look like a
wrapper around somebody else's page.

**It then said the same thing twice.** "₹22,000+ per month" and "From ₹22,000.00
per month" are one compensation fact. The structured qualified fact owns the
presentation; a note that only restates it is noise.

Two rules, and the second is what keeps the first honest:

*Only import-generated text is touched.* A recruiter who deliberately writes
"mentioned in our last post" has written job copy, and rewriting it would be a
worse defect than the one this fixes. Everything here runs on the import path,
before a recruiter has seen the draft, and never over their edits.

*A note is dropped only when it adds nothing.* "Performance bonus after
probation" is genuinely more than the figure and survives untouched. The test is
semantic — the note is read with the same compensation grammar the rest of the
pipeline uses — not a string comparison.
"""

from __future__ import annotations

import re
from typing import Final

from app.core.job_import_compensation import read_pay

#: A clause naming the document rather than the job.
#:
#: Composed rather than listed: a determiner, a word for "the thing I read", and
#: optionally a reporting verb. That covers "The post also states", "According to
#: the original listing", "This posting says" and the rest of the family without
#: needing each spelling written down — and it is anchored to the *start* of the
#: text, because that is where framing sits. A sentence mentioning a listing in
#: the middle of real copy is far more likely to be about the job.
_DOCUMENT = (
    r"(?:job\s+)?(?:post(?:ing)?|listing|advert(?:isement)?|ad|page|source|"
    r"description|announcement)"
)
_REPORTING = r"(?:states?|says?|mentions?|notes?|indicates?|specifies?|lists?|reads?)\b"

_SOURCE_FRAMING: Final[re.Pattern[str]] = re.compile(
    rf"""
    ^\s*
    (?:
        # "According to the original listing," / "As per the job post:"
        (?:according\s+to|as\s+per)\s+(?:the\s+)?
        (?:original\s+|source\s+|employer(?:'s)?\s+)?{_DOCUMENT}\b
      |
        # "The post also states" / "This posting says" — a determiner makes it
        # a reference to a document rather than an ordinary noun.
        (?:the|this|their|its)\s+(?:original\s+|source\s+|employer(?:'s)?\s+)?
        {_DOCUMENT}\b\s*(?:also\s+)?(?:{_REPORTING})?
      |
        # "Listing states:" — no determiner, so a reporting verb is required.
        (?:original\s+|source\s+)?{_DOCUMENT}\b\s*(?:also\s+)?{_REPORTING}
      |
        # "Source:" on its own, which only ever introduces provenance.
        source\s*(?=:)
    )
    \s*[:,\-–—]?\s*
    """,
    re.IGNORECASE | re.VERBOSE,
)

#: Wording that only introduces a restatement, with no document named.
#:
#: The separator is required. Without it "Notes on pay: bonus available" lost its
#: first word — legitimate copy beginning with an ordinary noun that happens to
#: also be a reporting verb.
_RESTATEMENT_LEAD: Final[re.Pattern[str]] = re.compile(
    r"^\s*(?:it\s+)?(?:also\s+)?(?:states?|says?|mentions?|notes?)\s*[:,]\s*",
    re.IGNORECASE,
)


def strip_source_framing(text: str) -> str:
    """Remove a leading clause that talks about the source document.

    Only ever strips a prefix. The rest of the sentence is the employer's own
    words and is returned untouched, because the fault is the framing rather
    than the content it introduces.
    """

    cleaned = text.strip()
    for pattern in (_SOURCE_FRAMING, _RESTATEMENT_LEAD):
        while True:
            trimmed = pattern.sub("", cleaned, count=1).strip()
            if trimmed == cleaned:
                break
            cleaned = trimmed
    return cleaned


def _same_compensation(note: str, payload: dict[str, object]) -> bool:
    """Whether a note states the compensation the job already carries."""

    stated = read_pay(note)
    if stated is None or not stated.states_a_figure:
        return False

    def number(value: object) -> float | None:
        try:
            return float(str(value))
        except (TypeError, ValueError):
            return None

    minimum = number(payload.get("budget_amount"))
    maximum = number(payload.get("budget_max"))
    if stated.minimum is not None and stated.minimum != minimum:
        return False
    if stated.maximum is not None and stated.maximum != maximum:
        return False
    # A note naming a bound the job does not carry is new information, not a
    # restatement — suppressing it would lose a fact rather than a repetition.
    if stated.minimum is None and minimum is not None and stated.maximum is None:
        return False
    return stated.minimum is not None or stated.maximum is not None


def candidate_compensation_note(
    note: object, payload: dict[str, object]
) -> str | None:
    """The pay note a candidate should read, or nothing.

    Returns ``None`` when the note is pure provenance framing, or when what
    remains after removing the framing only repeats the structured figure the
    listing already shows.
    """

    if not isinstance(note, str):
        return None
    cleaned = strip_source_framing(note)
    if not cleaned:
        return None
    without_trailing_stop = cleaned.rstrip(".").strip()
    if not without_trailing_stop:
        return None
    if _same_compensation(cleaned, payload):
        return None
    return cleaned


def candidate_native_copy(payload: dict[str, object]) -> dict[str, object]:
    """Strip import framing from the candidate-facing prose in a draft payload.

    Runs on the import path only. A recruiter's own words never reach here —
    by the time they can edit anything the draft already exists, and their text
    is never re-processed.
    """

    cleaned = dict(payload)

    note = cleaned.get("budget_note")
    if note is not None:
        candidate_note = candidate_compensation_note(note, cleaned)
        if candidate_note is None:
            cleaned.pop("budget_note", None)
        else:
            cleaned["budget_note"] = candidate_note

    # Free-text prose the candidate reads as the job's own description. Framing
    # is stripped; the content is left exactly as the employer wrote it.
    for field in ("about_channel", "how_to_apply", "budget_unit_custom"):
        value = cleaned.get(field)
        if isinstance(value, str):
            stripped = strip_source_framing(value)
            if stripped:
                cleaned[field] = stripped
            elif value.strip():
                # Framing was the whole of it, so there is no job copy to keep.
                cleaned.pop(field, None)

    return cleaned
