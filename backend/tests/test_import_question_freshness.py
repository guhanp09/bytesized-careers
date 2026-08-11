"""A question may only exist while the final state still needs a human.

The Nabbe defect was a question about a fact the page stated plainly. Its cause
was ordering: a row existed before reconciliation finished, and question
planning read that intermediate state.

So the invariant is about freshness rather than any one field. Whatever the
route by which a fact arrives — deterministic backfill, structured
reconciliation, labelled copy, provider salvage, a recruiter answer — a question
about it must be gone before anyone sees it.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.job_import_questions import deterministic_question_queue
from app.services.job_import_conversation_service import JobImportConversationService


def queue_for(missing: dict[str, str], **kwargs) -> list[str]:
    return [
        candidate.field_path
        for candidate in deterministic_question_queue(
            conflicted_fields=kwargs.pop("conflicted", frozenset()),
            missing_fields=missing,
            answered_fields=kwargs.pop("answered", frozenset()),
            suppressed_fields=kwargs.pop("suppressed", frozenset()),
            active_conditional_fields=kwargs.pop("conditional", frozenset()),
            **kwargs,
        )
    ]


ASKABLE = [
    "title",
    "work_mode",
    "location",
    "compensation_mode",
    "budget_unit",
    "budget_amount",
    "engagement_type",
    "experience_level",
]


class TestAResolvedFieldLeavesNoQuestion:
    """The core freshness rule, applied to every field that can be asked."""

    @pytest.mark.parametrize("field_path", ASKABLE)
    def test_a_field_present_in_answers_is_not_queued(self, field_path: str) -> None:
        queued = queue_for(
            {field_path: "required_for_publication"},
            answered=frozenset({field_path}),
        )

        assert field_path not in queued

    @pytest.mark.parametrize("field_path", ASKABLE)
    def test_a_suppressed_field_is_not_queued(self, field_path: str) -> None:
        queued = queue_for(
            {field_path: "required_for_publication"},
            suppressed=frozenset({field_path}),
        )

        assert field_path not in queued

    @pytest.mark.parametrize("field_path", ASKABLE)
    def test_a_field_absent_from_missing_is_not_queued(self, field_path: str) -> None:
        # The state after a backfill: the row is no longer missing, so nothing
        # about it may remain queued.
        assert field_path not in queue_for({})


class TestQuestionPlanningReadsTheReconciledState:
    """Planning must run after reconciliation, not alongside it."""

    def test_the_queue_is_a_pure_function_of_the_state_given(self) -> None:
        # Nothing is cached between calls, so a later state cannot inherit an
        # earlier state's questions. This is what makes ordering sufficient.
        before = queue_for({"budget_unit": "required_for_publication"})
        after = queue_for({}, answered=frozenset({"budget_unit"}))

        assert "budget_unit" in before
        assert after == []

    def test_planning_happens_after_the_structured_merge(self) -> None:
        from pathlib import Path

        source = Path("app/services/job_import_service.py").read_text()
        merge = source.index("rows = await self._merge_structured_page_signals(")
        prefill = source.index("rows = self._merge_recruiter_prefill(")

        # Recruiter answers are merged last, so nothing machine-derived can
        # overwrite them and no question can outlive them.
        assert merge < prefill

    def test_the_conversation_queue_is_built_from_current_rows(self) -> None:
        import inspect

        from app.services.job_import_conversation_service import (
            JobImportConversationService,
        )

        source = inspect.getsource(JobImportConversationService._queue_for)
        # Rows are read at question time rather than carried from an earlier
        # snapshot, which is what keeps a resolved field from staying queued.
        assert "list_fields(draft.id)" in source
        assert "provenance_state" in source


class TestOnlyGenuinelyOpenFieldsAreAsked:
    def test_a_missing_field_is_still_asked(self) -> None:
        assert "work_mode" in queue_for({"work_mode": "required_for_publication"})

    def test_a_conflict_is_still_asked(self) -> None:
        queued = queue_for({}, conflicted=frozenset({"work_mode"}))

        assert "work_mode" in queued

    def test_an_answered_conflict_is_not_asked_again(self) -> None:
        queued = queue_for(
            {},
            conflicted=frozenset({"work_mode"}),
            answered=frozenset({"work_mode"}),
        )

        assert "work_mode" not in queued


class TestNoTechnicalFailureBecomesABusinessQuestion:
    """A pipeline fault must not be handed to the recruiter as a decision."""

    @pytest.mark.parametrize(
        "field_path",
        ["application_mode", "external_apply_url"],
    )
    def test_platform_decided_fields_are_never_asked(self, field_path: str) -> None:
        queued = queue_for({field_path: "required_for_publication"})

        assert field_path not in queued

    def test_an_unreadable_page_never_reaches_question_planning(self) -> None:
        from app.core.job_page_evidence import classify_job_page

        # Retrieval refuses first, so there is no draft to plan questions from.
        for text in ("Jobs", "Just a moment... checking your browser"):
            assert not classify_job_page(text).may_extract


class TestConsequentialSuggestionsRemainConfirmable:
    def test_valid_contextual_currency_is_offered_but_not_auto_applied(self) -> None:
        row = SimpleNamespace(
            field_path="budget_currency",
            proposed_value="CAD",
            validation_errors=[
                "This field may only be extracted from explicit source wording."
            ],
        )

        assert JobImportConversationService._confirmable_essential_suggestion(row)

    @pytest.mark.parametrize(
        ("field_path", "value"),
        [
            ("creative_autonomy", "high"),
            ("budget_currency", "not-a-currency"),
        ],
    )
    def test_optional_or_malformed_suggestions_stay_suppressed(
        self, field_path: str, value: str
    ) -> None:
        row = SimpleNamespace(
            field_path=field_path,
            proposed_value=value,
            validation_errors=[
                "This field may only be extracted from explicit source wording."
            ],
        )

        assert not JobImportConversationService._confirmable_essential_suggestion(row)
