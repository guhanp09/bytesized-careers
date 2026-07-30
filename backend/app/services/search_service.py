from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from difflib import SequenceMatcher
from typing import Any, Literal

from app.core.search_taxonomy import (
    AVAILABILITY_ALIASES,
    ENGAGEMENT_ALIASES,
    FORMAT_ALIASES,
    GENRE_ALIASES,
    LOCATION_ALIASES,
    NICHE_ALIASES,
    PLATFORM_ALIASES,
    ROLE_ALIASES,
    SKILL_ALIASES,
    STOP_WORDS,
    TOOL_ALIASES,
    WORK_MODE_ALIASES,
    SearchAlias,
    normalize_search_text,
)
from app.models import Job, TalentListing, User
from app.repositories.search_repository import SearchRepository
from app.schemas.search import (
    SearchCompensationIntent,
    SearchIntentRead,
    SearchTurnaroundIntent,
)

MAX_QUERY_LENGTH = 300
Dimension = Literal[
    "role",
    "tool",
    "skill",
    "platform",
    "format",
    "genre",
    "niche",
    "location",
    "work_mode",
    "engagement",
    "availability",
    "compensation",
    "weekly_hours",
    "turnaround",
    "experience",
]

_DIMENSION_LABELS: dict[Dimension, str] = {
    "role": "role",
    "tool": "tool",
    "skill": "skill",
    "platform": "platform",
    "format": "format",
    "genre": "genre",
    "niche": "niche",
    "location": "location",
    "work_mode": "work mode",
    "engagement": "engagement",
    "availability": "availability",
    "compensation": "compensation",
    "weekly_hours": "weekly availability",
    "turnaround": "turnaround",
    "experience": "experience",
}

_WEIGHTS: dict[Dimension, float] = {
    "role": 14,
    "tool": 10,
    "skill": 9,
    "platform": 8,
    "format": 8,
    "genre": 7,
    "niche": 8,
    "location": 7,
    "work_mode": 7,
    "engagement": 7,
    "availability": 6,
    "compensation": 8,
    "weekly_hours": 5,
    "turnaround": 6,
    "experience": 5,
}

_BUDGET_RE = re.compile(
    r"\b(under|below|up\s?to|at\s?most|above|over|at\s?least|more\s?than)?\s*"
    r"(₹|inr|rs\.?|usd|\$)?\s*(\d[\d,]*)\s*(k|thousand)?"
    r"(?:\s*(?:/|per\s+|a\s+)?(hour|hr|hourly|day|video|short|thumbnail|project|week|month|monthly|year|annual))?",
    re.IGNORECASE,
)
_EXPERIENCE_RE = re.compile(r"\b(\d{1,2})\+?\s*(?:years?|yrs?)\b", re.IGNORECASE)
_WEEKLY_HOURS_RE = re.compile(
    r"\b(\d{1,3}(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:/|per\s*)?(?:week|weekly)\b",
    re.IGNORECASE,
)
_TURNAROUND_RE = re.compile(
    r"\b(?:within|turnaround(?:\s+of)?|delivery(?:\s+in)?)\s*(\d{1,3})\s*"
    r"(hours?|hrs?|business days?|calendar days?|days?|weeks?)\b",
    re.IGNORECASE,
)
_HARD_WORDS = re.compile(r"\b(must|required|only|need(?:s|ed)?)\b", re.IGNORECASE)
_NEGATION_WORDS = frozenset({"not", "no", "without", "exclude", "excluding"})


def _edit_distance(left: str, right: str) -> int:
    if not left:
        return len(right)
    if not right:
        return len(left)
    previous = list(range(len(right) + 1))
    for index, left_char in enumerate(left, start=1):
        current = [index]
        for other_index, right_char in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[other_index] + 1,
                    previous[other_index - 1] + (left_char != right_char),
                )
            )
        previous = current
    return previous[-1]


def _word_matches(token: str, target: str) -> bool:
    if token == target:
        return True
    if len(target) <= 3 or not token or token[0] != target[0]:
        return False
    threshold = 1
    if (
        (target.startswith(token) or token.startswith(target))
        and abs(len(token) - len(target)) > 1
    ):
        return False
    return abs(len(token) - len(target)) <= threshold and _edit_distance(token, target) <= threshold


def _is_inflection_variant(token: str, target: str) -> bool:
    return (
        token.rstrip("s") == target.rstrip("s")
        or token.endswith("ies")
        and token[:-3] == target.removesuffix("y")
        or target.endswith("ies")
        and target[:-3] == token.removesuffix("y")
    )


