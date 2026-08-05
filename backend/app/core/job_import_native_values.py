"""Shaping derived values into something the native editor will accept.

The intelligence layer reads facts in the vocabulary of the *source*: a page
says "2-4 years of experience", or "25 years", or "Coimbatore, Coimbatore
district, IN". The native editor accepts values in the vocabulary of the
*product*: a closed set of four experience bands, a city.

Nothing was translating between the two. A correctly-read fact was written to a
field that could not hold it, the editor's validator refused it on arrival, and
the recruiter was left to re-enter something the source had already stated. That
is the exact shape of failure this feature exists to remove: a technical mapping
fault presented to a person as their work.

So every machine-derived value passes through here on its way to the draft, and
one of three things happens.

*It fits.* Pass it through unchanged.

*It can be faithfully expressed in the product's vocabulary.* Translate it. A
requirement of "2-4 years" is a requirement of at least two years, and the band
containing two years says that truthfully.

*It cannot.* Drop it, and let it be asked. A value the editor will reject is
worth strictly less than no value at all: an empty field is one question, a
rejected one is an error message plus the same question.

What this must never do is guess. A source stating "25 years" is carried as
written or dropped — never rewritten into the "2-5 years" it was probably meant
to be. Deciding a source contains a typo is a person's call, not a parser's.
"""

from __future__ import annotations

import re
from typing import Final

from app.core.job_import_answer_shapes import answer_shape_for

#: A choice that names a numeric band: "0–1 years", "3–5 years", "5+ years".
_BAND = re.compile(r"^\s*(\d{1,3})\s*(?:[-–—]\s*(\d{1,3})|(\+))?\s*(\w+)?\s*$")

#: The same, read out of a free-form value: "2–4 years", "25 years", "5+ years".
_STATED = re.compile(r"(\d{1,3})\s*(?:[-–—]|to)\s*(\d{1,3})|(\d{1,3})\s*(\+)?")

#: Fields whose choices are ordered bands, so a stated figure can be placed in
#: one. Ordering is what makes the translation safe: without it, "closest" has
#: no meaning and the only honest options are an exact match or nothing.
_BANDED_FIELDS: Final[frozenset[str]] = frozenset({"experience_level"})


def _band_bounds(choice: str) -> tuple[float, float] | None:
    """The numeric span a choice covers, if it names one."""

    match = _BAND.match(choice.replace("years", " years"))
    if not match:
        return None
    low, high, open_ended, _unit = match.groups()
    if open_ended:
        return (float(low), float("inf"))
    if high:
        return (float(low), float(high))
    return (float(low), float(low))


def _stated_minimum(value: str) -> float | None:
    """The smallest figure a stated requirement would accept.

    "2-4 years" asks for at least two. "5+ years" asks for at least five. Both
    are minimums, which is the only reading that lets a range be placed in a
    single band without inventing precision the source did not have.
    """

    match = _STATED.search(value)
    if not match:
        return None
    low, _high, single, _plus = match.groups()
    return float(low if low else single)


def coerce_to_native(field_path: str, value: object) -> object | None:
    """The value as the native field would accept it, or ``None`` if it cannot.

    ``None`` means *do not write this*. The caller drops the field, which leaves
    it askable and leaves the editor clean, rather than handing the editor a
    value it will refuse.
    """

    shape = answer_shape_for(field_path)
    if shape is None or shape.kind != "choice" or shape.is_list:
        return value
    choices = list(shape.choices or ())
    if not choices or value in choices:
        return value
    if not isinstance(value, str):
        return None

    # Case and spacing differences are not disagreements about meaning.
    folded = {choice.casefold(): choice for choice in choices}
    exact = folded.get(value.strip().casefold())
    if exact is not None:
        return exact

    if field_path not in _BANDED_FIELDS:
        return None

    bands = [(choice, _band_bounds(choice)) for choice in choices]
    ordered = [(choice, bounds) for choice, bounds in bands if bounds is not None]
    if len(ordered) != len(bands):
        return None
    stated = _stated_minimum(value)
    if stated is None:
        return None

    # Bands share their boundaries — "1–3" and "3–5" both name three. A stated
    # minimum belongs to the band that *starts* there, not the one that ends
    # there: asking for five years is asking for the senior band, not the top of
    # the one below it. So the upper bound is exclusive.
    for choice, (low, high) in ordered:
        if low <= stated < high:
            return choice

    # At or beyond the most senior band the product offers. A source asking for
    # more experience than any band names is still asking for at least that
    # band, so saying so is true; saying nothing would lose a stated fact.
    ceiling = max(ordered, key=lambda item: item[1][0])
    if stated >= ceiling[1][0]:
        return ceiling[0]
    floor = min(ordered, key=lambda item: item[1][0])
    return floor[0] if stated < floor[1][0] else None
