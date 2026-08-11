"""Which crafts a title genuinely puts on the table.

Two failure modes bracket this, and both are worse than they look.

Offer too few and the recruiter gets a draft filed under a craft they did not
choose, shown to the wrong candidates, with nothing on screen to tell them it
happened. That was the reported defect: a title naming three crafts produced no
craft at all, because every pattern was an agent noun and the title used
activities.

Offer too many and the question stops being a question. A chat bubble holding
eight chips is the taxonomy picker the editor already has, moved somewhere worse.

So candidates come from what the *title* names. A craft mentioned once in a list
of alternative acceptable backgrounds is not what the job is for, and reading the
body for candidates would turn every passing mention into an option.
"""

from __future__ import annotations

import pytest

from app.core.job_import_title_signals import title_signals


def candidates(title: str) -> list[str]:
    """The crafts a title puts forward, whether it settles on one or not."""

    signals = title_signals(title)
    options = signals.suggested.get("primary_role_key_options")
    if isinstance(options, list):
        return list(options)
    single = signals.settled.get("primary_role_key") or signals.suggested.get(
        "primary_role_key"
    )
    return [single] if isinstance(single, str) else []


class TestSubstantialCraftsAreAllConsidered:
    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("Video Editing and Animation", {"video-editor", "animator"}),
            ("Video Editing and VFX", {"video-editor", "motion-designer"}),
            (
                "Editing, Motion Graphics and Animation",
                {"video-editor", "motion-designer", "animator"},
            ),
            (
                "Visual Content Creator - Video Editing, VFX & Animation",
                {"video-editor", "motion-designer", "animator"},
            ),
        ],
    )
    def test_every_craft_the_title_names_becomes_an_option(
        self, title: str, expected: set[str]
    ) -> None:
        assert set(candidates(title)) == expected

    def test_the_reported_title_offers_all_three_crafts_it_lists(self) -> None:
        # VFX has no craft of its own in the catalog. Among the ones that exist
        # it is motion and compositing work, and the title names it as one of
        # three headline crafts — which is title-prominent evidence, not a
        # keyword sighting.
        assert set(
            candidates("Visual Content Creator - Video Editing, VFX & Animation")
        ) == {"video-editor", "motion-designer", "animator"}


class TestOnlyTheStrongestOptionsAreShown:
    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("Senior Video Editor", "video-editor"),
            ("Motion Designer", "motion-designer"),
            ("Animation Specialist", "animator"),
            ("Freelance Scriptwriting for a weekly show", "scriptwriter"),
        ],
    )
    def test_one_dominant_craft_settles_without_a_question(
        self, title: str, expected: str
    ) -> None:
        assert candidates(title) == [expected]

    def test_two_tied_crafts_both_appear(self) -> None:
        assert set(candidates("Graphic Designer and Video Editor")) == {
            "graphic-designer",
            "video-editor",
        }

    def test_a_job_outside_the_marketplace_offers_nothing(self) -> None:
        assert candidates("Senior Financial Analyst") == []

    def test_seeded_community_manager_title_is_recognized(self) -> None:
        # Title-only lookup owns catalog recognition. Whole-job reconciliation
        # separately rejects office-operations jobs with this ambiguous title.
        assert candidates("Community Manager (NY)") == ["community-manager"]
        assert candidates("Online Community Manager") == ["community-manager"]

    def test_the_option_list_stays_short_enough_to_be_a_question(self) -> None:
        crowded = "Video Editing, Animation, Motion Graphics, Scriptwriting and Copywriting"
        assert len(candidates(crowded)) <= 5

    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("Video Editors Needed", "video-editor"),
            ("Shorts Editors", "shorts-editor"),
            ("Thumbnail Designers", "thumbnail-designer"),
            ("YouTube Shorts Video Editor", "shorts-editor"),
            ("Short Form Video Editor", "shorts-editor"),
            ("Long Form Video Editor", "long-form-editor"),
            ("YouTube Long-Form Video Editor", "long-form-editor"),
            ("Film Editor", "video-editor"),
            ("Audio Editor", "audio-engineer"),
            ("Sound Editor", "audio-engineer"),
            ("Thumbnail Creator", "thumbnail-designer"),
            ("Thumbnail Editor", "thumbnail-designer"),
        ],
    )
    def test_obvious_occupational_variants_choose_the_specific_role(
        self, title: str, expected: str
    ) -> None:
        assert candidates(title) == [expected]

    @pytest.mark.parametrize(
        "title",
        [
            "Video Editing Software Engineer",
            "Video Editing App Developer",
            "Video Editing Instructor",
            "Graphic Design Teacher",
            "Animation Instructor",
            "Sales Executive - Video Editing Software",
            "Customer Support - Video Editing Platform",
        ],
    )
    def test_a_non_practitioner_job_is_not_filed_under_the_craft_it_mentions(
        self, title: str
    ) -> None:
        assert candidates(title) == []


class TestIncidentalMentionsAreNotOptions:
    def test_a_craft_named_only_in_the_body_is_not_offered(self) -> None:
        # The reported page lists "Motion Graphics" once, inside "experience in
        # Video Editing, Motion Graphics, Animation, or Digital Content
        # Creation" — a list of backgrounds it would accept, not what the job is.
        body = (
            "25 years of professional experience in Video Editing, Motion "
            "Graphics, Animation, or Digital Content Creation."
        )
        assert candidates("Podcast Producer") == ["podcast-producer"]
        assert "motion-designer" not in candidates("Podcast Producer")
        # Body text is available to the reader and still contributes no craft.
        signals = title_signals("Podcast Producer", extra_text=body)
        assert signals.suggested.get("primary_role_key_options") is None


class TestNounFormDoesNotDecideTheAnswer:
    """"Editing" and "editor" name the same craft, so they must agree."""

    @pytest.mark.parametrize(
        ("activity", "agent"),
        [
            ("Video Editing role", "Video Editor role"),
            ("Motion Graphics role", "Motion Designer role"),
            ("Animation role", "Animator role"),
            ("Scriptwriting role", "Scriptwriter role"),
            ("Copywriting role", "Copywriter role"),
            ("Illustration role", "Illustrator role"),
            ("Videography role", "Videographer role"),
        ],
    )
    def test_both_forms_reach_the_same_craft(self, activity: str, agent: str) -> None:
        assert candidates(activity) == candidates(agent) != []
