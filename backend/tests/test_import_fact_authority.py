"""Who wins when two readers disagree, and what silence is allowed to mean.

The reported "Up to ₹20,000 a month" failure was not a comprehension failure.
The model read the qualifier — its note said so — and the fact still vanished,
because precedence was decided by *what kind of code produced a reading* rather
than by how strongly the source supported it. A regex that could not parse the
line outranked a model that could.

Two rules come out of that, and this module is where they are pinned.

**Silence is not evidence.** A detector that finds nothing has reported on its
own coverage, not on the page. `not_found` must never displace a fact another
detector did find, at any authority level. This is the single most important
assertion here: every historical "the fact disappeared" bug is a variant of a
blind detector being allowed to speak.

**Authority is about the source, not the implementation.** A page printing
"Compensation: ₹5,000/month" under a label has settled its own pay more firmly
than any interpretation of prose — so a labelled reading outranks an evidenced
one whether a regex or a model produced either. Equal authority disagreeing is a
conflict to surface, never a race won by whoever arrived last.

Expected outcomes here are stated as ground truth about the *source*, never read
back from whichever detector is under test.
"""

from __future__ import annotations

import itertools

import pytest

from app.core.job_import_facts import (
    Authority,
    Detection,
    Quantity,
    authority_rank,
    found,
    not_found,
    outranks,
    reconcile,
)

AUTHORITIES: tuple[Authority, ...] = (
    "recruiter",
    "labelled_source",
    "structured_source",
    "evidenced_interpretation",
    "heuristic",
)

CEILING = Quantity(
    qualifier="maximum_only", maximum=20_000, unit="per month", currency="INR"
)
FLAT = Quantity(qualifier="exact", minimum=20_000, unit="per month", currency="INR")
OTHER = Quantity(qualifier="exact", minimum=95_000, unit="per month", currency="INR")


class TestSilenceIsNotEvidence:
    """The rule whose absence caused the reported bug."""

    @pytest.mark.parametrize("silent_authority", AUTHORITIES)
    @pytest.mark.parametrize("speaking_authority", AUTHORITIES)
    def test_a_detector_that_found_nothing_never_displaces_one_that_did(
        self, silent_authority: Authority, speaking_authority: Authority
    ) -> None:
        # Every pairing, including a silent *recruiter-level* detector against
        # the weakest heuristic. Not finding something is never a statement
        # about the page, whoever failed to find it.
        result = reconcile(
            (
                not_found("blind", authority=silent_authority),
                found(CEILING, authority=speaking_authority, detector="reader"),
            )
        )

        assert result.found, (
            f"a silent {silent_authority} detector erased a "
            f"{speaking_authority} fact"
        )
        assert result.quantity == CEILING

    def test_the_reported_case_exactly(self) -> None:
        # The model read the qualifier and cited a span. The deterministic
        # reader had no rule that could match the line at all.
        result = reconcile(
            (
                not_found("labelled_regex", authority="labelled_source"),
                found(CEILING, authority="evidenced_interpretation", detector="model"),
            )
        )

        assert result.found and result.quantity is not None
        assert result.quantity.maximum == 20_000
        assert result.quantity.minimum is None

    def test_every_detector_silent_is_the_only_way_to_get_nothing(self) -> None:
        result = reconcile(
            (not_found("a"), not_found("b", authority="labelled_source"))
        )

        assert result.state == "not_found"


class TestAuthorityFollowsTheSourceNotTheImplementation:
    def test_the_ladder_is_ordered_as_documented(self) -> None:
        ranks = [authority_rank(name) for name in AUTHORITIES]

        # Written out rather than derived from the table, so reordering the
        # table cannot silently reorder the invariant it is supposed to encode.
        assert ranks == sorted(ranks), ranks
        assert authority_rank("recruiter") < authority_rank("labelled_source")
        assert authority_rank("labelled_source") < authority_rank("structured_source")
        assert authority_rank("structured_source") < authority_rank(
            "evidenced_interpretation"
        )
        assert authority_rank("evidenced_interpretation") < authority_rank("heuristic")

    def test_a_labelled_fact_beats_an_interpretation_of_prose(self) -> None:
        result = reconcile(
            (
                found(FLAT, authority="labelled_source"),
                found(OTHER, authority="evidenced_interpretation"),
            )
        )

        assert result.quantity == FLAT

    def test_an_evidenced_interpretation_beats_a_heuristic(self) -> None:
        # The direction that matters for this campaign: a weak deterministic
        # match must not beat a reading grounded in the page's own sentence.
        result = reconcile(
            (
                found(OTHER, authority="heuristic"),
                found(CEILING, authority="evidenced_interpretation"),
            )
        )

        assert result.quantity == CEILING

    def test_nothing_outranks_a_recruiter(self) -> None:
        for authority in AUTHORITIES:
            assert not outranks(authority, "recruiter") or authority == "recruiter"

    @pytest.mark.parametrize(
        ("stronger", "weaker"),
        [
            pair
            for pair in itertools.permutations(AUTHORITIES, 2)
            if authority_rank(pair[0]) < authority_rank(pair[1])
        ],
    )
    def test_strength_is_strict(self, stronger: Authority, weaker: Authority) -> None:
        assert outranks(stronger, weaker)
        assert not outranks(weaker, stronger)


