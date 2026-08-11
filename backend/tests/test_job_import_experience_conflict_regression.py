"""The dedicated Experience fact must survive extraction and conversation.

The reported page stated ``Experience: 1 to 2 yrs`` in its field-level facts
and later used ``1–3 years`` in prose. The provider retained both, but the
question layer mistook four UI shortcuts for a closed schema and reduced that
two-value conflict to one button. These tests pin each systemic boundary without
depending on the public page or a provider call.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.core.job_import_answer_shapes import (
    answer_shape_for,
    conversation_answer_errors,
)
from app.core.job_import_body_sections import (
    experience_from_body,
    experience_requirements_from_body,
    labelled_experience,
    normalize_experience_requirement,
    normalize_leading_experience_requirement,
)
from app.core.job_import_labelled_fields import labelled_facts, primary_job_text
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
from app.core.job_import_questions import QueueCandidate
from app.services.job_import_conversation_service import JobImportConversationService
from app.services.job_url_fetcher import (
    _structured_experience_requirement,
    normalize_public_job_html,
)


@pytest.mark.parametrize(
    ("written", "expected"),
    [
        ("1 to 2 yrs", "1–2 years"),
        ("1-3 yr", "1–3 years"),
        ("At least 5 years", "At least 5 years"),
        ("Minimum of 2 yrs", "Minimum 2 years"),
        ("2+ years", "2+ years"),
        ("3-5+ years", "3–5+ years"),
        ("12+ months of relevant editing experience", "12+ months"),
        ("12–18 months", "12–18 months"),
        (
            "Strong portfolio; no minimum years required",
            "Strong portfolio; no minimum years required",
        ),
    ],
)
def test_self_contained_experience_keeps_its_semantics(written: str, expected: str) -> None:
    assert normalize_experience_requirement(written) == expected


def test_prose_range_with_an_open_upper_bound_keeps_the_plus() -> None:
    source = "Have 3-5+ years of experience managing social media accounts."

    assert experience_requirements_from_body(source) == ("3–5+ years",)


@pytest.mark.parametrize(
    "written",
    [
        "3–1 years",
        "100 years",
        "601 months",
        "Aaaaaaaaaaaa",
        "Kjkklaamaja",
        "foo bar",
        "Experience-ish",
    ],
)
def test_invalid_or_filler_experience_is_not_an_answer(written: str) -> None:
    assert normalize_experience_requirement(written) is None
    assert conversation_answer_errors("experience_level", written)


@pytest.mark.parametrize(
    ("written", "expected"),
    [
        (
            "5+ years of content strategy, content marketing, or social media "
            "experience in a B2B environment",
            "5+ years",
        ),
        (
            "3-5+ years managing social media for a B2B SaaS or security company",
            "3–5+ years",
        ),
        (
            "2+ years in communications, content strategy, marketing, or copywriting",
            "2+ years",
        ),
        (
            "3+ years of professional graphic design experience, preferably in tech",
            "3+ years",
        ),
    ],
)
def test_long_provider_experience_keeps_its_exact_quantitative_requirement(
    written: str,
    expected: str,
) -> None:
    assert len(written) > 64
    assert normalize_leading_experience_requirement(written) == expected


@pytest.mark.parametrize(
    "written",
    [
        "5 years ago we were founded",
        "1–2 years or 3–5 years of experience",
        "Senior social media leader",
        "Several years of experience",
    ],
)
def test_experience_compaction_never_invents_or_hides_another_claim(written: str) -> None:
    assert normalize_leading_experience_requirement(written) is None


@pytest.mark.parametrize(
    "written",
    [
        "0–1 years",
        "1 to 2 yrs",
        "5+ years",
        "12–18 months",
        "12+ months of relevant editing experience",
        "No prior experience required",
        "Experience preferred",
        "Strong portfolio; no minimum years required",
    ],
)
def test_meaningful_custom_experience_answers_are_allowed(written: str) -> None:
    assert conversation_answer_errors("experience_level", written) == []


def test_anchored_experience_row_wins_over_later_prose_and_keeps_evidence() -> None:
    source = (
        "Company Name: Example Studio\n"
        "Experience: 1 to 2 yrs\n"
        "We want an editor with 1–3 years of experience to join the team."
    )

    labelled = labelled_experience(source)
    assert labelled is not None
    assert labelled.value == "1–2 years"
    assert labelled.evidence == "Experience: 1 to 2 yrs"
    assert experience_from_body(source) == "1–2 years"

    facts = labelled_facts(source)
    assert facts.experience_level == "1–2 years"
    assert (facts.evidence or {})["experience_level"] == "Experience: 1 to 2 yrs"


def test_experience_label_may_put_its_value_on_the_next_line() -> None:
    labelled = labelled_experience("Experience\n12–18 months")

    assert labelled is not None
    assert labelled.value == "12–18 months"
    assert labelled.evidence == "Experience\n12–18 months"


def test_two_distinct_dedicated_experience_rows_remain_unresolved() -> None:
    source = (
        "Experience: 1 to 2 yrs\n"
        "The role summary describes the opportunity.\n"
        "Experience required: 3 to 5 yrs"
    )

    assert labelled_experience(source) is None
    assert experience_from_body(source) is None
    assert labelled_facts(source).experience_level is None


def test_repeated_equivalent_experience_rows_are_one_authoritative_fact() -> None:
    source = "Experience: 1 to 2 yrs\nExperience required: 1–2 years"

    labelled = labelled_experience(source)

    assert labelled is not None
    assert labelled.value == "1–2 years"
    assert experience_from_body(source) == "1–2 years"


def test_skill_lines_before_the_primary_experience_row_are_not_a_neighbor_card() -> None:
    source = (
        "Video Editor\n"
        "Birth Marque\n"
        "Job Description\n"
        "Edit social videos for the brand every week.\n"
        "Key Skills\n"
        "Adobe Premiere\n"
        "After Effects\n"
        "Experience: 1 to 2 yrs\n"
    )

    assert primary_job_text(source).endswith("Experience: 1 to 2 yrs\n")
    assert labelled_facts(source).experience_level == "1–2 years"


def test_conflicting_labelled_rows_never_fall_through_to_weaker_prose() -> None:
    posting = {
        "description": (
            "Experience: 1 to 2 yrs\n"
            "Experience required: 3 to 5 yrs\n"
            "We welcome editors with 2–4 years of experience."
        )
    }

    assert _structured_experience_requirement(posting) is None


@pytest.mark.parametrize("neighbor_label", ["Experience: 5 to 8 yrs", "Experience\n5 to 8 yrs"])
def test_neighboring_job_experience_cannot_become_the_primary_jobs_fact(
    neighbor_label: str,
) -> None:
    page = f"""
