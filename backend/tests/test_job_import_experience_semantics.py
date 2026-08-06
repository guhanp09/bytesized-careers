"""Experience: what the source said, and nothing the source did not say.

Two separate ways of inventing a fact were found here, and neither looked like
invention at the time.

The first was arithmetic. A stated "25 years" was mapped into "5–8 years" so it
would fit a set of four bands — bands that turned out to be a *question's*
option list rather than the field's domain. That is fixed and pinned in
test_job_import_semantic_containment.

The second is vocabulary, and it is this file's subject. A title reading "Senior
Video Editor" produced "5–8 years", from a table mapping seniority adjectives to
year ranges. Nothing in the source said five, or eight. "Senior" is a judgement
about scope and independence, and studios mean wildly different spans by it — so
publishing a numeric range from it states a requirement the recruiter never
made, and a candidate with nine years reads themselves out of a job they were
wanted for.

The distinction the tests draw is between a word that *describes a person* and a
phrase that *states a quantity*. "Senior" is the former and yields no number.
"No prior experience" is the latter — it says the required amount is none — and
is allowed to settle the field, because it answers the question rather than
labelling the answerer.
"""

from __future__ import annotations

import pytest

from app.core.job_import_body_sections import experience_from_body
from app.core.job_import_native_values import convert_to_native
from app.core.job_import_title_signals import title_signals


def stated_experience(title: str) -> str | None:
    signals = title_signals(title)
    value = signals.settled.get("experience_level") or signals.suggested.get(
        "experience_level"
    )
    return value if isinstance(value, str) else None


class TestSeniorityWordsNeverBecomeYears:
    @pytest.mark.parametrize(
        "title",
        [
            "Senior Video Editor",
            "Junior Video Editor",
            "Mid level Animator",
            "Mid-level Motion Designer",
            "Experienced editor for a weekly show",
            "Expert motion designer",
            "Seasoned scriptwriter",
            "Entry level video editor",
            "Lead Video Editor",
        ],
    )
    def test_a_word_about_the_person_states_no_quantity(self, title: str) -> None:
        assert stated_experience(title) is None

    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("Senior Video Editor with 7+ years", "7+ years"),
            ("Junior Animator, 1-3 years experience", "1–3 years"),
            ("Lead editor at least 8 years", "At least 8 years"),
        ],
    )
    def test_a_number_beside_the_word_is_still_read(
        self, title: str, expected: str
    ) -> None:
        # The adjective contributes nothing; the figure contributes everything.
        assert stated_experience(title) == expected

    def test_seniority_survives_where_it_belongs(self) -> None:
        # Removing the inference does not lose the word: it is in the title,
        # which the listing keeps verbatim, and the recruiter can add years in
        # the editor if they want them.
        assert title_signals("Senior Video Editor").settled.get("title") is None
        assert convert_to_native("title", "Senior Video Editor").native_value == (
            "Senior Video Editor"
        )


class TestAnExplicitAbsenceOfExperienceIsAQuantity:
    """"No experience required" answers the question rather than labelling."""

    @pytest.mark.parametrize(
        "title",
        [
            "Fresher video editor",
            "Video editor - no experience required",
            "Editor, no prior experience needed",
        ],
    )
    def test_it_settles_the_field(self, title: str) -> None:
        assert stated_experience(title) == "No prior experience required"

    def test_it_reaches_the_draft_as_written(self) -> None:
        conversion = convert_to_native("experience_level", "No prior experience required")

        assert conversion.native_value == "No prior experience required"
        assert conversion.outcome == "exact"


class TestAStatedFloorKeepsItsQualifier:
    """"At least five years" is not "five years"."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("at least 5 years experience", "At least 5 years"),
            ("Minimum 5 years of hands-on experience", "Minimum 5 years"),
            ("2-4 years experience", "2–4 years"),
            ("1+ years of relevant work experience", "1+ years"),
            ("25 years of professional experience", "25 years"),
        ],
    )
    def test_the_body_reader_keeps_the_words_in_front(
        self, text: str, expected: str
    ) -> None:
        assert experience_from_body(text) == expected

    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("Editor at least 5 years", "At least 5 years"),
            ("Editor minimum 3 years", "Minimum 3 years"),
        ],
    )
    def test_the_title_reader_does_too(self, title: str, expected: str) -> None:
        assert stated_experience(title) == expected


class TestEveryWordingReachesTheDraftUnchanged:
    """The full table, end to end through the conversion chokepoint."""

    @pytest.mark.parametrize(
        "stated",
        [
            "0–1 years",
            "2–5 years",
            "5–8 years",
            "9 years",
            "10+ years",
            "25 years",
            "At least 7 years",
            "Up to 5 years",
            "Experience preferred",
            "No prior experience required",
        ],
    )
    def test_it_is_stored_exactly(self, stated: str) -> None:
        conversion = convert_to_native("experience_level", stated)

        assert conversion.native_value == stated
        assert conversion.outcome == "exact"
        assert conversion.contains_source

    @pytest.mark.parametrize("stated", ["9 years", "10+ years", "25 years"])
    def test_nothing_is_squeezed_into_the_senior_band(self, stated: str) -> None:
        assert convert_to_native("experience_level", stated).native_value != "5–8 years"

    def test_clearing_the_field_clears_it(self) -> None:
        assert convert_to_native("experience_level", "").native_value == ""
