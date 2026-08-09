"""Four ways to say twenty thousand, and why they are four different facts.

The qualified-fact architecture landed with one honest gap: ``approximate`` was
represented correctly in the semantic layer and then round-tripped natively as a
range with both ends equal. That is true but lossy — internally it was
indistinguishable from a genuine ₹20,000–₹20,000 range, and one careless reader
away from being reported as exact.

``approximate`` is now its own compensation mode. The change is additive and
needs no migration: the column is a plain string, so every existing row keeps
whatever it already had, and nothing that was stored as a range is reinterpreted.

What this file protects is the distinction itself. These four statements are not
the same offer, and a candidate told the wrong one has been misled about money:

    ₹20,000 a month          exactly that
    About ₹20,000 a month    roughly that, and the employer said so
    Up to ₹20,000 a month    at most that
    ₹20,000+ a month         at least that
"""

from __future__ import annotations

import itertools

import pytest

from app.core.job_import_compensation import read_pay
from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_questions import suppressed_by_stated_pay

#: Every hedge a page uses, written out rather than imported from the parser.
APPROXIMATE_WORDS: tuple[str, ...] = (
    "About",
    "about",
    "Around",
    "around",
    "Approximately",
    "approx.",
    "approx",
    "Roughly",
    "circa",
    "~",
)

PERIODS: tuple[tuple[str, str], ...] = (
    ("an hour", "per hour"),
    ("a month", "per month"),
    ("per annum", "per year"),
    ("per project", "per project"),
)


class TestEveryHedgeIsReadAsApproximate:
    @pytest.mark.parametrize(
        ("word", "period"), list(itertools.product(APPROXIMATE_WORDS, PERIODS))
    )
    def test_the_qualifier_survives_every_wording_and_period(
        self, word: str, period: tuple[str, str]
    ) -> None:
        written, unit = period
        joiner = "" if word == "~" else " "
        stated = read_pay(f"{word}{joiner}₹20,000 {written}")

        assert stated is not None, f"{word} {written} read as nothing"
        assert stated.qualifier == "approximate", f"{word} {written} -> {stated.qualifier}"
        assert stated.minimum == 20_000
        assert stated.unit == unit

    @pytest.mark.parametrize("word", APPROXIMATE_WORDS)
    def test_no_range_is_invented_around_the_figure(self, word: str) -> None:
        joiner = "" if word == "~" else " "
        stated = read_pay(f"{word}{joiner}₹20,000 a month")

        assert stated is not None
        # A hedge is not a spread. Inventing ±10% would put numbers on the page
        # that nobody wrote.
        assert stated.minimum == stated.maximum == 20_000 or stated.maximum is None


class TestApproximateIsItsOwnNativeFact:
    def test_it_reaches_the_draft_as_its_own_mode(self) -> None:
        facts = labelled_facts("About ₹20,000 a month")

        assert facts.compensation_mode == "approximate"
        assert facts.budget_amount == 20_000
        # Not an equal-ended range: that shape was the lossy workaround this
        # replaces, and it made approximate indistinguishable from a real range.
        assert facts.budget_max is None

    def test_it_is_not_stored_as_exact(self) -> None:
        approximate = labelled_facts("About ₹20,000 a month")
        exact = labelled_facts("₹20,000 a month")

        assert approximate.compensation_mode != exact.compensation_mode
        assert exact.compensation_mode == "fixed"

    def test_the_assistant_treats_it_as_known_pay(self) -> None:
        facts = labelled_facts("About ₹20,000 a month")
        settled = suppressed_by_stated_pay(
            {
                "budget_amount": facts.budget_amount,
                "budget_max": facts.budget_max,
                "budget_currency": facts.budget_currency,
                "budget_unit": facts.budget_unit,
                "compensation_mode": facts.compensation_mode,
            }
        )

        # The page said what it pays, hedged. Asking again ignores it.
        assert "budget_amount" in settled