def _find_aliases(
    tokens: list[str],
    entries: Sequence[SearchAlias],
) -> tuple[list[str], list[str], set[int], list[str]]:
    found_keys: list[str] = []
    found_labels: list[str] = []
    claimed: set[int] = set()
    corrections: list[str] = []
    aliases = sorted(
        (
            (entry, normalize_search_text(alias).split())
            for entry in entries
            for alias in entry.aliases
        ),
        key=lambda item: (-len(item[1]), -sum(len(word) for word in item[1])),
    )
    for entry, alias_words in aliases:
        if entry.key in found_keys or not alias_words:
            continue
        for start in range(0, len(tokens) - len(alias_words) + 1):
            indexes = range(start, start + len(alias_words))
            if any(index in claimed for index in indexes):
                continue
            if not all(
                _word_matches(tokens[index], alias_words[offset])
                for offset, index in enumerate(indexes)
            ):
                continue
            if start > 0 and tokens[start - 1] in _NEGATION_WORDS:
                claimed.add(start - 1)
                claimed.update(indexes)
                continue
            found_keys.append(entry.key)
            found_labels.append(entry.label)
            for offset, index in enumerate(indexes):
                claimed.add(index)
                if (
                    tokens[index] != alias_words[offset]
                    and not _is_inflection_variant(
                        tokens[index],
                        alias_words[offset],
                    )
                ):
                    corrections.append(f"{tokens[index]} → {alias_words[offset]}")
            break
    return found_keys, found_labels, claimed, corrections


def _parse_compensation(query: str) -> tuple[SearchCompensationIntent | None, str | None]:
    for match in _BUDGET_RE.finditer(query):
        raw_amount = match.group(3)
        amount = float(raw_amount.replace(",", ""))
        if match.group(4):
            amount *= 1000
        currency_token = (match.group(2) or "").casefold()
        unit_token = (match.group(5) or "").casefold()
        has_currency = bool(currency_token)
        if amount < 1000 and not has_currency and not unit_token:
            continue
        operator_token = (match.group(1) or "").casefold()
        operator = (
            "under"
            if re.search(r"under|below|up\s?to|at\s?most", operator_token)
            else "over"
            if re.search(r"above|over|at\s?least|more\s?than", operator_token)
            else "approx"
        )
        currency = (
            "INR"
            if currency_token in {"₹", "inr", "rs", "rs."}
            else "USD"
            if currency_token in {"usd", "$"}
            else None
        )
        unit_map = {
            "hour": "per hour",
            "hr": "per hour",
            "hourly": "per hour",
            "day": "per day",
            "video": "per video",
            "short": "per short",
            "thumbnail": "per thumbnail",
            "project": "per project",
            "week": "per week",
            "month": "per month",
            "monthly": "per month",
            "year": "per year",
            "annual": "per year",
        }
        return (
            SearchCompensationIntent(
                amount=amount,
                operator=operator,
                currency=currency,
                unit=unit_map.get(unit_token),
            ),
            match.group(0),
        )
    return None, None


