"""Bea's structured answers must preserve business facts, never invent them."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.core.job_import_answer_shapes import (
    answer_shape_for,
    conversation_answer_errors,
)
from app.core.job_import_intelligence_matrix import intelligence_matrix
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
from app.schemas.job import JobSourceInput
from app.services.job_import_conversation_service import JobImportConversationService
from app.services.job_import_service import JobImportService


@pytest.mark.parametrize(
    ("field_path", "item_key", "custom_key"),
    [
        ("deliverables", "type", "custom_type"),
        ("source_inputs", "type", "custom_label"),
        ("hiring_process", "stage", "custom_label"),
    ],
)
def test_structured_catalogs_are_open_with_bounded_other_rows(
    field_path: str,
    item_key: str,
    custom_key: str,
) -> None:
    shape = answer_shape_for(field_path)
    payload = shape.as_payload()

    assert shape.kind == "multi_choice"
    assert shape.item_key == item_key
    assert shape.custom_item_key == custom_key
    assert shape.custom_item_value == "other"
    assert shape.min_length == 2
    assert shape.custom_item_max_length == 80
    assert shape.custom_values_allowed is True
    assert shape.choices_are_suggestions is True
    assert payload["custom_item_max_length"] == 80
    assert JOB_IMPORT_FIELD_POLICIES[field_path].custom_values_allowed is True
    assert intelligence_matrix()[field_path].answer_classification == "structured_open"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field_path", "value"),
    [
        (
            "deliverables",
            [
                {
                    "type": "other",
                    "custom_type": "Sponsor cutdown",
                    "quantity": 2,
                    "frequency": "other",
                    "custom_frequency": "Every fortnight",
                }
            ],
        ),
        ("source_inputs", [{"type": "other", "custom_label": "Style guide deck"}]),
        (
            "source_inputs",
            [{"type": "analytics_access", "sensitive_access_confirmed": True}],
        ),
        (
            "hiring_process",
            [{"stage": "other", "custom_label": "Creative director chat"}],
        ),
    ],
)
async def test_complete_structured_answers_round_trip_exactly(
    field_path: str,
    value: list[dict[str, object]],
) -> None:
    service = JobImportService.__new__(JobImportService)
    normalized, errors = await service._validate_field_value(
        JOB_IMPORT_FIELD_POLICIES[field_path], value
    )

    assert errors == []
    assert normalized == value
    assert conversation_answer_errors(field_path, normalized) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field_path", "value", "expected_fragment"),
    [
        (
            "deliverables",
            [{"type": "long_form_video"}],
            "quantity",
        ),
        (
            "source_inputs",
            [{"type": "analytics_access"}],
            "sensitive access",
        ),
    ],
)
async def test_incomplete_structured_answers_are_rejected_instead_of_defaulted(
    field_path: str,
    value: list[dict[str, object]],
    expected_fragment: str,
) -> None:
    service = JobImportService.__new__(JobImportService)
    _normalized, errors = await service._validate_field_value(
        JOB_IMPORT_FIELD_POLICIES[field_path], value
    )

    assert errors
    assert expected_fragment in " ".join(errors).casefold()


@pytest.mark.parametrize(
    "value",
    [
        [{"type": "account_access"}],
        [{"type": "analytics_access", "sensitive_access_confirmed": False}],
        [{"type": "other", "custom_label": "API key"}],
    ],
)
def test_explicit_provider_access_is_preserved_as_pending_without_fabricated_consent(
    value: list[dict[str, object]],
) -> None:
    pending = JobImportService._pending_sensitive_source_inputs(value)

    assert pending is not None
    assert all(row["sensitive_access_confirmed"] is False for row in pending)


def test_provider_confirmation_is_stripped_back_to_pending() -> None:
    assert JobImportService._pending_sensitive_source_inputs(
        [{"type": "account_access", "sensitive_access_confirmed": True}]
    ) == [{"type": "account_access", "sensitive_access_confirmed": False}]


def test_date_answers_use_server_safe_calendar_bounds() -> None:
    today = datetime.now(UTC).date()

    assert conversation_answer_errors("start_date", today.isoformat()) == []
    assert conversation_answer_errors("deadline_at", today.isoformat())
    assert conversation_answer_errors(
        "deadline_at", (today + timedelta(days=1)).isoformat()
    ) == []


@pytest.mark.parametrize(
    ("field_path", "value"),
    [
        ("title", "   "),
        ("about_channel", "Too short"),
        ("platforms", []),
        ("work_mode", None),
    ],
)
def test_empty_or_publication_incomplete_answers_never_settle_a_turn(
    field_path: str, value: object
) -> None:
    assert conversation_answer_errors(field_path, value)


@pytest.mark.parametrize(
    ("field_path", "value"),
    [
        (
            "deliverables",
            [
                {
                    "type": "other",
                    "custom_type": "Aaaaaaaaaaaa",
                    "quantity": 1,
                    "frequency": "per_week",
                }
            ],
        ),
        ("source_inputs", [{"type": "other", "custom_label": "test"}]),
        ("hiring_process", [{"stage": "other", "custom_label": "asdf"}]),
    ],
)
def test_custom_structured_labels_reject_placeholder_text(
    field_path: str,
    value: list[dict[str, object]],
) -> None:
    assert conversation_answer_errors(field_path, value)


@pytest.mark.parametrize("field_path", ["source_inputs", "hiring_process"])
def test_one_character_custom_labels_are_rejected_by_conversation_contract(
    field_path: str,
) -> None:
    discriminator = "type" if field_path == "source_inputs" else "stage"

    assert conversation_answer_errors(
        field_path,
        [{discriminator: "other", "custom_label": "x"}],
    )


@pytest.mark.parametrize(
    "label",
    [
        "Log into Instagram",
        "Sign in to the channel",
        "Use the creator account",
        "Creator account admin",
        "Workspace permissions",
        "API key",
        "OAuth token",
        "2FA code",
        "session cookie",
        "private key",
        "secret token",
        "Meta Business Manager invite",
        "Add editor to the YouTube channel",
        "channel ownership",
    ],
)
def test_custom_sensitive_source_inputs_require_explicit_confirmation(label: str) -> None:
    with pytest.raises(ValidationError, match="sensitive access"):
        JobSourceInput(type="other", custom_label=label)

    confirmed = JobSourceInput(
        type="other",
        custom_label=label,
        sensitive_access_confirmed=True,
    )
    assert confirmed.sensitive_access_confirmed is True


def test_ordinary_custom_source_input_needs_no_sensitive_confirmation() -> None:
    source_input = JobSourceInput(type="other", custom_label="Style guide deck")
    physical_access = JobSourceInput(type="other", custom_label="Location access plan")

    assert source_input.sensitive_access_confirmed is False
    assert physical_access.sensitive_access_confirmed is False


@pytest.mark.parametrize("field_path", ["content_niches", "formats_hired_for"])
def test_open_string_catalogs_offer_bounded_custom_values(field_path: str) -> None:
    shape = answer_shape_for(field_path)

    assert shape.kind == "multi_choice"
    assert shape.is_list is True
    assert shape.custom_values_allowed is True
    assert shape.choices_are_suggestions is True
    assert shape.item_key is None
    assert shape.min_length == 2
    assert shape.max_length == 40
    assert conversation_answer_errors(field_path, ["Documentary storytelling"]) == []
    assert conversation_answer_errors(field_path, ["x"])
    assert conversation_answer_errors(field_path, ["Education", "education"])


def test_reference_videos_are_a_list_of_web_urls() -> None:
    shape = answer_shape_for("reference_videos")

    assert shape.kind == "url"
    assert shape.is_list is True
    assert conversation_answer_errors(
        "reference_videos", ["https://www.youtube.com/watch?v=example"]
    ) == []
    for rejected in (
        ["not a URL"],
        ["ftp://example.com/video"],
        ["https://user:secret@example.com/video"],
        ["http://[broken"],
    ):
        assert conversation_answer_errors("reference_videos", rejected)


@pytest.mark.asyncio
async def test_integer_and_decimal_number_answers_keep_distinct_contracts() -> None:
    service = JobImportService.__new__(JobImportService)

    for field_path in ("turnaround_value", "duration_value", "revision_rounds"):
        shape = answer_shape_for(field_path)
        assert shape.kind == "number"
        assert shape.integer_only is True
        assert shape.step == 1
        assert shape.as_payload()["integer_only"] is True
        assert shape.as_payload()["step"] == 1
        _normalized, errors = await service._validate_field_value(
            JOB_IMPORT_FIELD_POLICIES[field_path], 1.5
        )
        assert errors, field_path

    pay = answer_shape_for("budget_amount")
    assert pay.integer_only is False
    assert pay.step == "any"
    assert pay.minimum == 0
    assert pay.minimum_exclusive is True
    assert pay.as_payload()["integer_only"] is False
    assert pay.as_payload()["step"] == "any"
    assert pay.as_payload()["minimum_exclusive"] is True
    normalized, errors = await service._validate_field_value(
        JOB_IMPORT_FIELD_POLICIES["budget_amount"], 0.5
    )
    assert errors == []
    assert normalized == "0.5"


@pytest.mark.asyncio
async def test_long_explicit_experience_is_compacted_before_native_validation() -> None:
    service = JobImportService.__new__(JobImportService)
    normalized, errors = await service._validate_field_value(
        JOB_IMPORT_FIELD_POLICIES["experience_level"],
        "5+ years of content strategy, content marketing, or social media "
        "experience in a B2B environment",
    )

    assert errors == []
    assert normalized == "5+ years"


def test_past_start_dates_and_impossible_merged_pairs_are_rejected() -> None:
    yesterday = (datetime.now(UTC).date() - timedelta(days=1)).isoformat()
    assert conversation_answer_errors("start_date", yesterday)
    assert conversation_answer_errors(
        "start_date", datetime.now(UTC).date().isoformat()
    ) == []

    assert JobImportConversationService._effective_answer_errors(
        {"budget_amount": "30000", "budget_max": "20000"},
        changed_fields=frozenset({"compensation_mode"}),
    )
    assert JobImportConversationService._effective_answer_errors(
        {"budget_amount": "20000.50", "budget_max": "30000.75"},
        changed_fields=frozenset({"budget_amount"}),
    ) == []


def test_native_conversion_omits_inactive_descendants_without_mutating_audit_values() -> None:
    stored_values: dict[str, object] = {
        "compensation_mode": "negotiable",
        "budget_amount": "20000",
        "budget_max": "30000",
        "budget_unit": "per month",
        "budget_unit_custom": "per campaign",
        "revision_policy": "unlimited",
        "revision_rounds": 4,
        "start_timing": "immediate",
        "start_date": "2030-03-20",
        "duration_type": "ongoing",
        "duration_value": 6,
        "duration_unit": "months",
        "engagement_end_date": "2030-09-20",
        "trial_status": "none",
        "trial_scope": "Edit one sample",
        "trial_effort_value": "2",
        "trial_effort_unit": "hours",
        "trial_compensation_amount": "500",
        "trial_compensation_currency": "INR",
        "trial_compensation_basis": "flat",
        "trial_work_usage": "evaluation_only",
        "trial_portfolio_permission": "allowed",
        "trial_attribution": "credited",
        "unpaid_trial_confirmed": True,
        "trial_notes": "Old source terms",
        "role_specialization": "Podcast showrunner",
    }
    original = dict(stored_values)

    converted = JobImportService._without_inactive_native_dependents(
        stored_values, effective_role_slug="video-editor"
    )

    assert stored_values == original, "audit/source values must remain untouched"
    for inactive in {
        "budget_amount",
        "budget_max",
        "budget_unit_custom",
        "revision_rounds",
        "start_date",
        "duration_value",
        "duration_unit",
        "engagement_end_date",
        "trial_scope",
        "trial_effort_value",
        "trial_effort_unit",
        "trial_compensation_amount",
        "trial_compensation_currency",
        "trial_compensation_basis",
        "trial_work_usage",
        "trial_portfolio_permission",
        "trial_attribution",
        "unpaid_trial_confirmed",
        "trial_notes",
        "role_specialization",
    }:
        assert inactive not in converted, inactive


def test_native_conversion_keeps_only_dependents_of_the_selected_variant() -> None:
    unpaid = JobImportService._without_inactive_native_dependents(
        {
            "trial_status": "unpaid",
            "trial_scope": "One sample",
            "trial_effort_value": "2",
            "trial_effort_unit": "hours",
            "trial_compensation_amount": "500",
            "trial_compensation_currency": "INR",
            "trial_compensation_basis": "flat",
            "unpaid_trial_confirmed": True,
            "duration_type": "fixed_period",
            "duration_value": 3,
            "duration_unit": "months",
            "engagement_end_date": "2030-09-20",
        }
    )
    assert unpaid["trial_scope"] == "One sample"
    assert unpaid["unpaid_trial_confirmed"] is True
    assert "trial_compensation_amount" not in unpaid
    assert unpaid["duration_value"] == 3
    assert "engagement_end_date" not in unpaid

    until_date = JobImportService._without_inactive_native_dependents(
        {
            "duration_type": "until_date",
            "duration_value": 3,
            "duration_unit": "months",
            "engagement_end_date": "2030-09-20",
        }
    )
    assert until_date["engagement_end_date"] == "2030-09-20"
    assert "duration_value" not in until_date
    assert "duration_unit" not in until_date
    assert JobImportConversationService._effective_answer_errors(
        {"start_date": "2030-03-20", "engagement_end_date": "2030-03-19"},
        changed_fields=frozenset({"duration_type"}),
    )
    assert JobImportConversationService._effective_answer_errors(
        {"start_date": "2030-03-20", "engagement_end_date": "2030-03-20"},
        changed_fields=frozenset({"engagement_end_date"}),
    )
    assert JobImportConversationService._effective_answer_errors(
        {"expected_weekly_hours_max": "30"},
        changed_fields=frozenset({"expected_weekly_hours_max"}),
    )
    assert JobImportConversationService._effective_answer_errors(
        {
            "expected_weekly_hours_min": "40",
            "expected_weekly_hours_max": "20",
        },
        changed_fields=frozenset({"expected_weekly_hours_min"}),
    )
    assert JobImportConversationService._effective_answer_errors(
        {
            "expected_weekly_hours_min": "20.5",
            "expected_weekly_hours_max": "40.25",
        },
        changed_fields=frozenset({"expected_weekly_hours_max"}),
    ) == []
