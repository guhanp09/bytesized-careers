"""One sentence that asks for four things, sorted into four different homes.

A source's application paragraph rarely asks for one thing. "Send your CV, links
to your YouTube work, and answer: what creator inspires you?" contains a
structured requirement, a detail the structured requirement cannot hold, and a
question only prose can answer — and, usually, somewhere to send it all that
CreatorJobs cannot follow.

Each destination is load-bearing and each has a way of going wrong:

* A **structured requirement** activates an input the application form already
  renders. Missing it turns "portfolio" into a sentence someone types an answer
  to, uncollected and unsearchable.
* The **public note** carries what has no structured home. Over-filling it asks
  for the same thing twice; under-filling it drops what the recruiter wanted.
* A **screening question** is private and answered once. Sending a standard
  detail here is the failure the classifier exists to prevent.
* The **destination** is removed. Publishing it routes candidates into a hiring
  process the platform cannot see, and the applicant is lost.

The tests worth reading twice are the ones about platform names, because the two
uses are a word apart. "Links to your YouTube work" describes the work; "DM us on
Instagram" is a destination. Getting that wrong in the safe direction still costs
a recruiter the requirement they asked for.
"""

from __future__ import annotations

import pytest

from app.core.job_application_classification import classify_application_instructions
from app.core.job_application_instructions import separate_application_instructions
from app.core.job_apply_note import compose_public_apply_note
from app.services.job_import_service import JobImportService


def _converted(text: str) -> dict[str, object]:
    """The payload as the real conversion boundary produces it."""

    return JobImportService._safe_application_payload({"how_to_apply": text})


class TestTheFiveCompoundSentences:
    """Each names several things at once, in the shapes sources actually use."""

    def test_a_portfolio_and_a_rate_sent_to_an_address(self) -> None:
        source = "Email your portfolio and expected rate to hiring@studio.example."
        result = _converted(source)

        requirements = result.get("application_requirements") or []
        assert "relevant_portfolio" in requirements
        assert "expected_rate" in requirements

        note = str(result.get("how_to_apply") or "")
        # Both are structured, so the note must not ask for either again.
        assert "@" not in note
        assert "hiring@studio.example" not in note

    def test_samples_and_a_judgement_question_sent_over_whatsapp(self) -> None:
        source = (
            "Send two caption examples and tell us why you want the job on WhatsApp."
        )
        classified = classify_application_instructions(source)
        note = compose_public_apply_note(source_text=source)

        # One sentence, two asks. The material half is public, the judgement
        # half is private, and the destination survives in neither.
        assert any("why" in question.lower() for question in classified.screening_questions)
        for question in classified.screening_questions:
            assert "whatsapp" not in question.lower(), question
        assert note is None or "whatsapp" not in note.lower()

    def test_instagram_work_and_availability_requested_by_dm(self) -> None:
        source = "DM your Instagram work and availability."
        result = _converted(source)

        requirements = result.get("application_requirements") or []
        assert "start_availability" in requirements
        note = str(result.get("how_to_apply") or "")
        # The platform is what the recruiter wants to see, and it survives; the
        # instruction to send it by DM does not.
        assert "dm" not in note.lower().split()

    def test_a_form_and_a_showreel(self) -> None:
        source = "Apply through the form and include your showreel."
        result = _converted(source)

        assert "relevant_portfolio" in (result.get("application_requirements") or [])
        note = str(result.get("how_to_apply") or "")
        assert "form" not in note.lower()

    def test_a_cv_platform_links_and_an_open_question(self) -> None:
        source = (
            "Send your CV, links to YouTube work, and answer: what creator "
            "inspires you?"
        )
        classified = classify_application_instructions(source)

        # A CV is a portfolio requirement the form can collect.
        assert "relevant_portfolio" in classified.requirement_keys
        # The platform name is detail the generic key cannot carry, so it has to
        # survive somewhere the candidate will read it.
        surviving = " ".join(classified.unstructured_materials).lower()
        assert "youtube" in surviving or "youtube" in str(
            compose_public_apply_note(source_text=source) or ""
        ).lower()


class TestNothingIsAskedForTwice:
    @pytest.mark.parametrize(
        "source",
        [
            "Please include your portfolio.",
            "Share your showreel and your expected rate.",
            "Send work samples and tell us your availability.",
            "Include your CV and your turnaround time.",
        ],
    )
    def test_a_structured_requirement_is_not_repeated_in_the_note(
        self, source: str
    ) -> None:
        result = _converted(source)
        requirements = result.get("application_requirements") or []
        note = str(result.get("how_to_apply") or "").lower()

        # Whatever the form collects, the note must not ask for again — the
        # candidate would see the same request in two places and reasonably
        # wonder whether two different things were wanted.
        assert requirements
        for word in ("portfolio", "showreel", "expected rate"):
            if any(word.split()[0] in key for key in requirements):
                continue
            assert note.count(word) <= 1

    def test_a_requirement_and_a_question_are_never_the_same_sentence_twice(
        self,
    ) -> None:
        classified = classify_application_instructions(
            "Tell us your expected rate. Why do you want this role?"
        )

        assert "expected_rate" in classified.requirement_keys
        assert len(classified.screening_questions) == 1
        assert "expected rate" not in classified.screening_questions[0].lower()


