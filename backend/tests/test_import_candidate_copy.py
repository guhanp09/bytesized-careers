"""A CreatorJobs listing is the job, not a commentary on somebody else's page.

A candidate opened a listing and read:

    ₹22,000+ per month · The post also states: From ₹22,000.00 per month.

That sentence exists nowhere in this repository. The model wrote it into
``budget_note``, which is free text with no contract about who reads it, and the
candidate renderer joined it to the figure. Two faults: the listing described
where it came from, and then said the same thing twice.

The rule this file pins is narrow and deliberately so. Import-generated copy is
cleaned on the import path, before a recruiter has seen the draft. Recruiter
prose is never touched — someone who writes "mentioned in our last post" has
written job copy, and rewriting that would be a worse defect than the one being
fixed. So the negative cases here matter as much as the positive ones.
"""

from __future__ import annotations

import pytest

from app.core.job_import_candidate_copy import (
    candidate_compensation_note,
    candidate_native_copy,
    strip_source_framing,
)

FLOOR = {"budget_amount": 22000, "budget_max": None}
CEILING = {"budget_amount": None, "budget_max": 20000}
RANGE = {"budget_amount": 15000, "budget_max": 20000}


class TestProvenanceFramingNeverReachesACandidate:
    @pytest.mark.parametrize(
        "note",
        [
            "The post also states: From ₹22,000.00 per month.",
            "The listing says: ₹22,000 per month",
            "This posting states ₹22,000 per month",
            "According to the original listing, ₹22,000 per month",
            "As per the job post: ₹22,000 per month",
            "Source: ₹22,000 per month",
            "The original post mentions ₹22,000 per month",
            "The employer's listing states ₹22,000 per month",
        ],
    )
    def test_framing_plus_a_restatement_is_dropped_entirely(self, note: str) -> None:
        # Framing removed, and what is left only repeats the figure the listing
        # already shows — so there is nothing for a candidate to read.
        assert candidate_compensation_note(note, FLOOR) is None, note

    @pytest.mark.parametrize(
        ("note", "kept"),
        [
            (
                "The post also states: Performance bonus after probation.",
                "Performance bonus after probation.",
            ),
            ("The listing says: Bonus paid quarterly", "Bonus paid quarterly"),
            ("Listing states: negotiable for the right person", "negotiable for the right person"),
        ],
    )
    def test_framing_is_removed_and_real_content_survives(
        self, note: str, kept: str
    ) -> None:
        # The fault is the framing, not what it introduces.
        assert candidate_compensation_note(note, FLOOR) == kept


class TestRecruiterProseIsNotCorrupted:
    """The rule that keeps the fix honest."""

    @pytest.mark.parametrize(
        "prose",
        [
            "Mentioned in our last post on Instagram",
            "Posted rates are negotiable",
            "Notes on pay: bonus available",
            "Page one of our brand story explains the rate",
            "Advertising experience is a plus",
            "Sourcing your own footage is not required",
            "Performance bonus after probation",
            "Rate reviewed after three months",
        ],
    )
    def test_ordinary_copy_is_returned_untouched(self, prose: str) -> None:
        # Every one of these begins with a word the framing grammar knows.
        # Stripping any of them would silently rewrite what a recruiter wrote.
        assert strip_source_framing(prose) == prose, prose


class TestOneFactIsShownOnce:
    @pytest.mark.parametrize(
        ("note", "payload"),
        [
            ("From ₹22,000.00 per month", FLOOR),
            ("From ₹22,000 per month", FLOOR),
            ("Up to ₹20,000 a month", CEILING),
            ("₹15,000 - ₹20,000 per month", RANGE),
        ],
    )
    def test_a_note_restating_the_structured_fact_is_suppressed(
        self, note: str, payload: dict[str, object]
    ) -> None:
        assert candidate_compensation_note(note, payload) is None, note

    @pytest.mark.parametrize(
        "note",
        [
            "Performance bonus after probation",
            "Commission on top of the base rate",
            "Up to ₹30,000 for senior candidates",
            "Rate reviewed after three months",
            "Negotiable for exceptional portfolios",
        ],
    )
    def test_genuinely_additional_information_is_preserved(self, note: str) -> None:
        # Losing a bonus or a second rate would be a worse defect than the
        # duplication this suppression exists to remove.
        assert candidate_compensation_note(note, FLOOR) == note, note

    def test_a_note_about_a_different_figure_is_not_a_restatement(self) -> None:
        assert (
            candidate_compensation_note("From ₹40,000 per month", FLOOR)
            == "From ₹40,000 per month"
        )


class TestTheDraftPayloadBoundary:
    def test_the_reported_payload_reaches_a_candidate_clean(self) -> None:
        cleaned = candidate_native_copy(
            {
                "budget_amount": 22000,
                "budget_max": None,
                "compensation_mode": "range",
                "budget_currency": "INR",
                "budget_unit": "per month",
                "budget_note": "The post also states: From ₹22,000.00 per month.",
            }
        )

        assert "budget_note" not in cleaned
        # The structured fact is untouched — the qualified-fact architecture is
        # what owns the presentation, and suppression must never reach it.
        assert cleaned["budget_amount"] == 22000
        assert cleaned["compensation_mode"] == "range"

    def test_prose_fields_lose_framing_but_keep_their_content(self) -> None:
        cleaned = candidate_native_copy(
            {
                "about_channel": "The listing says: A finance channel for new investors.",
                "how_to_apply": "According to the post, include two recent edits.",
            }
        )

        assert cleaned["about_channel"] == "A finance channel for new investors."
        assert cleaned["how_to_apply"] == "include two recent edits."

    def test_a_field_that_is_only_framing_is_removed(self) -> None:
        cleaned = candidate_native_copy({"budget_note": "The post also states:"})

        assert "budget_note" not in cleaned

    def test_nothing_else_in_the_payload_is_disturbed(self) -> None:
        payload = {
            "title": "Freelance Video Editor",
            "responsibilities": ["Edit reels each week."],
            "screening_questions": [{"prompt": "Which edit would you change?"}],
            "budget_amount": 22000,
        }

        assert candidate_native_copy(dict(payload)) == payload
