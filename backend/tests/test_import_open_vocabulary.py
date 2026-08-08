"""Routing decided by grammar, so an unseen platform is still a destination.

Three curated lists used to decide this: which words name a channel, which
describe a candidate's own work, which headings mean a page has moved on to
other jobs. Each held about thirty entries and was consulted by exact
membership, and membership cannot decide both directions of an open category.

Generating the vocabulary instead of curating it made the cost exact. Of 616
genuine routing sentences written with platforms nobody had typed in — Skype,
Teams, Jotform, Insta, Google Chat — **144 leaked a destination into a public
note**. Of 600 legitimate sentences that merely mentioned a platform, **63 lost
it**: "Run paid campaigns on WhatsApp" became "Run paid campaigns", and a
recruiter's own responsibility lost the only detail that made it specific.

Both directions are now decided by what the sentence is doing rather than by
which words it contains. A destination needs a verb that sends, a preposition,
and an object that names a place. "Send your portfolio on WhatsApp" has all
three; "Run paid campaigns on WhatsApp" has the same platform and no verb that
sends anything.

The false-positive half matters as much as the leak half. Over-removal is not a
safe direction to fail in — it silently edits what a recruiter wrote.
"""

from __future__ import annotations

import re

import pytest

from app.services.job_import_service import JobImportService
from tests.import_vocabulary import (
    PLATFORMS,
    PORTALS,
    portfolio_sentences,
    routing_sentences,
    skill_sentences,
)

ROUTING = routing_sentences()
SKILLS = skill_sentences()
PORTFOLIO = portfolio_sentences()


def _note(text: str) -> str:
    payload = JobImportService._safe_application_payload({"how_to_apply": text})
    return str(payload.get("how_to_apply") or "")


def _subject(sentence) -> str:
    return (
        sentence.subject.lower()
        .removeprefix("a ")
        .removeprefix("an ")
        .removeprefix("the ")
    )


class TestTheGeneratedVocabularyIsWorthTrusting:
    def test_the_corpus_is_large_and_mostly_unlisted(self) -> None:
        from app.core.job_application_instructions import _CHANNELS

        assert len(ROUTING) + len(SKILLS) + len(PORTFOLIO) >= 1200

        listed = {name.casefold() for name in _CHANNELS}
        unlisted = [
            platform for platform in PLATFORMS if platform.casefold() not in listed
        ]
        # The point of the corpus: most of it is vocabulary the product has
        # never been told about. If that stopped being true the suite would be
        # testing the list rather than the architecture.
        assert len(unlisted) >= 15, unlisted

    def test_both_readings_of_every_platform_are_generated(self) -> None:
        routed = {sentence.subject for sentence in ROUTING}
        described = {sentence.subject for sentence in SKILLS}

        assert set(PLATFORMS) <= routed
        assert set(PLATFORMS) <= described
        assert set(PORTALS) <= routed


class TestNoRoutingDestinationEverReachesACandidate:
    @pytest.mark.parametrize("chunk", range(8))
    def test_a_generated_routing_instruction_loses_its_destination(
        self, chunk: int
    ) -> None:
        for sentence in ROUTING[chunk::8]:
            note = _note(sentence.text).lower()
            subject = _subject(sentence)

            assert not re.search(rf"\b{re.escape(subject)}\b", note), (
                f"{sentence.text!r} published its destination: {note!r}"
            )

    #: What the application form collects for each thing a source can ask for.
    #:
    #: A material may survive either in the note or as a structured
    #: requirement — both reach the candidate, and the structured one reaches
    #: them better. Only vanishing from both is a loss.
    REQUIREMENT_FOR = {
        "portfolio": "relevant_portfolio",
        "showreel": "relevant_portfolio",
        "reel": "relevant_portfolio",
        "cv": "relevant_portfolio",
        "resume": "relevant_portfolio",
        "work": "relevant_portfolio",
        "samples": "relevant_portfolio",
        "studies": "relevant_portfolio",
        "examples": "relevant_portfolio",
        "edits": "relevant_portfolio",
        "rate": "expected_rate",
        "availability": "start_availability",
    }

    @pytest.mark.parametrize("chunk", range(8))
    def test_the_material_survives_its_destination_being_removed(
        self, chunk: int
    ) -> None:
        for sentence in ROUTING[chunk::8]:
            if not sentence.material:
                continue
            payload = JobImportService._safe_application_payload(
                {"how_to_apply": sentence.text}
            )
            note = str(payload.get("how_to_apply") or "").lower()
            requirements = payload.get("application_requirements") or []
            head = sentence.material.split()[-1].lower()

            # Removing where to send it must not remove what to send. An
            # earlier version of this test skipped cases where the note came
            # back empty — which is exactly where the losses were, so it
            # reported zero while nineteen requirements were being discarded.
            assert head in note or self.REQUIREMENT_FOR.get(head) in requirements, (
                f"{sentence.text!r} lost {sentence.material!r}: "
                f"note={note!r} requirements={requirements}"
            )


