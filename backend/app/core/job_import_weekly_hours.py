"""Derive exact weekly hours only from an explicit arithmetic schedule.

``Full-time`` describes an engagement, not a number. ``Fast-paced`` describes
the work, not a schedule. Neither is permission to manufacture forty hours.
There is, however, no recruiter judgement hidden in ``Monday–Friday`` plus
``8 hours per day``: those two source facts entail exactly forty hours per
week. This module recognizes that deliberately small grammar and nothing else.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Final

from app.core.job_import_labelled_fields import primary_job_text

_NUMBER = r"\d{1,2}(?:\.\d)?"

_DAILY_HOURS_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(
        rf"(?<![\d.])(?P<value>{_NUMBER})\s*(?:hours?|hrs?)\s*"
        r"(?:per|/|a|each)\s*(?:working\s+)?day\b",
        re.IGNORECASE,
    ),
    re.compile(
        rf"(?<![\d.])(?P<value>{_NUMBER})\s*[- ]hour\s+"
        r"(?:working\s+)?day\b",
        re.IGNORECASE,
    ),
)

_DAYS_PER_WEEK_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(
        r"(?<![\d.])(?P<value>[1-7])\s*days?\s*(?:per|/|a|each)\s*week\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?<![\d.])(?P<value>[1-7])\s*[- ]day\s+(?:work(?:ing)?\s+)?week\b",
        re.IGNORECASE,
    ),
)

_WEEKDAYS: Final[dict[str, int]] = {
    "mon": 1,
    "monday": 1,
    "tue": 2,
    "tues": 2,
    "tuesday": 2,
    "wed": 3,
    "weds": 3,
    "wednesday": 3,
    "thu": 4,
    "thur": 4,
    "thurs": 4,
    "thursday": 4,
    "fri": 5,
    "friday": 5,
    "sat": 6,
    "saturday": 6,
    "sun": 7,
    "sunday": 7,
}
_WEEKDAY_TOKEN = "|".join(sorted(_WEEKDAYS, key=len, reverse=True))
_WEEKDAY_RANGE = re.compile(
    rf"\b(?P<start>{_WEEKDAY_TOKEN})\b\s*(?:[-–—]|to|through|thru)\s*"
    rf"\b(?P<end>{_WEEKDAY_TOKEN})\b",
    re.IGNORECASE,
)
_AMBIGUOUS_PREFIX = re.compile(
    r"\d(?:\.\d)?\s*(?:[-–—]|to|through|or)\s*$",
    re.IGNORECASE,
)
_EXPLICIT_WORK_CONTEXT = re.compile(
    r"\b(?:work(?:ing)?(?:\s+(?:schedule|hours?|days?|week))?|workweek|"
    r"shift(?:s)?|availability|employee(?:s)?|candidate(?:s)?|editor(?:s)?|"
    r"team\s+(?:schedule|hours?|availability)|full[- ]time\s+role)\b",
    re.IGNORECASE,
)
_NON_WORK_DAY_CONTEXT = re.compile(
    r"\b(?:channel\s+(?:runs?|operates?)|publish(?:es|ed|ing)?|posting|"
    r"uploads?|releases?|content\s+(?:calendar|cadence|schedule)|"
    r"publishing\s+schedule)\b",
    re.IGNORECASE,
)
_MEDIA_DURATION_CONTEXT = re.compile(
    r"\b(?:raw\s+)?(?:footage|runtime|video(?:s)?|content)\b",
    re.IGNORECASE,
)
_MEDIA_OBJECT_AFTER_HOURS = re.compile(
    r"^\s*(?:of\s+)?(?:raw\s+)?(?:footage|runtime|video(?:s)?|content)\b",
    re.IGNORECASE,
)
_MAX_PAIR_GAP = 180


@dataclass(frozen=True)
class WeeklyHoursInference:
    weekly_hours: int | float
    days_per_week: int
    hours_per_day: int | float
    evidence_snippets: tuple[str, ...]


@dataclass(frozen=True)
class _ScheduleFactor:
    value: Decimal
    snippet: str
    start: int
    end: int


def _json_number(value: Decimal) -> int | float:
    return int(value) if value == value.to_integral_value() else float(value)


def _exact_decimal_matches(
    text: str,
    patterns: tuple[re.Pattern[str], ...],
    *,
    maximum: Decimal,
) -> list[_ScheduleFactor]:
    found: list[_ScheduleFactor] = []
    for pattern in patterns:
        for match in pattern.finditer(text):
            # ``6 to 8 hours/day`` is a range, not an exact eight-hour day.
            # The regex begins at the second number, so guard its left context.
            if _AMBIGUOUS_PREFIX.search(text[max(0, match.start() - 20) : match.start()]):
                continue
            try:
                value = Decimal(match.group("value"))
            except InvalidOperation:  # pragma: no cover - regex admits digits only
                continue
            if value <= 0 or value > maximum:
                continue
            found.append(
                _ScheduleFactor(
                    value=value,
                    snippet=match.group(0),
                    start=match.start(),
                    end=match.end(),
                )
            )
    return found


def _day_matches(text: str) -> list[_ScheduleFactor]:
    found = _exact_decimal_matches(
        text,
        _DAYS_PER_WEEK_PATTERNS,
        maximum=Decimal(7),
    )
    for match in _WEEKDAY_RANGE.finditer(text):
        start = _WEEKDAYS[match.group("start").casefold()]
        end = _WEEKDAYS[match.group("end").casefold()]
        # A wraparound range is not universally interpreted the same way.
        if end < start:
            continue
        found.append(
            _ScheduleFactor(
                value=Decimal(end - start + 1),
                snippet=match.group(0),
                start=match.start(),
                end=match.end(),
            )
        )
    return found


def _statement_bounds(text: str, factor: _ScheduleFactor) -> tuple[int, int]:
    boundaries = "\n.!?;"
    start = max(text.rfind(marker, 0, factor.start) for marker in boundaries) + 1
    following = [index for marker in boundaries if (index := text.find(marker, factor.end)) >= 0]
    return start, min(following, default=len(text))


def _is_non_work_factor(
    text: str,
    factor: _ScheduleFactor,
    *,
    kind: str,
) -> bool:
    statement_start, statement_end = _statement_bounds(text, factor)
    statement = text[statement_start:statement_end]
    if kind == "days":
        # A publishing cadence is a content fact, even though its grammar is
        # identical to a workweek.
        return _NON_WORK_DAY_CONTEXT.search(statement) is not None

    suffix = text[factor.end : min(len(text), factor.end + 50)]
    if _MEDIA_OBJECT_AFTER_HOURS.search(suffix):
        return True
    if _MEDIA_DURATION_CONTEXT.search(statement) is None:
        return False

    prefix = text[max(statement_start, factor.start - 70) : factor.start]
    return _EXPLICIT_WORK_CONTEXT.search(prefix) is None


def _schedule_only_block(value: str) -> bool:
    """Whether a small block consists only of the two schedule factors.

    This retains compact source shapes such as ``Monday-Friday\n8 hours/day``
    without treating arbitrary prose elsewhere on the page as one equation.
    """

    remainder = value
    for pattern in (
        *_DAYS_PER_WEEK_PATTERNS,
        *_DAILY_HOURS_PATTERNS,
        _WEEKDAY_RANGE,
    ):
        remainder = pattern.sub(" ", remainder)
    remainder = re.sub(
        r"\b(?:work(?:ing)?\s+schedule|working\s+hours|hours?|schedule|"
        r"shift|availability|at|and)\b",
        " ",
        remainder,
        flags=re.IGNORECASE,
    )
    return re.sub(r"[^a-z0-9]+", "", remainder.casefold()) == ""


def _compatible_schedule_pairs(
    text: str,
    day_matches: list[_ScheduleFactor],
    hour_matches: list[_ScheduleFactor],
) -> list[tuple[_ScheduleFactor, _ScheduleFactor]]:
    pairs: list[tuple[_ScheduleFactor, _ScheduleFactor]] = []
    for day in day_matches:
        if _is_non_work_factor(text, day, kind="days"):
            continue
        for hour in hour_matches:
            if _is_non_work_factor(text, hour, kind="hours"):
                continue
            first = min(day.start, hour.start)
            last = max(day.end, hour.end)
            if last - first > _MAX_PAIR_GAP:
                continue
            between = text[min(day.end, hour.end) : max(day.start, hour.start)]
            if re.search(r"\n\s*\n", between):
                continue

            block_start = text.rfind("\n", 0, first) + 1
            block_end = text.find("\n", last)
            if block_end < 0:
                block_end = len(text)
            block = text[block_start:block_end]
            if not (_EXPLICIT_WORK_CONTEXT.search(block) or _schedule_only_block(block)):
                continue
            pairs.append((day, hour))
    return pairs


def infer_weekly_hours(normalized_text: str | None) -> WeeklyHoursInference | None:
    """Return one entailed weekly total, or ``None`` for anything ambiguous.

    Both factors must be explicit and independently evidenced. Multiple
    renderings are fine when they agree; contradictory factors stop inference.
    """

    text = primary_job_text(normalized_text)
    if not text.strip():
        return None

    day_matches = _day_matches(text)
    hour_matches = _exact_decimal_matches(
        text,
        _DAILY_HOURS_PATTERNS,
        maximum=Decimal(24),
    )
    pairs = _compatible_schedule_pairs(text, day_matches, hour_matches)
    day_values = {day.value for day, _hour in pairs}
    hour_values = {hour.value for _day, hour in pairs}
    if len(day_values) != 1 or len(hour_values) != 1:
        return None

    days_decimal = next(iter(day_values))
    daily_hours = next(iter(hour_values))
    weekly_hours = days_decimal * daily_hours
    if weekly_hours <= 0 or weekly_hours > Decimal(168):
        return None

    evidence = tuple(
        dict.fromkeys(
            [
                *(day.snippet for day, _hour in pairs),
                *(hour.snippet for _day, hour in pairs),
            ]
        )
    )[:5]
    return WeeklyHoursInference(
        weekly_hours=_json_number(weekly_hours),
        days_per_week=int(days_decimal),
        hours_per_day=_json_number(daily_hours),
        evidence_snippets=evidence,
    )
