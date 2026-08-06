"""The one place a public how-to-apply note is written.

Every candidate-facing application instruction comes from here, whether it began
as imported prose, a structured list of materials, or a deadline the source
buried in a sentence. Having one composer is the point: a note assembled in two
places is a note that will eventually disagree with itself, and the failure mode
is publishing a routing instruction that one path sanitises and the other does
not.

The composer only ever receives permitted values. It has no access to the private
destination at all, so there is no path — not a bug, not a future edit — by which
a WhatsApp number reaches a published listing through this function.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from app.core.job_application_instructions import (
    contains_external_routing,
    requirement_object,
    separate_application_instructions,
)

#: How the platform refers to itself when it improves clarity, and no more often.
_PLATFORM = "CreatorJobs"


def _join_materials(materials: list[str]) -> str:
    """Natural-language list, without repeating a phrase the source repeated."""

    seen: list[str] = []
    for item in materials:
        cleaned = re.sub(r"\s+", " ", item).strip().strip(".,;")
        if cleaned and cleaned.lower() not in {existing.lower() for existing in seen}:
            seen.append(cleaned)
    if not seen:
        return ""
    if len(seen) == 1:
        return seen[0]
    return f"{', '.join(seen[:-1])} and {seen[-1]}"


def format_deadline(when: datetime) -> str:
    """A deadline sentence, in the product's usual date wording.

    A stated time is kept because "by 5pm" and "by end of day" are different
    promises; a bare date does not gain a time it never had.
    """

    local = when
    day = local.day
    month = local.strftime("%B")
    year = local.year
    if local.hour or local.minute:
        clock = local.strftime("%-I:%M %p").replace("AM", "AM").replace("PM", "PM")
        zone = local.tzname() or "UTC"
        return f"Please apply by {clock} {zone} on {day} {month} {year}."
    return f"Applications close on {day} {month} {year}."


def compose_public_apply_note(
    *,
    source_text: str | None = None,
    materials: list[str] | None = None,
    deadline: datetime | None = None,
    deadline_sentence: str | None = None,
    recruiter_note: str | None = None,
) -> str | None:
    """Build the candidate-facing note from permitted parts only.

    Returns ``None`` when nothing useful survives — a source that said only
    "apply through the form below" has given the candidate no requirement and no
    date, and an empty instruction block is better than a hollow sentence.
    """

    sentences: list[str] = []

    # A recruiter's own safe wording leads, because they wrote it deliberately.
    if recruiter_note and recruiter_note.strip():
        if contains_external_routing(recruiter_note) is None:
            sentences.append(recruiter_note.strip())

    collected: list[str] = list(materials or [])
    carried: list[str] = []

    if source_text:
        separated = separate_application_instructions(source_text)
        for sentence in separated.safe_sentences:
            asked_for = requirement_object(sentence)
            if asked_for:
                collected.append(asked_for)
            else:
                carried.append(sentence)

    joined = _join_materials(collected)
    if joined:
        sentences.append(f"Please include {joined} with your {_PLATFORM} application.")
    sentences.extend(carried)

    if deadline_sentence and deadline_sentence.strip():
        sentences.append(deadline_sentence.strip())
    elif deadline is not None:
        sentences.append(format_deadline(deadline))

    note = " ".join(part.strip() for part in sentences if part and part.strip())
    note = re.sub(r"\s{2,}", " ", note).strip()
    if not note:
        return None

    # Belt and braces. Composition is built from permitted values only, so this
    # should never fire — but the cost of it firing wrongly is a public listing
    # telling candidates to message a stranger's phone number.
    if contains_external_routing(note) is not None:
        return None
    return note


def public_note_for_job(
    *,
    stored_note: str | None,
    stored_deadline: datetime | None = None,
) -> str | None:
    """The note a candidate should see for a job that already exists.

    Historical rows carry both a free-text note written before routing was
    policed and a deadline from the era when it had its own field. Neither is
    rewritten in the database; both are made safe on the way out, so an old
    listing cannot leak a destination and an old deadline is not simply lost.
    """

    safe = stored_note
    if stored_note and contains_external_routing(stored_note) is not None:
        separated = separate_application_instructions(stored_note)
        safe = " ".join(separated.safe_sentences) or None

    if stored_deadline is None:
        return safe or None

    deadline_line = format_deadline(stored_deadline)
    if safe and _mentions_deadline(safe, stored_deadline):
        return safe
    return " ".join(part for part in (safe, deadline_line) if part)


def _mentions_deadline(note: str, when: datetime) -> bool:
    """Whether a note already states this date, so it is not stated twice."""

    lowered = note.lower()
    if str(when.day) in lowered and when.strftime("%B").lower() in lowered:
        return True
    return bool(re.search(r"\b(?:applications close|apply by|deadline)\b", lowered))


def deadline_is_past(when: datetime | None, *, now: datetime | None = None) -> bool:
    """Whether an imported deadline has already gone by."""

    if when is None:
        return False
    reference = now or datetime.now(UTC)
    moment = when if when.tzinfo else when.replace(tzinfo=UTC)
    return moment < reference
