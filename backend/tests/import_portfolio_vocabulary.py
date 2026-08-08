"""Portfolio wording generated from meaning, not from the product's word list.

Three decisions in this importer still consult a curated set of "work nouns":
whether a platform beside a preposition is the candidate's own work or somewhere
to send an application, and whether a fragment naming a platform is material
worth keeping. Each of those is high-impact — one direction publishes a routing
destination, the other deletes what a recruiter asked for.

A curated list is the wrong shape for that when the category is open. Nobody has
heard of Zephyrgram, and "include links to your best Zephyrgram edits" is still
obviously a portfolio request; "apply by messaging us on Zephyrgram" is still
obviously not. The grammar says so in both cases, and the noun is doing none of
the work.

So the sentences here are built from four independent semantic components — a
frame, a work noun, a platform and a possessive — and every case declares which
class it belongs to *before* any production code sees it. Invented nouns and
invented platforms are included deliberately: they are the open-world half, and
a decision that needs them listed is a decision that will be wrong on the web.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

# --------------------------------------------------------------------------
# Semantic components
# --------------------------------------------------------------------------

#: What a candidate's own work can be called. The last few are invented.
WORK_NOUNS: tuple[str, ...] = (
    "portfolio",
    "showreel",
    "demo reel",
    "work samples",
    "samples",
    "examples",
    "past work",
    "previous work",
    "selected work",
    "projects",
    "case studies",
    "clips",
    "edits",
    "articles",
    "designs",
    "campaigns",
    "channel",
    "profile",
    "creator page",
    "website",
    "personal site",
    "gallery",
    "collection",
    "body of work",
    "published work",
    "client work",
    # Open-world: structurally identical, in no list anywhere.
    "sizzle reel",
    "cutdowns",
    "moodboards",
    "lookbook",
    "spec pieces",
)

#: Platforms, half of them invented.
PLATFORMS: tuple[str, ...] = (
    "YouTube",
    "Vimeo",
    "Instagram",
    "TikTok",
    "Behance",
    "Dribbble",
    "GitHub",
    "Substack",
    "Twitch",
    "Zephyrgram",
    "Larkfeed",
    "Corvid",
    "Nimbusreel",
    "Quillstream",
)

#: Frames that ask for the candidate's own work. Material must survive.
PORTFOLIO_FRAMES: tuple[str, ...] = (
    "Include links to your {platform} {noun}.",
    "Share your {platform} {noun}.",
    "Send examples of your {platform} {noun}.",
    "We would like to see your {platform} {noun}.",
    "Attach two of your {platform} {noun}.",
    "Include your best {platform} {noun}.",
    "Show us your {platform} {noun}.",
    "Add a link to your {platform} {noun}.",
    "Your {platform} {noun} would help us decide.",
    "Please include recent {platform} {noun}.",
)

#: Frames that route an application away. Destination must be removed.
DESTINATION_FRAMES: tuple[str, ...] = (
    "Apply by messaging us on {platform}.",
    "Send your {noun} to us on {platform}.",
    "Submit your {noun} through {platform}.",
    "DM us on {platform} to apply.",
    "Contact the hiring manager on {platform}.",
    "Reach out on {platform} with your {noun}.",
    "Apply through {platform}.",
    "Message us on {platform} with your {noun}.",
)

#: Frames where the platform is the job itself. Context must survive.
SKILL_FRAMES: tuple[str, ...] = (
    "Manage our {platform} community.",
    "You will own our {platform} presence.",
    "Grow our {platform} following.",
    "Plan and schedule {platform} content.",
    "Report on {platform} performance weekly.",
    "Experience with {platform} is useful.",
    "Run campaigns across {platform}.",
    "Moderate our {platform} channel.",
)

#: Ordinary job content that mentions a work noun with no platform at all.
ORDINARY_FRAMES: tuple[str, ...] = (
    "You will build a {noun} of finished pieces for the brand.",
    "The role produces a steady {noun} across the quarter.",
    "We keep an internal {noun} of approved assets.",
    "Our {noun} is reviewed by the creative lead each month.",
)


@dataclass(frozen=True)
class PortfolioCase:
    """One sentence and the class it belongs to, declared before parsing."""

    text: str
    #: PORTFOLIO_MATERIAL | APPLICATION_DESTINATION | JOB_SKILL_CONTEXT | ORDINARY
    semantic_class: str
    platform: str | None
    noun: str | None
    frame: str


def portfolio_cases() -> list[PortfolioCase]:
    return [
        PortfolioCase(
            text=frame.format(platform=platform, noun=noun),
            semantic_class="PORTFOLIO_MATERIAL",
            platform=platform,
            noun=noun,
            frame=frame,
        )
        for frame in PORTFOLIO_FRAMES
        for platform in PLATFORMS
        for noun in WORK_NOUNS
    ]


def destination_cases() -> list[PortfolioCase]:
    return [
        PortfolioCase(
            text=frame.format(platform=platform, noun=noun),
            semantic_class="APPLICATION_DESTINATION",
            platform=platform,
            noun=noun,
            frame=frame,
        )
        for frame in DESTINATION_FRAMES
        for platform in PLATFORMS
        for noun in WORK_NOUNS[:8]
    ]


def skill_cases() -> list[PortfolioCase]:
    return [
        PortfolioCase(
            text=frame.format(platform=platform),
            semantic_class="JOB_SKILL_CONTEXT",
            platform=platform,
            noun=None,
            frame=frame,
        )
        for frame in SKILL_FRAMES
        for platform in PLATFORMS
    ]


def ordinary_cases() -> list[PortfolioCase]:
    return [
        PortfolioCase(
            text=frame.format(noun=noun),
            semantic_class="ORDINARY",
            platform=None,
            noun=noun,
            frame=frame,
        )
        for frame in ORDINARY_FRAMES
        for noun in WORK_NOUNS
    ]


def contrastive_pairs(*, seed: int = 20260808) -> list[tuple[PortfolioCase, PortfolioCase]]:
    """The same platform in both readings, side by side.

    A pair is the sharpest form of this test: any rule that gets both halves
    right cannot be keying on the platform name, because the name is identical.
    """

    rng = random.Random(seed)
    portfolio = portfolio_cases()
    destinations = destination_cases()
    by_platform: dict[str, list[PortfolioCase]] = {}
    for case in destinations:
        by_platform.setdefault(case.platform or "", []).append(case)

    pairs: list[tuple[PortfolioCase, PortfolioCase]] = []
    for case in portfolio:
        options = by_platform.get(case.platform or "")
        if not options:
            continue
        pairs.append((case, rng.choice(options)))
    return pairs


ALL_CASES = portfolio_cases() + destination_cases() + skill_cases() + ordinary_cases()