def parse_search_intent(
    query: str,
    *,
    domain: Literal["jobs", "talent"],
) -> SearchIntentRead:
    clean_query = " ".join(query.split())[:MAX_QUERY_LENGTH]
    normalized = normalize_search_text(clean_query)
    tokens = normalized.split()
    recognized: set[int] = set()
    corrections: list[str] = []

    role_keys, role_labels, claimed, found_corrections = _find_aliases(tokens, ROLE_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)
    tool_keys, tool_labels, claimed, found_corrections = _find_aliases(tokens, TOOL_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)
    skill_keys, _, claimed, found_corrections = _find_aliases(tokens, SKILL_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)
    platforms, _, claimed, found_corrections = _find_aliases(tokens, PLATFORM_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)
    if not role_keys and "youtube" in platforms:
        for index, token in enumerate(tokens):
            if index in recognized or not _word_matches(token, "editor"):
                continue
            role_keys = ["video-editor"]
            role_labels = ["Video Editor"]
            recognized.add(index)
            if token != "editor":
                corrections.append(f"{token} → editor")
            break
    if platforms:
        tool_pairs = [
            (key, label)
            for key, label in zip(tool_keys, tool_labels, strict=False)
            if key not in platforms
        ]
        tool_keys = [key for key, _label in tool_pairs]
        tool_labels = [label for _key, label in tool_pairs]
    formats, _, claimed, found_corrections = _find_aliases(tokens, FORMAT_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)
    genres, _, claimed, found_corrections = _find_aliases(tokens, GENRE_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)
    niches, _, claimed, found_corrections = _find_aliases(tokens, NICHE_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)
    work_modes, _, claimed, found_corrections = _find_aliases(tokens, WORK_MODE_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)
    engagements, _, claimed, found_corrections = _find_aliases(tokens, ENGAGEMENT_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)
    availability, _, claimed, found_corrections = _find_aliases(tokens, AVAILABILITY_ALIASES)
    recognized |= claimed
    corrections.extend(found_corrections)

    locations: list[str] = []
    for index, token in enumerate(tokens):
        if canonical := LOCATION_ALIASES.get(token):
            if canonical not in locations:
                locations.append(canonical)
            recognized.add(index)
    compensation, budget_match = _parse_compensation(clean_query)
    experience_match = _EXPERIENCE_RE.search(clean_query)
    weekly_hours_match = _WEEKLY_HOURS_RE.search(clean_query)
    turnaround_match = _TURNAROUND_RE.search(clean_query)
    fast_turnaround = bool(re.search(r"\b(fast|quick|rapid)\s+turnaround\b", clean_query, re.I))
    turnaround: SearchTurnaroundIntent | None = None
    if turnaround_match:
        unit_token = turnaround_match.group(2).casefold()
        unit = "hours" if "hour" in unit_token or "hr" in unit_token else "weeks" if "week" in unit_token else "days"
        turnaround = SearchTurnaroundIntent(value=int(turnaround_match.group(1)), unit=unit)
    elif fast_turnaround:
        turnaround = SearchTurnaroundIntent(fast=True)

    consumed_phrases = [
        budget_match,
        experience_match.group(0) if experience_match else None,
        weekly_hours_match.group(0) if weekly_hours_match else None,
        turnaround_match.group(0) if turnaround_match else None,
        "fast turnaround" if fast_turnaround else None,
    ]
    remaining = normalized
    for phrase in consumed_phrases:
        if phrase:
            remaining = remaining.replace(normalize_search_text(phrase), " ")
    remaining_tokens = remaining.split()
    recognized_words = {tokens[index] for index in recognized}
    free_terms: list[str] = []
    for token in remaining_tokens:
        if (
            token in recognized_words
            or token in STOP_WORDS
            or len(token) < 2
            or token.isdigit()
            or token in free_terms
        ):
            continue
        free_terms.append(token)

    present_dimensions: list[Dimension] = []
    for dimension, values in (
        ("role", role_keys),
        ("tool", tool_keys),
        ("skill", skill_keys),
        ("platform", platforms),
        ("format", formats),
        ("genre", genres),
        ("niche", niches),
        ("location", locations),
        ("work_mode", work_modes),
        ("engagement", engagements),
        ("availability", availability),
    ):
        if values:
            present_dimensions.append(dimension)
    if compensation:
        present_dimensions.append("compensation")
    if weekly_hours_match:
        present_dimensions.append("weekly_hours")
    if turnaround:
        present_dimensions.append("turnaround")
    if experience_match:
        present_dimensions.append("experience")

    hard: list[str] = []
    if compensation and compensation.operator == "under":
        hard.append("compensation")
    if _HARD_WORDS.search(clean_query):
        hard.extend(
            dimension
            for dimension in present_dimensions
            if dimension not in hard
        )
    preferred = [dimension for dimension in present_dimensions if dimension not in hard]

    return SearchIntentRead(
        domain=domain,
        query=clean_query,
        roles=role_keys,
        role_labels=role_labels,
        specializations=[],
        tools=tool_keys,
        tool_labels=tool_labels,
        skills=skill_keys,
        platforms=platforms,
        formats=formats,
        genres=genres,
        niches=niches,
        locations=locations,
        work_modes=work_modes,
        engagement_types=engagements,
        availability=availability,
        compensation=compensation,
        weekly_hours=float(weekly_hours_match.group(1)) if weekly_hours_match else None,
        turnaround=turnaround,
        experience_years_min=int(experience_match.group(1)) if experience_match else None,
        hard_constraints=[_DIMENSION_LABELS[dimension] for dimension in hard],
        preferred_constraints=[_DIMENSION_LABELS[dimension] for dimension in preferred],
        free_text_terms=free_terms[:12],
        corrections=list(dict.fromkeys(corrections))[:8],
    )


