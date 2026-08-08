"""Portfolio context decided by grammar, so the word list is no longer load-bearing.

Three high-impact decisions used to consult a curated set of work nouns: whether
a platform beside a preposition is the candidate's own work or somewhere to send
an application, and whether a fragment naming a platform is material worth
keeping. One direction publishes a routing destination; the other deletes what a
recruiter asked for. Neither is a good thing to decide by dictionary lookup when
the category is open.

Generating the sentences from meaning rather than from the product's vocabulary
found two real failures. "Reach out on YouTube with your portfolio" was read as
portfolio context on 61 cases, because a work noun fifteen characters later
belonged to a different prepositional phrase entirely — so the destination was
protected. And "You will build a portfolio of finished pieces for the brand" was
converted into an application requirement on 22 cases: a responsibility the
recruiter wrote, deleted and replaced with a demand.

The last test in this file is the one that matters most. It empties the curated
vocabulary completely and re-measures. Every metric stays at zero, which is the
only way to show that the list improves recall rather than carrying the
invariant.
"""

from __future__ import annotations

import re

import pytest

import app.core.job_application_instructions as instructions
from app.services.job_import_service import JobImportService
from tests.import_portfolio_vocabulary import (
    ALL_CASES,
    contrastive_pairs,
    destination_cases,
    ordinary_cases,
    portfolio_cases,
    skill_cases,
)

PORTFOLIO = portfolio_cases()
DESTINATIONS = destination_cases()
SKILLS = skill_cases()
ORDINARY = ordinary_cases()
PAIRS = contrastive_pairs()


def _payload(text: str) -> tuple[str, list[str]]:
    result = JobImportService._safe_application_payload({"how_to_apply": text})
    return str(result.get("how_to_apply") or ""), result.get("application_requirements") or []


def _material_survived(case) -> bool:
    """Kept in the note, or promoted to a structured requirement. Either counts."""

    note, requirements = _payload(case.text)
    return bool(case.platform.lower() in note.lower() or requirements)


def _destination_removed(case) -> bool:
    note, _requirements = _payload(case.text)
    return not re.search(rf"\b{re.escape(case.platform.lower())}\b", note.lower())


class TestTheGeneratedCorpusIsWorthTrusting:
    def test_it_is_large_and_mostly_unlisted(self) -> None:
        assert len(ALL_CASES) >= 5000, len(ALL_CASES)
        assert len(PAIRS) >= 2000, len(PAIRS)

        # Invented platforms and invented work nouns are the open-world half.
        # If the corpus stopped containing them it would be testing the list.
        invented_platforms = {"Zephyrgram", "Larkfeed", "Corvid", "Nimbusreel", "Quillstream"}
        assert invented_platforms <= {case.platform for case in PORTFOLIO if case.platform}

        listed = {noun.casefold() for noun in instructions._PORTFOLIO_CONTEXT}
        nouns = {case.noun.casefold() for case in PORTFOLIO if case.noun}
        assert len(nouns - listed) >= 10, sorted(nouns - listed)


class TestPortfolioMaterialAlwaysSurvives:
    @pytest.mark.parametrize("chunk", range(10))
    def test_a_generated_portfolio_request_keeps_its_material(self, chunk: int) -> None:
        for case in PORTFOLIO[chunk::10]:
            assert _material_survived(case), (
                f"{case.text!r} lost its material: {_payload(case.text)}"
            )

    def test_an_invented_platform_and_noun_still_read_as_material(self) -> None:
        # Nothing anywhere has heard of either word. The frame is what says
        # this is the candidate's own work.
        note, requirements = _payload("Include links to your Zephyrgram sizzle reel.")

        assert "zephyrgram" in note.lower() or requirements, (note, requirements)


