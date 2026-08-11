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

import re
import typing
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Final, Literal
from urllib.parse import urlsplit

from annotated_types import Ge, Gt, Le, Lt, MaxLen, MinLen

from app.core.job_domain_taxonomy import (
    CREATOR_CONTENT_NICHES,
    CREATOR_EXPERIENCE_BANDS,
    CREATOR_JOB_CURRENCIES,
    CREATOR_JOB_FORMATS,
    CREATOR_JOB_PLATFORMS,
)
from app.core.job_import_body_sections import normalize_experience_requirement
from app.schemas.job import JobCreate

AnswerKind = Literal["choice", "multi_choice", "number", "text", "url", "date", "unknown"]

START_TIMEFRAME_CHOICES: Final[tuple[str, ...]] = (
    "ASAP",
    "<1mo",
    "<2mo",
    "<3mo",
    "Flexible",
)


@dataclass(frozen=True)
class AnswerShape:
    """The control the interface should render, and its exact bounds."""

    kind: AnswerKind
    #: Allowed values for a choice. Empty for anything free-form.
    choices: list[str] = field(default_factory=list)
    minimum: float | None = None
    maximum: float | None = None
    minimum_exclusive: bool = False
    maximum_exclusive: bool = False
    #: Count-like numbers use step 1; Decimal fields deliberately retain any
    #: precision accepted by the native schema.
    step: float | Literal["any"] | None = None
    integer_only: bool | None = None
    min_length: int | None = None
    max_length: int | None = None
    #: True when the field stores a list, so one pick becomes a one-item list.
    is_list: bool = False
    #: The key each picked value sits under, for structured rows.
    item_key: str | None = None
    #: The bounded label paired with an ``other`` structured row.
    custom_item_key: str | None = None
    custom_item_value: str | None = None
    custom_item_max_length: int | None = None
    #: Display text per value. A slug is an identifier, not a label — showing
    #: "Long-form-editor" as a button is the catalog leaking into the interface.
    labels: dict[str, str] = field(default_factory=dict)
    #: The picker offers useful shortcuts but does not close the native field.
    #: When true, the client must also offer a custom answer.
    custom_values_allowed: bool = False
    #: Makes the epistemic distinction explicit: these choices help someone
    #: answer; they are not a claim that no other truthful value exists.
    choices_are_suggestions: bool = False

    def as_payload(self) -> dict[str, Any]:
        """Bounded, JSON-safe, and free of anything internal."""

        payload: dict[str, Any] = {"kind": self.kind}
        if self.choices:
            payload["choices"] = self.choices[:40]
        for name in (
            "minimum",
            "maximum",
            "step",
            "integer_only",
            "min_length",
            "max_length",
            "item_key",
            "custom_item_key",
            "custom_item_value",
            "custom_item_max_length",
        ):
            value = getattr(self, name)
            if value is not None:
                payload[name] = value
        if self.is_list:
            payload["is_list"] = True
        if self.minimum_exclusive:
            payload["minimum_exclusive"] = True
        if self.maximum_exclusive:
            payload["maximum_exclusive"] = True
        if self.custom_values_allowed:
            payload["custom_values_allowed"] = True
        if self.choices_are_suggestions:
            payload["choices_are_suggestions"] = True
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
    # These are the canonical values already used by native job records. Keeping
    # the choice here (rather than tightening the legacy database column) makes
    # invalid conversation answers impossible without breaking old listings.
    "start_timeframe": START_TIMEFRAME_CHOICES,
    # Currency is a bare three-character string in the job schema, so without a
    # catalog it fell through to a free text box — and a live run confirmed the
    # result: anything typed there came back "That answer is not valid for this
    # detail". A currency is a pick, never a sentence.
    "budget_currency": CREATOR_JOB_CURRENCIES,
    "trial_compensation_currency": CREATOR_JOB_CURRENCIES,
}

#: Catalog fields that hold a single value rather than a list.
_SINGLE_VALUE_CATALOGS: frozenset[str] = frozenset(
    {
        "experience_level",
        "start_timeframe",
        "budget_currency",
        "trial_compensation_currency",
    }
)

_CATALOG_LABELS: dict[str, dict[str, str]] = {
    "platforms": {"youtube": "YouTube", "instagram": "Instagram"},
    "start_timeframe": {
        "ASAP": "As soon as possible",
        "<1mo": "Within one month",
        "<2mo": "Within two months",
        "<3mo": "Within three months",
        "Flexible": "Flexible",
    },
}


