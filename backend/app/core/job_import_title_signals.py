"""What a job title already says, so the assistant stops asking about it.

A post titled "AI graphics designer and video editor intern - 6 months onsite"
states the engagement, the work mode and the duration in its own headline. Asking
the recruiter for those is the clearest way to look like a scraper rather than a
reader: the answer was in the first line of what they handed over.

Settled values are read from the title itself, never from market assumptions or
incidental body text about a collaborator, team, or past project. Each signal
names a job attribute; none of them touches anything about a candidate.

Confidence is deliberately uneven. "Intern" in a title is unambiguous, as is a
single exact catalog craft such as "Video Editor", so both are settled. Titles
that name multiple crafts — "graphics designer and video editor" — still leave
the role for the recruiter to choose.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Final

from app.core.job_domain_taxonomy import CREATOR_CONTENT_NICHES


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

#: Wording that names a supported craft without using its catalog name.
#:
#: Job titles are written for candidates, not for a taxonomy. "YouTube Thumbnail
#: Artist" is a thumbnail designer; "Short-form Content Editor" is a shorts
#: editor. Mapping these is what stops the assistant asking a recruiter to
#: classify a job whose title has already said what it is.
_ROLE_SYNONYMS: Final[tuple[tuple[str, str], ...]] = (
    ("podcast post production", "podcast-producer"),
    ("podcast post-production", "podcast-producer"),
    ("podcast editor", "podcast-producer"),
    ("short form content editor", "shorts-editor"),
    ("short-form content editor", "shorts-editor"),
    ("short form editor", "shorts-editor"),
    ("reels editor", "shorts-editor"),
    ("thumbnail artist", "thumbnail-designer"),
    ("motion graphics designer", "motion-designer"),
    ("motion graphics artist", "motion-designer"),
    ("content growth consultant", "content-strategist"),
    ("content growth strategist", "content-strategist"),
    ("growth strategist", "content-strategist"),
    ("social media executive", "social-media-manager"),
    ("social media coordinator", "social-media-manager"),
    ("voiceover artist", "voice-over-artist"),
    ("voice artist", "voice-over-artist"),
    ("community moderator", "community-manager"),
    ("channel operator", "channel-manager"),
    # Craft named as an activity rather than as a person.
    #
    # A title reading "Visual Content Creator - Video Editing, VFX & Animation"
    # names three crafts and matched none of them, because every entry below was
    # an agent noun: "editor", "animator", "designer". The role arrived empty and
    # the recruiter was handed a draft with no craft and no question about it.
    ("video editing", "video-editor"),
    ("film editing", "video-editor"),
    ("motion graphics", "motion-designer"),
    ("motion design", "motion-designer"),
    # Visual effects has no craft of its own in the catalog, and among the ones
    # that exist it is motion and compositing work. Read from the title it is
    # substantial evidence; the same words appearing once in a list of alternative
    # backgrounds are not, which is why only the title is read for candidates.
    ("vfx", "motion-designer"),
    ("visual effects", "motion-designer"),
    ("animation", "animator"),
    ("2d animation", "animator"),
    ("3d animation", "animator"),
    ("graphic design", "graphic-designer"),
    ("thumbnail design", "thumbnail-designer"),
    ("scriptwriting", "scriptwriter"),
    ("script writing", "scriptwriter"),
    ("copywriting", "copywriter"),
    ("audio engineering", "audio-engineer"),
    ("audio editing", "audio-engineer"),
    ("sound editing", "audio-engineer"),
    ("sound design", "audio-engineer"),
    ("podcast production", "podcast-producer"),
    ("illustration", "illustrator"),
    ("videography", "videographer"),
    ("voice over", "voice-over-artist"),
    ("community management", "community-manager"),
    ("social media management", "social-media-manager"),
    ("content strategy", "content-strategist"),
)

#: Phrases where "editing" belongs to a craft other than video.
#:
#: "Editing" alone almost always means video editing in this marketplace, and a
#: title reading "Editing, Motion Graphics and Animation" should say so. But the
#: word is not exclusively ours, and matching it blindly would file a copy editor
#: as a video editor — so the bare word only counts when nothing narrows it.
_EDITING_BELONGS_ELSEWHERE: Final[tuple[str, ...]] = (
    "copy editing",
    "photo editing",
    "image editing",
    "audio editing",
    "sound editing",
    "script editing",
    "text editing",
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
    ("newsletter writer", "newsletter-writer"),
    ("paid ads specialist", "paid-ads-specialist"),
    ("seo specialist", "seo-specialist"),
    ("social media manager", "social-media-manager"),
    ("community manager", "community-manager"),
    ("channel manager", "channel-manager"),
    ("project manager", "project-manager"),
    ("voice over artist", "voice-over-artist"),
    ("ugc creator", "ugc-creator"),
    ("researcher", "researcher"),
    ("other creator role", "other-creator-role"),
    ("scriptwriter", "scriptwriter"),
    ("script writer", "scriptwriter"),
    ("copywriter", "copywriter"),
    ("videographer", "videographer"),
    ("animator", "animator"),
    ("illustrator", "illustrator"),
)

#: Wording that states, in words, that no prior experience is needed.
#:
#: These are the only non-numeric phrasings that survive, because each of them
#: *is* a statement about how much experience is required rather than a label for
#: how senior someone is. "Fresher" is the common Indian-market word for exactly
#: that, and it was being ignored entirely, so a title that had already answered
#: the question still produced one.
#:
#: What used to sit here alongside them was a seniority table: senior → 5–8
#: years, junior → 1–3, mid level → 3–5. That invented numbers out of adjectives.
#: "Senior" is a judgement about scope and independence, and studios mean wildly
#: different spans by it; publishing "5–8 years" from it states a requirement the
#: source never made, and a candidate with nine years reads themselves out of a
#: job they were wanted for. Seniority wording still reaches the listing — it is
#: in the title, which is preserved verbatim — and the recruiter can add years in
#: the editor if they want them.
_NO_EXPERIENCE_WORDS: Final[tuple[tuple[str, str], ...]] = (
    ("fresher", "No prior experience required"),
    ("freshers", "No prior experience required"),
    ("no experience", "No prior experience required"),
    ("no prior experience", "No prior experience required"),
)

#: "2-4 years", "3+ years" stated as an experience requirement.
#:
#: Matched against text that still has its hyphens: the general normaliser turns
#: "2-4 years" into "2 4 years", which reads as four years rather than a range.
_EXPERIENCE_RANGE = re.compile(
    r"\b(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})\s*\+?\s*years?\b"
    r"|\b(\d{1,2})\s*\+\s*years?\b"
    r"|\b(\d{1,2})\s*years?\s+(?:of\s+)?(?:\w+\s+){0,2}exp"
)

#: "at least 5 years", "minimum 3 years" — a floor stated in words.
#:
#: Kept separate from the range above because the qualifier is part of the claim.
#: A title asking for at least five years is not asking for exactly five, and
#: writing back the bare figure would quietly close an open requirement.
_EXPERIENCE_FLOOR = re.compile(
    r"\b(?:(minimum)(?:\s+of)?|(at\s+least))\s+(\d{1,2})\s*\+?\s*years?\b",
    re.IGNORECASE,
)

#: "6 months", "3-month" — a stated length is a fixed period.
_DURATION = re.compile(r"\b(\d{1,2})\s*[-–]?\s*(month|months|week|weeks|year|years)\b")


def _overlaps(left: tuple[int, int], right: tuple[int, int]) -> bool:
    return left[0] < right[1] and right[0] < left[1]


def _hyphenated(text: str) -> str:
    """Lowercased, but with hyphens kept so numeric ranges survive."""

    return re.sub(r"[^a-z0-9+–-]+", " ", text.lower()).strip()


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def title_signals(title: str | None, *, extra_text: str | None = None) -> TitleSignals:
    """Read the job attributes a title states or strongly implies."""

    if not title or not title.strip():
        return TitleSignals()

    # Settlement is title-only. ``extra_text`` may help with non-authoritative
    # niche suggestions below, but a body mention cannot decide the role's
    # engagement, work mode, experience, or duration.
    haystack = _normalise(title)
    hyphenated = _hyphenated(title)
    padded = f" {haystack} "
    # Only the title has authority to settle a role. A body sentence such as
    # "collaborate with our video editor" describes a colleague, not this job.
    # Ignoring body-only role words is safer than creating a suggestion without
    # field-specific evidence.
    role_padded = padded
    suggestion_text = f"{title} {extra_text or ''}"
    suggestion_padded = f" {_normalise(suggestion_text)} "
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

    # Synonyms first, so a specific phrase wins over the general word inside it
    # and "short-form content editor" is not merely "editor".
    matched_roles = list(
        dict.fromkeys(
            [
                value
                for phrase, value in _ROLE_SYNONYMS
                if f" {_normalise(phrase)} " in role_padded
            ]
            + [
                value
                for word, value in _ROLE_WORDS
                if f" {_normalise(word)} " in role_padded
            ]
        )
    )
    # "Editing" on its own, once nothing else has claimed it.
    if (
        "video-editor" not in matched_roles
        and " editing " in role_padded
        and not any(
            f" {_normalise(phrase)} " in role_padded
            for phrase in _EDITING_BELONGS_ELSEWHERE
        )
    ):
        matched_roles.append("video-editor")

    if len(matched_roles) == 1:
        # One exact catalog craft is the role the title declares. Asking the
        # recruiter to select Video Editor after reading "Video Editor" is not
        # caution; it is duplicated work.
        settled["primary_role_key"] = matched_roles[0]
    elif len(matched_roles) > 1:
        # "graphics designer and video editor" — the recruiter has to choose,
        # so the alternatives are offered rather than one of them picked.
        suggested["primary_role_key_options"] = matched_roles

    # A stated range wins over a word: "senior, 2-4 years" means 2-4.
    floor = _EXPERIENCE_FLOOR.search(hyphenated)
    experience = _EXPERIENCE_RANGE.search(hyphenated)
    if floor:
        wording = "Minimum" if floor.group(1) else "At least"
        settled["experience_level"] = f"{wording} {floor.group(3)} years"
        experience = floor
    elif experience:
        low, high, plus, single = experience.groups()
        if low and high:
            settled["experience_level"] = f"{low}–{high} years"
        elif plus:
            # "5+ years" is open-ended and stays that way. Closing it into a
            # range invented a ceiling the source never gave: this line used to
            # read base + 3, so a post asking for five years or more advertised
            # itself as wanting no more than eight.
            settled["experience_level"] = f"{plus}+ years"
        else:
            settled["experience_level"] = f"{single} years"
    else:
        for word, value in _NO_EXPERIENCE_WORDS:
            if f" {_normalise(word)} " in padded:
                settled["experience_level"] = value
                break

    for niche in CREATOR_CONTENT_NICHES:
        # Suggested, never settled: a post can mention a sector in passing, and
        # the recruiter confirming one chip is cheaper than an unwanted claim.
        if f" {_normalise(niche)} " in suggestion_padded:
            suggested.setdefault("content_niches", []).append(niche)  # type: ignore[union-attr]

    # Years spent working are not the length of the contract. Without this, a
    # title asking for "2-4 years experience" produced a four-year engagement.
    duration = _DURATION.search(hyphenated)
    if duration and experience and _overlaps(duration.span(), experience.span()):
        duration = None
    if duration:
        amount, unit = duration.groups()
        settled["duration_type"] = "fixed_period"
        settled["duration_value"] = int(amount)
        settled["duration_unit"] = (
            "months" if unit.startswith("month") else "weeks" if unit.startswith("week") else "years"
        )

    return TitleSignals(settled=settled, suggested=suggested)