class TestEqualAuthorityDisagreementIsAConflict:
    def test_two_equally_supported_readings_do_not_pick_a_winner(self) -> None:
        result = reconcile(
            (
                found(FLAT, authority="labelled_source", detector="one"),
                found(OTHER, authority="labelled_source", detector="two"),
            )
        )

        # Choosing between two equally-supported readings of somebody's pay is
        # not a machine's decision, and picking whichever arrived first is how
        # markup saying INTERN beat a page's own "Part-time / Freelance".
        assert result.state == "conflict"
        assert set(result.alternatives) == {FLAT, OTHER}

    def test_agreement_at_equal_authority_is_not_a_conflict(self) -> None:
        result = reconcile(
            (
                found(FLAT, authority="labelled_source", detector="one"),
                found(FLAT, authority="labelled_source", detector="two"),
            )
        )

        assert result.found and result.quantity == FLAT

    def test_a_stronger_reading_settles_a_weaker_disagreement(self) -> None:
        result = reconcile(
            (
                found(FLAT, authority="heuristic", detector="one"),
                found(OTHER, authority="heuristic", detector="two"),
                found(CEILING, authority="labelled_source", detector="label"),
            )
        )

        assert result.found and result.quantity == CEILING


class TestAQualifierIsPartOfTheFact:
    def test_a_ceiling_and_a_flat_rate_are_not_the_same_fact(self) -> None:
        # Both name 20,000. One says "at most", the other says "exactly", and a
        # reconciler treating them as equal would let either overwrite the
        # other without registering a disagreement.
        assert CEILING != FLAT

        result = reconcile(
            (
                found(CEILING, authority="labelled_source", detector="a"),
                found(FLAT, authority="labelled_source", detector="b"),
            )
        )
        assert result.state == "conflict"

    @pytest.mark.parametrize(
        ("qualifier", "kwargs"),
        [
            ("range", {"minimum": 10, "maximum": None}),
            ("range", {"minimum": None, "maximum": 10}),
            ("exact", {"minimum": None}),
            ("minimum_only", {"minimum": 10, "maximum": 20}),
            ("maximum_only", {"minimum": 10, "maximum": 20}),
            ("maximum_only", {"maximum": None}),
        ],
    )
    def test_an_incoherent_quantity_cannot_be_constructed(
        self, qualifier: str, kwargs: dict[str, object]
    ) -> None:
        # A one-sided bound calling itself a range invites every consumer to go
        # looking for the other end, and finding None there is exactly how a
        # ceiling becomes a flat rate.
        with pytest.raises(ValueError):
            Quantity(qualifier=qualifier, **kwargs)  # type: ignore[arg-type]


class TestDetectionStatesAreDistinct:
    def test_found_not_found_and_conflict_are_three_different_answers(self) -> None:
        conflict = Detection(
            state="conflict",
            authority="labelled_source",
            alternatives=(FLAT, OTHER),
            detector="x",
        )

        assert found(FLAT, authority="heuristic").found
        assert not found(FLAT, authority="heuristic").silent
        assert not_found("x").silent
        assert not not_found("x").found
        assert not conflict.found
        assert not conflict.silent

    def test_a_conflict_survives_when_nothing_stronger_speaks(self) -> None:
        result = reconcile(
            (
                not_found("blind"),
                Detection(
                    state="conflict",
                    authority="labelled_source",
                    alternatives=(FLAT, OTHER),
                    detector="x",
                ),
            )
        )

        assert result.state == "conflict"