@dataclass
class RankedSearchResult:
    item: Job | TalentListing
    owner: User | None
    score: float
    reasons: list[str]
    matched_all_recognized: bool
    hard_match: bool
    created_at: datetime | None


def _text(*values: Any) -> str:
    parts: list[str] = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, (list, tuple, set)):
            for item in value:
                if isinstance(item, dict):
                    parts.extend(str(nested) for nested in item.values() if nested is not None)
                elif item is not None:
                    parts.append(str(item))
        else:
            parts.append(str(value))
    return normalize_search_text(" ".join(parts))


def _contains_alias(corpus: str, key: str, entries: Sequence[SearchAlias]) -> bool:
    entry = next((candidate for candidate in entries if candidate.key == key), None)
    if entry is None:
        return key.replace("-", " ") in corpus
    return any(
        re.search(rf"(?<!\w){re.escape(normalize_search_text(alias))}(?!\w)", corpus)
        for alias in (entry.label, *entry.aliases)
        if normalize_search_text(alias)
    )


def _free_term_match(corpus: str, term: str) -> bool:
    if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", corpus):
        return True
    return any(
        word and word[0] == term[0] and SequenceMatcher(None, word, term).ratio() >= 0.78
        for word in corpus.split()
        if len(word) >= 4 and len(term) >= 4
    )


def _platform_label(value: str) -> str:
    return {
        "youtube": "YouTube",
        "instagram": "Instagram",
        "tiktok": "TikTok",
        "linkedin": "LinkedIn",
        "x-twitter": "X / Twitter",
    }.get(value, value.replace("-", " ").title())


def _compensation_matches(
    intent: SearchCompensationIntent,
    *,
    minimum: Decimal | float | None,
    maximum: Decimal | float | None,
    currency: str | None,
    unit: str | None,
) -> bool:
    if intent.currency and currency and intent.currency.casefold() != currency.casefold():
        return False
    if intent.unit and unit and normalize_search_text(intent.unit) != normalize_search_text(unit):
        return False
    low = float(minimum) if minimum is not None else None
    high = float(maximum) if maximum is not None else low
    if low is None and high is None:
        return False
    if intent.operator == "under":
        return low is not None and low <= intent.amount
    if intent.operator == "over":
        return high is not None and high >= intent.amount
    assert high is not None
    assert low is not None
    return low <= intent.amount <= high or 0.75 <= low / intent.amount <= 1.35


def _turnaround_days(value: int | None, unit: str | None) -> float | None:
    if value is None or unit is None:
        return None
    if "hour" in unit:
        return value / 24
    if "week" in unit:
        return value * 7
    return float(value)


def _intent_dimensions(intent: SearchIntentRead) -> list[Dimension]:
    dimensions: list[Dimension] = []
    for dimension, values in (
        ("role", intent.roles),
        ("tool", intent.tools),
        ("skill", intent.skills),
        ("platform", intent.platforms),
        ("format", intent.formats),
        ("genre", intent.genres),
        ("niche", intent.niches),
        ("location", intent.locations),
        ("work_mode", intent.work_modes),
        ("engagement", intent.engagement_types),
        ("availability", intent.availability),
    ):
        if values:
            dimensions.append(dimension)
    if intent.compensation:
        dimensions.append("compensation")
    if intent.weekly_hours is not None:
        dimensions.append("weekly_hours")
    if intent.turnaround:
        dimensions.append("turnaround")
    if intent.experience_years_min is not None:
        dimensions.append("experience")
    return dimensions


