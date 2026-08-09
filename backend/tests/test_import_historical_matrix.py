"""Every serious import bug, classified by the layer that actually failed.

The point of this file is not documentation. It is to answer, in one place and
mechanically, the question that made the last round of diagnosis expensive: when
a fact reaches a recruiter wrong, *which layer lost it?*

Classifying the known history that way turned up the finding this campaign is
named for. Almost none of these were comprehension failures. The model
understood the page in the case that triggered the campaign, and most of the
rest were deterministic readers that could not parse a rendering, or a native
schema with no shape for what the source said. Two of them — the same fact,
"25 years" and "Up to ₹20,000" — were the schema being unable to hold a
qualified truth, which is the pattern the semantic fact layer now exists to
stop.

Each case carries its source text and asserts the fact still survives today, so
the matrix is a regression suite and not a list of claims.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.core.job_import_compensation import read_pay
from app.core.job_import_labelled_fields import labelled_facts

#: Where a bug actually lived. Used to find repeated architectural patterns
#: rather than to file the bugs.
Classification = str

MODEL_MISREAD = "MODEL_MISREAD"
DETERMINISTIC_MISREAD = "DETERMINISTIC_MISREAD"
SCHEMA_EXPRESSIVENESS_LOSS = "SCHEMA_EXPRESSIVENESS_LOSS"
PRECEDENCE_LOSS = "PRECEDENCE_LOSS"
NATIVE_CONVERSION_LOSS = "NATIVE_CONVERSION_LOSS"
QUESTION_PLANNER_LOSS = "QUESTION_PLANNER_LOSS"
PRESENTATION_LOSS = "PRESENTATION_LOSS"
BOUNDARY_LOSS = "BOUNDARY_LOSS"


@dataclass(frozen=True)
class HistoricalCase:
    name: str
    source: str
    classification: Classification
    #: What the page says, by hand.
    expect: dict[str, object]
    note: str


CASES: tuple[HistoricalCase, ...] = (
    HistoricalCase(
        "rupees-per-month-vanished",
        "Compensation: ₹5,000 / mo",
        DETERMINISTIC_MISREAD,
        {"budget_amount": 5_000, "budget_currency": "INR", "budget_unit": "per month"},
        "Markup carried no pay; the labelled reader existed but the page's own "
        "line was not consulted. A reading gap, not a comprehension gap.",
    ),
    HistoricalCase(
        "annually-eaten-by-the-article",
        "Compensation: ₹500000 annually",
        DETERMINISTIC_MISREAD,
        {"budget_amount": 500_000, "budget_unit": "per year"},
        "The 'a' separator had no word boundary and ate the first letter of "
        "'annually', so a plainly stated salary parsed to nothing.",
    ),
    HistoricalCase(
        "rupee-word-forms",
        "Compensation: Rs. 40,000 per month",
        DETERMINISTIC_MISREAD,
        {"budget_amount": 40_000, "budget_currency": "INR"},
        "'Rs' and 'Rs.' were not currencies at all, though on Indian boards "
        "they are as common as the symbol.",
    ),
    HistoricalCase(
        "dollars-an-hour",
        "Compensation: $40 an hour",
        DETERMINISTIC_MISREAD,
        {"budget_amount": 40, "budget_currency": "USD", "budget_unit": "per hour"},
        "'an' was not a separator, so the period never matched.",
    ),
    HistoricalCase(
        "magnitude-suffix",
        "Compensation: ₹20k per month",
        DETERMINISTIC_MISREAD,
        {"budget_amount": 20_000},
        "'20k' read as twenty, or not at all. Found by this campaign.",
    ),
    HistoricalCase(
        "ceiling-had-nowhere-to-live",
        "Up to ₹20,000 a month",
        SCHEMA_EXPRESSIVENESS_LOSS,
        {"budget_max": 20_000, "budget_amount": None, "budget_unit": "per month"},
        "The model understood the qualifier and said so in a note. There was no "
        "field for a ceiling, no native shape for a one-sided bound, and no "
        "presentation branch — so the understanding had nowhere to go.",
    ),
    HistoricalCase(
        "floor-flattened",
        "₹20,000+ per month",
        SCHEMA_EXPRESSIVENESS_LOSS,
        {"budget_amount": 20_000, "budget_max": None},
        "Same shape from the other side: a floor with no ceiling had to be "
        "either a flat rate or nothing.",
    ),
    HistoricalCase(
        "neighbouring-job-salary",
        "\n".join(
            [
                "Content Creator",
                "Larkfield Studio",
                "Your creative mandate",
                "Own our social presence across several channels.",
                "Senior Video Editor",
                "Northgate Media",
                "Compensation: INR 95000 per month",
            ]
        ),
        BOUNDARY_LOSS,
        {"budget_amount": None},
        "A real figure, correctly parsed, belonging to somebody else. Ownership "
        "is structural, not a parsing question.",
    ),
    HistoricalCase(
        "pay-below-the-body-still-ours",
        "\n".join(
            [
                "Content Creator",
                "Larkfield Studio",
                "About the role",
                "Own our social presence across several channels.",
                "Compensation: INR 5000 per month",
            ]
        ),
        BOUNDARY_LOSS,
        {"budget_amount": 5_000},
        "The mirror of the case above: a page may state its pay after its "
        "description, and cutting on position alone lost it.",
    ),
)


class TestTheHistoryStillHolds:
    @pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
    def test_the_fact_survives_today(self, case: HistoricalCase) -> None:
        facts = labelled_facts(case.source)

        for field, expected in case.expect.items():
            actual = getattr(facts, field)
            assert actual == expected, (
                f"{case.name} [{case.classification}]: {field} is {actual!r}, "
                f"the source states {expected!r} — {case.note}"
            )


class TestTheMatrixIsHonest:
    def test_every_classification_is_one_of_the_named_layers(self) -> None:
        known = {
            MODEL_MISREAD,
            DETERMINISTIC_MISREAD,
            SCHEMA_EXPRESSIVENESS_LOSS,
            PRECEDENCE_LOSS,
            NATIVE_CONVERSION_LOSS,
            QUESTION_PLANNER_LOSS,
            PRESENTATION_LOSS,
            BOUNDARY_LOSS,
        }

        for case in CASES:
            assert case.classification in known, case.name

    def test_the_matrix_is_not_a_monoculture(self) -> None:
        # If every case classified the same way the classification would be
        # telling us nothing.
        assert len({case.classification for case in CASES}) >= 3

    def test_no_case_is_classified_as_a_model_misread(self) -> None:
        # The finding this campaign turns on, asserted rather than claimed. Of
        # the serious import bugs with recoverable evidence, none was the model
        # failing to understand the page. Should a genuine model misread be
        # found later it belongs in this list, and this assertion should be the
        # thing that has to be deliberately changed to add it.
        misreads = [case.name for case in CASES if case.classification == MODEL_MISREAD]

        assert misreads == [], (
            f"a model misread is now recorded: {misreads}. Update this test "
            "deliberately — it exists so the claim cannot rot silently."
        )


class TestTheRepeatedPattern:
    """Two bugs, one cause: a qualified truth with no shape to live in."""

    @pytest.mark.parametrize(
        ("source", "minimum", "maximum"),
        [
            ("Up to ₹20,000 a month", None, 20_000),
            ("₹20,000+ a month", 20_000, None),
            ("Maximum of $500 per project", None, 500),
            ("At least $40 per hour", 40, None),
        ],
    )
    def test_a_one_sided_bound_stays_one_sided(
        self, source: str, minimum: float | None, maximum: float | None
    ) -> None:
        stated = read_pay(source)

        assert stated is not None, source
        assert stated.minimum == minimum, source
        assert stated.maximum == maximum, source
