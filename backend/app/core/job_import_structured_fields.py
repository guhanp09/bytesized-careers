"""Job facts a page states in machine-readable form, turned into field values.

Most public job pages carry a schema.org ``JobPosting`` block: employment type,
salary, location, experience, employer. That is the publisher's own structured
statement of the job — strictly better evidence than prose, and not something a
model should have to re-read and re-guess.

Until now the fetcher extracted those signals and then flattened them into lines
of text ("Structured employment type: FULL_TIME") for the model to read back. If
the model missed one, the field arrived ``missing`` and the assistant asked the
recruiter for something the page had already said in a machine-readable field.
That is the whole reason the assistant could feel unintelligent on a URL import.

This module reads those signals directly. Everything here is deterministic and
conservative: a value is produced only when the structured data says it plainly,
and anything ambiguous is left for the model or the conversation. Nothing here
invents, and nothing here overrides a recruiter.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, time
from decimal import Decimal, InvalidOperation
from typing import Any, Final

from babel import Locale

from app.core.job_domain_taxonomy import CREATOR_JOB_CURRENCIES
from app.core.job_import_field_descriptions import looks_like_boilerplate
from app.core.job_import_inference import explicit_country_from_location
from app.core.job_import_location_resolution import city_for_location

#: schema.org employmentType values, mapped onto CreatorJobs engagement types.
#:
#: Only unambiguous mappings appear. "OTHER" and "PER_DIEM" are deliberately
#: absent: they do not identify an engagement shape this product models.
_EMPLOYMENT_TYPES: Final[dict[str, str]] = {
    "FULL_TIME": "full_time",
    "FULLTIME": "full_time",
    "PART_TIME": "part_time",
    "PARTTIME": "part_time",
    "CONTRACTOR": "ongoing_freelance",
    "CONTRACT": "fixed_term",
    "TEMPORARY": "fixed_term",
    "INTERN": "internship",
    "INTERNSHIP": "internship",
}

#: schema.org salary units, mapped onto CreatorJobs compensation units.
_SALARY_UNITS: Final[dict[str, str]] = {
    "HOUR": "per hour",
    "DAY": "per day",
    "WEEK": "per week",
    "MONTH": "per month",
    "YEAR": "per year",
}

#: Currencies the product offers. A page quoting anything else is left alone
#: rather than coerced into one of these.
_KNOWN_CURRENCIES: Final[frozenset[str]] = frozenset(CREATOR_JOB_CURRENCIES)

#: Wording publishers use when they have deliberately not stated pay. Reading
#: this is what stops the assistant asking four money questions about a page
#: that already said it will not say.
_UNDISCLOSED_PAY = re.compile(
    r"\b(not disclosed|undisclosed|not specified|unspecified|"
    r"as per (?:industry )?standards?|negotiable|competitive|depends on experience|"
    r"best in industry|salary not)\b",
    re.IGNORECASE,
)

_TELECOMMUTE = re.compile(r"\btele\s*commute\b|\bremote\b", re.IGNORECASE)
_HYBRID = re.compile(r"\bhybrid\b", re.IGNORECASE)

#: "2-4 years", "3+ years", "24 months" stated as an experience requirement.
_YEARS = re.compile(
    r"(\d{1,2})\s*(?:(?:[-–—]|to)\s*(\d{1,2}))?\s*(\+?)\s*years?",
    re.IGNORECASE,
)
_MONTHS = re.compile(
    r"(\d{1,3})\s*(?:(?:[-–—]|to)\s*(\d{1,3}))?\s*(\+?)\s*months?",
    re.IGNORECASE,
)

#: "at least", "minimum of" — the words that make a figure a floor, not a target.
_AT_LEAST = re.compile(r"\b(?:at\s+least|minimum(?:\s+of)?|min\.?|over|more\s+than)\b", re.IGNORECASE)

#: A trailing plus is its own way of saying the same thing.
_OPEN_ENDED = re.compile(r"\d\s*\+")

_GLOBAL_REMOTE = re.compile(
    r"\b(?:worldwide|globally|anywhere in the world|work from anywhere)\b",
    re.IGNORECASE,
)
_REMOTE_PREFIX = re.compile(
    r"^(?:remote(?:ly)?\s*)?(?:anywhere\s+)?(?:only\s+)?(?:in|within|from)\s+",
    re.IGNORECASE,
)
_REMOTE_REGIONS: Final[dict[str, str]] = {
    "africa": "Africa",
    "apac": "APAC",
    "asia pacific": "Asia-Pacific",
    "europe": "Europe",
    "european economic area": "European Economic Area",
    "eea": "European Economic Area",
    "eu": "European Union",
    "european union": "European Union",
    "emea": "EMEA",
    "latin america": "Latin America",
    "latam": "Latin America",
    "middle east": "Middle East",
    "north america": "North America",
    "south america": "South America",
}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _remote_area_label(raw: str, *, trusted_administrative_area: bool = False) -> str | None:
    cleaned = " ".join(raw.split()).strip(" ,;|-")
    if not cleaned or _GLOBAL_REMOTE.search(cleaned):
        return None
    code = cleaned.upper()
    if re.fullmatch(r"[A-Z]{2}", code):
        label = Locale.parse("en").territories.get(code)
        if isinstance(label, str) and label.strip():
            return label.strip()[:120]
    country_code = explicit_country_from_location(cleaned)
    if country_code:
        label = Locale.parse("en").territories.get(country_code)
        if isinstance(label, str) and label.strip():
            return label.strip()[:120]
    region = _REMOTE_PREFIX.sub("", cleaned).strip(" ,;|-")
    region_key = re.sub(r"[^a-z0-9]+", " ", region.casefold()).strip()
    if region_key in _REMOTE_REGIONS:
        return _REMOTE_REGIONS[region_key]
    if re.fullmatch(r"[A-Za-z][A-Za-z /+-]{1,60}\s+time\s*zones?", region):
        return region[:120]
    if trusted_administrative_area and re.fullmatch(
        r"[A-Za-z][A-Za-z .'/+-]{1,60}", region
    ):
        return region[:120]
    return None


def remote_location_restriction(
    raw: str,
    *,
    trusted_areas: list[str] | None = None,
) -> str | None:
    """Return an explicit remote applicant geography, never an office city.

    For remote jobs the native ``location`` control is labelled Candidate
    location and accepts a country or region.  Schema.org exposes that through
    ``applicantLocationRequirements``; ``jobLocation`` is the employer's office
    and must not be substituted for it.
    """

    cleaned = " ".join(raw.split()).strip(" ,;|-")
    if not cleaned or _GLOBAL_REMOTE.search(cleaned):
        return None
    trusted = {
        " ".join(item.split()).casefold()
        for item in trusted_areas or []
        if isinstance(item, str) and item.strip()
    }
    values: list[str] = []
    for raw_part in re.split(r"\s*\|\s*", cleaned):
        part = raw_part.strip()
        label = _remote_area_label(
            part,
            trusted_administrative_area=part.casefold() in trusted,
        )
        if label and label.casefold() not in {item.casefold() for item in values}:
            values.append(label)
    return " | ".join(values)[:120] or None


def _experience_band(raw: str) -> str | None:
    """State the requirement the source stated, in years.

    This used to close every open requirement into a band by adding three years
    to the floor, and to turn a month count into a two-year window. Both invent
    a ceiling nobody wrote: a structured "At least 60 months of experience"
    became "5–7 years", advertising a maximum the employer never set and reading
    a candidate with nine years out of a job they were wanted for.

    A range stays a range, a floor stays a floor, and months become the years
    they are. Nothing gains a bound it did not arrive with.
    """

    qualifier = "At least " if _AT_LEAST.search(raw) else ""

    years = _YEARS.search(raw)
    if years:
        low, high, plus = years.groups()
        if high:
            return f"{low}–{high} years"
        if plus or _OPEN_ENDED.search(raw):
            return f"{low}+ years"
        return f"{qualifier}{low} years"

    months = _MONTHS.search(raw)
    if months:
        low, high, plus = months.groups()
        if high:
            return f"{low}–{high} months"
        if plus or _OPEN_ENDED.search(raw):
            return f"{low}+ months"
        total = int(low)
        if total < 12:
            return f"{qualifier}{total} months".strip()
        whole, remainder = divmod(total, 12)
        if remainder:
            return f"{qualifier}{total} months"
        return f"{qualifier}{whole} years"
    return None


def _compensation_fields(raw: str) -> dict[str, object]:
    """Read a structured salary statement into the compensation fields.

    ``baseSalary`` is normalised upstream into a readable string such as
    "INR 30000-40000 per MONTH". Parsed here rather than inferred, because money
    read wrongly is the most damaging kind of wrong.
    """

    fields: dict[str, object] = {}
    if not raw:
        return fields

    # A page that says it will not disclose pay has answered the question.
    if _UNDISCLOSED_PAY.search(raw) and not re.search(r"\d", raw):
        return {"compensation_mode": "negotiable"}

    currency = next(
        (code for code in _KNOWN_CURRENCIES if re.search(rf"\b{code}\b", raw, re.I)),
        None,
    )
    if currency:
        fields["budget_currency"] = currency

    unit = next(
        (
            value
            for key, value in _SALARY_UNITS.items()
            if re.search(rf"\b{key}\b", raw, re.IGNORECASE)
        ),
        None,
    )
    if unit:
        fields["budget_unit"] = unit

    # A number is only pay when the statement carries pay context. Without this
    # guard "Posted 2026" reads as a salary of 2026.
    if not (currency or unit or re.search(r"[₹$€£]|\bsalary\b|\bpay\b|\bctc\b", raw, re.I)):
        return fields

    amounts: list[int | float] = []
    for match in re.findall(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?", raw):
        try:
            amount = Decimal(match.replace(",", ""))
        except InvalidOperation:  # pragma: no cover - regex is numeric
            continue
        if not amount.is_finite() or amount <= 0:
            continue
        amounts.append(
            int(amount) if amount == amount.to_integral_value() else float(amount)
        )
    if len(amounts) >= 2 and amounts[0] != amounts[1]:
        low, high = amounts[:2]
        if low <= high:
            fields.update(
                {"compensation_mode": "range", "budget_amount": low, "budget_max": high}
            )
        else:
            # Do not silently repair an inverted publisher range.  Omitting the
            # numeric write keeps it unresolved rather than advertising a value
            # the page did not state in that order.
            fields["compensation_mode"] = "range"
    elif amounts:
        if re.search(r"\bmaximum\b", raw, re.IGNORECASE):
            fields.update({"compensation_mode": "range", "budget_max": amounts[0]})
        elif re.search(r"\bminimum\b", raw, re.IGNORECASE):
            fields.update({"compensation_mode": "range", "budget_amount": amounts[0]})
        else:
            fields.update({"compensation_mode": "fixed", "budget_amount": amounts[0]})
    return fields


def structured_compensation_has_inverted_range(raw: str) -> bool:
    """Whether a structured pay string states a descending two-ended range."""

    match = re.search(
        r"(?<![A-Za-z])(?P<minimum>\d[\d,]*(?:\.\d+)?)\s*[-–—]\s*"
        r"(?P<maximum>\d[\d,]*(?:\.\d+)?)",
        raw,
    )
    if match is None:
        return False
    try:
        minimum = Decimal(match.group("minimum").replace(",", ""))
        maximum = Decimal(match.group("maximum").replace(",", ""))
    except InvalidOperation:  # pragma: no cover - numeric grammar
        return False
    return minimum > maximum


_WEEKLY_HOURS = re.compile(
    r"^\s*(?P<minimum>\d{1,3}(?:\.\d+)?)\s*"
    r"(?:(?:[-–—]|to)\s*(?P<maximum>\d{1,3}(?:\.\d+)?)\s*)?"
    r"(?:hours?|hrs?)\s*(?:per|/|a)\s*week\s*$",
    re.IGNORECASE,
)


def _weekly_hours_fields(raw: str) -> dict[str, object]:
    match = _WEEKLY_HOURS.fullmatch(raw)
    if match is None:
        return {}
    minimum = Decimal(match.group("minimum"))
    maximum = Decimal(match.group("maximum") or match.group("minimum"))
    if minimum <= 0 or maximum < minimum or maximum > 168:
        return {}

    def native(value: Decimal) -> int | float:
        return int(value) if value == value.to_integral_value() else float(value)

    return {
        "expected_weekly_hours_min": native(minimum),
        "expected_weekly_hours_max": native(maximum),
    }


def _future_deadline(raw: str) -> str | None:
    cleaned = raw.strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cleaned):
            parsed_date = date.fromisoformat(cleaned)
            parsed = datetime.combine(parsed_date, time.max, tzinfo=UTC)
        else:
            parsed = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return None
            parsed = parsed.astimezone(UTC)
    except ValueError:
        return None
    if parsed <= datetime.now(UTC):
        return None
    return parsed.isoformat().replace("+00:00", "Z")


def _job_start_fields(raw: str) -> dict[str, object]:
    cleaned = raw.strip()
    try:
        parsed = date.fromisoformat(cleaned)
    except ValueError:
        try:
            timestamp = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
        except ValueError:
            return {}
        if timestamp.tzinfo is None:
            return {}
        parsed = timestamp.astimezone(UTC).date()
    if parsed < datetime.now(UTC).date():
        return {}
    return {"start_timing": "specific_date", "start_date": parsed.isoformat()}


def fields_from_structured_context(context: dict[str, object]) -> dict[str, object]:
    """Field values the page states outright in its structured job data.

    Returns canonical import field paths mapped to values ready for validation.
    Only confident readings are returned; everything else is left to the model
    and, failing that, to the conversation.
    """

    if not isinstance(context, dict) or not context:
        return {}

    fields: dict[str, object] = {}

    title = _text(context.get("job_title"))
    if title:
        fields["title"] = title[:120]

    about = _text(context.get("about_summary"))
    if len(about) >= 20 and not looks_like_boilerplate(about):
        # The editor requires at least 20 characters, so a shorter blurb would
        # only give the recruiter something to fix. Job-board furniture — equal
        # opportunity notices, "powered by" footers, apply prompts — is rejected
        # outright: pre-filling it is worse than asking, because the recruiter
        # then has to notice it and delete it.
        fields["about_channel"] = about[:2000]

    raw_employment = context.get("employment_type")
    employment = (
        ",".join(item for item in raw_employment if isinstance(item, str))
        if isinstance(raw_employment, list)
        else _text(raw_employment)
    ).upper().replace(" ", "_")
    engagement_matches: set[str] = set()
    for token in re.split(r"[,/|]+", employment):
        mapped = _EMPLOYMENT_TYPES.get(token.strip())
        if mapped:
            engagement_matches.add(mapped)
    if len(engagement_matches) == 1:
        fields["engagement_type"] = next(iter(engagement_matches))

    location_type = _text(context.get("location_type"))
    remote_eligibility = _text(context.get("remote_eligibility"))
    role_location = _text(context.get("role_location"))
    role_locations = context.get("role_locations")
    has_role_locations = bool(
        isinstance(role_locations, list)
        and any(isinstance(item, str) and item.strip() for item in role_locations)
    )
    if _TELECOMMUTE.search(location_type) or _TELECOMMUTE.search(remote_eligibility):
        fields["work_mode"] = "remote"
    elif _HYBRID.search(location_type) or _HYBRID.search(role_location):
        fields["work_mode"] = "hybrid"
    elif role_location or has_role_locations:
        # A stated physical workplace and no remote signal means on-site.
        fields["work_mode"] = "onsite"
    if fields.get("work_mode") == "remote" and remote_eligibility:
        trusted_areas = (
            [item for item in context.get("remote_eligibility_areas", []) if isinstance(item, str)]
            if isinstance(context.get("remote_eligibility_areas"), list)
            else None
        )
        restriction = remote_location_restriction(
            remote_eligibility,
            trusted_areas=trusted_areas,
        )
        if restriction:
            fields["location"] = restriction
    elif role_location and fields.get("work_mode") != "remote":
        # The native field holds a city, not a formatted address. A page stating
        # "Coimbatore, Coimbatore district, IN" was putting that whole label into
        # it, and the editor's city validator refused the draft the moment it
        # opened — a technical mapping fault the recruiter was left to repair.
        canonical = city_for_location(role_location)
        if canonical:
            fields["location"] = canonical[:120]

    fields.update(_compensation_fields(_text(context.get("compensation"))))

    band = _experience_band(_text(context.get("experience_requirement")))
    if band:
        fields["experience_level"] = band

    fields.update(_weekly_hours_fields(_text(context.get("work_hours"))))
    deadline = _future_deadline(_text(context.get("valid_through")))
    if deadline:
        fields["deadline_at"] = deadline
    fields.update(_job_start_fields(_text(context.get("job_start_date"))))

    return fields