def _score_job(job: Job, intent: SearchIntentRead) -> RankedSearchResult:
    role_corpus = _text(job.title, job.primary_role_name_snapshot, job.role_specialization, job.category)
    tool_corpus = _text(job.required_tool_keys, job.other_required_tools)
    skill_corpus = _text(
        job.required_skill_keys,
        job.preferred_skill_keys,
        job.other_required_skills,
        job.other_preferred_skills,
        job.requirements,
    )
    platform_corpus = _text(job.platforms, job.posted_platform)
    format_corpus = _text(job.formats_hired_for, job.deliverables)
    niche_corpus = _text(job.content_niches, job.content_genres)
    genre_corpus = _text(job.content_genres)
    location_corpus = _text(job.location)
    public_corpus = _text(
        job.title,
        job.primary_role_name_snapshot,
        job.role_specialization,
        job.category,
        job.about_channel,
        job.responsibilities,
        job.requirements,
        job.tags,
        job.platforms,
        job.content_niches,
        job.content_genres,
        job.formats_hired_for,
        job.required_tool_keys,
        job.other_required_tools,
        job.required_skill_keys,
        job.preferred_skill_keys,
        job.other_required_skills,
        job.other_preferred_skills,
        job.channel_name,
    )
    hits: dict[Dimension, bool] = {}
    reasons: list[str] = []

    hits["role"] = bool(intent.roles) and any(
        _contains_alias(role_corpus, key, ROLE_ALIASES) for key in intent.roles
    )
    if hits["role"]:
        matched = next(
            label
            for key, label in zip(intent.roles, intent.role_labels, strict=False)
            if _contains_alias(role_corpus, key, ROLE_ALIASES)
        )
        reasons.append(f"Matches {matched} role")
    tool_matches = [
        key in (job.required_tool_keys or [])
        or _contains_alias(tool_corpus, key, TOOL_ALIASES)
        for key in intent.tools
    ]
    hits["tool"] = any(tool_matches)
    tool_coverage = (
        sum(tool_matches) / len(tool_matches)
        if tool_matches
        else 0.0
    )
    if hits["tool"]:
        matched = [
            label
            for key, label in zip(intent.tools, intent.tool_labels, strict=False)
            if key in (job.required_tool_keys or []) or _contains_alias(tool_corpus, key, TOOL_ALIASES)
        ]
        reasons.append(f"Requires {' and '.join(matched[:2])}")
    hits["skill"] = bool(intent.skills) and any(
        key in (job.required_skill_keys or []) + (job.preferred_skill_keys or [])
        or _contains_alias(skill_corpus, key, SKILL_ALIASES)
        for key in intent.skills
    )
    if hits["skill"]:
        reasons.append("Matches requested skill")
    hits["platform"] = bool(intent.platforms) and any(
        _contains_alias(platform_corpus, key, PLATFORM_ALIASES) for key in intent.platforms
    )
    if hits["platform"]:
        reasons.append(f"Works on {_platform_label(intent.platforms[0])}")
    hits["format"] = bool(intent.formats) and any(
        _contains_alias(format_corpus, key, FORMAT_ALIASES) for key in intent.formats
    )
    if hits["format"]:
        reasons.append("Matches requested content format")
    hits["genre"] = bool(intent.genres) and any(
        _contains_alias(genre_corpus, key, GENRE_ALIASES) for key in intent.genres
    )
    if hits["genre"]:
        reasons.append("Matches requested content genre")
    hits["niche"] = bool(intent.niches) and any(
        _contains_alias(niche_corpus, key, NICHE_ALIASES) for key in intent.niches
    )
    if hits["niche"]:
        reasons.append(f"Creator niche: {intent.niches[0].title()}")
    hits["location"] = bool(intent.locations) and any(
        location == "Remote"
        and job.work_mode == "remote"
        or normalize_search_text(location) in location_corpus
        for location in intent.locations
    )
    if hits["location"]:
        reasons.append("Remote role" if "Remote" in intent.locations else f"Location matches {intent.locations[0]}")
    hits["work_mode"] = bool(intent.work_modes) and job.work_mode in intent.work_modes
    if hits["work_mode"] and not hits["location"]:
        reasons.append(f"{intent.work_modes[0].title()} work")
    hits["engagement"] = bool(intent.engagement_types) and job.engagement_type in intent.engagement_types
    if hits["engagement"]:
        reasons.append("Engagement type matches")
    hits["availability"] = False
    hits["compensation"] = bool(intent.compensation) and _compensation_matches(
        intent.compensation,
        minimum=job.budget_amount,
        maximum=job.budget_max,
        currency=job.budget_currency,
        unit=job.budget_unit,
    )
    if hits["compensation"]:
        reasons.append("Compensation fits your query")
    hits["weekly_hours"] = (
        intent.weekly_hours is not None
        and job.expected_weekly_hours_min is not None
        and float(job.expected_weekly_hours_min) <= intent.weekly_hours
        and (
            job.expected_weekly_hours_max is None
            or intent.weekly_hours <= float(job.expected_weekly_hours_max)
        )
    )
    if hits["weekly_hours"]:
        reasons.append("Weekly hours match")
    intent_days = (
        _turnaround_days(intent.turnaround.value, intent.turnaround.unit)
        if intent.turnaround and not intent.turnaround.fast
        else None
    )
    job_days = _turnaround_days(job.turnaround_value, job.turnaround_unit)
    hits["turnaround"] = bool(intent.turnaround) and (
        job_days is not None
        and (
            job_days <= 3
            if intent.turnaround.fast
            else intent_days is not None and job_days <= intent_days
        )
    )
    if hits["turnaround"]:
        reasons.append("Turnaround matches")
    experience_number = re.search(r"\d+", job.experience_level or "")
    hits["experience"] = (
        intent.experience_years_min is not None
        and experience_number is not None
        and int(experience_number.group()) >= intent.experience_years_min
    )
    if hits["experience"]:
        reasons.append("Experience level matches")

    dimensions = _intent_dimensions(intent)
    hard_labels = set(intent.hard_constraints)
    hard_dimensions = {
        dimension for dimension in dimensions if _DIMENSION_LABELS[dimension] in hard_labels
    }
    dimension_complete = dict(hits)
    if intent.tools:
        dimension_complete["tool"] = tool_coverage == 1.0
    hard_match = all(
        dimension_complete.get(dimension, False) for dimension in hard_dimensions
    )
    score = sum(
        _WEIGHTS[dimension]
        for dimension in dimensions
        if dimension != "tool" and hits.get(dimension)
    )
    if "tool" in dimensions:
        score += _WEIGHTS["tool"] * tool_coverage
    free_hits = [term for term in intent.free_text_terms if _free_term_match(public_corpus, term)]
    score += len(free_hits) * 2
    if free_hits and not reasons:
        reasons.append(f"Matches “{free_hits[0]}”")
    if score > 0:
        if job.hiring_verification_status_snapshot == "VERIFIED":
            score += 0.25
        if job.listing_schema_version >= 3 and job.about_channel:
            score += 0.15
    recognized_count = len(dimensions) + len(intent.free_text_terms)
    matched_all_recognized = (
        recognized_count > 0
        and all(dimension_complete.get(dimension, False) for dimension in dimensions)
        and len(free_hits) == len(intent.free_text_terms)
    )
    return RankedSearchResult(
        item=job,
        owner=None,
        score=score,
        reasons=list(dict.fromkeys(reasons))[:5],
        matched_all_recognized=matched_all_recognized,
        hard_match=hard_match,
        created_at=job.created_at,
    )


