"""Adversarial sweeps for the two defect classes that keep recurring.

The first is narrowing: a source says one thing and the draft says something
smaller or more precise. "25 years" became "5–8 years"; "At least 60 months"
became "5–7 years"; "5+ years" gained a ceiling of eight. Each was found one at a
time, by a person reading output. This sweeps the space instead.

The second is authority: which evidence wins when two sources of a fact
disagree. A page whose markup said INTERN while its own copy said "Part-time /
Freelance" produced an internship, then asked the recruiter to sort it out.
"""

from __future__ import annotations

import pytest

from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_native_values import convert_to_native
from app.core.job_import_structured_fields import _experience_band
from app.core.job_import_title_signals import title_signals


class TestExperienceNeverNarrows:
    """Every shape a page states experience in, and what it must stay."""

    @pytest.mark.parametrize(
        "stated",
        [
            "0 years", "1 year", "2–5 years", "5 years", "7 years", "8 years",
            "9 years", "10+ years", "25 years", "At least 7 years",
            "Up to 5 years", "Experience preferred", "No prior experience required",
            "3+ years", "1–7 years of experience",
        ],
    )
    def test_the_stated_wording_reaches_the_draft_untouched(self, stated: str) -> None:
        conversion = convert_to_native("experience_level", stated)

        assert conversion.native_value == stated
        assert conversion.outcome == "exact"

    @pytest.mark.parametrize(
        "stated", ["9 years", "10+ years", "25 years", "At least 7 years"]
    )
    def test_nothing_above_the_senior_band_is_squeezed_into_it(self, stated: str) -> None:
        assert convert_to_native("experience_level", stated).native_value != "5–8 years"

    @pytest.mark.parametrize(
        ("structured", "expected"),
        [
            ("At least 60 months of experience", "At least 5 years"),
            ("Minimum of 36 months", "At least 3 years"),
            ("3+ years", "3+ years"),
            ("2-4 years", "2–4 years"),
            ("18 months", "18 months"),
        ],
    )
    def test_structured_experience_keeps_its_shape(
        self, structured: str, expected: str
    ) -> None:
        assert _experience_band(structured) == expected

    @pytest.mark.parametrize(
        "structured", ["At least 60 months of experience", "3+ years", "Minimum 24 months"]
    )
    def test_an_open_requirement_never_gains_a_ceiling(self, structured: str) -> None:
        derived = _experience_band(structured) or ""
        # Two figures around a dash is the shape of an invented maximum.
        assert not any(
            part.strip().isdigit() for part in derived.replace("–", "-").split("-")[1:]
        ), derived

    @pytest.mark.parametrize(
        "title",
        ["Senior Video Editor", "Junior Animator", "Expert Motion Designer",
         "Seasoned Scriptwriter", "Mid-level Editor", "Entry level Designer"],
    )
    def test_a_seniority_word_never_becomes_a_number(self, title: str) -> None:
        assert title_signals(title).settled.get("experience_level") is None


class TestLocationNeverBecomesSomethingElse:
    @pytest.mark.parametrize(
        ("stated", "expected"),
        [
            ("Coimbatore, Coimbatore district, IN", "Coimbatore"),
            ("San Francisco, California, US", "San Francisco"),
            ("Brookefield, Bengaluru", "Brookefield, Bengaluru"),
            ("Boston, MA", "Boston, MA"),
            ("Remote (Acme Inc); Tysons Corner, VA", "Tysons Corner, VA"),
            ("Hybrid / Remote: Bengaluru", "Bengaluru"),
        ],
    )
    def test_a_city_field_receives_a_city(self, stated: str, expected: str) -> None:
        assert convert_to_native("location", stated).native_value == expected

    @pytest.mark.parametrize(
        "arrangement",
        ["Remote", "Remote-friendly", "Remote first", "Fully remote", "Hybrid",
         "On-site", "In-office", "Distributed", "Anywhere", "Work from home",
         "Remote, India"],
    )
    def test_an_arrangement_is_never_a_place(self, arrangement: str) -> None:
        assert convert_to_native("location", arrangement).native_value is None


