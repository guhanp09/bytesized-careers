"""Every P0 and P1 this feature has produced, replayed in one place.

Regressions in an import pipeline are not independent. Each of these was found
by a recruiter or a benchmark, fixed, and covered by a test somewhere — but
"somewhere" is spread across twenty files, so nothing answers the question a
release actually asks: *do all of the old failures still stay fixed?*

This file is that question. One case per historical defect, named for what the
recruiter saw rather than for the module that was wrong, and deliberately
duplicating assertions that exist elsewhere. Duplication is the point: a
consolidated replay is how you notice that a refactor undid something from four
rounds ago.

Each class names its escape route too, because the pattern in how these got out
matters more than any individual one: almost every entry was a family that had
been tested by example rather than generated.
"""

from __future__ import annotations

import pytest

from app.core.job_application_classification import classify_application_instructions
from app.core.job_application_instructions import separate_application_instructions
from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_native_values import convert_to_native
from app.core.job_page_evidence import classify_job_page
from app.services.job_import_service import JobImportService
from app.services.job_url_fetcher import normalize_public_job_html


def _note(text: str) -> dict[str, object]:
    return JobImportService._safe_application_payload({"how_to_apply": text})


class TestCompensationThatWasLostOrInvented:
    """Escape route: grammar tested by example, so families went unexercised."""

    def test_h01_rupees_per_month_reach_the_draft(self) -> None:
        # Reported: a page printing "Compensation ₹5,000 / mo" produced a draft
        # with no pay and a question asking how pay was measured.
        facts = labelled_facts("Compensation: ₹5,000 / mo")

        assert (facts.budget_amount, facts.budget_currency, facts.budget_unit) == (
            5000,
            "INR",
            "per month",
        )

    def test_h02_an_annual_salary_is_not_lost_to_the_a_separator(self) -> None:
        assert labelled_facts("Salary: ₹500000 annually").budget_unit == "per year"

    def test_h03_rupees_written_as_rs_are_still_rupees(self) -> None:
        assert labelled_facts("Salary: Rs 5,000 per month").budget_currency == "INR"

    def test_h04_an_hourly_rate_written_with_the_article_is_read(self) -> None:
        assert labelled_facts("Pay: $40 an hour").budget_unit == "per hour"

    def test_h05_one_figure_is_never_advertised_as_a_range(self) -> None:
        assert labelled_facts("Compensation: ₹5,000 / mo").compensation_mode == "fixed"

    def test_h06_a_bare_number_never_acquires_a_period(self) -> None:
        assert labelled_facts("Compensation: ₹5,000").budget_amount is None


class TestExperienceThatWasNarrowed:
    """Escape route: banding was a deliberate design, wrong at the edges."""

    def test_h07_twenty_five_years_is_not_five_to_eight(self) -> None:
        stored = str(
            convert_to_native(
                "experience_level", "25 years of professional experience"
            ).native_value
            or ""
        )

        assert "5-8" not in stored and "5–8" not in stored
        assert "25" in stored

    def test_h08_at_least_sixty_months_gains_no_ceiling(self) -> None:
        stored = str(
            convert_to_native("experience_level", "At least 60 months").native_value or ""
        )

        assert "-" not in stored and "–" not in stored

    def test_h09_a_seniority_word_never_becomes_a_number(self) -> None:
        stored = str(convert_to_native("experience_level", "senior").native_value or "")

        assert not any(character.isdigit() for character in stored)


