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
    ("youtube shorts video editor", "shorts-editor"),
    ("short form video editor", "shorts-editor"),
    ("short-form video editor", "shorts-editor"),
    ("short form editor", "shorts-editor"),
    ("reels editor", "shorts-editor"),
    ("youtube long form video editor", "long-form-editor"),
    ("youtube long-form video editor", "long-form-editor"),
    ("long form video editor", "long-form-editor"),
    ("long-form video editor", "long-form-editor"),
    ("film editor", "video-editor"),
    ("audio editor", "audio-engineer"),
    ("sound editor", "audio-engineer"),
    ("thumbnail artist", "thumbnail-designer"),
    ("thumbnail creator", "thumbnail-designer"),
    ("thumbnail editor", "thumbnail-designer"),
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

# These titles discuss a creator craft without hiring that practitioner.  The
# occupational head wins over a substring: a Video Editing Software Engineer
# builds editing software; an Editing Instructor teaches the craft. Filing
# either as a Video Editor would silently put the listing in the wrong market.
_NON_CREATOR_OCCUPATION = re.compile(
    r"\b(?:software\s+engineer|software\s+developer|app(?:lication)?\s+developer|"
    r"web\s+developer|instructor|teacher|trainer|coach|"
    r"sales(?:\s+executive|\s+representative|\s+manager)?|"
    r"customer\s+(?:support|success|service)(?:\s+\w+)?|"
    r"technical\s+support)\b",
    re.IGNORECASE,
)

_OCCUPATIONAL_PLURALS: Final[dict[str, str]] = {
    "editors": "editor",
    "designers": "designer",
    "writers": "writer",
    "managers": "manager",
    "producers": "producer",
    "creators": "creator",
    "artists": "artist",
    "engineers": "engineer",
    "specialists": "specialist",
    "animators": "animator",
    "illustrators": "illustrator",
    "videographers": "videographer",
    "copywriters": "copywriter",
    "scriptwriters": "scriptwriter",
    "researchers": "researcher",
}

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

