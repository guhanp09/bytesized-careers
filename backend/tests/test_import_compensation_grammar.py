"""Compensation, generated from semantics rather than listed by hand.

``₹500000 annually`` survived several rounds of compensation tests. Nobody
reasoned wrongly about it; nobody happened to write it down. The ``a`` that makes
"₹5,000 **a** month" work had no word boundary, so it ate the first letter of
"annually" and the string parsed to nothing at all — on a page that stated its
salary plainly.

That is not a missing example, it is a missing *family*. So this generates every
currency × period × amount × spacing rendering of the same underlying fact and
asserts the parse returns the fact it came from. A property finds the
combination nobody thought of, which is the only kind that has been escaping.

Failures print the semantic object, the rendered string and the recipe, so a
generated failure is exactly as debuggable as a written one.
"""

from __future__ import annotations

import pytest

from app.core.job_import_labelled_fields import labelled_facts
from tests.import_generators import (
    NON_NUMERIC_COMPENSATION,
    NOT_THE_CANDIDATES_PAY,
    compensation_cases,
)

CASES = compensation_cases()


def _parse(text: str):
    return labelled_facts(f"Compensation: {text}")


class TestEveryRenderingReturnsTheFactItCameFrom:
    """The central property. One fact, every way a page can write it."""

    @pytest.mark.parametrize(
        "case", CASES, ids=lambda case: case.recipe if hasattr(case, "recipe") else ""
    )
    def test_a_generated_rate_round_trips(self, case) -> None:
        facts = _parse(case.text)

        assert facts.budget_amount == case.semantics.amount, (
            f"amount changed: {case.recipe} | {case.text!r} -> "
            f"{facts.budget_amount} (wanted {case.semantics.amount})"
        )
        assert facts.budget_currency == case.semantics.currency, (
            f"currency changed: {case.recipe} | {case.text!r} -> "
            f"{facts.budget_currency} (wanted {case.semantics.currency})"
        )
        assert facts.budget_unit == case.semantics.unit, (
            f"unit changed: {case.recipe} | {case.text!r} -> "
            f"{facts.budget_unit} (wanted {case.semantics.unit})"
        )

    def test_the_generated_corpus_is_large_enough_to_be_worth_trusting(self) -> None:
        # A guard on the generator itself. If it silently degenerates to a
        # handful of cases the suite still passes and proves almost nothing.
        assert len(CASES) >= 500
        assert len({case.semantics.currency for case in CASES}) >= 4
        assert len({case.semantics.unit for case in CASES}) >= 7


class TestASingleFigureIsNeverARange:
    @pytest.mark.parametrize("case", CASES[:200], ids=lambda case: case.recipe)
    def test_no_ceiling_is_invented(self, case) -> None:
        facts = _parse(case.text)

        # Advertising a spread the employer never offered, to every candidate
        # who reads the listing.
        assert facts.compensation_mode == "fixed", case.recipe


class TestNothingIsInventedFromWordsAlone:
    @pytest.mark.parametrize("text", NON_NUMERIC_COMPENSATION)
    def test_prose_naming_no_figure_yields_no_figure(self, text: str) -> None:
        facts = _parse(text)

        assert facts.budget_amount is None, f"{text!r} -> {facts.budget_amount}"
        assert facts.budget_currency is None
        assert facts.budget_unit is None

    @pytest.mark.parametrize(
        "text",
        [
            "5000",
            "5,000",
            "₹5,000",
            "5000 per month",
            "$5000",
            "5000 monthly",
            "Around 5000",
            "Up to 5000",
        ],
    )
    def test_a_figure_missing_its_currency_or_period_is_not_a_rate(
        self, text: str
    ) -> None:
        """A rate needs all three, and a missing one is not filled in.

        The first version of this asserted only that the three arrived
        *together* — amount implies currency and unit. A mutation that defaults
        the period to "per month" satisfies that perfectly while inventing the
        one fact the page never stated, and it survived. The oracle has to name
        what must not happen, not just that the parts agree.
        """

        facts = _parse(text)

        assert facts.budget_amount is None, (
            f"{text!r} states no complete rate but produced "
            f"{facts.budget_amount} {facts.budget_currency} {facts.budget_unit}"
        )

    @pytest.mark.parametrize(
        ("text", "missing"),
        [
            ("₹5,000", "period"),
            ("$5,000", "period"),
            ("Rs 5,000", "period"),
            ("5000 per month", "currency"),
            ("5,000 monthly", "currency"),
            ("5000 annually", "currency"),
        ],
    )
    def test_the_missing_half_is_never_supplied_from_nowhere(
        self, text: str, missing: str
    ) -> None:
        facts = _parse(text)

        # Defaulting the period to "per month" would understate an annual
        # salary twelve-fold; defaulting the currency to INR on a dollar page
        # would understate it eighty-fold. Both are worse than reading nothing.
        assert facts.budget_unit is None, f"{text!r} gained a {missing}: {facts}"
        assert facts.budget_currency is None, f"{text!r} gained a {missing}: {facts}"
        assert facts.budget_amount is None


