"""Where the job is, and how it is worked — as a matrix rather than examples.

Two defects came out of this pair, and both had a correct value behind them.
``Remote-friendly`` reached a city field, so the draft claimed a place that does
not exist. And a remote job in India rendered as "Remote", dropping the country —
on a marketplace where remote-in-India and remote-anywhere are different jobs to
apply for.

Neither was a parsing failure. Both were category errors: a word describing *how*
work happens was treated as *where*, and a derived label was allowed to replace a
stated fact. So the matrix here crosses every work-mode word with every kind of
place, plus the things that look like places and are not — company names, office
buildings, timezones, footer addresses.

Engagement carries the same shape of risk from the other direction: a page whose
syndicated markup said INTERN while its own copy said "Part-time / Freelance"
reached a recruiter as an internship. Lower-authority evidence disagreeing with
an employer's own words is not a reason to ask, and never a reason to overwrite.
"""

from __future__ import annotations

import pytest

from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_native_values import convert_to_native
from tests.import_generators import (
    ENGAGEMENT_COMPOUNDS,
    ENGAGEMENT_WORDS,
    NOT_PLACES,
    PLACES,
    WORK_MODE_WORDS,
)


def _city(value: str):
    return convert_to_native("location", value)


class TestAWorkModeWordIsNeverAPlace:
    @pytest.mark.parametrize(
        ("written", "_mode"), WORK_MODE_WORDS, ids=[w for w, _ in WORK_MODE_WORDS]
    )
    def test_it_never_reaches_a_location_field(self, written: str, _mode) -> None:
        conversion = _city(written)

        # "Remote-friendly, IN" as a city is a place that does not exist, and it
        # reached a live draft once.
        assert conversion.outcome in ("unsupported", "invalid") or not conversion.native_value, (
            f"{written!r} was accepted as a location: {conversion.native_value!r}"
        )

    @pytest.mark.parametrize("written", NOT_PLACES)
    def test_a_company_office_or_timezone_is_never_a_place(self, written: str) -> None:
        conversion = _city(written)

        assert conversion.outcome in ("unsupported", "invalid") or not conversion.native_value, (
            f"{written!r} was accepted as a location: {conversion.native_value!r}"
        )


class TestAStatedPlaceSurvives:
    @pytest.mark.parametrize(
        ("written", "city"),
        [(written, city) for written, city in PLACES if city],
        ids=[written for written, city in PLACES if city],
    )
    def test_the_city_is_the_city_the_source_named(self, written: str, city: str) -> None:
        conversion = _city(written)

        if not conversion.native_value:
            return
        stored = str(conversion.native_value)
        # A district must not replace the city: "Coimbatore, Coimbatore
        # district, IN" is Coimbatore, and taking the second field made the
        # city "Coimbatore district", which is not a city.
        assert city.casefold() in stored.casefold(), f"{written!r} -> {stored!r}"
        assert "district" not in stored.casefold()

    @pytest.mark.parametrize(
        "written", ["London or Manchester", "Remote (Acme); Tysons Corner, VA"]
    )
    def test_several_places_resolve_to_the_first_stated_one(self, written: str) -> None:
        # A documented product decision rather than an accident: a city control
        # holds one city, and the first stated place is the one used. Pinned so
        # the behaviour is deliberate and visible rather than incidental.
        stored = str(_city(written).native_value or "")

        assert stored in ("London", "Tysons Corner"), f"{written!r} -> {stored!r}"


class TestWorkModeAndPlaceAreDifferentQuestions:
    @pytest.mark.parametrize(
        ("written", "mode"),
        [(w, m) for w, m in WORK_MODE_WORDS if m],
        ids=[w for w, m in WORK_MODE_WORDS if m],
    )
    def test_a_supported_mode_converts_to_itself(self, written: str, mode: str) -> None:
        conversion = convert_to_native("work_mode", written)

        # Case-folding is normalisation, not interpretation, so the gate does
        # it. Hyphenation is wording, so the gate refuses it rather than
        # guessing — but it must never produce a *different* mode.
        assert conversion.native_value in (mode, None), written

    @pytest.mark.parametrize("written", ["onsite", "hybrid", "on-site", "in-office"])
    def test_an_onsite_or_hybrid_job_never_becomes_remote(self, written: str) -> None:
        stored = convert_to_native("work_mode", written).native_value

        assert stored != "remote", f"{written!r} -> {stored!r}"

    @pytest.mark.parametrize(
        "written", ["Remote-friendly", "Remote-first", "Fully remote", "WFH"]
    )
    def test_a_looser_remote_phrase_is_not_forced_into_a_place(self, written: str) -> None:
        # It may or may not be accepted as a mode — that is a product decision —
        # but it must never become somewhere a candidate could travel to.
        assert not _city(written).native_value


