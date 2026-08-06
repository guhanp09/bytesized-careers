"""The contract that a conversion may not change what a source said.

One defect motivated this file. A page stating "25 years of professional
experience" produced a native draft reading "5–8 years", because the conversion
layer believed the field could only hold one of four bands and picked the
closest. The belief was wrong — the bands are a question's option list, not the
schema's domain — but the deeper fault was the picking. "Closest" is not a
truth-preserving operation. Once a layer is willing to choose a nearby value,
every bounded field in the product is one bad lookup away from publishing a
claim nobody made.

So the rule here is stronger than "get experience right". For every field the
schema constrains, a written value must be one the source actually supports, and
the only ways to earn one are to match exactly or to be contained by a category
that is explicitly open-ended. There is deliberately no third way.
"""

from __future__ import annotations

import pytest

from app.core.job_import_answer_shapes import native_schema_constraints
from app.core.job_import_native_values import (
    OPEN_ENDED_CATEGORIES,
    convert_to_native,
)
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES

#: Every field whose native values the schema restricts to a fixed set.
BOUNDED_FIELDS: tuple[str, ...] = tuple(
    sorted(
        path
        for path in JOB_IMPORT_FIELD_POLICIES
        if native_schema_constraints(path)[0] and not native_schema_constraints(path)[2]
    )
)


def test_the_audit_actually_covers_something() -> None:
    # A silent empty list would make every test below vacuously true.
    assert len(BOUNDED_FIELDS) >= 8, BOUNDED_FIELDS


class TestNoBoundedFieldEverInventsAValue:
    """The general contract, applied to every bounded field the product has."""

    @pytest.mark.parametrize("field_path", BOUNDED_FIELDS)
    def test_each_allowed_value_survives_unchanged(self, field_path: str) -> None:
        choices, _cap, _is_list = native_schema_constraints(field_path)
        assert choices is not None
        for choice in choices:
            conversion = convert_to_native(field_path, choice)
            assert conversion.native_value == choice, field_path
            assert conversion.outcome == "exact"

    @pytest.mark.parametrize("field_path", BOUNDED_FIELDS)
    def test_an_unrepresentable_value_is_never_swapped_for_a_neighbour(
        self, field_path: str
    ) -> None:
        choices, _cap, _is_list = native_schema_constraints(field_path)
        assert choices is not None
        for stated in ("something the schema has never heard of", "42", ""):
            conversion = convert_to_native(field_path, stated)
            if conversion.native_value is None:
                assert conversion.outcome in {"unsupported", "invalid"}
                # The source wording survives, so the recruiter can be shown
                # what the page said rather than asked what it already answered.
                assert conversion.source_value == stated
                continue
            # Anything written must be defensible: either the value itself, or a
            # category declared open-ended and containing it.
            assert conversion.contains_source, field_path
            assert conversion.outcome == "broadened"
            assert conversion.native_value in dict(
                OPEN_ENDED_CATEGORIES.get(field_path, ())
            )

    @pytest.mark.parametrize("field_path", BOUNDED_FIELDS)
    def test_a_wrongly_typed_value_is_a_defect_not_a_guess(
        self, field_path: str
    ) -> None:
        conversion = convert_to_native(field_path, 17)

        assert conversion.native_value is None
        assert conversion.outcome in {"unsupported", "invalid"}


class TestOpenEndedCategoriesAreDeclaredNotAssumed:
    """A catch-all is only safe when the product says it is one."""

    def test_no_closed_range_is_registered_as_open_ended(self) -> None:
        # A label like "5–8 years" names a ceiling. Registering it here would
        # re-authorise exactly the distortion this file exists to prevent.
        for field_path, categories in OPEN_ENDED_CATEGORIES.items():
            for name, _bound in categories:
                assert "–" not in name and "-" not in name, (field_path, name)

    def test_experience_declares_none_because_the_product_has_none(self) -> None:
        # Every experience band closes, the most senior at eight years. Until a
        # genuinely open-ended band exists, nothing above eight can be shown as
        # a band, and pretending otherwise is what broke the BeBee import.
        assert "experience_level" not in OPEN_ENDED_CATEGORIES


class TestExperienceSemanticIntegrity:
    """The exact table the reported defect was argued over."""

    @pytest.mark.parametrize(
        "stated",
        [
            "0 years",
            "fresher",
            "1 year",
            "2–5 years",
            "5 years",
            "7 years",
            "8 years",
            "9 years",
            "10+ years",
            "25 years",
            "at least 5 years",
            "at least 10 years",
            "up to 5 years",
            "experience preferred",
            "!!!",
        ],
    )
    def test_the_source_wording_reaches_the_draft_untouched(self, stated: str) -> None:
        conversion = convert_to_native("experience_level", stated)

        assert conversion.native_value == stated
        assert conversion.outcome == "exact"
        assert conversion.contains_source

    @pytest.mark.parametrize(
        "stated", ["9 years", "10 years", "25 years", "at least 10 years"]
    )
    def test_nothing_above_the_senior_band_is_shown_as_that_band(
        self, stated: str
    ) -> None:
        assert convert_to_native("experience_level", stated).native_value != "5–8 years"

    def test_a_requirement_longer_than_the_column_is_declined_not_trimmed(self) -> None:
        # Cutting a sentence in half changes the claim it makes, so the field is
        # left unset and the source keeps its words.
        stated = "at least twenty-five years of professional post-production " * 2
        conversion = convert_to_native("experience_level", stated)

        assert conversion.native_value is None
        assert conversion.outcome == "unsupported"
        assert conversion.source_value == stated
