"""Which of two homes each imported instruction belongs in.

Standard details — a portfolio, a rate, availability, tools — are the same
request for every applicant, and the application form already collects them.
Evaluative questions need prose only the candidate can write, and belong in
private screening.

Putting the first kind in the second is the failure this exists to stop. A
request that becomes a question stops being a field the form can fill: it turns
into a sentence someone types an answer to, uncollected and unsearchable.

Grammar does not decide it. "What is your expected rate?" ends in a question
mark and is still a standard detail, because every applicant has a rate and
there is a box for it.
"""

from __future__ import annotations

import pytest

from app.core.job_application_classification import classify_application_instructions
from app.services.job_import_service import JobImportService


def convert(text: str) -> dict:
    return JobImportService._safe_application_payload({"how_to_apply": text})


class TestStandardDetailsBecomeStructuredRequirements:
    @pytest.mark.parametrize(
        ("source", "expected"),
        [
            ("Include your portfolio.", "relevant_portfolio"),
            ("Share your expected rate.", "expected_rate"),
            ("Provide your availability.", "start_availability"),
            ("Include your usual working hours.", "working_hours"),
            ("Tell us your years of experience.", "relevant_experience"),
            ("List the editing tools and workflow you use.", "tools_workflow"),
            ("Attach your CV.", "relevant_portfolio"),
            ("Include your showreel.", "relevant_portfolio"),
            ("Send links to previous work.", "reference_links"),
            ("What is your expected turnaround?", "turnaround"),
        ],
    )
    def test_each_maps_to_a_field_the_form_can_collect(
        self, source: str, expected: str
    ) -> None:
        result = classify_application_instructions(source)

        assert expected in result.requirement_keys
        assert result.screening_questions == []

    def test_question_grammar_does_not_make_a_rate_a_question(self) -> None:
        # Scenario D. Every applicant has a rate and the form has a box for it,
        # so classifying on the question mark alone would put a collectable fact
        # into prose nobody can filter on.
        result = classify_application_instructions("What is your expected rate?")

        assert result.requirement_keys == ["expected_rate"]
        assert result.screening_questions == []


class TestGenuineEvaluationBecomesAScreeningQuestion:
    @pytest.mark.parametrize(
        "source",
        [
            "Why are you interested in this role?",
            "Describe a project that is similar to this one.",
            "How would you approach editing this type of content?",
            "What was your role in the work shown in your portfolio?",
            "How do you handle multiple rounds of feedback?",
            "Explain your process for selecting B-roll.",
        ],
    )
    def test_prose_only_the_candidate_can_write(self, source: str) -> None:
        result = classify_application_instructions(source)

        assert result.screening_questions == [source]

    @pytest.mark.parametrize(
        "source",
        ["Upload your portfolio.", "State your expected rate.", "Provide your availability."],
    )
    def test_an_imperative_request_is_never_a_question(self, source: str) -> None:
        assert classify_application_instructions(source).screening_questions == []


class TestNothingAppearsInTwoPlaces:
    def test_a_fully_structured_request_leaves_no_note_behind(self) -> None:
        result = convert("Include your portfolio and expected rate.")

        assert set(result["application_requirements"]) == {"relevant_portfolio", "expected_rate"}
        # Repeating it in the note would make the candidate answer it twice.
        assert "how_to_apply" not in result
        assert "screening_questions" not in result

    def test_requirements_and_evaluation_split_without_overlap(self) -> None:
        result = convert(
            "Include your portfolio and expected rate. Why are you interested in this role?"
        )

        assert set(result["application_requirements"]) == {"relevant_portfolio", "expected_rate"}
        prompts = [row["prompt"] for row in result["screening_questions"]]
        assert prompts == ["Why are you interested in this role?"]
        # The question is asked of applicants, not printed for every reader.
        assert "how_to_apply" not in result

    def test_a_destination_is_still_removed_while_requirements_are_mapped(self) -> None:
        result = convert("Please share your portfolio on WhatsApp.")

        assert result["application_requirements"] == ["relevant_portfolio"]
        assert "whatsapp" not in str(result).lower()
        assert result["application_mode"] == "internal"


class TestPublicationRefusesOffPlatformRouting:
    """The recruiter's own prose, checked where it cannot be skipped.

    Imported wording is sanitised on the way in, which covers the source but not
    the person editing afterwards. Someone can still type "send it on WhatsApp"
    into the public note, and publishing it told candidates to apply somewhere
    CreatorJobs cannot see, record or protect them in.

    The check lives in the publication validator rather than the form, because a
    stale client, a hand-built request and an old draft all arrive there.
    """

    @staticmethod
    def _publication_errors(note: str) -> dict:
        from app.services.job_service import JobService, JobValidationError

        try:
            JobService._validate_domain_for_publication(
                JobService.__new__(JobService), {"how_to_apply": note}
            )
        except JobValidationError as exc:
            return exc.field_errors
        return {}

    @pytest.mark.parametrize(
        "note",
        [
            "Send your portfolio to us on WhatsApp at +91 90000 00000.",
            "Email your CV to hiring@studio.example.",
            "Submit via Telegram.",
            "DM us on Instagram to apply.",
            "Fill out this Google Form.",
            "Apply at https://jobs.example.com/apply.",
            "Apply through LinkedIn.",
            "Use our careers page.",
        ],
    )
    def test_routing_prose_cannot_be_published(self, note: str) -> None:
        errors = self._publication_errors(note)

        assert "how_to_apply" in errors, note
        assert "CreatorJobs" in " ".join(errors["how_to_apply"])

    @pytest.mark.parametrize(
        "note",
        [
            "Include links to your YouTube work.",
            "Provide Instagram portfolio examples.",
            "Share a GitHub repository.",
            "Experience producing LinkedIn content is a plus.",
            "Familiarity with WhatsApp marketing helps.",
            "Include two recent samples and your expected rate.",
        ],
    )
    def test_legitimate_platform_references_still_publish(self, note: str) -> None:
        # A blanket ban would block a recruiter for naming the platforms their
        # work actually lives on, which is most of them.
        assert self._publication_errors(note) == {}

    def test_the_message_says_what_to_do_about_it(self) -> None:
        errors = self._publication_errors("WhatsApp me on +91 90000 00000.")
        message = " ".join(errors["how_to_apply"])

        # Keep the materials, drop the destination — and the prose itself is
        # never rewritten, so the draft still holds exactly what was typed.
        assert "Keep the requested" in message
