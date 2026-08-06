"""What a candidate must send, kept; where a source said to send it, removed.

The reported defect: an imported page said "Please share the requested
portfolio, samples, personal details, and AI-video confirmation on WhatsApp
only", and CreatorJobs published that sentence whole. Two facts were tangled in
one line — the materials and the destination — and the import layer kept both.

The materials are exactly what a candidate needs. The destination routes them
into a hiring process that is not the one they are standing in, and the platform
cannot follow them there.

The tests that matter most here are the ones proving the removal is not a
blanket ban on platform names. "Links to your YouTube and Instagram work" names
two platforms and neither is a destination; "DM us on Instagram" names one that
is. Getting that wrong in the safe direction still costs a recruiter their
portfolio requirement.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.core.job_application_instructions import (
    contains_external_routing,
    separate_application_instructions,
)
from app.core.job_apply_note import (
    compose_public_apply_note,
    deadline_is_past,
    public_note_for_job,
)


class TestTheReportedSentence:
    SOURCE = (
        "Please share the requested portfolio, samples, personal details, "
        "and AI-video confirmation on WhatsApp only."
    )

    def test_the_materials_survive_and_whatsapp_does_not(self) -> None:
        note = compose_public_apply_note(source_text=self.SOURCE)

        assert note is not None
        for material in ("portfolio", "samples", "personal details", "AI-video confirmation"):
            assert material in note
        assert "whatsapp" not in note.lower()
        assert "CreatorJobs application" in note

    def test_the_destination_is_kept_privately_rather_than_lost(self) -> None:
        separated = separate_application_instructions(self.SOURCE)

        # Retained for import diagnostics and evidence. It has no path to a
        # candidate-facing field, which is why it is separated rather than
        # edited in place.
        assert any("whatsapp" in item.lower() for item in separated.destination)
        assert separated.sanitized


class TestDestinationsInEveryShapeSourcesUse:
    @pytest.mark.parametrize(
        "source",
        [
            "Email your CV to careers@example.com.",
            "WhatsApp us at +91 98765 43210.",
            "Submit via Telegram.",
            "DM us on Instagram to apply.",
            "Apply through LinkedIn.",
            "Fill out this Google Form.",
            "Apply at https://jobs.example.com/apply.",
            "Send your portfolio to our careers page.",
            "Message this number to apply.",
        ],
    )
    def test_no_note_ever_carries_the_destination(self, source: str) -> None:
        note = compose_public_apply_note(source_text=source)

        if note is None:
            return
        lowered = note.lower()
        for banned in ("whatsapp", "telegram", "@", "http", "google form", "linkedin"):
            assert banned not in lowered, note

    def test_a_sentence_that_is_only_routing_produces_no_note(self) -> None:
        # Nothing was asked for, so there is nothing to say. A hollowed-out
        # sentence would read as broken English on a public page.
        assert compose_public_apply_note(source_text="Apply using the form below.") is None

    def test_materials_survive_a_destination_in_the_same_sentence(self) -> None:
        note = compose_public_apply_note(source_text="Email your CV and showreel to careers@example.com.")

        assert note == "Please include your CV and showreel with your CreatorJobs application."


class TestPlatformNamesThatDescribeWork:
    """A blanket ban would strip the requirement along with the routing."""

    def test_portfolio_platforms_survive(self) -> None:
        note = compose_public_apply_note(
            source_text="Send links to your YouTube and Instagram work by email."
        )

        assert note is not None
        assert "YouTube" in note and "Instagram" in note
        assert "email" not in note.lower()

    @pytest.mark.parametrize(
        "source",
        [
            "Include your GitHub portfolio and two recent edits.",
            "Share your Instagram reels and YouTube channel links.",
            "We need someone with Instagram Reels experience.",
        ],
    )
    def test_a_platform_named_as_work_is_never_treated_as_a_destination(
        self, source: str
    ) -> None:
        assert separate_application_instructions(source).destination == []

    def test_the_same_platform_named_as_a_destination_is_removed(self) -> None:
        separated = separate_application_instructions("DM us on Instagram to apply.")

        assert separated.destination


class TestDeadlinesBecomeASentence:
    def test_an_exact_date_is_appended(self) -> None:
        note = compose_public_apply_note(
            source_text="Include two recent samples.",
            deadline=datetime(2026, 8, 31, tzinfo=UTC),
        )

        assert note is not None
        assert "Applications close on 31 August 2026." in note

    def test_a_stated_time_is_kept_because_it_changes_the_promise(self) -> None:
        note = compose_public_apply_note(deadline=datetime(2026, 8, 31, 17, 0, tzinfo=UTC))

        assert note is not None
        assert "5:00 PM" in note and "31 August 2026" in note

    def test_a_deadline_is_never_stated_twice(self) -> None:
        already = "Please include two samples. Applications close on 31 August 2026."
        note = public_note_for_job(
            stored_note=already, stored_deadline=datetime(2026, 8, 31, tzinfo=UTC)
        )

        assert note is not None
        assert note.count("31 August 2026") == 1

    def test_an_expired_deadline_is_recognised_rather_than_published_as_current(self) -> None:
        assert deadline_is_past(
            datetime(2020, 1, 1, tzinfo=UTC), now=datetime(2026, 8, 6, tzinfo=UTC)
        )
        assert not deadline_is_past(
            datetime(2030, 1, 1, tzinfo=UTC), now=datetime(2026, 8, 6, tzinfo=UTC)
        )

    def test_nothing_invents_a_deadline(self) -> None:
        note = compose_public_apply_note(source_text="Apply soon, we are hiring quickly.")

        assert note is None or not any(
            month in note for month in ("January", "August", "December")
        )


class TestHistoricalRowsAreMadeSafeOnTheWayOut:
    """Old notes were written before routing was policed. They still render."""

    def test_a_stored_note_with_a_destination_is_sanitised_for_display(self) -> None:
        note = public_note_for_job(
            stored_note="Send your portfolio to hiring@old.example and include a rate."
        )

        assert note is None or "@" not in note

    def test_a_historical_deadline_reaches_the_note_rather_than_a_field(self) -> None:
        note = public_note_for_job(
            stored_note="Please include two samples.",
            stored_deadline=datetime(2026, 12, 1, tzinfo=UTC),
        )

        assert note is not None
        assert "1 December 2026" in note

    def test_an_empty_history_stays_empty(self) -> None:
        assert public_note_for_job(stored_note=None) is None


class TestRecruiterProseIsWarnedAboutRatherThanRewritten:
    @pytest.mark.parametrize(
        "note",
        [
            "Email your CV to me at hiring@studio.example.",
            "WhatsApp me on +91 90000 00000.",
            "Apply through our careers page.",
        ],
    )
    def test_routing_is_detected(self, note: str) -> None:
        assert contains_external_routing(note) is not None

    @pytest.mark.parametrize(
        "note",
        [
            "Include two recent samples and a short note about your approach.",
            "Tell us your expected rate and weekly availability.",
            "Share links to your YouTube work.",
        ],
    )
    def test_a_safe_note_passes_untouched(self, note: str) -> None:
        assert contains_external_routing(note) is None
        assert compose_public_apply_note(recruiter_note=note) == note


class TestTheImportPipelineActuallyCallsThis:
    """The wiring, not just the parts.

    The sanitizer existed and was correct for a while before anything invoked
    it, which meant a real import still published the WhatsApp sentence. These
    pin the connection at the conversion boundary every import passes through.
    """

    @staticmethod
    def _convert(payload: dict[str, object]) -> dict[str, object]:
        from app.services.job_import_service import JobImportService

        return JobImportService._safe_application_payload(dict(payload))

    def test_the_reported_source_becomes_a_safe_note_on_conversion(self) -> None:
        result = self._convert(
            {
                "how_to_apply": (
                    "Please share the requested portfolio, samples, personal "
                    "details, and AI-video confirmation on WhatsApp only."
                )
            }
        )

        note = str(result["how_to_apply"])
        assert "whatsapp" not in note.lower()
        assert "portfolio" in note and "AI-video confirmation" in note

    def test_an_imported_external_route_never_survives_conversion(self) -> None:
        result = self._convert(
            {
                "application_mode": "external",
                "external_apply_url": "https://jobs.example.test/apply",
            }
        )

        assert result["application_mode"] == "internal"
        assert "external_apply_url" not in result

    def test_an_imported_deadline_becomes_note_text_not_a_field(self) -> None:
        result = self._convert(
            {
                "how_to_apply": "Include two recent samples.",
                "deadline_at": datetime(2026, 8, 31, tzinfo=UTC),
            }
        )

        assert "deadline_at" not in result
        assert "Applications close on 31 August 2026." in str(result["how_to_apply"])

    def test_a_source_that_only_routes_leaves_no_note_behind(self) -> None:
        result = self._convert({"how_to_apply": "Apply using the form below."})

        assert "how_to_apply" not in result
        assert result["application_mode"] == "internal"