#: Structured list fields, and the key each chosen value sits under.
#:
#: These are the ones that produced "That answer is not valid for this detail":
#: the model stores rows, not prose, so the interface has to build the rows.
_STRUCTURED_ROWS: dict[str, tuple[str, str, str]] = {
    # field path -> (nested model field, discriminator, custom-label key)
    "hiring_process": ("hiring_process", "stage", "custom_label"),
    "source_inputs": ("source_inputs", "type", "custom_label"),
    "deliverables": ("deliverables", "type", "custom_type"),
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


def _bounds(
    metadata: list[Any], *, integer_only: bool | None = None
) -> dict[str, Any]:
    bounds: dict[str, Any] = {}
    for entry in metadata:
        if isinstance(entry, Gt):
            bounds["minimum"] = (
                float(entry.gt) + 1 if integer_only else float(entry.gt)
            )
            if not integer_only:
                bounds["minimum_exclusive"] = True
        elif isinstance(entry, Ge):
            bounds["minimum"] = float(entry.ge)
        elif isinstance(entry, Lt):
            bounds["maximum"] = (
                float(entry.lt) - 1 if integer_only else float(entry.lt)
            )
            if not integer_only:
                bounds["maximum_exclusive"] = True
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


def native_schema_constraints(
    field_path: str,
) -> tuple[tuple[str, ...] | None, int | None, bool]:
    """What the *job schema* actually enforces: allowed values, and a length cap.

    Deliberately not ``answer_shape_for``. That function answers a different
    question — what to put in front of the recruiter — and it consults
    ``_CATALOG_CHOICES`` first, which are product suggestion lists for fields the
    schema types as plain strings.

    Confusing the two caused a real distortion. ``experience_level`` is a free
    ``str`` in the schema, but its catalog offers four closed bands, so a
    conversion layer reading the answer shape concluded the field could only hold
    one of those bands and mapped a stated "25 years" into "5–8 years" to fit.
    The field had never needed narrowing; only the question did.

    Returns ``(choices, cap, is_list)``. ``choices`` is ``None`` when the schema
    constrains no values, which means the field can hold the source value as
    stated. ``cap`` counts characters for a string field and items for a list,
    so callers must read it alongside ``is_list`` rather than on its own.
    """

    model_field = JobCreate.model_fields.get(field_path)
    if model_field is None:
        return (None, None, False)
    choices = tuple(value for value in _literals(model_field.annotation) if value != "other")
    cap: int | None = None
    for entry in model_field.metadata or []:
        candidate = getattr(entry, "max_length", None)
        if isinstance(candidate, int):
            cap = candidate
    return (choices or None, cap, _is_list(model_field.annotation))


def answer_shape_for(field_path: str) -> AnswerShape:
    """Describe a valid answer for one field."""

    if field_path in _STRUCTURED_ROWS:
        nested_field, key, custom_key = _STRUCTURED_ROWS[field_path]
        choices = [value for value in _row_choices(nested_field, key) if value != "other"]
        if choices:
            return AnswerShape(
                kind="multi_choice",
                choices=choices,
                is_list=True,
                item_key=key,
                custom_item_key=custom_key,
                custom_item_value="other",
                min_length=2,
                custom_item_max_length=80,
                custom_values_allowed=True,
                choices_are_suggestions=True,
            )

    if field_path in _CATALOG_CHOICES:
        choices = list(_CATALOG_CHOICES[field_path])
        single = field_path in _SINGLE_VALUE_CATALOGS
        # Experience is intentionally an open native string. Its four catalog
        # bands are common shortcuts, while exact source values ("12–18 months",
        # "5+ years") are both valid and more truthful. Catalog controls used by
        # genuinely closed fields keep their old strict behavior.
        experience_suggestions = field_path == "experience_level"
        open_list_suggestions = field_path in {
            "content_niches",
            "formats_hired_for",
        }
        _native_choices, native_cap, _native_is_list = native_schema_constraints(field_path)
        return AnswerShape(
            kind="choice" if single else "multi_choice",
            choices=choices,
            is_list=not single,
            min_length=2 if open_list_suggestions else None,
            max_length=(
                native_cap
                if experience_suggestions
                else 40
                if open_list_suggestions
                else None
            ),
            custom_values_allowed=experience_suggestions or open_list_suggestions,
            choices_are_suggestions=experience_suggestions or open_list_suggestions,
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
    integer_only = primitive is int
    bounds = _bounds(
        list(model_field.metadata or []),
        integer_only=integer_only if primitive in (int, float, Decimal) else None,
    )

    if choices:
        return AnswerShape(
            kind="multi_choice" if is_list else "choice",
            choices=choices,
            is_list=is_list,
            **bounds,
        )

    # A yes/no field is two buttons, not a sentence. Checked before the numeric
    # branch because bool is a subclass of int and would otherwise be offered a
    # number pad — and before the text fallback, which would invite prose that
    # the field can only ever reject.
    if primitive is bool:
        return AnswerShape(
            kind="choice",
            choices=["yes", "no"],
            labels={"yes": "Yes", "no": "No"},
            **bounds,
        )

    # Money is stored as Decimal, so a bare int/float check missed every
    # compensation field and left them without a numeric control.
    if primitive in (int, float, Decimal):
        return AnswerShape(
            kind="number",
            is_list=is_list,
            integer_only=integer_only,
            step=1 if integer_only else "any",
            **bounds,
        )
    if field_path == "reference_videos":
        return AnswerShape(kind="url", is_list=True, **bounds)
    if field_path.endswith("_url"):
        return AnswerShape(kind="url", is_list=is_list, **bounds)
    if field_path.endswith(("_at", "_date")):
        return AnswerShape(kind="date", is_list=is_list, **bounds)
    if primitive is str or is_list:
        return AnswerShape(kind="text", is_list=is_list, **bounds)
    return AnswerShape(kind="unknown", is_list=is_list, **bounds)


_DESCRIPTIVE_LIST_FIELDS: Final[frozenset[str]] = frozenset(
    {"responsibilities", "requirements"}
)
_INTEGER_ANSWER_FIELDS: Final[frozenset[str]] = frozenset(
    {"turnaround_value", "duration_value", "revision_rounds"}
)
_OPEN_CATALOG_LIST_FIELDS: Final[frozenset[str]] = frozenset(
    {"content_niches", "formats_hired_for"}
)
_MEANINGLESS_PHRASES: Final[frozenset[str]] = frozenset(
    {
        "asdf",
        "blah",
        "blah blah",
        "dummy text",
        "i dont know",
        "idk",
        "lorem ipsum",
        "n a",
        "na",
        "none",
        "not sure",
        "provided during qa",
        "test",
        "test answer",
        "tbd",
        "todo",
        "unknown",
    }
)


def conversation_answer_errors(field_path: str, value: object) -> list[str]:
    """Return conversation-only errors for candidate-facing recruiter answers.

    Native drafts stay permissive for legacy compatibility. The assistant is a
    narrower interface and must not turn keyboard noise into a public duty,
    qualification, or start commitment.
    """

    if (
        value is None
        or (isinstance(value, str) and not value.strip())
        or (isinstance(value, (list, dict)) and not value)
    ):
        return ["Provide an answer before continuing."]

    if field_path == "title" and isinstance(value, str) and len(value.strip()) < 3:
        return ["Enter a job title with at least 3 characters."]

    if (
        field_path == "about_channel"
        and isinstance(value, str)
        and len(value.strip()) < 20
    ):
        return ["Add at least 20 characters about the channel or employer."]

    if field_path in {"start_date", "deadline_at"}:
        try:
            if isinstance(value, str):
                raw = value.strip().replace("Z", "+00:00")
                parsed = (
                    datetime.fromisoformat(raw)
                    if "T" in raw or " " in raw
                    else date.fromisoformat(raw)
                )
            else:
                parsed = value
        except ValueError:
            return [
                "Choose a valid application deadline."
                if field_path == "deadline_at"
                else "Choose a valid start date."
            ]
        if isinstance(parsed, datetime):
            if field_path == "deadline_at":
                comparable = (
                    parsed.replace(tzinfo=UTC)
                    if parsed.tzinfo is None
                    else parsed.astimezone(UTC)
                )
                if comparable <= datetime.now(UTC):
                    return ["Choose a future application deadline."]
                return []
            parsed = parsed.date()
        if isinstance(parsed, date):
            today = datetime.now(UTC).date()
            if field_path == "deadline_at" and parsed <= today:
                return ["Choose a future application deadline."]
            if field_path == "start_date" and parsed < today:
                return ["Choose today or a future start date."]
        return []

    if field_path in _INTEGER_ANSWER_FIELDS:
        if isinstance(value, bool) or not isinstance(value, int):
            return ["Enter a whole number for this detail."]
        return []

    if field_path == "reference_videos":
        if not isinstance(value, list) or not value:
            return ["Add at least one reference video link."]
        errors: list[str] = []
        for index, item in enumerate(value):
            try:
                parsed = urlsplit(item) if isinstance(item, str) else None
                hostname = parsed.hostname if parsed is not None else None
            except ValueError:
                parsed = None
                hostname = None
            if (
                parsed is None
                or parsed.scheme.casefold() not in {"http", "https"}
                or not hostname
                or parsed.username is not None
                or parsed.password is not None
            ):
                errors.append(
                    f"Item {index + 1} must be a valid http or https link."
                )
        return errors

    if field_path in _OPEN_CATALOG_LIST_FIELDS:
        if not isinstance(value, list) or not value:
            return ["Select or add at least one specific value."]
        errors: list[str] = []
        seen: set[str] = set()
        for index, item in enumerate(value):
            normalized = " ".join(item.split()).strip() if isinstance(item, str) else ""
            folded = normalized.casefold()
            phrase_key = re.sub(r"[^\w]+", " ", folded).strip()
            if (
                len(normalized) < 2
                or len(normalized) > 40
                or phrase_key in _MEANINGLESS_PHRASES
            ):
                errors.append(
                    f"Item {index + 1} needs a specific 2–40 character value."
                )
            elif folded in seen:
                errors.append(f"Item {index + 1} duplicates an earlier value.")
            seen.add(folded)
        return errors

    if field_path == "start_timeframe":
        if not isinstance(value, str) or value not in START_TIMEFRAME_CHOICES:
            return ["Select one of the available start timeframes."]
        return []

    if field_path == "experience_level":
        if not isinstance(value, str):
            # Canonical field validation reports the type error.
            return []
        normalized = " ".join(value.split()).strip()
        compact = "".join(character for character in normalized.casefold() if character.isalnum())
        phrase_key = re.sub(r"[^\w]+", " ", normalized.casefold()).strip()
        if (
            not normalized
            or len(normalized) > 64
            or phrase_key in _MEANINGLESS_PHRASES
            or re.search(r"(.)\1{4,}", compact)
            or (len(compact) >= 8 and len(set(compact)) <= 3)
            or normalize_experience_requirement(normalized) is None
        ):
            return [
                "Enter a real experience requirement, such as 1–3 years, "
                "12+ months, or no prior experience required."
            ]
        return []

    custom_key = {
        "deliverables": "custom_type",
        "source_inputs": "custom_label",
        "hiring_process": "custom_label",
    }.get(field_path)
    discriminator = "stage" if field_path == "hiring_process" else "type"
    if custom_key is not None and isinstance(value, list):
        errors: list[str] = []
        for index, item in enumerate(value):
            if not isinstance(item, dict) or item.get(discriminator) != "other":
                continue
            raw_label = item.get(custom_key)
            normalized = " ".join(raw_label.split()).strip() if isinstance(raw_label, str) else ""
            compact = "".join(character for character in normalized.casefold() if character.isalnum())
            phrase_key = re.sub(r"[^\w]+", " ", normalized.casefold()).strip()
            if (
                len(normalized) < 2
                or len(normalized) > 80
                or phrase_key in _MEANINGLESS_PHRASES
                or re.search(r"(.)\1{4,}", compact)
                or (len(compact) >= 8 and len(set(compact)) <= 3)
            ):
                errors.append(f"Item {index + 1} needs a specific custom label.")
        return errors

    if field_path not in _DESCRIPTIVE_LIST_FIELDS:
        return []
    if not isinstance(value, list) or not value:
        return ["Add at least one descriptive phrase."]

    errors: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str):
            continue  # Canonical field validation reports the shape error.
        normalized = " ".join(item.split()).strip()
        folded = " ".join(normalized.casefold().split())
        words = re.findall(r"[^\W_]+(?:['’-][^\W_]+)?", folded, flags=re.UNICODE)
        compact = "".join(character for character in folded if character.isalnum())
        phrase_key = re.sub(
            r"[^\w]+",
            " ",
            re.sub(r"['’]", "", folded),
            flags=re.UNICODE,
        ).strip()
        if phrase_key in _MEANINGLESS_PHRASES:
            errors.append(f"Item {index + 1} needs a real job-specific detail.")
            continue
        if len(normalized) < 8:
            errors.append(f"Item {index + 1} needs at least 8 characters.")
            continue
        if len(words) < 2 or len({word.casefold() for word in words}) < 2:
            errors.append(f"Item {index + 1} needs a short descriptive phrase.")
            continue
        if re.search(r"(.)\1{4,}", compact):
            errors.append(f"Item {index + 1} looks like repeated-character text.")
            continue
        if len(compact) >= 8 and len(set(compact)) <= 3:
            errors.append(f"Item {index + 1} looks like placeholder text.")
    return errors


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
