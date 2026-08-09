"""Pay a page states, in the shapes pages actually state it.

A reported listing headed ``Up to ₹20,000 a month`` reached the recruiter as a
question about what the role pays, with a candidate preview reading
"Compensation not specified · Up to". Three separate gaps produced that, and
each is a family rather than an example — so this generates the families instead
of listing the strings that happened to be reported.

The negative half matters as much. A grammar loose enough to read every page is
loose enough to read a client's budget, a reimbursement or a previous salary as
the offer, and inventing pay is worse than missing it. Those cases are asserted
here too, against the same reader.
"""

from __future__ import annotations

import itertools

import pytest

from app.core.job_import_compensation import read_pay
from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_questions import suppressed_by_stated_pay

#: Magnitude words and what one unit of each is worth. Written out rather than
#: imported from the module under test: a table derived from the parser cannot
#: notice the parser losing an entry.
MAGNITUDES: tuple[tuple[str, int], ...] = (
    ("k", 1_000),
    ("K", 1_000),
    ("thousand", 1_000),
    ("lakh", 100_000),
    ("lakhs", 100_000),
    ("lac", 100_000),
    ("L", 100_000),
    ("crore", 10_000_000),
    ("cr", 10_000_000),
    ("million", 1_000_000),
    ("mn", 1_000_000),
)

CURRENCIES: tuple[tuple[str, str], ...] = (
    ("₹", "INR"),
    ("Rs.", "INR"),
    ("Rs", "INR"),
    ("INR", "INR"),
    ("$", "USD"),
    ("USD", "USD"),
    ("£", "GBP"),
    ("€", "EUR"),
)

PERIODS: tuple[tuple[str, str], ...] = (
    ("a month", "per month"),
    ("per month", "per month"),
    ("/month", "per month"),
    ("monthly", "per month"),
    ("pm", "per month"),
    ("a year", "per year"),
    ("per annum", "per year"),
    ("pa", "per year"),
    ("annually", "per year"),
    ("an hour", "per hour"),
    ("/hr", "per hour"),
    ("per week", "per week"),
    ("per project", "per project"),
    ("per video", "per video"),
)


class TestAMagnitudeIsWorthWhatItSays:
    """``₹20k`` is twenty thousand, and reading it as twenty is the worse bug."""

    @pytest.mark.parametrize(("word", "multiplier"), MAGNITUDES)
    @pytest.mark.parametrize(("symbol", "code"), CURRENCIES[:4])
    def test_every_magnitude_multiplies(
        self, word: str, multiplier: int, symbol: str, code: str
    ) -> None:
        stated = read_pay(f"{symbol}20{word} a month")

        assert stated is not None, f"{symbol}20{word} read as nothing"
        assert stated.minimum == 20 * multiplier, f"{symbol}20{word} -> {stated.minimum}"
        assert stated.currency == code
        assert stated.unit == "per month"

    def test_a_fractional_magnitude_is_not_truncated(self) -> None:
        assert read_pay("₹1.5 lakh per annum").minimum == 150_000  # type: ignore[union-attr]
        assert read_pay("₹2.5k a month").minimum == 2_500  # type: ignore[union-attr]

    @pytest.mark.parametrize("text", ["₹5000 monthly", "₹5000 mo", "₹5000 a month"])
    def test_a_period_beginning_with_a_magnitude_letter_is_still_a_period(
        self, text: str
    ) -> None:
        # "monthly" starts with the letter that means million. A magnitude
        # matched here would report five billion a month.
        stated = read_pay(text)

        assert stated is not None and stated.minimum == 5_000, f"{text} -> {stated}"
        assert stated.unit == "per month"


class TestEveryCurrencyAndPeriodSurvives:
    @pytest.mark.parametrize(
        ("currency", "period"), list(itertools.product(CURRENCIES, PERIODS))
    )
    def test_a_plain_rate_reads_back_as_itself(
        self, currency: tuple[str, str], period: tuple[str, str]
    ) -> None:
        symbol, code = currency
        written, unit = period
        joiner = "" if written.startswith("/") else " "
        stated = read_pay(f"{symbol}40,000{joiner}{written}")

        assert stated is not None, f"{symbol}40,000{joiner}{written} read as nothing"
        assert stated.minimum == 40_000
        assert stated.currency == code
        assert stated.unit == unit

    def test_indian_digit_grouping_is_not_mangled(self) -> None:
        assert read_pay("₹5,00,000 pa").minimum == 500_000  # type: ignore[union-attr]

    def test_a_rupee_terminator_is_not_read_as_a_period(self) -> None:
        stated = read_pay("₹20,000/- per month")

        assert stated is not None and stated.minimum == 20_000
        assert stated.unit == "per month"


