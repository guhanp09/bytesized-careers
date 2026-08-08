"""Whose facts these are, decided by structure rather than by heading wording.

A neighbouring listing's salary reaching this job's draft is the worst thing this
importer can do: the number is real, the formatting is right, and it belongs to
somebody else. The previous campaign fixed it for a composed heading grammar and
a structural rule for pages with no heading at all.

That structural rule turned out to be *gated* on recognising a body heading. So a
page using wording nobody had listed — "Your creative mandate", "Day to day",
"What success looks like" — disabled it entirely, and 437 of 1,500 generated
layouts took a neighbour's salary with the heading list fully intact.

Prose is the fix, and it needs no vocabulary: a sentence is where a page's header
ends, whatever the heading above it happened to be called. The heading grammar
still runs and still helps, but it is no longer what the invariant rests on —
the last test empties it completely and the contamination count stays at zero.
"""

from __future__ import annotations

import random
import re

import pytest

import app.core.job_import_labelled_fields as labelled

NEIGHBOUR_PAY = 95000
PRIMARY_PAY = 5000

#: Headings the product recognises.
KNOWN_BODY_HEADINGS = (
    "About the role",
    "Responsibilities",
    "Requirements",
    "What you'll do",
    "Who you are",
    "Benefits",
    "Skills",
    "Qualifications",
    "How to apply",
    "Overview",
)

#: Headings it has never seen, composed the way real pages compose them.
NOVEL_BODY_HEADINGS = (
    "Your creative mandate",
    "What success looks like",
    "The work ahead",
    "Where you'll contribute",
    "Your focus areas",
    "Day to day",
    "Key tasks",
    "Your mission",
    "Scope",
    "The opportunity",
    "In this role",
    "What you'll own",
    "Duties",
    "Your impact",
    "How this role matters",
    "The brief",
)

#: Headings that introduce other people's jobs, known and invented.
NEIGHBOUR_HEADINGS = (
    None,  # no heading at all — the case that matters most
    "Similar jobs",
    "Related roles",
    "Other opportunities",
    "Fresh opportunities",
    "Explore another role",
    "Roles worth considering",
    "More ways to join us",
)

ALL_BODY_HEADINGS = KNOWN_BODY_HEADINGS + NOVEL_BODY_HEADINGS


def _layout(seed: int) -> tuple[str, int | None]:
    """One page: a primary job, then one or more foreign cards."""

    rng = random.Random(seed)
    primary_pay = rng.choice([None, PRIMARY_PAY])
    body_heading = rng.choice(ALL_BODY_HEADINGS)
    neighbour_heading = rng.choice(NEIGHBOUR_HEADINGS)

    lines = ["Content Creator Primary", "Larkfield Studio"]
    if primary_pay is not None:
        lines += [f"Compensation: INR {primary_pay} per month", "Type: Freelance"]
    lines += [
        body_heading,
        "Own our social presence across several channels.",
        "Edit Reels for the brand each week.",
    ]
    if neighbour_heading:
        lines.append(neighbour_heading)
    for index in range(rng.randint(1, 3)):
        lines += [
            f"Senior Video Editor {index}",
            # Sometimes the same employer, sometimes a different one — a card
            # is a card either way.
            rng.choice([f"Northgate {index} Media", "Larkfield Studio"]),
            f"Compensation: INR {NEIGHBOUR_PAY + index} per month",
            "Type: Full-time",
            "Location: Mumbai, Maharashtra, IN",
        ]
    return "\n".join(lines), primary_pay


LAYOUTS = [_layout(seed) for seed in range(5000)]


class TestTheGeneratedLayoutsAreWorthTrusting:
    def test_there_are_enough_and_they_vary(self) -> None:
        assert len(LAYOUTS) >= 5000, len(LAYOUTS)

        texts = [text for text, _ in LAYOUTS]
        # Both the with-pay and without-pay primary must appear: the second is
        # where a neighbour's figure becomes the first one on the page.
        assert any(pay is None for _text, pay in LAYOUTS)
        assert any(pay is not None for _text, pay in LAYOUTS)
        # Novel body headings and heading-free neighbours must both occur.
        assert any("Your creative mandate" in text for text in texts)
        assert any(
            not any(heading in text for heading in NEIGHBOUR_HEADINGS if heading)
            for text in texts
        )


