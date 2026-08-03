"""What a valid answer to a question actually looks like.

Derived from the canonical job schema rather than restated by hand. The client
was maintaining its own idea of which fields were enums and what their values
were, which is how it came to offer a text box for ``hiring_process`` — a list
of stage objects that no typed sentence could ever satisfy.

Reading the shape off ``JobCreate`` means the two cannot drift: adding a work
mode or tightening a length shows up in the UI on the next request, and a field
the client has never heard of still gets a correct control.

Nothing here decides *whether* a question is asked. It only describes the answer,
so the interface can make an invalid one unexpressible instead of rejecting it.
"""

from __future__ import annotations

import typing
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

from annotated_types import Ge, Gt, Le, Lt, MaxLen, MinLen

from app.core.job_domain_taxonomy import (
    CREATOR_CONTENT_NICHES,
    CREATOR_EXPERIENCE_BANDS,
    CREATOR_JOB_FORMATS,
    CREATOR_JOB_PLATFORMS,
)
from app.schemas.job import JobCreate

AnswerKind = Literal["choice", "multi_choice", "number", "text", "url", "date", "unknown"]


@dataclass(frozen=True)
class AnswerShape:
    """The control the interface should render, and its exact bounds."""

    kind: AnswerKind
    #: Allowed values for a choice. Empty for anything free-form.
    choices: list[str] = field(default_factory=list)
    minimum: float | None = None
    maximum: float | None = None
    min_length: int | None = None
    max_length: int | None = None
    #: True when the field stores a list, so one pick becomes a one-item list.
    is_list: bool = False
    #: The key each picked value sits under, for structured rows.
    item_key: str | None = None
    #: Display text per value. A slug is an identifier, not a label — showing
    #: "Long-form-editor" as a button is the catalog leaking into the interface.
    labels: dict[str, str] = field(default_factory=dict)

    def as_payload(self) -> dict[str, Any]:
        """Bounded, JSON-safe, and free of anything internal."""

        payload: dict[str, Any] = {"kind": self.kind}
        if self.choices:
            payload["choices"] = self.choices[:40]
        for name in ("minimum", "maximum", "min_length", "max_length", "item_key"):
            value = getattr(self, name)
            if value is not None:
                payload[name] = value
        if self.is_list:
            payload["is_list"] = True
        if self.labels:
            payload["labels"] = {
                value: self.labels[value] for value in payload.get("choices", [])
                if value in self.labels
            }
        return payload


#: Values that live in a product catalog rather than the job schema.
#:
#: The schema types these as plain lists of strings, so they would otherwise get
#: a free-text box — which is how a platform question came to accept "Ajajjaja".
_CATALOG_CHOICES: dict[str, tuple[str, ...]] = {
    "platforms": CREATOR_JOB_PLATFORMS,
    "formats_hired_for": CREATOR_JOB_FORMATS,
    "content_niches": CREATOR_CONTENT_NICHES,
    "experience_level": CREATOR_EXPERIENCE_BANDS,
}

#: Catalog fields that hold a single value rather than a list.
_SINGLE_VALUE_CATALOGS: frozenset[str] = frozenset({"experience_level"})

_CATALOG_LABELS: dict[str, dict[str, str]] = {
    "platforms": {"youtube": "YouTube", "instagram": "Instagram"},
}


#: Structured list fields, and the key each chosen value sits under.
#:
#: These are the ones that produced "That answer is not valid for this detail":
#: the model stores rows, not prose, so the interface has to build the rows.
_STRUCTURED_ROWS: dict[str, tuple[str, str]] = {
    # field path -> (nested model field name, its key on each row)
    "hiring_process": ("hiring_process", "stage"),
    "source_inputs": ("source_inputs", "type"),
    "deliverables": ("deliverables", "type"),
}


def _titlecase(value: str) -> str:
    """Turn a slug into something a person would read.

    Values that are already written for people — "Shorts/Reels", "Long-form
    video" — are left exactly as they are; only lowercase slugs are rewritten.
    """

    if value != value.lower() or not any(mark in value for mark in "-_"):
        return value
    return value.replace("-", " ").replace("_", " ").strip().capitalize()


def _literals(annotation: Any) -> list[str]:
    """Every Literal value reachable through Optionals, lists and unions."""

    found: list[str] = []
    if typing.get_origin(annotation) is Literal:
        return [value for value in typing.get_args(annotation) if isinstance(value, str)]
    for argument in typing.get_args(annotation):
        if argument is type(None):
            continue
        found.extend(_literals(argument))
    return list(dict.fromkeys(found))


