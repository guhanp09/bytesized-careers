"""Experience, checked by containment rather than by equality.

A source that says "25 years" once reached the draft as "5–8 years". Nobody
intended that; a banding step existed and 25 fell outside every band, so it was
placed in the nearest one. The recruiter was shown a closed range that cannot
contain the number the page printed.

Equality tests would not have caught the general case, because for most inputs
banding produces something plausible. Containment does: whatever the native
representation is, it must not commit the job to a bound the source never stated.
"5+" has a floor and no ceiling. "up to 5" has a ceiling and no floor. "senior"
has neither, and any number attached to it is invented.

So each generated case carries the bounds its text actually states, and the
assertion is about what the stored value would let a reader conclude.
"""

from __future__ import annotations

import re

import pytest

from app.core.job_import_native_values import convert_to_native
from tests.import_generators import experience_cases

CASES = experience_cases()


def _numbers_in(value: object) -> list[float]:
    return [float(match) for match in re.findall(r"\d+(?:\.\d+)?", str(value or ""))]


class TestNothingIsNarrowed:
    @pytest.mark.parametrize("case", CASES, ids=lambda case: case.recipe)
    def test_the_stored_value_states_no_bound_the_source_did_not(self, case) -> None:
        conversion = convert_to_native("experience_level", case.text)

        if conversion.native_value in (None, ""):
            # Declining to store is always safe: nothing false is claimed.
            return

        stored = str(conversion.native_value)
        numbers = _numbers_in(stored)

        # An open-ended source must not gain a ceiling. This is the "25 years
        # became 5–8" defect stated as a property: the stored value may not
        # introduce a second bound the source never wrote.
        if case.ceiling is None and case.floor is not None:
            assert not re.search(r"\d+\s*(?:-|–|to)\s*\d+", stored), (
                f"{case.recipe}: open-ended {case.text!r} became a closed "
                f"range {stored!r}"
            )

        # A source with no number at all must not acquire one.
        if case.floor is None and case.ceiling is None:
            assert not numbers, (
                f"{case.recipe}: {case.text!r} states no number, stored {stored!r}"
            )

        # Whatever numbers survive must be numbers the source actually wrote.
        source_numbers = set(_numbers_in(case.text))
        for number in numbers:
            assert number in source_numbers, (
                f"{case.recipe}: {stored!r} contains {number}, which "
                f"{case.text!r} never states"
            )

    def test_the_generated_corpus_is_large_enough_to_be_worth_trusting(self) -> None:
        assert len(CASES) >= 300
        assert any(case.ceiling is None and case.floor is not None for case in CASES)
        assert any(case.ceiling is not None and case.floor is None for case in CASES)
        assert any(case.floor is None and case.ceiling is None for case in CASES)


class TestTheReportedCasesByName:
    """Pinned individually, because each cost a real recruiter interruption."""

    @pytest.mark.parametrize(
        "text",
        [
            "25 years",
            "At least 25 years of professional experience",
            "25 years of professional experience",
        ],
    )
    def test_twenty_five_years_never_becomes_five_to_eight(self, text: str) -> None:
        stored = str(convert_to_native("experience_level", text).native_value or "")

        assert "5-8" not in stored and "5–8" not in stored
        assert stored == "" or "25" in stored

    def test_at_least_sixty_months_gains_no_ceiling(self) -> None:
        stored = str(
            convert_to_native("experience_level", "At least 60 months").native_value or ""
        )

        assert not re.search(r"\d+\s*(?:-|–|to)\s*\d+", stored)

    @pytest.mark.parametrize(
        "word", ["senior", "junior", "entry-level", "fresher", "expert", "lead"]
    )
    def test_a_seniority_word_never_becomes_a_number_of_years(self, word: str) -> None:
        # Qualitative seniority means different spans at different companies.
        # Turning it into years states a fact the page never did.
        stored = str(convert_to_native("experience_level", word).native_value or "")

        assert not _numbers_in(stored), f"{word!r} -> {stored!r}"


class TestBoundaryLengths:
    def test_a_value_too_long_for_the_column_is_declined_not_truncated(self) -> None:
        # Truncating "at least 25 years of post-production experience across…"
        # to a column width could cut it mid-claim and change what it says.
        long_value = "At least 25 years of " + ("professional " * 20) + "experience"
        conversion = convert_to_native("experience_level", long_value)

        assert conversion.native_value in (None, "") or conversion.native_value == long_value

    @pytest.mark.parametrize("text", ["", "   ", "\t\n"])
    def test_blank_wording_states_nothing(self, text: str) -> None:
        stored = convert_to_native("experience_level", text).native_value

        assert stored in (None, "")