class TestARangeKeepsBothEnds:
    @pytest.mark.parametrize(
        "text",
        [
            "₹15,000 - ₹20,000 a month",
            "₹15,000 – ₹20,000 a month",
            "₹15,000 to ₹20,000 a month",
            "₹15,000 - 20,000 a month",
            "between ₹15,000 and ₹20,000 per month",
        ],
    )
    def test_both_ends_are_read(self, text: str) -> None:
        stated = read_pay(text)

        assert stated is not None, f"{text} read as nothing"
        assert (stated.minimum, stated.maximum) == (15_000, 20_000), text
        assert stated.qualifier == "range"

    def test_a_shared_magnitude_reaches_the_first_end(self) -> None:
        # "₹15-20k" states one magnitude for both. Reading the first end
        # literally gives ₹15 against ₹20,000 — a spread nobody wrote.
        stated = read_pay("₹15-20k a month")

        assert stated is not None
        assert (stated.minimum, stated.maximum) == (15_000, 20_000)


class TestACeilingIsNotARate:
    """The reported case, and the reason it must not be flattened."""

    @pytest.mark.parametrize(
        "text",
        [
            "Up to ₹20,000 a month",
            "Upto ₹20,000 a month",
            "up to Rs. 20,000 per month",
            "Maximum of ₹20,000 a month",
            "no more than ₹20,000 a month",
        ],
    )
    def test_a_ceiling_is_read_as_a_ceiling(self, text: str) -> None:
        stated = read_pay(text)

        assert stated is not None, f"{text} read as nothing"
        assert stated.maximum == 20_000, text
        # Promoting the ceiling into a flat rate would advertise a figure the
        # employer never offered, which is the same class of error as reading a
        # monthly rate as annual.
        assert stated.minimum is None, f"{text} invented a floor of {stated.minimum}"
        assert stated.qualifier == "maximum_only"

    @pytest.mark.parametrize(
        "text",
        [
            "From ₹25,000 per month",
            "Starting at ₹25,000 per month",
            "Minimum of ₹25,000 per month",
            "at least ₹25,000 per month",
        ],
    )
    def test_a_floor_is_read_as_a_floor(self, text: str) -> None:
        stated = read_pay(text)

        assert stated is not None, f"{text} read as nothing"
        assert stated.minimum == 25_000, text
        assert stated.maximum is None, f"{text} invented a ceiling"
        assert stated.qualifier == "minimum_only"


class TestNothingIsInvented:
    @pytest.mark.parametrize(
        "text",
        [
            "8 videos per month",
            "3-5 videos a week",
            "2 posts per day",
            "40 hours per week",
            "₹20,000",
            "20,000 per month",
        ],
    )
    def test_an_incomplete_or_non_monetary_figure_is_not_a_rate(self, text: str) -> None:
        # A rate needs a currency and a period. Supplying either from nowhere
        # understates real salaries by an order of magnitude.
        assert read_pay(text) is None, f"{text!r} produced pay"

    @pytest.mark.parametrize("text", ["Competitive salary", "Salary negotiable", "Pay is DOE"])
    def test_wording_with_no_figure_names_no_figure(self, text: str) -> None:
        stated = read_pay(text)

        # The page addressed pay and named no number. Recording *that* is
        # useful; inventing an amount from it is not.
        assert stated is not None and stated.qualifier == "negotiable", text
        assert stated.minimum is None and stated.maximum is None

    @pytest.mark.parametrize("labelled", ["Compensation Competitive", "Compensation DOE"])
    def test_a_keyword_does_not_choose_the_recruiters_compensation_mode(
        self, labelled: str
    ) -> None:
        # `negotiable` is a publishable state a recruiter chooses. "Competitive"
        # says a reader will find no figure; it does not say the recruiter
        # picked an open one, and a deterministic keyword must not decide that.
        assert labelled_facts(labelled).compensation_mode is None