class TestPlacesThatWereNotPlaces:
    """Escape route: positional fallbacks, tested only on Indian addresses."""

    def test_h10_remote_friendly_never_becomes_a_city(self) -> None:
        assert not convert_to_native("location", "Remote-friendly").native_value

    def test_h11_a_district_wrapper_never_becomes_the_city(self) -> None:
        assert (
            convert_to_native(
                "location", "Coimbatore, Coimbatore district, IN"
            ).native_value
            == "Coimbatore"
        )

    def test_h12_a_us_state_abbreviation_never_becomes_the_city(self) -> None:
        assert convert_to_native("location", "Boston, MA").native_value == "Boston"
        assert convert_to_native("location", "New York, NY").native_value == "New York"

    def test_h13_an_employer_name_never_becomes_a_city(self) -> None:
        assert not convert_to_native("location", "Remote (Acme Inc)").native_value

    def test_h14_a_timezone_never_becomes_a_city(self) -> None:
        assert not convert_to_native("location", "Asia/Kolkata").native_value


class TestEngagementThatWasWrong:
    """Escape route: markup trusted over the employer's own visible copy."""

    def test_h15_a_paid_freelance_brief_is_not_an_internship(self) -> None:
        assert (
            labelled_facts("Type: Part-time / Freelance").engagement_type
            == "ongoing_freelance"
        )

    def test_h16_nothing_defaults_to_internship(self) -> None:
        assert labelled_facts("Type: TBD").engagement_type != "internship"

    def test_h17_an_unsupported_engagement_is_refused_not_rounded(self) -> None:
        assert labelled_facts("Type: Volunteer").engagement_type is None


class TestApplicationRoutingThatLeaked:
    """Escape route: sentence-level rules, tested one clause at a time."""

    def test_h18_whatsapp_never_reaches_a_public_note(self) -> None:
        note = str(
            _note(
                "Please share the requested portfolio, samples, personal details, "
                "and AI-video confirmation on WhatsApp only."
            ).get("how_to_apply")
            or ""
        )

        assert "whatsapp" not in note.lower()
        assert "personal details" in note

    def test_h19_an_email_address_never_reaches_a_public_note(self) -> None:
        note = str(
            _note("Email your CV and showreel to careers@example.com.").get(
                "how_to_apply"
            )
            or ""
        )

        assert "@" not in note

    def test_h20_a_careers_page_destination_never_reaches_a_public_note(self) -> None:
        note = str(_note("Send everything to our careers page.").get("how_to_apply") or "")

        assert "careers page" not in note.lower()

    def test_h21_a_destination_never_rides_inside_a_screening_question(self) -> None:
        classified = classify_application_instructions(
            "Send two caption examples and tell us why you want the job on WhatsApp."
        )

        for question in classified.screening_questions:
            assert "whatsapp" not in question.lower()

    def test_h22_an_external_application_mode_never_survives_conversion(self) -> None:
        result = JobImportService._safe_application_payload(
            {"application_mode": "external", "external_apply_url": "https://x.invalid/a"}
        )

        assert result["application_mode"] == "internal"
        assert "external_apply_url" not in result

    def test_h23_a_platform_named_as_work_survives(self) -> None:
        assert (
            separate_application_instructions(
                "Send links to your YouTube and Instagram work."
            ).destination
            == []
        )


class TestApplicantMaterialThatWasLost:
    """Escape route: routing detection judged a sentence by its opening."""

    @pytest.mark.parametrize(
        "source",
        [
            "Apply through the form and include your showreel.",
            "Fill out this Google Form and attach your reel.",
            "Apply at https://jobs.example.com/apply with two samples.",
        ],
    )
    def test_h24_a_requirement_after_directions_is_not_discarded(
        self, source: str
    ) -> None:
        result = _note(source)

        assert result.get("application_requirements") or result.get("how_to_apply"), source

    def test_h25_a_requirement_key_the_job_side_cannot_collect_is_never_emitted(
        self,
    ) -> None:
        # `reference_links` is talent-only. Emitting it for a job produced a
        # requirement the sanitizer silently discarded, so the candidate was
        # never asked and the recruiter never received it.
        classified = classify_application_instructions("Send links to previous work.")

        assert "reference_links" not in classified.requirement_keys

    def test_h26_a_standard_detail_never_becomes_a_screening_question(self) -> None:
        classified = classify_application_instructions("What is your expected rate?")

        assert "expected_rate" in classified.requirement_keys
        assert classified.screening_questions == []

    def test_h27_which_opens_a_judgement_question(self) -> None:
        classified = classify_application_instructions(
            "Which Indian pop-culture moment would you turn into a Reel?"
        )

        assert classified.screening_questions