Video Editor
Example Studio
About the role
Edit a weekly show for a growing creator-led education channel.

Motion Designer
Another Studio
{neighbor_label}
"""

    assert labelled_facts(page).experience_level is None


def test_json_ld_normalization_prefers_the_dedicated_experience_row() -> None:
    posting = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Video Editor Executive - Chennai",
        "description": (
            "<p>Company Name: Example Studio</p>"
            "<p>Location: Chennai</p>"
            "<p>Experience: 1 to 2 yrs</p>"
            "<p>We want a video editor with 1–3 years of experience.</p>"
        ),
    }
    html = f'<script type="application/ld+json">{json.dumps(posting)}</script>'

    normalized, _title, metadata = normalize_public_job_html(
        html,
        final_url="https://jobs.example/video-editor",
    )

    assert metadata["structured_context"]["experience_requirement"] == ("1–2 years of experience")
    assert "Structured experience requirement: 1–2 years of experience" in normalized


def test_experience_catalog_is_shortcuts_plus_an_open_native_answer() -> None:
    shape = answer_shape_for("experience_level")
    payload = shape.as_payload()

    assert shape.kind == "choice"
    assert shape.max_length == 64
    assert shape.custom_values_allowed is True
    assert shape.choices_are_suggestions is True
    assert payload["custom_values_allowed"] is True
    assert payload["choices_are_suggestions"] is True
    assert payload["max_length"] == 64
    assert JOB_IMPORT_FIELD_POLICIES["experience_level"].custom_values_allowed is True


def _draft(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = {
        "recruiter_prefill": {},
        "machine_output": None,
        "recruiter_context_version": 0,
        "conversation_state": "waiting_for_recruiter",
        "active_question": None,
        "last_completed_stage": None,
        "continuation_count": 0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _conflict_row(values: list[str]) -> SimpleNamespace:
    return SimpleNamespace(
        provenance_state="conflicting_source_values",
        review_status="pending",
        proposed_value=None,
        conflicting_values=[
            {
                "value": value,
                "evidence": [{"snippet": f"Source says {value}"}],
            }
            for value in values
        ],
    )


def test_open_experience_conflict_preserves_both_exact_valid_alternatives() -> None:
    service = JobImportConversationService.__new__(JobImportConversationService)
    question = service._build_question(
        _draft(),
        QueueCandidate("experience_level", "optional", 50),
        None,
        _conflict_row(["1 to 2 yrs", "1–3 years"]),
    )

    assert [item["value"] for item in question["alternatives"]] == [
        "1 to 2 yrs",
        "1–3 years",
    ]
    assert question["answer"]["custom_values_allowed"] is True
    assert question["reason"] == "UNRESOLVED_SOURCE_CONFLICT"


def test_strict_enum_conflicts_still_map_to_their_real_values() -> None:
    service = JobImportConversationService.__new__(JobImportConversationService)
    question = service._build_question(
        _draft(),
        QueueCandidate("work_mode", "confirmation", 0),
        None,
        _conflict_row(["Remote within India", "Hybrid in Chennai"]),
    )

    assert [item["value"] for item in question["alternatives"]] == [
        "remote",
        "hybrid",
    ]


def test_ambiguous_interpretations_are_not_labelled_as_source_contradictions() -> None:
    service = JobImportConversationService.__new__(JobImportConversationService)
    row = _conflict_row(["remote", "hybrid"])
    row.provider_confidence = {"epistemic_state": "ambiguous"}

    question = service._build_question(
        _draft(),
        QueueCandidate("work_mode", "confirmation", 0),
        None,
        row,
    )

    assert question["reason"] == "GENUINE_AMBIGUITY"


def test_a_conflict_question_never_exposes_one_alternative() -> None:
    service = JobImportConversationService.__new__(JobImportConversationService)
    built = service._build_question(
        _draft(),
        QueueCandidate("work_mode", "confirmation", 0),
        None,
        _conflict_row(["Remote within India", "Somewhere else entirely"]),
    )
    assert "alternatives" not in built
    assert set(built["answer"]["choices"]) == {"remote", "hybrid", "onsite"}

    # Checkpointed questions created by an older process are safe on refresh too.
    stale = _draft(
        active_question={
            "field_path": "experience_level",
            "kind": "optional",
            "answer": answer_shape_for("experience_level").as_payload(),
            "alternatives": [{"value": "1–3 years", "evidence": []}],
        }
    )
    snapshot = service._snapshot_of(stale, [])
    assert snapshot.active_question is not None
    assert "alternatives" not in snapshot.active_question
    assert snapshot.active_question["reason"] == "OPTIONAL_HIGH_VALUE_REFINEMENT"
