"""Every question the assistant can ask must have a control that can answer it.

This is a contract test rather than a set of examples, because the defects it
exists to stop were all the same shape and all found by recruiters rather than by
tests: a field whose type the control mapper did not understand quietly became a
free text box, and then rejected whatever was typed into it.

Real instances, each shipped and each reported:

* ``platforms``  — a list of strings, so it accepted "Ajajjaja j".
* ``budget_currency`` — a bare three-character string, so a live run produced
  "That answer is not valid for this detail" for anything a person could type.
* ``unpaid_trial_confirmed`` — a boolean, offered as prose.

Adding a field to the askable set now fails here unless it also has a control
that can express a valid answer.
"""

from __future__ import annotations

import typing

import pytest

from app.core.job_import_answer_shapes import answer_shape_for
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
from app.core.job_import_questions import conversation_question_kind
from app.schemas.job import JobCreate

#: Fields whose answer genuinely is prose written by the recruiter.
#:
#: Everything outside this set must resolve to a bounded control. Kept explicit
#: so that widening it is a visible decision in review rather than a silent
#: consequence of a type the mapper did not recognise.
INTENTIONAL_FREE_TEXT: frozenset[str] = frozenset(
    {
        "title",
        "location",
        "about_channel",
        "responsibilities",
        "requirements",
        "reference_videos",
        "role_specialization",
        "budget_note",
        "how_to_apply",
        "revision_notes",
        "source_inputs_notes",
        "creative_autonomy_notes",
        "trial_notes",
        "hiring_process_notes",
        "required_skills_note",
        "preferred_skills_note",
        "other_required_tools",
        "other_required_skills",
        "other_preferred_skills",
        "budget_unit_custom",
        "timezone_overlap",
        "application_requirements",
        "tags",
    }
)

#: Resolved outside the job schema and given its control by the service.
CATALOG_RESOLVED: frozenset[str] = frozenset({"primary_role_key"})


def askable_fields() -> list[str]:
    return sorted(
        path
        for path, policy in JOB_IMPORT_FIELD_POLICIES.items()
        if conversation_question_kind(path, policy.missing_requirement)
    )


def test_the_assistant_can_actually_ask_something() -> None:
    """Guard the guard: an empty set would make every assertion below vacuous."""

    assert len(askable_fields()) >= 10


@pytest.mark.parametrize("field_path", askable_fields())
def test_every_askable_field_has_a_control_that_can_answer_it(field_path: str) -> None:
    shape = answer_shape_for(field_path)

    if field_path in CATALOG_RESOLVED:
        # Its values live in the roles catalog, so the service supplies them per
        # request. It must not present as an ordinary free-text field.
        assert shape.kind in {"unknown", "choice"}, field_path
        return

    if field_path in INTENTIONAL_FREE_TEXT:
        assert shape.kind in {"text", "url", "multi_choice"}, field_path
        return

    assert shape.kind != "unknown", (
        f"{field_path} has no control the interface can render, so the recruiter "
        "would be shown a text box that rejects every answer"
    )
    assert shape.kind != "text", (
        f"{field_path} is not intentional free text but resolved to a text box"
    )
    if shape.kind in {"choice", "multi_choice"}:
        assert shape.choices, f"{field_path} offers a picker with nothing to pick"


@pytest.mark.parametrize("field_path", askable_fields())
def test_no_askable_field_is_typed_but_uncontrolled(field_path: str) -> None:
    """A schema type the mapper cannot represent is a defect, not a text box.

    Enums, booleans, numbers and dates each have a control. This catches the
    case where the schema tightens a field and the mapper silently downgrades.
    """

    model_field = JobCreate.model_fields.get(field_path)
    if model_field is None:
        return
    shape = answer_shape_for(field_path)
    annotation = model_field.annotation
    flattened = [
        argument
        for argument in (typing.get_args(annotation) or (annotation,))
        if argument is not type(None)
    ]

    if bool in flattened:
        assert shape.kind == "choice" and shape.choices == ["yes", "no"], field_path
    if typing.get_origin(annotation) is typing.Literal:
        assert shape.kind in {"choice", "multi_choice"} and shape.choices, field_path


@pytest.mark.parametrize(
    "field_path",
    [
        "budget_currency",
        "trial_compensation_currency",
        "budget_unit",
        "compensation_mode",
        "unpaid_trial_confirmed",
        "trial_status",
        "work_mode",
        "engagement_type",
        "platforms",
        "formats_hired_for",
        "required_tool_keys",
        "experience_level",
        "start_timing",
        "content_niches",
        "duration_type",
        "duration_unit",
        "turnaround_unit",
        "turnaround_basis",
        "revision_policy",
        "creative_autonomy",
        "employer_context_type",
    ],
)
def test_named_fields_from_the_defect_reports_are_bounded(field_path: str) -> None:
    """The specific fields this went wrong on, pinned by name.

    A field the assistant never asks needs no control, so the assertion is
    conditional — but it is written this way deliberately: if any of these is
    ever promoted into the question set, it must arrive with a real control
    rather than silently becoming a text box the way the first three did.
    """

    policy = JOB_IMPORT_FIELD_POLICIES[field_path]
    if conversation_question_kind(field_path, policy.missing_requirement) is None:
        pytest.skip(f"{field_path} is not askable, so it needs no control")
    shape = answer_shape_for(field_path)
    assert shape.kind in {"choice", "multi_choice"}, f"{field_path} -> {shape.kind}"
    assert shape.choices, field_path


@pytest.mark.parametrize(
    ("field_path", "expected"),
    [
        ("budget_amount", "number"),
        ("budget_max", "number"),
        ("expected_weekly_hours_min", "number"),
        ("expected_weekly_hours_max", "number"),
        ("turnaround_value", "number"),
        ("duration_value", "number"),
        ("revision_rounds", "number"),
        ("start_date", "date"),
        ("deadline_at", "date"),
        ("engagement_end_date", "date"),
    ],
)
def test_numbers_and_dates_never_use_a_prose_control(
    field_path: str, expected: str
) -> None:
    assert answer_shape_for(field_path).kind == expected, field_path


@pytest.mark.parametrize("field_path", askable_fields())
def test_every_askable_field_is_supported_and_carryable(field_path: str) -> None:
    """A question whose answer has nowhere to land is worse than no question."""

    policy = JOB_IMPORT_FIELD_POLICIES[field_path]
    assert policy.native_field is not None or field_path in CATALOG_RESOLVED, field_path


def test_the_serialized_shape_stays_bounded_and_client_safe() -> None:
    """The client renders from this payload, so it must be complete and small."""

    for field_path in askable_fields():
        payload = answer_shape_for(field_path).as_payload()
        assert "kind" in payload
        assert len(payload.get("choices", [])) <= 40, field_path
        for value in payload.get("choices", []):
            assert isinstance(value, str) and value, field_path
        for label in payload.get("labels", {}).values():
            assert isinstance(label, str) and label, field_path
