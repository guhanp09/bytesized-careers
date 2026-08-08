"""Putting a source's own words into a native field without changing what they say.

A source speaks in its own terms — "25 years of professional experience",
"Coimbatore, Coimbatore district, IN". A native field has its own shape. Getting
a fact from one to the other is a real translation problem, and the first attempt
at it got the central rule wrong, so it is worth stating plainly:

**A conversion may never make a fact narrower, more precise, or different.**

It may represent the value exactly. It may place it in a native category that
genuinely *contains* it. It may decline, leaving the field unset and the source
value preserved for the recruiter to see. It may report a technical defect. It
may not do anything else — and in particular it may not pick the closest
available category and hope.

The defect that forced this rewrite is instructive. ``coerce_to_native`` asked
``answer_shape_for`` what values the field accepted. But that function answers a
different question — what to offer the recruiter in a chat question — and for
``experience_level`` it returns four closed bands from a *product catalog*. The
schema itself types the field as a free string. So a page stating "25 years" was
mapped into "5–8 years" to fit a constraint that did not exist, and a listing
went out saying something the source never said. Twenty-five years is not five to
eight years. No amount of rounding makes it so.

Two lessons are encoded here. Native constraints are read from the schema, via
``native_schema_constraints``, never from the question's option list. And a
category only ever receives a value it demonstrably contains, which is why there
is no "nearest band" search anywhere below: narrowing is not rejected by a check,
it is absent by construction.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final, Literal, get_args, get_origin

from app.core.job_import_answer_shapes import native_schema_constraints
from app.core.job_import_location_resolution import parse_location
from app.schemas.job import JobCreate

#: What happened to one value on its way to a native field.
ConversionOutcome = Literal["exact", "broadened", "unsupported", "invalid"]


@dataclass(frozen=True)
class NativeConversion:
    """One value, what became of it, and why — auditable after the fact.

    ``native_value`` is ``None`` for every outcome except ``exact`` and
    ``broadened``. That is the point: a field the source could not truthfully
    fill stays empty, and ``source_value`` keeps what the page actually said so
    the recruiter can be shown it rather than asked for it.
    """

    field_path: str
    source_value: object
    native_value: object | None
    outcome: ConversionOutcome
    #: Whether the native representation includes the source fact. Always true
    #: when a value is written; the writing paths cannot produce anything else.
    contains_source: bool
    #: Plain-language reason, safe to show a recruiter.
    detail: str

    @property
    def writable(self) -> bool:
        return self.native_value is not None


#: Native categories that are explicitly open-ended, with the figure they start
#: from. A source figure at or above the bound is genuinely contained by such a
#: category, so mapping into it broadens without distorting.
#:
#: Empty for ``experience_level``, and that emptiness is the honest state of the
#: product: its bands are all closed ranges, the most senior ending at eight
#: years, so nothing above eight can be truthfully represented as a band. The
#: mechanism exists so that adding an "8+ years" category later is a data change
#: rather than another rewrite — but adding one is a product decision about
#: search and matching, not something a conversion layer may assume.
OPEN_ENDED_CATEGORIES: Final[dict[str, tuple[tuple[str, float], ...]]] = {}

#: A figure stated as a lower bound with no upper one: "5+ years", "at least 8".
_OPEN_ENDED_SOURCE = re.compile(
    r"(?:\b(?:at\s+least|minimum(?:\s+of)?|min\.?|over|more\s+than)\s+)(\d{1,3})"
    r"|(\d{1,3})\s*\+",
    re.IGNORECASE,
)


def _numeric_floor(value: str) -> float | None:
    """The smallest figure a stated requirement would accept, if it states one."""

    match = _OPEN_ENDED_SOURCE.search(value)
    if match:
        return float(match.group(1) or match.group(2))
    plain = re.search(r"\b(\d{1,3})\b", value)
    return float(plain.group(1)) if plain else None


def _category_contains(field_path: str, category: str, value: str) -> bool:
    """Whether an open-ended native category genuinely includes a stated figure."""

    floor = _numeric_floor(value)
    if floor is None:
        return False
    for name, bound in OPEN_ENDED_CATEGORIES.get(field_path, ()):
        if name == category:
            return floor >= bound
    return False


def convert_to_native(field_path: str, value: object) -> NativeConversion:
    """Translate one value for one native field, honestly or not at all."""

    def result(
        native: object | None, outcome: ConversionOutcome, detail: str
    ) -> NativeConversion:
        return NativeConversion(
            field_path=field_path,
            source_value=value,
            native_value=native,
            outcome=outcome,
            contains_source=native is not None,
            detail=detail,
        )

    choices, cap, is_list = native_schema_constraints(field_path)

    if isinstance(value, dict):
        # A provider reply's `value` is typed as JsonValue, so an object passes
        # schema validation and arrives here. Nothing downstream expects one: a
        # title that is a mapping renders as `{'unexpected': 'object'}` to a
        # recruiter and to a candidate. Generated replies found this, and the
        # reason it survived is that no hand-written case ever thought to send
        # an object where a sentence belongs.
        return result(
            None,
            "invalid",
            "The source value is a structure rather than a stated fact.",
        )

    if is_list:
        # A list is a set of facts rather than one fact, so there is no category
        # to place it in and nothing here can narrow it. Membership of each entry
        # is the schema's business, and Pydantic still checks it downstream.
        #
        # Except for shape, and only where the schema says the list holds plain
        # strings. An entry that is itself a structure is then the same defect
        # as a mapping arriving for a scalar field, one level down — a
        # responsibility that is an object reads as `{'a': 1}` in a bullet list.
        # Rejecting the whole value is right rather than dropping the bad entry:
        # a reply that got the shape wrong is not evidence about which of its
        # entries are trustworthy.
        #
        # Fields like `deliverables` genuinely hold objects, and an earlier
        # version of this guard refused them — so the shape question has to be
        # asked of the schema rather than assumed.
        if (
            _list_holds_plain_strings(field_path)
            and isinstance(value, list)
            and any(isinstance(entry, (dict, list)) for entry in value)
        ):
            return result(
                None,
                "invalid",
                "The source lists structures rather than stated facts.",
            )
        return result(value, "exact", "Stored as the source lists it.")

    if field_path == "location" and isinstance(value, str):
        # Reducing a postal address to its city is not narrowing: the control
        # holds a city, and the city is the same one either way. Dropping the
        # district and the country code changes the wording, not the place.
        parts = parse_location(value)
        canonical = ", ".join(
            component for component in (parts.locality, parts.city) if component
        )
        if not canonical:
            return result(
                None,
                "unsupported",
                "The source names an arrangement or a country rather than a city.",
            )
        if cap is not None and len(canonical) > cap:
            return result(None, "unsupported", "The place name is longer than the field allows.")
        return result(canonical, "exact", "The same place, named as the field expects.")

    if choices is None:
        # The schema constrains nothing, so the field can hold what the source
        # said. This is the common case and the one that must stay simple: no
        # catalog, no banding, no rounding — the recruiter sees the page's words.
        if isinstance(value, str) and cap is not None and len(value) > cap:
            # Truncating would quietly change the claim, so it is declined.
            return result(
                None,
                "unsupported",
                "The source states this at greater length than the field can hold.",
            )
        if isinstance(value, str) and value and not value.strip():
            # Whitespace is not a statement. Storing it "exactly" filled the row
            # with something that renders as nothing — so the field looks
            # answered, no question is asked about it, and the recruiter reaches
            # Post Job to find it blank with no explanation.
            #
            # An *empty* string is different and is deliberately still exact: it
            # is how a recruiter clears a field, and refusing it would make the
            # field impossible to empty once anything had been read into it.
            return result(None, "unsupported", "The source states nothing here.")
        return result(value, "exact", "Stored exactly as the source states it.")

    if value in choices:
        return result(value, "exact", "Exactly one of the values this field accepts.")

    if not isinstance(value, str):
        return result(None, "invalid", "This field accepts a fixed set of values.")

    folded = {choice.casefold(): choice for choice in choices}
    matched = folded.get(value.strip().casefold())
    if matched is not None:
        # Spelling and spacing are not disagreements about meaning.
        return result(matched, "exact", "The same value, spelled as the field expects.")

    for category, _bound in OPEN_ENDED_CATEGORIES.get(field_path, ()):
        if category in choices and _category_contains(field_path, category, value):
            return result(
                category,
                "broadened",
                f"{value} falls inside {category}, which is open-ended.",
            )

    # Deliberately no fallback. There is no "closest" category, because a
    # category that does not contain the value would state something the source
    # did not. The field stays empty and the source value stays visible.
    return result(
        None,
        "unsupported",
        "The source states something none of this field's values covers.",
    )


def coerce_to_native(field_path: str, value: object) -> object | None:
    """The value as the native field may hold it, or ``None`` to leave it unset."""

    return convert_to_native(field_path, value).native_value


def _list_holds_plain_strings(field_path: str) -> bool:
    """Whether the schema types this list field as a list of plain strings.

    Asked of ``JobCreate`` directly rather than of ``native_schema_constraints``,
    which reports only whether a field *is* a list. Some list fields —
    ``deliverables`` most obviously — legitimately hold objects, and refusing
    those would throw away structured facts a source correctly supplied.
    """

    model_field = JobCreate.model_fields.get(field_path)
    if model_field is None:
        return False
    annotation = model_field.annotation
    for candidate in (annotation, *get_args(annotation)):
        if get_origin(candidate) is not list:
            continue
        arguments = get_args(candidate)
        if arguments and arguments[0] is str:
            return True
    return False
