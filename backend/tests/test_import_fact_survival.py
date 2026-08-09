"""Where a fact dies, named — so nobody has to do archaeology again.

The reported bug cost a full round of diagnosis to answer one question: did the
model miss it, or did CreatorJobs throw it away? That question should be
answerable by running a test, not by reading four modules and a screenshot.

So every case here declares what the source says as plain ground truth, then
walks the stages a fact passes through and reports the *first* one that lost it:

    SOURCE → DETECTED → NATIVE → PUBLIC

A failure names the boundary. "PRESENTATION_LOSS at ₹20,000 maximum" is a
different bug from "MODEL_MISREAD", and conflating them is what made the same
architectural fault look like a series of unrelated parser gaps.

The ground truth is written by hand from the page's own words. Nothing here is
derived from the reader under test — an oracle built from the parser cannot
notice the parser going blind, which is the lesson the state-abbreviation
self-referential oracle already taught this repository once.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.core.job_import_compensation import read_pay
from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_questions import suppressed_by_stated_pay

#: The layers a fact can die at. Used as the failure vocabulary so a report says
#: which component to open.
LOSS_STAGES = (
    "DETECTION_LOSS",
    "RECONCILIATION_LOSS",
    "NATIVE_CONVERSION_LOSS",
    "QUESTION_PLANNER_LOSS",
    "PRESENTATION_LOSS",
)


@dataclass(frozen=True)
class SourceFact:
    """What a page says, written from the page rather than from any parser."""

    page: str
    #: None where the source states no such bound.
    minimum: float | None
    maximum: float | None
    currency: str | None
    unit: str | None
    qualifier: str
    #: Whether the assistant should still need to ask what the role pays.
    still_ask: bool


#: One entry per way a real listing states pay. Ground truth by hand.
FACTS: tuple[SourceFact, ...] = (
    SourceFact(
        "Up to ₹20,000 a month", None, 20_000, "INR", "per month", "maximum_only", False
    ),
    SourceFact(
        "₹20,000+ a month", 20_000, None, "INR", "per month", "minimum_only", False
    ),
    SourceFact(
        "From ₹25,000 per month", 25_000, None, "INR", "per month", "minimum_only", False
    ),
    SourceFact(
        "₹15,000 - ₹20,000 a month",
        15_000,
        20_000,
        "INR",
        "per month",
        "range",
        False,
    ),
    SourceFact("₹5,000 / mo", 5_000, None, "INR", "per month", "exact", False),
    SourceFact("$40 an hour", 40, None, "USD", "per hour", "exact", False),
    SourceFact("₹5,00,000 per annum", 500_000, None, "INR", "per year", "exact", False),
    SourceFact("Maximum $500 per project", None, 500, "USD", "per project", "maximum_only", False),
    SourceFact("Minimum $40/hour", 40, None, "USD", "per hour", "minimum_only", False),
    # States no figure at all, so the recruiter genuinely still has to decide.
    SourceFact("Competitive salary", None, None, None, None, "negotiable", True),
)


def _detected(fact: SourceFact):
    """Stage 1: did anything read the page at all?"""

    return read_pay(fact.page)


class TestStageOneDetection:
    @pytest.mark.parametrize("fact", FACTS, ids=lambda fact: fact.page)
    def test_the_source_fact_is_detected_with_its_qualifier(
        self, fact: SourceFact
    ) -> None:
        stated = _detected(fact)

        assert stated is not None, f"DETECTION_LOSS: nothing read from {fact.page!r}"
        assert stated.qualifier == fact.qualifier, (
            f"DETECTION_LOSS: {fact.page!r} read as {stated.qualifier}, "
            f"source states {fact.qualifier}"
        )
        assert stated.minimum == fact.minimum, (
            f"DETECTION_LOSS: minimum {stated.minimum} != {fact.minimum}"
        )
        assert stated.maximum == fact.maximum, (
            f"DETECTION_LOSS: maximum {stated.maximum} != {fact.maximum}"
        )
        assert stated.currency == fact.currency
        assert stated.unit == fact.unit


class TestStageTwoReconciliation:
    @pytest.mark.parametrize("fact", FACTS, ids=lambda fact: fact.page)
    def test_the_fact_survives_into_the_draft_fields(self, fact: SourceFact) -> None:
        facts = labelled_facts(fact.page)

        if fact.qualifier == "negotiable":
            # No figure to carry, and a keyword must not choose the recruiter's
            # compensation mode for them.
            assert facts.budget_amount is None and facts.budget_max is None
            return

        assert facts.budget_amount == fact.minimum, (
            f"RECONCILIATION_LOSS: {fact.page!r} minimum "
            f"{facts.budget_amount} != {fact.minimum}"
        )
        assert facts.budget_max == fact.maximum, (
            f"RECONCILIATION_LOSS: {fact.page!r} maximum "
            f"{facts.budget_max} != {fact.maximum}"
        )
        assert facts.budget_currency == fact.currency
        assert facts.budget_unit == fact.unit

    @pytest.mark.parametrize("fact", FACTS, ids=lambda fact: fact.page)
    def test_a_one_sided_bound_is_never_flattened_into_a_rate(
        self, fact: SourceFact
    ) -> None:
        facts = labelled_facts(fact.page)

        if fact.qualifier == "maximum_only":
            # The whole reported bug in one assertion.
            assert facts.budget_amount is None, (
                f"RECONCILIATION_LOSS: a ceiling became a flat rate of "
                f"{facts.budget_amount}"
            )
            assert facts.compensation_mode != "fixed"
        if fact.qualifier == "minimum_only":
            assert facts.budget_max is None, (
                "RECONCILIATION_LOSS: a floor gained a ceiling nobody stated"
            )


class TestStageThreeQuestionPlanning:
    @pytest.mark.parametrize("fact", FACTS, ids=lambda fact: fact.page)
    def test_the_assistant_asks_only_when_the_page_did_not_say(
        self, fact: SourceFact
    ) -> None:
        facts = labelled_facts(fact.page)
        settled = suppressed_by_stated_pay(
            {
                "budget_amount": facts.budget_amount,
                "budget_max": facts.budget_max,
                "budget_currency": facts.budget_currency,
                "budget_unit": facts.budget_unit,
                "compensation_mode": facts.compensation_mode,
            }
        )
        asks = "budget_amount" not in settled

        assert asks == fact.still_ask, (
            f"QUESTION_PLANNER_LOSS: {fact.page!r} "
            f"{'was asked about anyway' if asks else 'was not asked about'}"
        )


class TestQualifiedFactsBeyondCompensation:
    """The same failure shape, checked where it could recur.

    Compensation was the field that broke, but the pattern — a source states a
    bound, the schema holds only exact-or-null — is not specific to money. The
    audit found experience already safe for a reason worth recording, and worth
    pinning so it stays that way.
    """

    @pytest.mark.parametrize(
        "stated",
        [
            "At least 5 years",
            "5+ years",
            "Up to 5 years",
            "25 years of professional experience",
            "At least 60 months",
            "Minimum of three years",
            "Senior",
            "2-3 years",
        ],
    )
    def test_experience_is_carried_in_the_sources_own_words(self, stated: str) -> None:
        from app.core.job_import_native_values import convert_to_native

        conversion = convert_to_native("experience_level", stated)

        # `experience_level` is free-form text, so a qualified requirement needs
        # no bounded representation to survive: the qualifier is the value. That
        # is why "25 years" reached the editor intact where "up to ₹20,000"
        # could not — and it is the shape compensation now has too.
        assert conversion.writable, f"{stated!r} became unwritable"
        assert conversion.native_value == stated, (
            f"{stated!r} was rewritten to {conversion.native_value!r}"
        )
        assert conversion.outcome == "exact"

    @pytest.mark.parametrize(
        "stated", ["At least 5 years", "5+ years", "Up to 5 years", "Senior"]
    )
    def test_a_qualified_requirement_is_never_narrowed_into_a_band(
        self, stated: str
    ) -> None:
        from app.core.job_import_native_values import convert_to_native

        conversion = convert_to_native("experience_level", stated)

        # The failure this guards is the one already paid for once: "25 years"
        # arriving as the band "5-8". A narrowed value is worse than none,
        # because nothing downstream can tell it was narrowed.
        assert conversion.native_value is None or conversion.native_value == stated
        for band in ("0–1", "1-3", "3-5", "5-8"):
            assert conversion.native_value != band