class TestTheFourFactsStayFourFacts:
    STATEMENTS = {
        "exact": "₹20,000 a month",
        "approximate": "About ₹20,000 a month",
        "maximum_only": "Up to ₹20,000 a month",
        "minimum_only": "₹20,000+ a month",
    }

    @pytest.mark.parametrize("qualifier", sorted(STATEMENTS))
    def test_each_statement_reads_as_its_own_qualifier(self, qualifier: str) -> None:
        stated = read_pay(self.STATEMENTS[qualifier])

        assert stated is not None
        assert stated.qualifier == qualifier

    def test_no_two_of_them_are_stored_identically(self) -> None:
        stored = {
            name: (
                facts.compensation_mode,
                facts.budget_amount,
                facts.budget_max,
            )
            for name, text in self.STATEMENTS.items()
            for facts in [labelled_facts(text)]
        }

        # The whole point: four statements about the same number that a
        # candidate must not have confused with one another.
        assert len(set(stored.values())) == 4, stored

    def test_the_semantic_facts_are_pairwise_distinct(self) -> None:
        facts = [read_pay(text) for text in self.STATEMENTS.values()]

        for left, right in itertools.combinations(facts, 2):
            assert left != right, (left, right)


class TestBackwardCompatibility:
    """Nothing already stored changes meaning."""

    @pytest.mark.parametrize(
        ("mode", "minimum", "maximum"),
        [
            ("fixed", 20_000, None),
            ("range", 15_000, 20_000),
            ("range", 20_000, None),
            ("range", None, 20_000),
            ("negotiable", None, None),
        ],
    )
    def test_existing_shapes_are_untouched_by_the_new_mode(
        self, mode: str, minimum: int | None, maximum: int | None
    ) -> None:
        from app.core.job_taxonomy import COMPENSATION_MODES

        # The addition is additive: every previously valid mode is still valid,
        # and a stored row is never rewritten by this change.
        assert mode in COMPENSATION_MODES

    def test_an_equal_ended_range_is_not_reinterpreted_as_approximate(self) -> None:
        # A recruiter who genuinely entered 20,000-20,000 said "a range that
        # happens to be tight", not "about". Only evidence of a hedge makes a
        # fact approximate, and there is none in a stored pair of numbers.
        facts = labelled_facts("₹20,000 - ₹20,000 a month")

        assert facts.compensation_mode == "range"
        assert facts.budget_amount == 20_000
        assert facts.budget_max == 20_000

    def test_a_plain_figure_is_still_fixed(self) -> None:
        assert labelled_facts("₹20,000 a month").compensation_mode == "fixed"


class TestTheProvidersOwnWordingIsNotDiscarded:
    """A fact read correctly must not be dropped for its spelling.

    Found by a bounded live provider check, which is the reason that check
    exists. Asked to read "Up to ₹20,000 a month", the model returned a currency
    of ``₹`` and a period of ``month`` — both correct, both in the page's own
    vocabulary rather than the product's. The gate discarded the period for not
    being the token ``per month``, and stored ``₹`` as though a symbol were a
    currency code.

    That is the campaign's whole thesis in miniature: the model understood, and
    the pipeline threw it away. Translating a stated equivalent is not inference
    and cannot narrow anything.
    """

    @pytest.mark.parametrize(
        ("written", "stored"),
        [
            ("₹", "INR"), ("Rs", "INR"), ("rupees", "INR"), ("INR", "INR"),
            ("$", "USD"), ("USD", "USD"), ("£", "GBP"), ("€", "EUR"),
        ],
    )
    def test_a_currency_symbol_becomes_the_code(self, written: str, stored: str) -> None:
        from app.core.job_import_native_values import convert_to_native

        conversion = convert_to_native("budget_currency", written)

        assert conversion.native_value == stored, written
        assert conversion.outcome == "exact"

    @pytest.mark.parametrize(
        ("written", "stored"),
        [
            ("month", "per month"), ("monthly", "per month"), ("mo", "per month"),
            ("hour", "per hour"), ("hourly", "per hour"),
            ("year", "per year"), ("annually", "per year"), ("per annum", "per year"),
            ("week", "per week"), ("project", "per project"),
            ("per month", "per month"),
        ],
    )
    def test_a_bare_period_becomes_the_product_unit(
        self, written: str, stored: str
    ) -> None:
        from app.core.job_import_native_values import convert_to_native

        conversion = convert_to_native("budget_unit", written)

        assert conversion.native_value == stored, written
        assert conversion.outcome == "exact"

    def test_an_unsupported_period_is_still_refused(self) -> None:
        from app.core.job_import_native_values import convert_to_native

        # Translation is a synonym lookup, not a nearest-match search. A period
        # the product cannot represent must still decline rather than be rounded
        # into one it can.
        conversion = convert_to_native("budget_unit", "fortnightly")

        assert conversion.native_value is None
        assert conversion.outcome == "unsupported"