def _score_talent(
    listing: TalentListing,
    owner: User,
    intent: SearchIntentRead,
) -> RankedSearchResult:
    role_corpus = _text(listing.title, listing.primary_role, listing.roles)
    tool_corpus = _text(listing.tools)
    skill_corpus = _text(listing.description, listing.roles)
    platform_corpus = _text(listing.platforms)
    format_corpus = _text(listing.formats)
    niche_corpus = _text(listing.niche, listing.content_niches, listing.content_genres)
    genre_corpus = _text(listing.content_genres)
    location_corpus = _text(listing.location)
    public_corpus = _text(
        listing.title,
        listing.primary_role,
        listing.roles,
        listing.niche,
        listing.content_niches,
        listing.content_genres,
        listing.formats,
        listing.platforms,
        listing.tools,
        listing.languages,
        listing.work_mode,
        listing.location,
        listing.turnaround,
        listing.description,
    )
    hits: dict[Dimension, bool] = {}
    reasons: list[str] = []
    hits["role"] = bool(intent.roles) and any(
        _contains_alias(role_corpus, key, ROLE_ALIASES) for key in intent.roles
    )
    if hits["role"]:
        matched = next(
            label
            for key, label in zip(intent.roles, intent.role_labels, strict=False)
            if _contains_alias(role_corpus, key, ROLE_ALIASES)
        )
        reasons.append(f"Matches {matched} role")
    tool_matches = [
        _contains_alias(tool_corpus, key, TOOL_ALIASES) for key in intent.tools
    ]
    hits["tool"] = any(tool_matches)
    tool_coverage = (
        sum(tool_matches) / len(tool_matches)
        if tool_matches
        else 0.0
    )
    if hits["tool"]:
        matched = [
            label
            for key, label in zip(intent.tools, intent.tool_labels, strict=False)
            if _contains_alias(tool_corpus, key, TOOL_ALIASES)
        ]
        reasons.append(f"Experience with {' and '.join(matched[:2])}")
    hits["skill"] = bool(intent.skills) and any(
        _contains_alias(skill_corpus, key, SKILL_ALIASES) for key in intent.skills
    )
    if hits["skill"]:
        reasons.append("Matches requested skill")
    hits["platform"] = bool(intent.platforms) and any(
        _contains_alias(platform_corpus, key, PLATFORM_ALIASES) for key in intent.platforms
    )
    if hits["platform"]:
        reasons.append(f"Works on {_platform_label(intent.platforms[0])}")
    hits["format"] = bool(intent.formats) and any(
        _contains_alias(format_corpus, key, FORMAT_ALIASES) for key in intent.formats
    )
    if hits["format"]:
        reasons.append("Portfolio focus matches the format")
    hits["genre"] = bool(intent.genres) and any(
        _contains_alias(genre_corpus, key, GENRE_ALIASES) for key in intent.genres
    )
    if hits["genre"]:
        reasons.append("Portfolio genre matches")
    hits["niche"] = bool(intent.niches) and any(
        _contains_alias(niche_corpus, key, NICHE_ALIASES) for key in intent.niches
    )
    if hits["niche"]:
        reasons.append(f"Creator niche: {intent.niches[0].title()}")
    hits["location"] = bool(intent.locations) and any(
        location == "Remote"
        and listing.work_mode == "remote"
        or normalize_search_text(location) in location_corpus
        for location in intent.locations
    )
    if hits["location"]:
        reasons.append("Remote availability" if "Remote" in intent.locations else f"Based in {intent.locations[0]}")
    hits["work_mode"] = bool(intent.work_modes) and listing.work_mode in intent.work_modes
    if hits["work_mode"] and not hits["location"]:
        reasons.append(f"{intent.work_modes[0].title()} availability")
    hits["engagement"] = False
    hits["availability"] = bool(intent.availability) and listing.availability_status in intent.availability
    if hits["availability"]:
        reasons.append("Available now")
    hits["compensation"] = bool(intent.compensation) and _compensation_matches(
        intent.compensation,
        minimum=listing.rate_min,
        maximum=listing.rate_max,
        currency=listing.rate_currency,
        unit=None,
    )
    if hits["compensation"]:
        reasons.append("Rate overlaps your range")
    hits["weekly_hours"] = False
    talent_turnaround = _text(listing.turnaround)
    hits["turnaround"] = bool(intent.turnaround) and (
        (intent.turnaround.fast and any(word in talent_turnaround for word in ("fast", "quick", "24", "48")))
        or (
            intent.turnaround.value is not None
            and str(intent.turnaround.value) in talent_turnaround
        )
    )
    if hits["turnaround"]:
        reasons.append("Turnaround matches")
    hits["experience"] = (
        intent.experience_years_min is not None
        and listing.experience_years is not None
        and listing.experience_years >= intent.experience_years_min
    )
    if hits["experience"]:
        reasons.append(f"{listing.experience_years}+ years of experience")

    dimensions = _intent_dimensions(intent)
    hard_labels = set(intent.hard_constraints)
    hard_dimensions = {
        dimension for dimension in dimensions if _DIMENSION_LABELS[dimension] in hard_labels
    }
    dimension_complete = dict(hits)
    if intent.tools:
        dimension_complete["tool"] = tool_coverage == 1.0
    hard_match = all(
        dimension_complete.get(dimension, False) for dimension in hard_dimensions
    )
    score = sum(
        _WEIGHTS[dimension]
        for dimension in dimensions
        if dimension != "tool" and hits.get(dimension)
    )
    if "tool" in dimensions:
        score += _WEIGHTS["tool"] * tool_coverage
    free_hits = [term for term in intent.free_text_terms if _free_term_match(public_corpus, term)]
    score += len(free_hits) * 2
    if free_hits and not reasons:
        reasons.append(f"Profile lists “{free_hits[0]}”")
    if score > 0 and listing.availability_status == "available":
        score += 0.2
    recognized_count = len(dimensions) + len(intent.free_text_terms)
    matched_all_recognized = (
        recognized_count > 0
        and all(dimension_complete.get(dimension, False) for dimension in dimensions)
        and len(free_hits) == len(intent.free_text_terms)
    )
    return RankedSearchResult(
        item=listing,
        owner=owner,
        score=score,
        reasons=list(dict.fromkeys(reasons))[:5],
        matched_all_recognized=matched_all_recognized,
        hard_match=hard_match,
        created_at=listing.created_at,
    )