class TestNoForeignFactEverEntersThePrimaryJob:
    @pytest.mark.parametrize("chunk", range(20))
    def test_a_generated_layout_takes_nothing_from_a_neighbour(self, chunk: int) -> None:
        for index in range(chunk, len(LAYOUTS), 20):
            text, expected = LAYOUTS[index]
            got = labelled.labelled_facts(text).budget_amount

            if expected is None:
                assert got is None, (
                    f"seed {index}: took a neighbour's rate {got}"
                )
            else:
                assert got == expected, f"seed {index}: got {got}, job says {expected}"

    def test_a_novel_body_heading_does_not_disable_the_boundary(self) -> None:
        # The defect this found. With a heading nobody had listed, the
        # structural rule never ran at all.
        text = "\n".join(
            [
                "Content Creator Primary",
                "Larkfield Studio",
                "Your creative mandate",
                "Own our social presence across several channels.",
                "Senior Video Editor",
                "Northgate Media",
                f"Compensation: INR {NEIGHBOUR_PAY} per month",
            ]
        )

        assert labelled.labelled_facts(text).budget_amount is None

    def test_a_novel_neighbour_heading_is_still_a_boundary(self) -> None:
        text = "\n".join(
            [
                "Content Creator Primary",
                "Larkfield Studio",
                "The brief",
                "Own our social presence across several channels.",
                "Roles worth considering",
                "Senior Video Editor",
                "Northgate Media",
                f"Compensation: INR {NEIGHBOUR_PAY} per month",
            ]
        )

        assert labelled.labelled_facts(text).budget_amount is None


class TestThePrimaryJobKeepsItsOwnFacts:
    @pytest.mark.parametrize("heading", ALL_BODY_HEADINGS)
    def test_a_rate_above_any_body_heading_survives(self, heading: str) -> None:
        text = "\n".join(
            [
                "Content Creator",
                "Larkfield Studio",
                f"Compensation: INR {PRIMARY_PAY} per month",
                "Type: Freelance",
                heading,
                "Own our social presence across several channels.",
            ]
        )
        facts = labelled.labelled_facts(text)

        assert facts.budget_amount == PRIMARY_PAY, heading
        assert facts.engagement_type == "ongoing_freelance", heading

    @pytest.mark.parametrize("heading", ALL_BODY_HEADINGS)
    def test_a_rate_below_a_body_heading_still_survives(self, heading: str) -> None:
        # A page may legitimately state its pay after its description. What
        # marks a neighbour is being introduced by a card, not being lower down.
        text = "\n".join(
            [
                "Content Creator",
                "Larkfield Studio",
                heading,
                "Own our social presence across several channels.",
                "Edit Reels for the brand each week.",
                f"Compensation: INR {PRIMARY_PAY} per month",
                "Type: Freelance",
            ]
        )

        assert labelled.labelled_facts(text).budget_amount == PRIMARY_PAY, heading


class TestTheHeadingListIsNoLongerLoadBearing:
    """Emptied entirely, and the isolation invariant still holds."""

    @pytest.fixture
    def without_headings(self):
        original = labelled._BODY_SECTION
        yield lambda: setattr(
            labelled, "_BODY_SECTION", re.compile(r"^(?!x)x$", re.MULTILINE)
        )
        labelled._BODY_SECTION = original

    def test_removing_every_known_body_heading_changes_nothing(
        self, without_headings
    ) -> None:
        without_headings()

        contaminated = []
        for index in range(0, len(LAYOUTS), 5):
            text, expected = LAYOUTS[index]
            got = labelled.labelled_facts(text).budget_amount
            if expected is None and got is not None:
                contaminated.append(index)
            elif expected is not None and got != expected:
                contaminated.append(index)

        # Prose marks the end of the header, and a sentence needs no
        # vocabulary. The heading grammar improves recall; it is not what the
        # invariant rests on.
        assert contaminated == [], contaminated[:5]