class TestAFigureInProseIsNotTheOffer:
    """Reading a page harder must not mean reading somebody else's number."""

    @pytest.mark.parametrize(
        "sentence",
        [
            "Previous salary of ₹30,000 per month will be verified.",
            "We manage campaign budgets of ₹50,00,000 per month for clients.",
            "Reimbursement of ₹2,000 per month for internet.",
            "For example, a video that costs $500 per video to produce.",
            "Similar jobs pay ₹95,000 / mo.",
            "Our client spends ₹80,000 a month on ads.",
        ],
    )
    def test_money_inside_a_sentence_is_never_taken_as_pay(self, sentence: str) -> None:
        facts = labelled_facts(sentence)

        assert facts.budget_amount is None, f"{sentence!r} -> {facts.budget_amount}"
        assert facts.budget_max is None, f"{sentence!r} -> {facts.budget_max}"


class TestTheReportedListing:
    """End to end, in the shape the page actually rendered it."""

    PAGE = "\n".join(
        [
            "Freelance Video Editor",
            "Finance Simplified",
            "Up to ₹20,000 a month",
            "Remote",
            "Job Type: Freelance",
            "",
            "Edit raw footage into finished videos including reels.",
            "Perform colour correction and audio cleanup.",
        ]
    )

    def test_the_ceiling_is_read_without_a_label(self) -> None:
        facts = labelled_facts(self.PAGE)

        # No "Compensation:" label anywhere. The figure is a bare line, which is
        # how most boards render pay and how this listing was missed entirely.
        assert facts.budget_max == 20_000
        assert facts.budget_currency == "INR"
        assert facts.budget_unit == "per month"

    def test_the_ceiling_is_not_promoted_to_a_flat_rate(self) -> None:
        facts = labelled_facts(self.PAGE)

        assert facts.budget_amount is None
        # "fixed" would claim the job pays exactly ₹20,000. A one-sided range is
        # the truthful native shape: a range with an end the page did not state.
        assert facts.compensation_mode == "range"

    def test_the_engagement_still_reads(self) -> None:
        assert labelled_facts(self.PAGE).engagement_type == "ongoing_freelance"

    def test_the_assistant_stops_asking_what_the_role_pays(self) -> None:
        facts = labelled_facts(self.PAGE)
        values = {
            "budget_max": facts.budget_max,
            "budget_currency": facts.budget_currency,
            "budget_unit": facts.budget_unit,
            "budget_amount": facts.budget_amount,
        }

        # The whole point of the report: the page said what it pays, and the
        # assistant asked anyway.
        assert "budget_amount" in suppressed_by_stated_pay(values)
        assert "compensation_mode" in suppressed_by_stated_pay(values)


class TestSuppressionOnlyAppliesToAStatedRate:
    def test_a_ceiling_without_a_currency_still_earns_the_question(self) -> None:
        assert (
            suppressed_by_stated_pay(
                {"budget_max": 20_000, "budget_unit": "per month", "budget_currency": None}
            )
            == frozenset()
        )

    def test_a_ceiling_without_a_period_still_earns_the_question(self) -> None:
        assert (
            suppressed_by_stated_pay(
                {"budget_max": 20_000, "budget_currency": "INR", "budget_unit": None}
            )
            == frozenset()
        )

    def test_nothing_is_suppressed_when_no_pay_was_stated(self) -> None:
        assert suppressed_by_stated_pay({}) == frozenset()

    def test_a_stated_range_settles_pay_entirely(self) -> None:
        # Both ends stated: nothing about pay is worth interrupting for.
        settled = suppressed_by_stated_pay(
            {
                "budget_amount": 20_000,
                "budget_max": 30_000,
                "budget_currency": "INR",
                "budget_unit": "per month",
            }
        )

        assert {"budget_amount", "budget_max", "compensation_mode"} <= settled

    def test_a_stated_floor_alone_also_settles_pay(self) -> None:
        # "₹20,000+/month" is an answer. Asking what the role pays after
        # reading it is asking the recruiter to repeat their own listing.
        settled = suppressed_by_stated_pay(
            {
                "budget_amount": 20_000,
                "budget_max": None,
                "budget_currency": "INR",
                "budget_unit": "per month",
            }
        )

        assert "budget_amount" in settled
        assert "compensation_mode" in settled

    def test_a_negotiable_page_is_not_asked_for_amounts(self) -> None:
        settled = suppressed_by_stated_pay({"compensation_mode": "negotiable"})

        assert {"budget_amount", "budget_max"} <= settled
