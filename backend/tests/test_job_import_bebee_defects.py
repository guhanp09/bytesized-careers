"""The four faults a real BeBee listing exposed, each pinned separately.

The page: a school hiring a "Visual Content Creator - Video Editing, VFX &
Animation" in Coimbatore, with a plainly labelled experience requirement.

Four things went wrong, and they were four different faults rather than one:
the craft was never read because the title named activities instead of people;
the craft was never *asked* because the assistant had been told never to
interrupt about it; the city arrived as a formatted postal label the editor's
validator refused; and the experience requirement was read but written into a
closed-choice field that could not hold it, so it vanished.

What the four share is their shape. In every case the source stated the fact
plainly and the recruiter was still asked to supply it — which is the one
outcome this feature exists to prevent.
"""

from __future__ import annotations

import pytest

from app.core.job_import_body_sections import experience_from_body
from app.core.job_import_location_resolution import parse_location
from app.core.job_import_native_values import coerce_to_native, convert_to_native
from app.core.job_import_questions import deterministic_question_queue
from app.core.job_import_structured_fields import fields_from_structured_context
from app.core.job_import_title_signals import title_signals

BEBEE_TITLE = "Visual Content Creator - Video Editing, VFX & Animation"


class TestCraftNamedAsAnActivity:
    """A title can name a craft without naming a practitioner."""

    def test_the_bebee_title_names_crafts_that_were_previously_invisible(self) -> None:
        # Every role word was an agent noun — "editor", "animator". This title
        # uses gerunds, matched nothing, and left the role field empty.
        signals = title_signals(BEBEE_TITLE)
        options = signals.suggested.get("primary_role_key_options")

        assert options is not None, "the title names crafts and none were read"
        # Three crafts, one per item the title lists. VFX has no craft of its
        # own in the catalog and is motion and compositing work among the ones
        # that do exist. Candidate breadth is pinned in detail by
        # test_job_import_role_candidates.
        assert set(options) == {"video-editor", "motion-designer", "animator"}

    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("Freelance Video Editing Specialist", "video-editor"),
            ("Motion Graphics Contractor", "motion-designer"),
            ("Scriptwriting for a weekly show", "scriptwriter"),
            ("Podcast Production Assistant", "podcast-producer"),
        ],
    )
    def test_one_craft_named_as_an_activity_still_settles_without_asking(
        self, title: str, expected: str
    ) -> None:
        signals = title_signals(title)
        settled = signals.settled.get("primary_role_key")
        suggested = signals.suggested.get("primary_role_key")

        assert (settled or suggested) == expected

    def test_a_job_outside_the_marketplace_names_no_craft(self) -> None:
        # The reason the old never-ask policy existed. It must stay true: there
        # is no honest creator craft for this, so there is nothing to ask.
        signals = title_signals("Senior Financial Analyst")

        assert signals.settled.get("primary_role_key") is None
        assert signals.suggested.get("primary_role_key_options") is None


class TestAmbiguityEarnsExactlyOneQuestion:
    """A decision only the recruiter can make is worth interrupting for."""

    def _queue_paths(self, *, ambiguous: bool) -> list[str]:
        candidates = deterministic_question_queue(
            conflicted_fields=frozenset(),
            missing_fields={"primary_role_key": "required_for_publication"},
            answered_fields=frozenset(),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset(),
            ambiguous_fields=frozenset({"primary_role_key"}) if ambiguous else frozenset(),
        )
        return [candidate.field_path for candidate in candidates]

    def test_several_plausible_crafts_reach_the_recruiter(self) -> None:
        assert "primary_role_key" in self._queue_paths(ambiguous=True)

    def test_an_unambiguous_craft_never_interrupts(self) -> None:
        # The original policy, still correct for the case it was written for.
        assert "primary_role_key" not in self._queue_paths(ambiguous=False)


