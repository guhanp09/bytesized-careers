"""Every question must have a legitimate, recorded reason."""

from __future__ import annotations

import pytest

from app.core.job_import_question_reasons import (
    ASK_REASONS,
    SUPPRESSION_REASONS,
    QuestionDecision,
    decide,
)

BASE = dict(
    has_recruiter_answer=False,
    has_effective_value=False,
    is_conflicted=False,
    is_suppressed=False,
    is_supported=True,
    is_active_conditional=False,
    requires_confirmation=False,
    kind="mandatory",
)


def test_a_provider_failure_is_never_a_reason_to_ask_anything() -> None:
    """The defect this whole effort exists to stop.

    A timed-out extraction produced an empty result, and the queue then asked
    about every field in it. The failure must terminate the workflow, not seed
    an interrogation.
    """

    decision = decide("budget_amount", **{**BASE, "provider_failed": True})
    assert decision.asked is False
    assert decision.reason == "provider_failure_not_questionable"


def test_a_value_already_on_the_page_is_not_asked_about() -> None:
    decision = decide("work_mode", **{**BASE, "has_effective_value": True})
    assert decision.asked is False
    assert decision.reason == "source_value_available"


def test_a_recruiter_answer_outranks_everything() -> None:
    decision = decide(
        "budget_currency",
        **{
            **BASE,
            "has_recruiter_answer": True,
            "has_effective_value": True,
            "is_conflicted": True,
        },
    )
    assert decision.asked is False
    assert decision.reason == "recruiter_value_available"


def test_a_dependency_suppression_beats_an_absent_value() -> None:
    decision = decide("trial_work_usage", **{**BASE, "is_suppressed": True})
    assert decision.asked is False
    assert decision.reason == "suppressed_by_dependency"


def test_a_contradiction_is_a_real_question() -> None:
    decision = decide(
        "budget_amount", **{**BASE, "is_conflicted": True, "has_effective_value": True}
    )
    assert decision.asked is True
    assert decision.reason == "conflict_requires_decision"


def test_a_consequential_inference_is_confirmed_not_assumed() -> None:
    decision = decide(
        "budget_currency",
        **{**BASE, "has_effective_value": True, "requires_confirmation": True},
    )
    assert decision.asked is True
    assert decision.reason == "consequential_inference_requires_confirmation"


def test_a_genuinely_absent_required_field_is_asked() -> None:
    decision = decide("about_channel", **BASE)
    assert decision.asked is True
    assert decision.reason == "genuinely_absent_required_field"


def test_an_internal_field_is_never_asked() -> None:
    decision = decide("status", **{**BASE, "is_supported": False})
    assert decision.asked is False
    assert decision.reason == "unsupported_or_internal_field"


def test_a_reason_cannot_contradict_the_outcome_it_explains() -> None:
    """The categories are a contract, not a label printed after the fact."""

    with pytest.raises(ValueError):
        QuestionDecision("work_mode", True, "source_value_available")
    with pytest.raises(ValueError):
        QuestionDecision("work_mode", False, "genuinely_absent_required_field")


def test_the_two_reason_sets_stay_disjoint() -> None:
    assert not (ASK_REASONS & SUPPRESSION_REASONS)