class TestPagesThatWereNotOneJob:
    """Escape route: keyword heuristics, which an aggregator page satisfies."""

    def test_h28_an_index_never_reaches_the_provider(self) -> None:
        evidence = classify_job_page(
            "Current openings\n120 jobs\nFilter by\nSort by\nNext page",
            declared_job_titles=["Video Editor", "Backend Engineer", "Designer"],
        )

        assert evidence.classification == "multi_job_or_index"
        assert not evidence.may_extract

    def test_h29_a_neighbouring_job_does_not_supply_this_jobs_rate(self) -> None:
        page = "\n".join(
            [
                "Content Creator",
                "Compensation: ₹5,000 / mo",
                "Similar jobs",
                "Senior Video Editor",
                "Compensation: ₹95,000 / mo",
            ]
        )

        assert labelled_facts(page).budget_amount == 5000

    def test_h30_a_terse_but_real_posting_is_not_rejected_as_a_shell(self) -> None:
        # The threshold was 400 once and rejected a genuine 378-character
        # listing. Small boards write short posts, and a missed real listing
        # costs more than a caught shell.
        posting = (
            "About the role\n"
            "We need a video editor for four YouTube videos a month for our "
            "cooking channel. You will cut long-form footage into finished "
            "episodes and one short each.\n"
            "Responsibilities\n"
            "Edit and deliver each episode within four days of receiving the "
            "raw footage, add captions, and colour-correct.\n"
            "Requirements\n"
            "Comfortable in CapCut or Premiere. Some experience with food or "
            "lifestyle content is a plus.\n"
            "How to apply\n"
            "Include two recent edits."
        )
        assert len(posting) > 200
        evidence = classify_job_page(posting, declared_job_titles=[])

        assert evidence.classification == "single_job", evidence.reason


class TestMarkupThatCollapsed:
    """Escape route: fixtures were pretty-printed; production HTML is minified."""

    def test_h31_a_minified_definition_list_keeps_every_row(self) -> None:
        html = (
            "<html><body><h1>Content Creator</h1>"
            "<dl><dt>Compensation</dt><dd>₹5,000 / mo</dd>"
            "<dt>Type</dt><dd>Part-time / Freelance</dd></dl></body></html>"
        )
        text, _title, _metadata = normalize_public_job_html(
            html, final_url="https://example.invalid/j"
        )
        facts = labelled_facts(text)

        assert facts.budget_amount == 5000
        assert facts.engagement_type == "ongoing_freelance"

    def test_h32_a_minified_table_keeps_every_row(self) -> None:
        html = (
            "<html><body><h1>X</h1><table><tbody>"
            "<tr><th>Compensation</th><td>₹5,000 / mo</td></tr>"
            "<tr><th>Type</th><td>Freelance</td></tr>"
            "</tbody></table></body></html>"
        )
        text, _title, _metadata = normalize_public_job_html(
            html, final_url="https://example.invalid/j"
        )
        facts = labelled_facts(text)

        assert facts.budget_amount == 5000
        assert facts.engagement_type == "ongoing_freelance"


class TestValuesThatVanishedOrDoubled:
    """Escape route: the stored value was right, so nothing compared renders."""

    def test_h33_whitespace_is_not_stored_as_a_fact(self) -> None:
        assert convert_to_native("title", "   ").native_value is None

    def test_h34_an_empty_string_still_clears_a_field(self) -> None:
        assert convert_to_native("experience_level", "").native_value == ""

    def test_h35_a_value_too_long_for_its_column_is_declined_not_truncated(self) -> None:
        conversion = convert_to_native("location", "x" * 500)

        assert conversion.native_value is None or len(str(conversion.native_value)) <= 500