class TestEngagementNeverFallsIntoAnUnrelatedEnum:
    @pytest.mark.parametrize(
        ("labelled", "expected"),
        [
            ("Type Full-time", "full_time"),
            ("Type Part-time", "part_time"),
            ("Type Freelance", "ongoing_freelance"),
            ("Type Contract", "fixed_term"),
            ("Type Internship", "internship"),
            ("Type Part-time / Freelance", "ongoing_freelance"),
            ("Type Retainer", "retainer"),
        ],
    )
    def test_each_stated_type_maps_to_its_own_meaning(
        self, labelled: str, expected: str
    ) -> None:
        assert labelled_facts(labelled).engagement_type == expected

    @pytest.mark.parametrize(
        "labelled",
        ["Type Something unusual", "Type TBD", "Type Varies", "Type See description"],
    )
    def test_an_unreadable_type_is_left_unset_rather_than_guessed(
        self, labelled: str
    ) -> None:
        assert labelled_facts(labelled).engagement_type is None

    @pytest.mark.parametrize(
        "value", ["full_time", "part_time", "ongoing_freelance", "fixed_term", "internship"]
    )
    def test_every_supported_engagement_survives_conversion(self, value: str) -> None:
        assert convert_to_native("engagement_type", value).native_value == value


class TestCompensationNeverInventsAFigure:
    @pytest.mark.parametrize(
        ("labelled", "amount", "currency", "unit"),
        [
            ("Compensation ₹5,000 / mo", 5000, "INR", "per month"),
            ("Compensation $30 per hour", 30, "USD", "per hour"),
            ("Salary £250 / day", 250, "GBP", "per day"),
            ("Budget €1,500 per project", 1500, "EUR", "per project"),
            ("Pay INR 40000 monthly", 40000, "INR", "per month"),
            ("Compensation $95,000 per year", 95000, "USD", "per year"),
        ],
    )
    def test_a_stated_rate_is_read_exactly(
        self, labelled: str, amount: int, currency: str, unit: str
    ) -> None:
        facts = labelled_facts(labelled)

        assert (facts.budget_amount, facts.budget_currency, facts.budget_unit) == (
            amount, currency, unit,
        )
        # One figure is a fixed rate. A range would advertise a spread the
        # employer never offered.
        assert facts.compensation_mode == "fixed"

    @pytest.mark.parametrize(
        "labelled",
        ["Compensation Competitive", "Salary Depends on experience",
         "Pay 5000", "Compensation ₹5,000", "Budget To be discussed",
         "Salary Market rate", "Compensation DOE"],
    )
    def test_an_unclear_figure_yields_nothing(self, labelled: str) -> None:
        facts = labelled_facts(labelled)

        assert facts.budget_amount is None
        assert facts.compensation_mode is None


class TestEvidenceAuthority:
    """Which source wins when two disagree about the same fact."""

    def test_labelled_copy_beats_markup_that_contradicts_it(self) -> None:
        # The recurring case: syndicated markup versus the employer's own words.
        assert labelled_facts("Type Part-time / Freelance").engagement_type == (
            "ongoing_freelance"
        )

    def test_labelled_copy_supplies_what_markup_omits(self) -> None:
        assert labelled_facts("Compensation ₹5,000 / mo").budget_amount == 5000

    def test_unlabelled_prose_is_not_treated_as_a_labelled_fact(self) -> None:
        # A footer mentioning a city must not become a location, and a sentence
        # mentioning money must not become a rate.
        prose = "Our London office hosts meetups. Salaries here are competitive."
        facts = labelled_facts(prose)

        assert facts.budget_amount is None
        assert facts.engagement_type is None

    def test_a_recruiter_reviewed_row_is_never_overwritten(self) -> None:
        from app.services.job_import_service import JobImportService

        for status in ("accepted", "edited", "rejected"):
            assert not JobImportService._structured_value_may_fill(
                {
                    "field_path": "engagement_type",
                    "provenance_state": "extracted_from_source",
                    "proposed_value": "internship",
                    "review_status": status,
                }
            ), status