class TestRoutingIsAlwaysRemoved:
    @pytest.mark.parametrize("chunk", range(8))
    def test_a_generated_routing_instruction_loses_its_destination(
        self, chunk: int
    ) -> None:
        for case in DESTINATIONS[chunk::8]:
            assert _destination_removed(case), (
                f"{case.text!r} published its destination: {_payload(case.text)}"
            )

    def test_a_work_noun_in_a_later_phrase_does_not_protect_a_destination(self) -> None:
        # The defect this found: the noun belongs to "with your portfolio", not
        # to "on YouTube", and reading it as portfolio context protected the
        # destination on sixty-one generated cases.
        note, requirements = _payload("Reach out on YouTube with your portfolio.")

        assert "youtube" not in note.lower(), note
        assert "relevant_portfolio" in requirements


class TestLegitimateContentIsNeverDeleted:
    @pytest.mark.parametrize("chunk", range(4))
    def test_a_job_responsibility_keeps_its_platform(self, chunk: int) -> None:
        for case in SKILLS[chunk::4]:
            note, _requirements = _payload(case.text)
            assert case.platform.lower() in note.lower(), (
                f"{case.text!r} lost its platform: {note!r}"
            )

    @pytest.mark.parametrize("chunk", range(4))
    def test_ordinary_job_content_is_not_turned_into_a_requirement(
        self, chunk: int
    ) -> None:
        for case in ORDINARY[chunk::4]:
            note, _requirements = _payload(case.text)
            assert case.noun.split()[-1].lower() in note.lower(), (
                f"{case.text!r} was deleted: {note!r}"
            )

    def test_a_responsibility_is_not_read_as_a_request(self) -> None:
        # "You will build a portfolio" describes the job. Reading it as a
        # request replaced a recruiter's own description with a demand for a
        # portfolio on twenty-two generated cases.
        note, requirements = _payload(
            "You will build a portfolio of finished pieces for the brand."
        )

        assert "portfolio" in note.lower()
        assert requirements == []


class TestTheSamePlatformInBothReadings:
    @pytest.mark.parametrize("chunk", range(10))
    def test_a_contrastive_pair_gets_both_halves_right(self, chunk: int) -> None:
        # The sharpest form of the test: the platform is identical in both
        # halves, so any rule that gets both right cannot be keying on it.
        for keep, strip in PAIRS[chunk::10]:
            assert _material_survived(keep), f"kept half failed: {keep.text!r}"
            assert _destination_removed(strip), f"stripped half failed: {strip.text!r}"


class TestTheWordListIsNoLongerLoadBearing:
    """Emptied entirely, and every invariant still holds.

    This is the whole point of the change. A list is a fine way to improve
    recall; it is not an acceptable sole defence for a decision that either
    publishes a routing destination or deletes a recruiter's requirement.
    """

    @pytest.fixture
    def without_vocabulary(self):
        original = instructions._PORTFOLIO_CONTEXT
        yield lambda value: setattr(instructions, "_PORTFOLIO_CONTEXT", value)
        instructions._PORTFOLIO_CONTEXT = original

    @pytest.mark.parametrize(
        ("label", "keep"),
        [("25% removed", 0.75), ("50% removed", 0.5), ("one word", 0.0), ("empty", -1.0)],
    )
    def test_deleting_the_vocabulary_changes_nothing(
        self, without_vocabulary, label: str, keep: float
    ) -> None:
        original = instructions._PORTFOLIO_CONTEXT
        if keep < 0:
            reduced: tuple[str, ...] = ()
        elif keep == 0.0:
            reduced = ("work",)
        else:
            reduced = original[: int(len(original) * keep)]
        without_vocabulary(reduced)

        # A representative slice rather than all 5,472, four times over — the
        # full corpus runs in the tests above and this measures dependence.
        sample_portfolio = PORTFOLIO[::20]
        sample_destinations = DESTINATIONS[::10]
        sample_skills = SKILLS

        lost = [case for case in sample_portfolio if not _material_survived(case)]
        leaked = [case for case in sample_destinations if not _destination_removed(case)]
        deleted = [
            case
            for case in sample_skills
            if case.platform.lower() not in _payload(case.text)[0].lower()
        ]

        assert lost == [], f"{label}: material lost {[c.text for c in lost[:3]]}"
        assert leaked == [], f"{label}: routes leaked {[c.text for c in leaked[:3]]}"
        assert deleted == [], f"{label}: context deleted {[c.text for c in deleted[:3]]}"