class TestEngagementIsNeverForcedIntoAnEnum:
    @pytest.mark.parametrize(
        ("written", "expected"), ENGAGEMENT_WORDS, ids=[w for w, _ in ENGAGEMENT_WORDS]
    )
    def test_a_word_maps_to_its_own_meaning_or_to_nothing(
        self, written: str, expected: str | None
    ) -> None:
        """Read by the labelled reader, which is the layer that knows wording.

        `convert_to_native` deliberately does not: it compares against the
        schema literal and refuses anything else, so "Full-time" is unsupported
        there and `full_time` is exact. That split is the containment model —
        the gate never guesses, and the reader never invents a literal the
        schema does not have.
        """

        read = labelled_facts(f"Type: {written}").engagement_type

        if expected is None:
            # "Volunteer" is not an internship, and rounding it to the nearest
            # supported literal states something the page never did.
            assert read is None, f"{written!r} was coerced to {read!r}"
        else:
            assert read == expected, f"{written!r}"

    @pytest.mark.parametrize(
        ("written", "expected"),
        [(w, e) for w, e in ENGAGEMENT_WORDS if e],
        ids=[w for w, e in ENGAGEMENT_WORDS if e],
    )
    def test_the_native_gate_accepts_only_the_schemas_own_spelling(
        self, written: str, expected: str
    ) -> None:
        # The reader's output is what reaches the gate, and it must pass.
        assert convert_to_native("engagement_type", expected).native_value == expected

    @pytest.mark.parametrize(
        ("written", "expected"),
        ENGAGEMENT_COMPOUNDS,
        ids=[w for w, _ in ENGAGEMENT_COMPOUNDS],
    )
    def test_a_compound_resolves_to_the_descriptor_that_decides_structure(
        self, written: str, expected: str
    ) -> None:
        # "Part-time / Freelance" is freelance work at part-time volume. The
        # freelance half decides how the engagement is structured; part-time
        # only describes its volume, which weekly hours already carry.
        assert labelled_facts(f"Type: {written}").engagement_type == expected

    def test_nothing_defaults_to_internship(self) -> None:
        # The reported failure: a paid freelance brief presented as an
        # internship. No absence of evidence may produce this value.
        for text in ("", "   ", "Type:", "Type: TBD", "Type: See description"):
            assert labelled_facts(text).engagement_type != "internship", text


class TestNeighbouringContentCannotDecideThisJob:
    def test_a_similar_jobs_card_does_not_supply_the_place(self) -> None:
        page = "\n".join(
            [
                "Content Creator",
                "Location: Remote-friendly",
                "Similar jobs",
                "Senior Video Editor",
                "Location: Mumbai, Maharashtra, IN",
            ]
        )
        # The reader keys on the first labelled row, which belongs to the job
        # the page is about. Mumbai belongs to somebody else's job.
        assert "mumbai" not in str(labelled_facts(page).evidence or {}).casefold()

    def test_a_footer_address_yields_its_city_and_nothing_else(self) -> None:
        # The company and the building must not become the place. The city in
        # the address genuinely is a city, so extracting it is correct — what
        # would be wrong is storing "Northgate Media Pvt Ltd" or "Building 4".
        stored = str(
            _city("Northgate Media Pvt Ltd, Building 4, Gurugram, Haryana, IN").native_value
            or ""
        )

        assert stored == "Gurugram", stored
        assert "pvt" not in stored.casefold()
        assert "building" not in stored.casefold()