class TestLegitimatePlatformMentionsSurvive:
    @pytest.mark.parametrize("chunk", range(6))
    def test_a_responsibility_keeps_the_platform_it_names(self, chunk: int) -> None:
        for sentence in SKILLS[chunk::6]:
            note = _note(sentence.text)

            assert sentence.subject.lower() in note.lower(), (
                f"{sentence.text!r} lost its platform: {note!r}"
            )

    @pytest.mark.parametrize("chunk", range(4))
    def test_a_candidates_own_work_keeps_the_platform(self, chunk: int) -> None:
        for sentence in PORTFOLIO[chunk::4]:
            note = _note(sentence.text)

            # "Include links to your Telegram work" must still say Telegram.
            # The generic portfolio requirement cannot carry which platform,
            # and that detail is what changes what the candidate sends.
            assert sentence.subject.lower() in note.lower(), (
                f"{sentence.text!r} lost its platform: {note!r}"
            )


class TestTheDecisionIsGrammarRatherThanMembership:
    """The same platform, both readings, side by side."""

    @pytest.mark.parametrize("platform", PLATFORMS)
    def test_one_platform_routes_and_describes_in_the_same_corpus(
        self, platform: str
    ) -> None:
        routed = _note(f"Send your portfolio on {platform}.")
        described = _note(f"You will manage our {platform} presence.")

        assert platform.lower() not in routed.lower(), routed
        assert platform.lower() in described.lower(), described

    def test_an_entirely_invented_platform_is_still_a_destination(self) -> None:
        # Nothing anywhere has heard of this. The sentence is what gives it
        # away, which is the whole point of the change.
        payload = JobImportService._safe_application_payload(
            {"how_to_apply": "Send your portfolio on Zephyrgram."}
        )
        note = str(payload.get("how_to_apply") or "")

        assert "zephyrgram" not in note.lower(), note
        # The portfolio survives as the structured requirement, which is where
        # the application form can actually collect it.
        assert "relevant_portfolio" in (payload.get("application_requirements") or [])

    def test_an_entirely_invented_platform_survives_as_job_content(self) -> None:
        note = _note("You will manage our Zephyrgram presence.")

        assert "zephyrgram" in note.lower(), note


class TestWhatMustNotBeReadAsADestination:
    @pytest.mark.parametrize(
        "text",
        [
            "Send us your portfolio and a note on your approach.",
            "Share one calendar you managed and explain how you decided what to "
            "adapt by platform.",
            "Share a field-production reel and confirmation that you can work "
            "locally in Lisbon.",
            "Please apply by 5:00 PM UTC on 31 August 2026.",
        ],
    )
    def test_legitimate_wording_is_published_unchanged(self, text: str) -> None:
        from app.core.job_application_instructions import contains_external_routing

        # Each of these was flagged as routing by an earlier version of the
        # grammar: a possessive object, a generic "platform", a place of work,
        # and a deadline. Over-removal edits what a recruiter wrote, which is
        # not a safe direction to fail in.
        #
        # "Apply through CreatorJobs" is deliberately absent. It *is* treated
        # as pure routing, and correctly: applying through CreatorJobs is what
        # happens anyway, so the sentence tells a candidate nothing and is
        # dropped rather than published. Nothing leaks either way.
        assert contains_external_routing(text) is None, text