def _apply_structured_constraints(
    intent: SearchIntentRead,
    *,
    roles: list[str] | None = None,
    platforms: list[str] | None = None,
    formats: list[str] | None = None,
    work_modes: list[str] | None = None,
    engagement_types: list[str] | None = None,
    locations: list[str] | None = None,
    availability: list[str] | None = None,
) -> SearchIntentRead:
    updates: dict[str, Any] = {}
    hard = list(intent.hard_constraints)
    for field, dimension, supplied, entries in (
        ("roles", "role", roles, ROLE_ALIASES),
        ("platforms", "platform", platforms, PLATFORM_ALIASES),
        ("formats", "format", formats, FORMAT_ALIASES),
        ("work_modes", "work mode", work_modes, WORK_MODE_ALIASES),
        ("engagement_types", "engagement", engagement_types, ENGAGEMENT_ALIASES),
        ("locations", "location", locations, ()),
        ("availability", "availability", availability, AVAILABILITY_ALIASES),
    ):
        values: list[str] = []
        for value in supplied or []:
            normalized = normalize_search_text(value)
            if not normalized:
                continue
            if field == "locations":
                canonical = LOCATION_ALIASES.get(normalized, value.strip())
            else:
                entry = next(
                    (
                        candidate
                        for candidate in entries
                        if normalized
                        in {
                            normalize_search_text(candidate.key),
                            normalize_search_text(candidate.label),
                            *(normalize_search_text(alias) for alias in candidate.aliases),
                        }
                    ),
                    None,
                )
                canonical = entry.key if entry else normalized.replace(" ", "-")
            if canonical not in values:
                values.append(canonical)
        if not values:
            continue
        current = list(getattr(intent, field))
        updates[field] = list(dict.fromkeys((*current, *values)))
        if dimension not in hard:
            hard.append(dimension)
    if updates.get("roles"):
        labels = list(intent.role_labels)
        for role in updates["roles"]:
            entry = next((candidate for candidate in ROLE_ALIASES if candidate.key == role), None)
            label = entry.label if entry else role.replace("-", " ").title()
            if label not in labels:
                labels.append(label)
        updates["role_labels"] = labels
    updates["hard_constraints"] = hard
    updates["preferred_constraints"] = [
        value for value in intent.preferred_constraints if value not in hard
    ]
    return intent.model_copy(update=updates)


