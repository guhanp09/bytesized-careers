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
from typing import Any, Final

from app.core.job_import_field_descriptions import looks_like_boilerplate
from app.core.job_import_location_resolution import parse_location

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
_KNOWN_CURRENCIES: Final[frozenset[str]] = frozenset({"INR", "USD", "EUR", "GBP"})

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
_YEARS = re.compile(r"(\d{1,2})\s*(?:[-–]\s*(\d{1,2}))?\s*\+?\s*year", re.IGNORECASE)
_MONTHS = re.compile(r"(\d{1,3})\s*month", re.IGNORECASE)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _experience_band(raw: str) -> str | None:
    """Map a stated requirement onto the bands the Post Job editor parses."""

    years = _YEARS.search(raw)
    if years:
        low, high = years.groups()
        return f"{low}–{high} years" if high else f"{low}–{int(low) + 3} years"
    months = _MONTHS.search(raw)
    if months:
        total = int(months.group(1))
        low = total // 12
        return f"{low}–{low + 2} years"
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

    amounts = [
        int(match.replace(",", ""))
        for match in re.findall(r"\d[\d,]{2,}", raw)
    ]
    amounts = [value for value in amounts if value >= 100]
    if len(amounts) >= 2 and amounts[0] != amounts[1]:
        low, high = sorted(amounts[:2])
        fields.update(
            {"compensation_mode": "range", "budget_amount": low, "budget_max": high}
        )
    elif amounts:
        fields.update({"compensation_mode": "fixed", "budget_amount": amounts[0]})
    return fields


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

    employment = _text(context.get("employment_type")).upper().replace(" ", "_")
    for token in re.split(r"[,/|]+", employment):
        mapped = _EMPLOYMENT_TYPES.get(token.strip())
        if mapped:
            fields["engagement_type"] = mapped
            break

    location_type = _text(context.get("location_type"))
    remote_eligibility = _text(context.get("remote_eligibility"))
    role_location = _text(context.get("role_location"))
    if _TELECOMMUTE.search(location_type) or _TELECOMMUTE.search(remote_eligibility):
        fields["work_mode"] = "remote"
    elif _HYBRID.search(location_type) or _HYBRID.search(role_location):
        fields["work_mode"] = "hybrid"
    elif role_location:
        # A stated physical workplace and no remote signal means on-site.
        fields["work_mode"] = "onsite"
    if role_location and fields.get("work_mode") != "remote":
        # The native field holds a city, not a formatted address. A page stating
        # "Coimbatore, Coimbatore district, IN" was putting that whole label into
        # it, and the editor's city validator refused the draft the moment it
        # opened — a technical mapping fault the recruiter was left to repair.
        parts = parse_location(role_location)
        canonical = ", ".join(
            component for component in (parts.locality, parts.city) if component
        )
        if canonical:
            fields["location"] = canonical[:120]

    fields.update(_compensation_fields(_text(context.get("compensation"))))

    band = _experience_band(_text(context.get("experience_requirement")))
    if band:
        fields["experience_level"] = band

    return fields