def _is_list(annotation: Any) -> bool:
    for candidate in (annotation, *typing.get_args(annotation)):
        if typing.get_origin(candidate) in (list, set, tuple):
            return True
    return False


def _bounds(metadata: list[Any]) -> dict[str, Any]:
    bounds: dict[str, Any] = {}
    for entry in metadata:
        if isinstance(entry, Gt):
            bounds["minimum"] = float(entry.gt) + 1
        elif isinstance(entry, Ge):
            bounds["minimum"] = float(entry.ge)
        elif isinstance(entry, Lt):
            bounds["maximum"] = float(entry.lt) - 1
        elif isinstance(entry, Le):
            bounds["maximum"] = float(entry.le)
        elif isinstance(entry, MinLen):
            bounds["min_length"] = int(entry.min_length)
        elif isinstance(entry, MaxLen):
            bounds["max_length"] = int(entry.max_length)
    return bounds


def _row_choices(nested_field: str, key: str) -> list[str]:
    """Allowed keys for one row of a structured list field."""

    outer = JobCreate.model_fields.get(nested_field)
    if outer is None:
        return []
    for argument in typing.get_args(outer.annotation):
        for inner in typing.get_args(argument):
            model_fields = getattr(inner, "model_fields", None)
            if model_fields and key in model_fields:
                return _literals(model_fields[key].annotation)
    return []


def answer_shape_for(field_path: str) -> AnswerShape:
    """Describe a valid answer for one field."""

    if field_path in _STRUCTURED_ROWS:
        nested_field, key = _STRUCTURED_ROWS[field_path]
        choices = [value for value in _row_choices(nested_field, key) if value != "other"]
        if choices:
            return AnswerShape(
                kind="multi_choice", choices=choices, is_list=True, item_key=key
            )

    if field_path in _CATALOG_CHOICES:
        choices = list(_CATALOG_CHOICES[field_path])
        single = field_path in _SINGLE_VALUE_CATALOGS
        return AnswerShape(
            kind="choice" if single else "multi_choice",
            choices=choices,
            is_list=not single,
            labels={
                value: _CATALOG_LABELS.get(field_path, {}).get(value, _titlecase(value))
                for value in choices
            },
        )

    model_field = JobCreate.model_fields.get(field_path)
    if model_field is None:
        return AnswerShape(kind="unknown")

    annotation = model_field.annotation
    is_list = _is_list(annotation)
    choices = [value for value in _literals(annotation) if value != "other"]
    bounds = _bounds(list(model_field.metadata or []))

    if choices:
        return AnswerShape(
            kind="multi_choice" if is_list else "choice",
            choices=choices,
            is_list=is_list,
            **bounds,
        )

    # No enum: fall back to the primitive the field stores. Annotated wrappers
    # carry the constraints, so they have to be unwrapped to reach the type.
    def unwrap(candidate: Any) -> Any:
        while typing.get_origin(candidate) is typing.Annotated:
            candidate = typing.get_args(candidate)[0]
        return candidate

    flattened = [
        unwrap(argument)
        for argument in (typing.get_args(annotation) or (annotation,))
        if argument is not type(None)
    ]
    primitive = flattened[0] if flattened else unwrap(annotation)

    # Money is stored as Decimal, so a bare int/float check missed every
    # compensation field and left them without a numeric control.
    if primitive in (int, float, Decimal):
        return AnswerShape(kind="number", is_list=is_list, **bounds)
    if field_path.endswith("_url"):
        return AnswerShape(kind="url", is_list=is_list, **bounds)
    if field_path.endswith(("_at", "_date")):
        return AnswerShape(kind="date", is_list=is_list, **bounds)
    if primitive is str or is_list:
        return AnswerShape(kind="text", is_list=is_list, **bounds)
    return AnswerShape(kind="unknown", is_list=is_list, **bounds)


def matching_choices(field_path: str, values: list[Any]) -> list[str]:
    """Map source-supplied values onto the field's real allowed values.

    When a post contradicts itself the alternatives are whatever the source
    said. Offering those verbatim can hand back a value the field would refuse,
    so each is matched to a real choice; anything that cannot be matched is
    dropped rather than shown as a trap.
    """

    shape = answer_shape_for(field_path)
    if not shape.choices:
        return []

    lowered = {choice.lower(): choice for choice in shape.choices}
    matched: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        needle = value.strip().lower()
        # A source phrase is usually longer than the canonical value —
        # "Hybrid within India" for "hybrid" — so the choice is looked for
        # inside the phrase, not the other way round.
        hit = lowered.get(needle) or next(
            (choice for key, choice in lowered.items() if needle and key in needle),
            None,
        )
        if hit and hit not in matched:
            matched.append(hit)
    return matched