class TestAStandardDetailIsNeverAScreeningQuestion:
    """The failure the classifier exists to prevent."""

    @pytest.mark.parametrize(
        ("source", "key"),
        [
            ("What is your expected rate?", "expected_rate"),
            ("What is your availability?", "start_availability"),
            ("What tools do you use?", "tools_workflow"),
            ("How many years of experience do you have?", "relevant_experience"),
            ("Upload your portfolio.", "relevant_portfolio"),
            ("List the tools you work in.", "tools_workflow"),
        ],
    )
    def test_a_fact_the_form_models_stays_structured(self, source: str, key: str) -> None:
        classified = classify_application_instructions(source)

        # A question mark is not what decides this. Every applicant has a rate
        # and the form has a box for it.
        assert key in classified.requirement_keys
        assert classified.screening_questions == []

    @pytest.mark.parametrize(
        "source",
        [
            "Why do you want to work with us?",
            "How would you approach our first campaign?",
            "Describe a project you are proud of.",
            "Which Indian pop-culture moment would you turn into a Reel?",
            "Walk us through your editing process.",
            "Explain why you chose those tools.",
        ],
    )
    def test_a_judgement_stays_a_screening_question(self, source: str) -> None:
        classified = classify_application_instructions(source)

        assert classified.screening_questions, source
        assert classified.requirement_keys == [] or "why" in source.lower()


class TestPlatformNamesAreWorkOrDestinationNeverBoth:
    @pytest.mark.parametrize(
        "source",
        [
            "Include your GitHub portfolio and two recent edits.",
            "Share your Instagram reels and YouTube channel links.",
            "Send links to your YouTube and Instagram work.",
            "We need someone with Instagram Reels experience.",
            "Your Behance profile helps.",
        ],
    )
    def test_a_platform_named_as_work_is_kept(self, source: str) -> None:
        assert separate_application_instructions(source).destination == []

    @pytest.mark.parametrize(
        "source",
        [
            "DM us on Instagram to apply.",
            "Apply through LinkedIn.",
            "Submit via Telegram.",
            "WhatsApp us at +91 98765 43210.",
        ],
    )
    def test_the_same_platform_named_as_a_destination_is_removed(
        self, source: str
    ) -> None:
        assert separate_application_instructions(source).destination


class TestNoDestinationEverReachesACandidate:
    @pytest.mark.parametrize(
        "source",
        [
            "Email your CV and showreel to careers@example.com.",
            "Send your portfolio and rate on WhatsApp only.",
            "Apply at https://jobs.example.com/apply with two samples.",
            "Fill out this Google Form and attach your reel.",
            "Message this number with your work.",
        ],
    )
    def test_the_route_is_gone_and_the_materials_remain(self, source: str) -> None:
        result = _converted(source)
        note = str(result.get("how_to_apply") or "").lower()
        requirements = result.get("application_requirements") or []

        for banned in ("whatsapp", "telegram", "google form", "http", "@", "careers page"):
            assert banned not in note, f"{banned!r} survived in {note!r}"

        # The materials are what the candidate actually needs, so the sentence
        # must not be discarded wholesale along with its destination.
        assert requirements or note

    @pytest.mark.parametrize(
        "source",
        [
            "Send everything to our careers page.",
            "Apply using the form below.",
            "Apply now.",
            "Use the link below.",
        ],
    )
    def test_a_sentence_that_is_only_directions_leaves_nothing_behind(
        self, source: str
    ) -> None:
        # "everything" names no material, so there is genuinely nothing to keep.
        # A hollowed-out sentence would read as broken English on a public page,
        # and inventing a requirement to justify keeping one would be worse.
        result = _converted(source)

        assert not result.get("how_to_apply")
        assert not result.get("application_requirements")

    def test_every_import_is_internal_whatever_the_source_said(self) -> None:
        result = JobImportService._safe_application_payload(
            {
                "application_mode": "external",
                "external_apply_url": "https://jobs.example.test/apply",
                "how_to_apply": "Apply on our site.",
            }
        )

        assert result["application_mode"] == "internal"
        assert "external_apply_url" not in result


class TestDeadlinesAreStatedOnceAndNeverInvented:
    def test_a_deadline_is_not_a_field_on_an_imported_job(self) -> None:
        from datetime import UTC, datetime

        result = JobImportService._safe_application_payload(
            {
                "how_to_apply": "Include two recent samples.",
                "deadline_at": datetime(2026, 8, 31, tzinfo=UTC),
            }
        )

        assert "deadline_at" not in result
        assert "31 August 2026" in str(result["how_to_apply"])

    def test_rolling_wording_never_becomes_a_date(self) -> None:
        note = compose_public_apply_note(source_text="Deadline: Rolling — apply early.")

        assert note is None or not any(
            month in note for month in ("January", "August", "December")
        )
