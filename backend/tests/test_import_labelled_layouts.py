"""The same fact, in every layout a job page prints it in.

The labelled reader answers one question — "did the employer print this under a
label?" — and it now outranks the page's own syndicated markup when the two
disagree. That authority is the reason to stress it broadly: a reader that is
right about definition lists and wrong about tables would silently hand a table
site's markup the decision, and the failure would look exactly like the one this
was built to fix.

Two risks are specific enough to name. Responsive sites ship the same row twice —
once for a phone, once for a desktop — and a reader that treats the second copy
as a second opinion invents a conflict out of one fact. And a page usually
carries *other* jobs in a sidebar or a "similar roles" card, so a reader that
takes the first label it finds anywhere can quietly import a neighbour's salary.
"""

from __future__ import annotations

import pytest

from app.core.job_import_labelled_fields import labelled_facts


def _plain(rows: str) -> str:
    """Normalised page text, as the fetcher hands it on: one row per line."""

    return "\n".join(line.strip() for line in rows.strip().splitlines())


class TestEveryLayoutThatPrintsALabelledRow:
    """Layout is the site's choice. The fact is the same in all of them."""

    @pytest.mark.parametrize(
        ("label", "text"),
        [
            ("inline with colon", "Compensation: ₹5,000 / mo"),
            ("inline no colon", "Compensation ₹5,000 / mo"),
            ("inline with dash", "Compensation - ₹5,000 / mo"),
            ("inline with en dash", "Compensation – ₹5,000 / mo"),
            ("stacked", "Compensation\n₹5,000 / mo"),
            ("stacked with colon", "Compensation:\n₹5,000 / mo"),
            ("padded", "   Compensation   :   ₹5,000 / mo   "),
            ("tab separated", "Compensation\t₹5,000 / mo"),
        ],
    )
    def test_a_rate_is_read_however_the_row_is_laid_out(
        self, label: str, text: str
    ) -> None:
        facts = labelled_facts(_plain(text))

        assert facts.budget_amount == 5000, label
        assert facts.budget_currency == "INR", label
        assert facts.budget_unit == "per month", label

    @pytest.mark.parametrize(
        "label",
        ["Compensation", "Salary", "Pay", "Stipend", "Budget"],
    )
    def test_every_word_a_page_uses_for_money(self, label: str) -> None:
        facts = labelled_facts(_plain(f"{label}: $30 per hour"))

        assert facts.budget_amount == 30
        assert facts.budget_currency == "USD"
        assert facts.budget_unit == "per hour"

    @pytest.mark.parametrize(
        "label",
        ["Job Type", "Employment Type", "Type", "Engagement"],
    )
    def test_every_word_a_page_uses_for_engagement(self, label: str) -> None:
        assert (
            labelled_facts(_plain(f"{label}: Freelance")).engagement_type
            == "ongoing_freelance"
        )

    @pytest.mark.parametrize(
        ("written", "expected"),
        [
            ("Freelance", "ongoing_freelance"),
            ("Part-time / Freelance", "ongoing_freelance"),
            ("Freelance / Part-time", "ongoing_freelance"),
            ("Full-time", "full_time"),
            ("Full time", "full_time"),
            ("Part-time", "part_time"),
            ("Internship", "internship"),
            ("Contract", "fixed_term"),
            ("Retainer", "retainer"),
            ("Permanent", "full_time"),
        ],
    )
    def test_engagement_wording_maps_to_the_products_own_vocabulary(
        self, written: str, expected: str
    ) -> None:
        assert labelled_facts(_plain(f"Type: {written}")).engagement_type == expected

    def test_freelance_decides_when_a_row_names_two(self) -> None:
        # "Part-time / Freelance" is freelance work at part-time volume. The
        # freelance half decides how the engagement is structured; the part-time
        # half only describes its volume, which weekly hours already carry.
        assert (
            labelled_facts(_plain("Type: Part-time / Freelance")).engagement_type
            == "ongoing_freelance"
        )


class TestCurrenciesAndPeriods:
    @pytest.mark.parametrize(
        ("written", "amount", "currency"),
        [
            ("₹5,000 / mo", 5000, "INR"),
            ("INR 5000 monthly", 5000, "INR"),
            ("$1,200 per month", 1200, "USD"),
            ("€900 / month", 900, "EUR"),
            ("£750 per month", 750, "GBP"),
            ("USD 40 per hour", 40, "USD"),
        ],
    )
    def test_a_stated_currency_is_kept_exactly(
        self, written: str, amount: int, currency: str
    ) -> None:
        facts = labelled_facts(_plain(f"Compensation: {written}"))

        assert facts.budget_amount == amount
        assert facts.budget_currency == currency

    @pytest.mark.parametrize(
        ("written", "unit"),
        [
            ("₹5000/mo", "per month"),
            ("₹5000 per month", "per month"),
            ("₹5000 monthly", "per month"),
            ("₹500/hr", "per hour"),
            ("₹500 per hour", "per hour"),
            ("₹500000 per year", "per year"),
            ("₹500000 annually", "per year"),
            ("₹9000 per week", "per week"),
            ("₹2000 per day", "per day"),
            ("₹15000 per project", "per project"),
            ("₹3000 per video", "per video"),
        ],
    )
    def test_a_stated_period_maps_to_a_supported_unit(
        self, written: str, unit: str
    ) -> None:
        assert labelled_facts(_plain(f"Pay: {written}")).budget_unit == unit

    def test_one_figure_is_a_fixed_rate_never_a_range(self) -> None:
        facts = labelled_facts(_plain("Compensation: ₹5,000 / mo"))

        # Inventing a ceiling would advertise a spread the employer never
        # offered, to every candidate who reads the listing.
        assert facts.compensation_mode == "fixed"