class TestCityRatherThanPostalLabel:
    """The native control holds a city, so it must receive a city."""

    def test_the_district_wrapper_is_not_mistaken_for_the_city(self) -> None:
        parts = parse_location("Coimbatore, Coimbatore district, IN")

        assert parts.city == "Coimbatore"
        assert parts.region == "Coimbatore district"

    def test_the_bebee_page_yields_a_city_the_editor_accepts(self) -> None:
        fields = fields_from_structured_context(
            {
                "job_title": BEBEE_TITLE,
                "employment_type": "FULL_TIME",
                "role_location": "Coimbatore, Coimbatore district, IN",
            }
        )

        assert fields["location"] == "Coimbatore"

    @pytest.mark.parametrize(
        ("stated", "expected"),
        [
            ("San Francisco, California, US", "San Francisco"),
            ("Mumbai, IN", "Mumbai"),
            # A neighbourhood is more specific than its city, not noise, so it
            # survives — the editor accepts it and candidates recognise it.
            ("Brookefield, Bengaluru", "Brookefield, Bengaluru"),
        ],
    )
    def test_other_shapes_of_address_reduce_to_a_place(
        self, stated: str, expected: str
    ) -> None:
        fields = fields_from_structured_context({"role_location": stated})

        assert fields["location"] == expected

    def test_an_arrangement_is_not_written_into_a_city_field(self) -> None:
        fields = fields_from_structured_context(
            {"role_location": "Remote, India", "location_type": "TELECOMMUTE"}
        )

        assert "location" not in fields
        assert fields["work_mode"] == "remote"


class TestStatedExperienceSurvivesToTheDraft:
    """Read from the body, then stored without being rewritten."""

    def test_a_labelled_requirement_is_read_rather_than_asked(self) -> None:
        stated = experience_from_body(
            "Experience\n25 years of professional experience in Video Editing, "
            "Motion Graphics, Animation, or Digital Content Creation."
        )

        # Carried exactly as the page wrote it. The figure is probably a typo
        # for "2-5", and deciding that is the recruiter's call, not a parser's.
        assert stated == "25 years"

    @pytest.mark.parametrize(
        "text",
        [
            "We are a remote team of 12 people",
            "Founded 8 years ago in Chennai",
            "Salary 25000 per month",
        ],
    )
    def test_a_number_near_no_requirement_is_not_an_experience_claim(
        self, text: str
    ) -> None:
        assert experience_from_body(text) is None

    @pytest.mark.parametrize(
        "stated",
        ["2–4 years", "5+ years", "25 years", "at least 10 years", "fresher"],
    )
    def test_a_stated_requirement_reaches_the_field_exactly_as_stated(
        self, stated: str
    ) -> None:
        # This used to place each figure in one of four bands, which read as
        # normalisation and was not. The field is a plain string in the schema;
        # the four bands are a *question's* option list. Reading the question's
        # options as the field's domain is what turned a stated 25 years into
        # "5–8 years" — a listing claiming something its source never said.
        assert coerce_to_native("experience_level", stated) == stated

    @pytest.mark.parametrize(
        ("stated", "forbidden"),
        [("25 years", "5–8 years"), ("10 years", "5–8 years"), ("9 years", "5–8 years")],
    )
    def test_a_figure_above_every_band_is_never_squeezed_into_one(
        self, stated: str, forbidden: str
    ) -> None:
        conversion = convert_to_native("experience_level", stated)

        assert conversion.native_value != forbidden
        assert conversion.native_value == stated
        assert conversion.outcome == "exact"
        assert conversion.contains_source

    def test_an_open_ended_requirement_keeps_its_open_end(self) -> None:
        # "5+ years" says five or more. A closed 5–8 contradicts that, and the
        # title reader used to build exactly that by adding three to the figure.
        assert title_signals("Video Editor 5+ years").settled["experience_level"] == (
            "5+ years"
        )
        assert title_signals("Animator 10+ years experience").settled[
            "experience_level"
        ] == "10+ years"

    def test_a_valid_value_passes_through_untouched(self) -> None:
        assert coerce_to_native("work_mode", "remote") == "remote"
        assert coerce_to_native("title", BEBEE_TITLE) == BEBEE_TITLE