_EXPERIENCE_MONTHS = re.compile(
    r"\b(?:(minimum)(?:\s+of)?|(at\s+least))?\s*(\d{1,3})\s*[-–]?\s*months?"
    r"\s+(?:of\s+)?(?:experience|exp)\b",
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
    role_haystack = " ".join(
        _OCCUPATIONAL_PLURALS.get(token, token) for token in haystack.split()
    )
    role_padded = f" {role_haystack} "
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
    matched_roles: list[str] = []
    creator_occupation = not _NON_CREATOR_OCCUPATION.search(title)
    if creator_occupation:
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
        # A specialist title naturally contains the generic phrase too. The
        # more specific catalog role is the meaning, not an ambiguity between
        # two roles: "Short Form Video Editor" is a Shorts Editor.
        if any(role in matched_roles for role in ("shorts-editor", "long-form-editor")):
            matched_roles = [role for role in matched_roles if role != "video-editor"]
    # "Editing" on its own, once nothing else has claimed it.
    if (
        creator_occupation
        and
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
    month_experience = _EXPERIENCE_MONTHS.search(hyphenated)
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
    elif month_experience:
        qualifier = month_experience.group(1) or month_experience.group(2)
        amount = month_experience.group(3)
        prefix = "Minimum " if month_experience.group(1) else "At least " if qualifier else ""
        settled["experience_level"] = f"{prefix}{amount} months"
        experience = month_experience
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


#: How far into a paste a title may be. A recruiter's first line is sometimes a
#: greeting or a company name, but the title is never buried.
_TITLE_SEARCH_LINES: Final[int] = 4

#: Decoration a hiring post puts around its own title.
_TITLE_TRIM = re.compile(r"^[\s\W_]+|[\s!.:;–—-]+$", re.UNICODE)

#: Wording that introduces the title inside the same line, as a post does:
#: "We're hiring a Video Editor", "Now hiring: Video Editor", "Subject: Fwd: …".
_TITLE_LEAD_IN = re.compile(
    r"^(?:.*?\b(?:hiring|looking\s+for|seeking|wanted|we\s+need|"
    r"job\s+title|position|role|vacancy|subject|fwd)\b\s*[:\-\u2013]?\s*)+"
    r"(?:an?\s+|the\s+)?",
    re.IGNORECASE,
)

#: A title names the job. Past this, the line is describing it instead.
#:
#: Twelve, because real ones run long: "AI Graphics Designer and Video Editor
#: Intern 6 months onsite" is a title a live board published, and it carries the
#: engagement and the duration with it. Cutting at eight words read that page's
#: own title as prose and lost both. What keeps the limit honest is not its size
#: but the two guards beside it — a clause word or a sentence break disqualifies
#: a line however short it is.
_TITLE_MAX_WORDS: Final[int] = 12

#: Words that turn a title into a sentence about the title.
#:
#: Subordinators only. "and" is not one of them: "Graphics Designer and Video
#: Editor" is a title two crafts wide, and rejecting it lost the page's own
#: title along with the duration and engagement stated inside it.
_TITLE_CLAUSE = re.compile(r"\b(?:to|who|that|which|because)\b", re.IGNORECASE)

#: A full stop inside the line means it is prose that happens to start here.
#: "Video Editor. Remote-friendly. San Francisco office." names a role and is
#: three statements, not a title — and taking it as one would hand the whole
#: sentence to the title reader, which settles work mode and place from titles.
_TITLE_SENTENCE_BREAK = re.compile(r"[.!?;]\s")


def leading_job_title(text: str | None) -> str | None:
    """The job's own title, when the source opens by naming it.

    A fetched page states its title in markup, and that is where the import
    reads it. Pasted text has no markup and states its title the way every job
    post does — on the first line — so declining to read it would leave the
    draft with no title, no role, and a question about both, for a source whose
    opening words answered them.

    Deliberately narrow. A line qualifies only if it *names a role this product
    knows*, which is a far stronger test than looking title-shaped: an opening
    sentence of prose, a company name, or a greeting names none, and is left
    alone. A line that keeps going after the role — "a video editor to join our
    YouTube team" — is a sentence about the job rather than its title, and is
    left for the recruiter. That keeps the failure mode "no title read" rather
    than "a wrong title settled": the recruiter can supply the first, and would
    have to notice the second.
    """

    if not text:
        return None
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines[:_TITLE_SEARCH_LINES]:
        if len(line) > 120:
            continue
        for candidate in _title_candidates(line):
            if _names_the_job(title_signals(candidate)):
                return candidate
    return None


#: Facts a title states about the job, grouped so one fact counts once.
_TITLE_FACTS: Final[tuple[tuple[str, ...], ...]] = (
    ("engagement_type",),
    ("work_mode",),
    ("experience_level",),
    ("duration_type", "duration_value", "duration_unit"),
)


def _names_the_job(signals: TitleSignals) -> bool:
    """Whether this line is the job's title rather than a line about the job.

    A role is the clearest answer and usually the only one needed. It is not the
    only one: "AI Graphics Designer and Video Editor Intern 6 months onsite" is a
    title a live board published, and the role reader declines it on purpose,
    because two crafts in one title is a genuine ambiguity for the recruiter to
    settle. Requiring a role therefore threw away the page's own title — and the
    engagement, duration and work mode stated inside it.

    So several job facts in one short line also qualify. One does not: "Fully
    remote within India" states a work mode and is a line about the job, and
    taking it as the title would put it where a candidate reads the role.
    """

    role = signals.settled.get(
        "primary_role_key", signals.suggested.get("primary_role_key")
    )
    if isinstance(role, str) and role:
        return True
    stated = sum(
        1 for group in _TITLE_FACTS if any(key in signals.settled for key in group)
    )
    return stated >= 2


def _title_candidates(line: str) -> list[str]:
    """The line with a post's lead-in removed, then the line as written.

    Tightest first, so "We're hiring a Video Editor" settles as "Video Editor"
    rather than as the sentence that announced it.
    """

    trimmed = _TITLE_TRIM.sub("", line)
    without_lead_in = _TITLE_TRIM.sub("", _TITLE_LEAD_IN.sub("", trimmed))
    candidates = [
        candidate
        for candidate in dict.fromkeys((without_lead_in, trimmed))
        if len(candidate) >= 3
        and len(candidate.split()) <= _TITLE_MAX_WORDS
        and not _TITLE_CLAUSE.search(candidate)
        and not _TITLE_SENTENCE_BREAK.search(candidate)
    ]
    return candidates