class SearchService:
    def __init__(self, repository: SearchRepository):
        self.repository = repository

    async def search_jobs(
        self,
        query: str,
        *,
        limit: int,
        offset: int,
        roles: list[str] | None = None,
        platforms: list[str] | None = None,
        formats: list[str] | None = None,
        work_modes: list[str] | None = None,
        engagement_types: list[str] | None = None,
        locations: list[str] | None = None,
    ) -> tuple[SearchIntentRead, list[RankedSearchResult], int, bool]:
        intent = _apply_structured_constraints(
            parse_search_intent(query, domain="jobs"),
            roles=roles,
            platforms=platforms,
            formats=formats,
            work_modes=work_modes,
            engagement_types=engagement_types,
            locations=locations,
        )
        ranked = [_score_job(job, intent) for job in await self.repository.public_job_candidates()]
        ranked = [result for result in ranked if result.score > 0]
        strict = [result for result in ranked if result.hard_match]
        selected = strict or ranked
        no_exact_match = bool(selected) and not any(
            result.matched_all_recognized for result in selected
        )
        selected.sort(
            key=lambda result: (
                result.score,
                result.created_at.timestamp() if result.created_at else 0,
            ),
            reverse=True,
        )
        return intent, selected[offset : offset + limit], len(selected), no_exact_match

    async def search_talent(
        self,
        query: str,
        *,
        limit: int,
        offset: int,
        roles: list[str] | None = None,
        platforms: list[str] | None = None,
        formats: list[str] | None = None,
        work_modes: list[str] | None = None,
        locations: list[str] | None = None,
        availability: list[str] | None = None,
    ) -> tuple[SearchIntentRead, list[RankedSearchResult], int, bool]:
        intent = _apply_structured_constraints(
            parse_search_intent(query, domain="talent"),
            roles=roles,
            platforms=platforms,
            formats=formats,
            work_modes=work_modes,
            locations=locations,
            availability=availability,
        )
        ranked = [
            _score_talent(listing, owner, intent)
            for listing, owner in await self.repository.public_talent_candidates()
        ]
        ranked = [result for result in ranked if result.score > 0]
        strict = [result for result in ranked if result.hard_match]
        selected = strict or ranked
        no_exact_match = bool(selected) and not any(
            result.matched_all_recognized for result in selected
        )
        selected.sort(
            key=lambda result: (
                result.score,
                result.created_at.timestamp() if result.created_at else 0,
            ),
            reverse=True,
        )
        return intent, selected[offset : offset + limit], len(selected), no_exact_match
