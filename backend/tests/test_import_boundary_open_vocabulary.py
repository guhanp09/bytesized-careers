"""Where a page stops being about its own job, without being told.

A neighbouring listing's salary reaching this job's draft is the worst kind of
defect this importer can produce: the number is real, the formatting is right,
and it belongs to a different company. The previous campaign fixed it for nine
headings.

Generating the heading space showed how little that covered — 234 of 304
variants walked straight past: "Related roles", "Other opportunities",
"Vacancies", a trailing em dash, a bracketed count. And 503 of 1,000 layouts
had no heading at all, because a great many sites just repeat a card.

Two mechanisms replace the list. The heading grammar is *composed* from
qualifiers and job nouns rather than enumerated, which works here — unlike
platform names, this vocabulary really is closed, and a heading nobody has seen
is still made of the same parts. And a structural rule catches the rest: a
page's own labelled facts sit above its body, so a labelled row appearing below
it, introduced by its own title and employer, belongs to something else.

The second half of that rule is the part worth keeping honest. A page may
legitimately state its pay below its body, and an earlier version of this cut
it — so the discriminator is whether a *card* introduces the row, not merely
where the row sits.
"""

from __future__ import annotations

import random

import pytest

from app.core.job_import_labelled_fields import labelled_facts, primary_job_text
from tests.import_vocabulary import OTHER_JOB_HEADINGS, heading_variants

NEIGHBOUR_PAY = 95000
PRIMARY_PAY = 5000


def _page_with_heading(heading: str, *, primary_pay: int | None = None) -> str:
    lines = ["Content Creator Primary", "Larkfield Studio"]
    if primary_pay is not None:
        lines += [f"Compensation: INR {primary_pay} per month", "Type: Freelance"]
    lines += ["About the role", "Own our social presence."]
    lines += [
        heading,
        "Senior Video Editor",
        f"Compensation: INR {NEIGHBOUR_PAY} per month",
        "Type: Full-time",
    ]
    return "\n".join(lines)


class TestTheHeadingSpaceIsCovered:
    VARIANTS = [
        variant
        for heading in OTHER_JOB_HEADINGS
        for variant in heading_variants(heading)
    ]

    def test_there_are_enough_variants_to_be_worth_trusting(self) -> None:
        assert len(self.VARIANTS) >= 300, len(self.VARIANTS)

    @pytest.mark.parametrize("chunk", range(8))
    def test_no_heading_variant_lets_a_neighbours_rate_through(
        self, chunk: int
    ) -> None:
        for variant in self.VARIANTS[chunk::8]:
            facts = labelled_facts(_page_with_heading(variant))

            assert facts.budget_amount != NEIGHBOUR_PAY, (
                f"{variant!r} did not end the primary job"
            )

    @pytest.mark.parametrize("chunk", range(8))
    def test_the_primarys_own_rate_still_survives_every_heading(
        self, chunk: int
    ) -> None:
        for variant in self.VARIANTS[chunk::8]:
            facts = labelled_facts(_page_with_heading(variant, primary_pay=PRIMARY_PAY))

            # Cutting is only useful if it cuts in the right place.
            assert facts.budget_amount == PRIMARY_PAY, variant

    def test_an_unseen_heading_made_of_the_same_parts_still_works(self) -> None:
        # None of these are in the generated list either. The grammar composes
        # qualifiers with job nouns, so it covers the space rather than points
        # in it.
        for invented in (
            "Further related listings",
            "More suggested positions",
            "Other available opportunities",
            "Additional featured roles",
        ):
            facts = labelled_facts(_page_with_heading(invented))

            assert facts.budget_amount != NEIGHBOUR_PAY, invented


class TestAPostingsOwnHeadingsAreNeverABoundary:
    @pytest.mark.parametrize(
        "heading",
        [
            "About the role",
            "Responsibilities",
            "Key responsibilities",
            "Requirements",
            "Qualifications",
            "What you'll do",
            "Who you are",
            "Benefits",
            "Skills",
            "How to apply",
        ],
    )
    def test_the_page_is_not_cut_at_its_own_section(self, heading: str) -> None:
        text = f"Content Creator\n{heading}\nDetails about the work.\nMore detail."

        # Cutting here would throw away the job's own description.
        assert heading in primary_job_text(text), heading


class TestACardWithNoHeadingIsStillAnotherJob:
    """The structural half: half of a thousand layouts had no heading at all."""

    @staticmethod
    def _layout(seed: int) -> tuple[str, int | None]:
        rng = random.Random(seed)
        primary_pay = rng.choice([None, PRIMARY_PAY])
        lines = ["Content Creator Primary", "Larkfield Studio"]
        if primary_pay is not None:
            lines += [f"Compensation: INR {primary_pay} per month", "Type: Freelance"]
        lines += [
            "About the role",
            "Own our social presence.",
            "Responsibilities",
            "Edit Reels.",
        ]
        for index in range(rng.randint(1, 4)):
            lines += [
                f"Senior Video Editor {index}",
                f"Northgate {index} Media",
                f"Compensation: INR {NEIGHBOUR_PAY + index} per month",
                "Type: Full-time",
                "Location: Mumbai, Maharashtra, IN",
            ]
        return "\n".join(lines), primary_pay

    @pytest.mark.parametrize("chunk", range(10))
    def test_a_thousand_heading_free_layouts_leak_nothing(self, chunk: int) -> None:
        for seed in range(chunk, 1000, 10):
            text, expected = self._layout(seed)
            got = labelled_facts(text).budget_amount

            if expected is None:
                assert got is None, f"seed {seed}: took a neighbour's rate {got}"
            else:
                assert got == expected, f"seed {seed}: got {got}"


class TestAPostingMayStateItsPayBelowItsBody:
    """The false negative the structural rule nearly introduced."""

    def test_a_rate_after_the_responsibilities_is_still_this_jobs(self) -> None:
        text = "\n".join(
            [
                "Content Creator",
                "Larkfield Studio",
                "About the role",
                "Own our social presence.",
                "Responsibilities",
                "Edit Reels.",
                "Write captions.",
                "Compensation: INR 5000 per month",
                "Type: Freelance",
            ]
        )
        facts = labelled_facts(text)

        # Position alone is not evidence. What makes a below-body row somebody
        # else's is being introduced by their title and employer; prose above
        # it means the page is still talking about itself.
        assert facts.budget_amount == PRIMARY_PAY
        assert facts.engagement_type == "ongoing_freelance"

    def test_a_page_with_no_body_at_all_keeps_its_facts(self) -> None:
        text = "Content Creator\nCompensation: INR 5000 per month\nType: Freelance"

        assert labelled_facts(text).budget_amount == PRIMARY_PAY