class TestAFigureOnThePageIsNotNecessarilyThePay:
    @pytest.mark.parametrize("sentence", NOT_THE_CANDIDATES_PAY)
    def test_an_unlabelled_figure_elsewhere_is_never_read_as_the_rate(
        self, sentence: str
    ) -> None:
        # These carry a currency and a period and are still not what the job
        # pays. The label is what makes a figure the offer, which is why the
        # reader keys on labels rather than on the presence of money.
        facts = labelled_facts(sentence)

        assert facts.budget_amount is None, f"{sentence!r} -> {facts.budget_amount}"


class TestPeriodsAreNeverConfusedForOneAnother:
    """A monthly rate read as annual is a factor-of-twelve lie."""

    @pytest.mark.parametrize(
        ("text", "unit"),
        [
            ("₹500000 annually", "per year"),
            ("₹500000 a year", "per year"),
            ("₹500000 per annum", "per year"),
            ("₹5000 a month", "per month"),
            ("₹5000 monthly", "per month"),
            ("₹5000 /mo", "per month"),
            ("$40 an hour", "per hour"),
            ("$40 hourly", "per hour"),
            ("$40/hr", "per hour"),
            ("₹9000 weekly", "per week"),
            ("₹2000 daily", "per day"),
        ],
    )
    def test_the_stated_period_is_the_stored_period(self, text: str, unit: str) -> None:
        assert _parse(text).budget_unit == unit, text

    def test_annually_is_not_swallowed_by_the_a_separator(self) -> None:
        # The exact escape. Pinned by name so a future change to the separator
        # cannot quietly reintroduce it.
        assert _parse("₹500000 annually").budget_unit == "per year"
        assert _parse("₹5,000 a month").budget_unit == "per month"


class TestCurrenciesAreNeverInferred:
    @pytest.mark.parametrize(
        ("text", "currency"),
        [
            ("₹5000 per month", "INR"),
            ("INR 5000 per month", "INR"),
            ("Rs 5000 per month", "INR"),
            ("Rs. 5000 per month", "INR"),
            ("$5000 per month", "USD"),
            ("USD 5000 per month", "USD"),
            ("US$5000 per month", "USD"),
            ("£5000 per month", "GBP"),
            ("GBP 5000 per month", "GBP"),
            ("€5000 per month", "EUR"),
            ("EUR 5000 per month", "EUR"),
        ],
    )
    def test_the_stated_currency_is_the_stored_currency(
        self, text: str, currency: str
    ) -> None:
        assert _parse(text).budget_currency == currency, text

    def test_a_dollar_amount_on_an_indian_page_stays_dollars(self) -> None:
        # Locale is not evidence. A page hosted in India offering USD is
        # offering USD, and inferring INR would understate it ~83-fold.
        page = "\n".join(
            [
                "Location: Bengaluru, Karnataka, IN",
                "Compensation: $2,000 per month",
            ]
        )
        facts = labelled_facts(page)

        assert facts.budget_currency == "USD"
        assert facts.budget_amount == 2000


class TestBoundaryAmounts:
    @pytest.mark.parametrize(
        ("text", "amount"),
        [
            ("₹0 per month", 0),
            ("₹1 per month", 1),
            ("₹999999999 per month", 999999999),
            ("₹1,00,00,000 per month", 10000000),
        ],
    )
    def test_extremes_are_read_or_declined_but_never_altered(
        self, text: str, amount: int
    ) -> None:
        facts = _parse(text)

        # Reading it is fine and declining it is fine. Returning a *different*
        # number is not.
        assert facts.budget_amount in (None, amount), f"{text!r} -> {facts.budget_amount}"

    def test_a_negative_figure_is_not_a_rate(self) -> None:
        facts = _parse("-5000 per month")

        assert facts.budget_amount is None or facts.budget_amount >= 0
