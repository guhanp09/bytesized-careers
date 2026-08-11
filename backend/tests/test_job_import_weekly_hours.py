"""Exact schedule arithmetic for imported weekly hours."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.job_import_inference import import_decision_policy
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
from app.core.job_import_weekly_hours import infer_weekly_hours
from app.schemas.job_import import (
    JobImportEvidence,
    JobImportExtractionField,
    JobImportExtractionResponse,
    JobImportProviderConfidence,
)
from app.services.job_import_service import JobImportService


@pytest.mark.parametrize(
    ("schedule", "expected"),
    [
        ("Monday–Friday\n8 hours per day", 40),
        ("Monday to Friday, 8 hrs/day", 40),
        ("5 days per week at 8 hours a day", 40),
        ("5-day work week; 7.5-hour day", 37.5),
    ],
)
def test_explicit_daily_schedule_entails_weekly_hours(
    schedule: str,
    expected: int | float,
) -> None:
    inferred = infer_weekly_hours(schedule)

    assert inferred is not None
    assert inferred.weekly_hours == expected
    assert inferred.days_per_week == 5
    assert len(inferred.evidence_snippets) == 2
    assert all(snippet in schedule for snippet in inferred.evidence_snippets)


@pytest.mark.parametrize(
    "source",
    [
        "This is a full-time video editor role.",
        "Join a fast-paced full-time team.",
        "Monday–Friday, fast-paced environment.",
        "8 hours per day in a fast-paced studio.",
        "Monday–Friday, 6 to 8 hours per day.",
        "Work either 4 or 5 days per week, 8 hours per day.",
        "Friday–Monday, 8 hours per day.",
        (
            "Join our fast-paced full-time video team.\n"
            "Similar jobs\n"
            "Another editor\nMonday-Friday\n8 hours per day"
        ),
        "Publish videos 5 days per week. We capture 8 hours per day of footage.",
        "The channel runs 5 days per week. Raw footage can reach 8 hours per day.",
        (
            "Publishing schedule: publish videos 5 days per week.\n"
            "Raw footage received: 8 hours per day."
        ),
        ("The channel runs 5 days per week.\nFootage available to editors: 8 hours per day."),
    ],
)
def test_vague_partial_ranged_or_conflicting_schedules_never_invent_hours(
    source: str,
) -> None:
    assert infer_weekly_hours(source) is None


def test_two_unrelated_schedule_shaped_facts_in_one_block_are_not_multiplied() -> None:
    source = (
        "Publishing cadence\n"
        "Videos go live 5 days per week.\n"
        "Input volume\n"
        "Raw footage can reach 8 hours per day."
    )

    assert infer_weekly_hours(source) is None


def test_weekly_hours_policy_allows_only_explicit_or_exact_contextual_values() -> None:
    for field_path in ("expected_weekly_hours_min", "expected_weekly_hours_max"):
        policy = import_decision_policy(field_path)
        assert policy.allowed_origins == frozenset({"explicit", "contextual_inference"})
        assert policy.auto_fill_confidence == "high"
        assert policy.risk == "medium"


def _source(text: str) -> SimpleNamespace:
    return SimpleNamespace(original_text=text, retrieval_metadata={})


def _response(*fields: JobImportExtractionField) -> JobImportExtractionResponse:
    return JobImportExtractionResponse(
        extraction_schema_version=1,
        target_listing_schema_version=3,
        fields=list(fields),
    )


def test_service_adds_equal_weekly_bounds_with_exact_combined_evidence() -> None:
    source_text = (
        "Video editor\n"
        "Work schedule: Monday–Friday\n"
        "Hours: 8 hours per day\n"
        "Create and edit social video assets."
    )

    augmented = JobImportService._with_deterministic_context(
        _response(),
        _source(source_text),
    )
    fields = {
        field.field_path: field
        for field in augmented.fields
        if field.field_path.startswith("expected_weekly_hours_")
    }

    assert set(fields) == {
        "expected_weekly_hours_min",
        "expected_weekly_hours_max",
    }
    assert {field.value for field in fields.values()} == {40}
    for field in fields.values():
        assert field.provenance == "suggested_inference"
        assert field.epistemic_status == "logically_entailed"
        assert field.inference_type == "schedule_arithmetic"
        assert field.provider_confidence is not None
        assert field.provider_confidence.metadata["origin"] == "contextual_inference"
        assert field.provider_confidence.metadata["rationale_code"] == (
            "weekly_hours_from_explicit_schedule"
        )
        auto_fill, decision = JobImportService._field_decision(
            JOB_IMPORT_FIELD_POLICIES[field.field_path],
            field,
            validation_errors=[],
        )
        assert auto_fill is True
        assert decision["origin"] == "contextual_inference"
        assert decision["epistemic_state"] == "logically_entailed"
        snippets = [evidence.snippet for evidence in field.evidence]
        assert snippets == ["Monday–Friday", "8 hours per day"]
        for evidence in field.evidence:
            assert evidence.location is not None
            start = evidence.location.char_start
            end = evidence.location.char_end
            assert start is not None and end is not None
            assert source_text[start:end] == evidence.snippet


def test_service_drops_provider_guess_from_vague_full_time_copy() -> None:
    source_text = "Fast-paced full-time video editor role."
    evidence = JobImportEvidence(
        snippet=source_text,
        location={"char_start": 0, "char_end": len(source_text)},
    )
    provider_guess = JobImportExtractionField(
        field_path="expected_weekly_hours_min",
        value=40,
        provenance="suggested_inference",
        evidence=[evidence],
        explanation="Full-time usually means forty hours.",
        provider_confidence=JobImportProviderConfidence(
            score=0.99,
            label="high",
            metadata={"origin": "semantic_inference"},
        ),
        epistemic_status="plausible_interpretation",
        inference_type="market_norm",
    )

    augmented = JobImportService._with_deterministic_context(
        _response(provider_guess),
        _source(source_text),
    )

    assert not any(
        field.field_path.startswith("expected_weekly_hours_") for field in augmented.fields
    )
    assert any(
        warning.code == "unsupported_weekly_hours_inference_removed"
        for warning in augmented.warnings
    )


def test_exact_schedule_replaces_provider_market_norm_with_server_arithmetic() -> None:
    source_text = "Full-time role. Monday-Friday. 8 hours/day."
    evidence = JobImportEvidence(
        snippet="Full-time role.",
        location={"char_start": 0, "char_end": len("Full-time role.")},
    )
    provider_guess = JobImportExtractionField(
        field_path="expected_weekly_hours_min",
        value=35,
        provenance="suggested_inference",
        evidence=[evidence],
        explanation="A likely full-time schedule.",
        provider_confidence=JobImportProviderConfidence(
            score=0.99,
            label="high",
            metadata={"origin": "semantic_inference"},
        ),
        epistemic_status="plausible_interpretation",
        inference_type="market_norm",
    )

    augmented = JobImportService._with_deterministic_context(
        _response(provider_guess),
        _source(source_text),
    )
    hours = {
        field.field_path: field.value
        for field in augmented.fields
        if field.field_path.startswith("expected_weekly_hours_")
    }

    assert hours == {
        "expected_weekly_hours_min": 40,
        "expected_weekly_hours_max": 40,
    }
