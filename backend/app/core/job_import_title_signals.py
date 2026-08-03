"""What a job title already says, so the assistant stops asking about it.

A post titled "AI graphics designer and video editor intern - 6 months onsite"
states the engagement, the work mode and the duration in its own headline. Asking
the recruiter for those is the clearest way to look like a scraper rather than a
reader: the answer was in the first line of what they handed over.

These are read from the title and the role's own description, never from market
assumptions about the person. Each signal names a job attribute; none of them
touches anything about a candidate.

Confidence is deliberately uneven. "Intern" in a title is unambiguous, so the
engagement type is settled. A role word is a strong hint but titles routinely
name two crafts — "graphics designer and video editor" — so the role is proposed
for confirmation rather than chosen.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Final


@dataclass(frozen=True)
class TitleSignals:
    """Values the title settles outright, and values it merely suggests."""

    #: Safe to set: the title states them unambiguously.
    settled: dict[str, object] = field(default_factory=dict)
    #: Likely, but the recruiter confirms — a title can name two crafts.
    suggested: dict[str, object] = field(default_factory=dict)

    def is_empty(self) -> bool:
        return not (self.settled or self.suggested)


#: Engagement wording that means exactly one thing in a job title.
_ENGAGEMENT_WORDS: Final[tuple[tuple[str, str], ...]] = (
    ("internship", "internship"),
    ("intern", "internship"),
    ("full-time", "full_time"),
    ("full time", "full_time"),
    ("part-time", "part_time"),
    ("part time", "part_time"),
    ("retainer", "retainer"),
    ("freelance", "ongoing_freelance"),
    ("contract", "fixed_term"),
)

_WORK_MODE_WORDS: Final[tuple[tuple[str, str], ...]] = (
    ("on-site", "onsite"),
    ("onsite", "onsite"),
    ("on site", "onsite"),
    ("in-office", "onsite"),
    ("hybrid", "hybrid"),
    ("remote", "remote"),
    ("work from home", "remote"),
    ("wfh", "remote"),
)

#: Role words, longest first so "long-form editor" is not eaten by "editor".
_ROLE_WORDS: Final[tuple[tuple[str, str], ...]] = (
    ("thumbnail designer", "thumbnail-designer"),
    ("motion designer", "motion-designer"),
    ("graphic designer", "graphic-designer"),
    ("graphics designer", "graphic-designer"),
    ("brand designer", "brand-designer"),
    ("long-form editor", "long-form-editor"),
    ("shorts editor", "shorts-editor"),
    ("video editor", "video-editor"),
    ("podcast producer", "podcast-producer"),
    ("audio engineer", "audio-engineer"),
    ("content strategist", "content-strategist"),
    ("social media manager", "social-media-manager"),
    ("community manager", "community-manager"),
    ("channel manager", "channel-manager"),
    ("scriptwriter", "scriptwriter"),
    ("script writer", "scriptwriter"),
    ("copywriter", "copywriter"),
    ("videographer", "videographer"),
    ("animator", "animator"),
    ("illustrator", "illustrator"),
)

#: "6 months", "3-month" — a stated length is a fixed period.
_DURATION = re.compile(r"\b(\d{1,2})\s*[-–]?\s*(month|months|week|weeks|year|years)\b")


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def title_signals(title: str | None, *, extra_text: str | None = None) -> TitleSignals:
    """Read the job attributes a title states or strongly implies."""

    if not title or not title.strip():
        return TitleSignals()

    haystack = _normalise(f"{title} {extra_text or ''}")
    padded = f" {haystack} "
    settled: dict[str, object] = {}
    suggested: dict[str, object] = {}

    for word, value in _ENGAGEMENT_WORDS:
        if f" {_normalise(word)} " in padded:
            settled["engagement_type"] = value
            break

    for word, value in _WORK_MODE_WORDS:
        if f" {_normalise(word)} " in padded:
            settled["work_mode"] = value
            break

    matched_roles = [
        value for word, value in _ROLE_WORDS if f" {_normalise(word)} " in padded
    ]
    if len(matched_roles) == 1:
        # One craft named: still a suggestion, because a title is a headline
        # rather than a taxonomy entry and the recruiter may mean a neighbour.
        suggested["primary_role_key"] = matched_roles[0]
    elif len(matched_roles) > 1:
        # "graphics designer and video editor" — the recruiter has to choose,
        # so the alternatives are offered rather than one of them picked.
        suggested["primary_role_key_options"] = matched_roles

    duration = _DURATION.search(haystack)
    if duration:
        amount, unit = duration.groups()
        settled["duration_type"] = "fixed_period"
        settled["duration_value"] = int(amount)
        settled["duration_unit"] = (
            "months" if unit.startswith("month") else "weeks" if unit.startswith("week") else "years"
        )

    return TitleSignals(settled=settled, suggested=suggested)