class TestNothingIsInvented:
    """The reader's most important behaviour is declining to answer."""

    @pytest.mark.parametrize(
        "value",
        [
            "Competitive",
            "Negotiable",
            "Depends on experience",
            "As per industry standards",
            "Unpaid",
            "TBD",
        ],
    )
    def test_prose_that_names_no_figure_yields_nothing(self, value: str) -> None:
        facts = labelled_facts(_plain(f"Compensation: {value}"))

        assert facts.budget_amount is None
        assert facts.budget_currency is None
        assert facts.budget_unit is None

    @pytest.mark.parametrize(
        "value",
        ["5000", "5,000", "5000 rupees a lot", "Around 5000"],
    )
    def test_a_bare_number_is_not_a_rate(self, value: str) -> None:
        # Without both a currency and a period there is no rate — only a digit.
        # Guessing either is the invention the rest of the pipeline refuses.
        facts = labelled_facts(_plain(f"Compensation: {value}"))

        assert facts.budget_amount is None or (
            facts.budget_currency is not None and facts.budget_unit is not None
        )

    def test_a_currency_without_a_period_is_not_a_rate(self) -> None:
        assert labelled_facts(_plain("Compensation: ₹5,000")).budget_amount is None

    def test_a_period_without_a_currency_is_not_a_rate(self) -> None:
        assert labelled_facts(_plain("Compensation: 5000 per month")).budget_amount is None

    @pytest.mark.parametrize("text", ["", "   ", "\n\n"])
    def test_an_empty_page_yields_nothing(self, text: str) -> None:
        facts = labelled_facts(text)

        assert facts.budget_amount is None
        assert facts.engagement_type is None

    def test_a_page_with_no_labels_yields_nothing(self) -> None:
        facts = labelled_facts(
            _plain(
                """
                We are hiring a video editor.
                You will edit 4 videos a month for our channel.
                Apply if you love storytelling.
                """
            )
        )

        assert facts.budget_amount is None
        assert facts.engagement_type is None

    def test_an_unsupported_engagement_word_is_not_forced_into_an_enum(self) -> None:
        assert labelled_facts(_plain("Type: Volunteer")).engagement_type is None


class TestOnePageCanCarryOtherPeoplesJobs:
    """A neighbouring listing's numbers must never become this job's."""

    def test_the_current_jobs_row_is_read_not_a_later_card(self) -> None:
        page = _plain(
            """
            (Paid) Content Creator & Social Media Manager
            Compensation: ₹5,000 / mo
            Type: Part-time / Freelance
            About the role
            Own our social presence.
            Similar jobs
            Senior Video Editor
            Compensation: ₹95,000 / mo
            Type: Full-time
            """
        )
        facts = labelled_facts(page)

        # The first labelled row belongs to the job the page is about. Taking
        # the last would import the neighbour's salary and engagement wholesale.
        assert facts.budget_amount == 5000
        assert facts.engagement_type == "ongoing_freelance"

    def test_a_sidebar_recommendation_does_not_replace_the_job(self) -> None:
        page = _plain(
            """
            Junior Motion Designer
            Salary: ₹18,000 / mo
            Recommended for you
            Lead Motion Designer
            Salary: ₹1,40,000 / mo
            """
        )

        assert labelled_facts(page).budget_amount == 18000


class TestResponsiveMarkupIsOneFactNotTwo:
    def test_the_same_row_printed_twice_reads_once(self) -> None:
        # Responsive sites ship a phone copy and a desktop copy of the same row.
        # Reading the duplicate as a second opinion would manufacture a conflict
        # out of a page that never disagreed with itself.
        page = _plain(
            """
            Compensation: ₹5,000 / mo
            Compensation: ₹5,000 / mo
            Type: Freelance
            Type: Freelance
            """
        )
        facts = labelled_facts(page)

        assert facts.budget_amount == 5000
        assert facts.budget_currency == "INR"
        assert facts.engagement_type == "ongoing_freelance"


class TestTheReaderNeverBreaksTheImport:
    @pytest.mark.parametrize(
        "text",
        [
            "Compensation: " + "9" * 400,
            "Type: " + "x" * 400,
            "Compensation:\n" * 200,
            "Compensation: ₹5,000 / mo\x00",
            "Pay: ₹∞ / mo",
        ],
    )
    def test_hostile_input_returns_facts_rather_than_raising(self, text: str) -> None:
        # Enrichment is a bonus. A malformed page must never turn a successful
        # extraction into a failed import.
        facts = labelled_facts(_plain(text))

        assert facts is not None

    def test_a_very_long_page_still_finds_its_labelled_rows(self) -> None:
        filler = "\n".join(f"Point number {index} about the role." for index in range(400))
        page = _plain(f"Compensation: ₹5,000 / mo\nType: Freelance\n{filler}")

        assert labelled_facts(page).budget_amount == 5000
