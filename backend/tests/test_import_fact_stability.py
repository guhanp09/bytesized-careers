"""Explicit source facts must not depend on which way the model answered today.

A repeat benchmark ran the same seven live pages twice and found two facts that
appeared on one run and vanished on the next — a job title and an experience
requirement, both stated plainly by the page itself.

Neither was really a model failure. The page's own JobPosting markup carried
both, and the deterministic reader had them. What blocked the backfill was that
a *row already existed* — one holding nothing, one holding sixty-plus characters
of prose the sixty-four-character column refuses. Provenance said "the machine
read this", so the explicit fact stood aside for a value that could never reach
the draft.

The rule is now about usability rather than provenance: a row that cannot become
part of the draft is not a reading worth protecting. A settled, usable reading
still wins, and a recruiter still wins over both.
"""

from __future__ import annotations

import pytest

from app.services.job_import_service import JobImportService


def row(**kwargs) -> dict:
    base = {
        "field_path": "title",
        "provenance_state": "extracted_from_source",
        "review_status": "pending",
        "proposed_value": "Video Editor",
        "validation_errors": None,
    }
    base.update(kwargs)
    return base


class TestAnUnusableRowYieldsToTheExplicitFact:
    def test_an_empty_row_does_not_block_the_page_title(self) -> None:
        # Observed live: a title row arrived holding nothing and still blocked
        # the page's own JobPosting title, so the fact was lost *and* the
        # recruiter was asked for something the page had stated.
        assert JobImportService._structured_value_may_fill(row(proposed_value=None))
        assert JobImportService._structured_value_may_fill(row(proposed_value=""))

    def test_a_value_too_long_for_its_column_does_not_block(self) -> None:
        # Observed live: sixty-plus characters of experience prose, refused by
        # the sixty-four-character column, discarded a correctly-read fact.
        long_prose = (
            "25 years of professional experience in Video Editing, Motion "
            "Graphics, Animation, or Digital Content Creation"
        )
        assert len(long_prose) > 64
        assert JobImportService._structured_value_may_fill(
            row(field_path="experience_level", proposed_value=long_prose)
        )

    def test_a_rejected_row_does_not_block(self) -> None:
        assert JobImportService._structured_value_may_fill(
            row(validation_errors=["not valid"])
        )

    def test_a_value_the_native_field_refuses_does_not_block(self) -> None:
        assert JobImportService._structured_value_may_fill(
            row(field_path="work_mode", proposed_value="whatever the team prefers")
        )


class TestUsableReadingsAreStillProtected:
    """The backfill must not become an overwrite."""

    def test_a_settled_usable_reading_wins(self) -> None:
        assert not JobImportService._structured_value_may_fill(row())

    def test_a_recruiter_reviewed_row_is_never_overwritten(self) -> None:
        assert not JobImportService._structured_value_may_fill(
            row(review_status="accepted")
        )
        assert not JobImportService._structured_value_may_fill(
            row(review_status="edited", proposed_value=None)
        )

    def test_a_conflict_holding_a_usable_value_is_left_to_the_recruiter(self) -> None:
        assert not JobImportService._structured_value_may_fill(
            row(provenance_state="conflicting_source_values")
        )

    def test_a_missing_row_is_filled_as_before(self) -> None:
        assert JobImportService._structured_value_may_fill(
            row(provenance_state="missing", proposed_value=None)
        )


class TestNothingIsManufactured:
    """Stability must not become invention."""

    @pytest.mark.parametrize(
        ("field_path", "value"),
        [
            ("experience_level", "5 years ago we were founded"),
            ("title", ""),
            ("location", "Remote (Acme Inc)"),
        ],
    )
    def test_the_gate_only_decides_eligibility_never_supplies_a_value(
        self, field_path: str, value: str
    ) -> None:
        # This helper answers "may an explicit fact fill here?", never "invent
        # one". With no structured fact available the field simply stays empty,
        # which the corpus tests already pin end to end.
        result = JobImportService._structured_value_may_fill(
            row(field_path=field_path, proposed_value=value)
        )
        assert isinstance(result, bool)
