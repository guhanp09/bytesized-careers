from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Final, Literal

import geonamescache
from babel import Locale
from babel.numbers import get_territory_currencies

ImportDecisionOrigin = Literal[
    "explicit",
    "contextual_inference",
    "semantic_inference",
    "suggestion",
    "unknown",
]
ImportDecisionConfidence = Literal["high", "medium", "low"]
ImportFieldRisk = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class ImportDecisionPolicy:
    risk: ImportFieldRisk
    allowed_origins: frozenset[ImportDecisionOrigin]
    auto_fill_confidence: ImportDecisionConfidence | None
    suggestion_confidence: ImportDecisionConfidence | None
    explicit_evidence_required: bool


@dataclass(frozen=True)
class CurrencyInference:
    currency: str | None
    origin: ImportDecisionOrigin
    confidence: ImportDecisionConfidence | None
    rationale_code: str | None
    country_code: str | None = None
    conflict_currency: str | None = None


_CONFIDENCE_RANK: Final[dict[ImportDecisionConfidence, int]] = {
    "low": 1,
    "medium": 2,
    "high": 3,
}

_SAFE_SEMANTIC_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "primary_role_key",
        "platforms",
        "formats_hired_for",
        "engagement_type",
        "work_mode",
        "budget_unit",
        "employer_context_type",
        "required_skill_keys",
        "preferred_skill_keys",
        "other_required_skills",
        "other_preferred_skills",
        "required_tool_keys",
        "other_required_tools",
        "content_niches",
        "content_genres",
        "deliverables",
        "source_inputs",
        "duration_type",
        "turnaround_unit",
    }
)

_CAUTIOUS_SEMANTIC_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "experience_level",
        "turnaround_value",
        "turnaround_basis",
        "creative_autonomy",
        "start_timeframe",
        "start_timing",
        "duration_value",
        "duration_unit",
        "revision_policy",
        "revision_rounds",
        "hiring_process",
    }
)

# These may be inferred only through exact source arithmetic (for example,
# five stated days per week multiplied by eight stated hours per day). The
# deterministic import layer supplies that contextual decision. General role
# labels such as "full-time" never authorize a numeric guess.
_SAFE_SCHEDULE_ARITHMETIC_FIELDS: Final[frozenset[str]] = frozenset(
    {"expected_weekly_hours_min", "expected_weekly_hours_max"}
)

_EXPLICIT_ONLY_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "budget_amount",
        "budget_max",
        "deadline_at",
        "start_date",
        "engagement_end_date",
        "trial_status",
        "trial_scope",
        "trial_effort_value",
        "trial_effort_unit",
        "trial_compensation_amount",
        "trial_compensation_currency",
        "trial_compensation_basis",
        "trial_work_usage",
        "trial_portfolio_permission",
        "trial_attribution",
        "unpaid_trial_confirmed",
        "screening_questions",
    }
)


def import_decision_policy(field_path: str) -> ImportDecisionPolicy:
    """Return the provider-neutral authority policy for one canonical field."""

    if field_path in _SAFE_SCHEDULE_ARITHMETIC_FIELDS:
        return ImportDecisionPolicy(
            risk="medium",
            allowed_origins=frozenset({"explicit", "contextual_inference"}),
            auto_fill_confidence="high",
            suggestion_confidence=None,
            explicit_evidence_required=True,
        )
    if field_path in {"budget_currency", "location"}:
        return ImportDecisionPolicy(
            risk="medium",
            allowed_origins=frozenset({"explicit", "contextual_inference"}),
            auto_fill_confidence="high",
            suggestion_confidence="medium",
            explicit_evidence_required=True,
        )
    if field_path in _EXPLICIT_ONLY_FIELDS:
        return ImportDecisionPolicy(
            risk="high",
            allowed_origins=frozenset({"explicit"}),
            auto_fill_confidence="high",
            suggestion_confidence=None,
            explicit_evidence_required=True,
        )
    if field_path in _SAFE_SEMANTIC_FIELDS:
        return ImportDecisionPolicy(
            risk="low",
            allowed_origins=frozenset(
                {"explicit", "contextual_inference", "semantic_inference", "suggestion"}
            ),
            auto_fill_confidence="high",
            suggestion_confidence="medium",
            explicit_evidence_required=True,
        )
    if field_path in _CAUTIOUS_SEMANTIC_FIELDS:
        return ImportDecisionPolicy(
            risk="medium",
            allowed_origins=frozenset({"explicit", "semantic_inference", "suggestion"}),
            auto_fill_confidence=None,
            suggestion_confidence="medium",
            explicit_evidence_required=True,
        )
    return ImportDecisionPolicy(
        risk="medium",
        allowed_origins=frozenset({"explicit"}),
        auto_fill_confidence="high",
        suggestion_confidence=None,
        explicit_evidence_required=True,
    )


def confidence_at_least(
    actual: ImportDecisionConfidence,
    required: ImportDecisionConfidence | None,
) -> bool:
    return required is not None and _CONFIDENCE_RANK[actual] >= _CONFIDENCE_RANK[required]


def provider_confidence_label(score: float | None, label: str | None) -> ImportDecisionConfidence:
    normalized = (label or "").strip().casefold()
    if normalized in {"high", "medium", "low"}:
        return normalized  # type: ignore[return-value]
    if score is not None and score >= 0.85:
        return "high"
    if score is not None and score >= 0.6:
        return "medium"
    return "low"


def _normalize_place(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


_COUNTRY_ALIASES: Final[dict[str, str]] = {
    "america": "US",
    "us": "US",
    "u s": "US",
    "u s a": "US",
    "usa": "US",
    "united states of america": "US",
    "uk": "GB",
    "u k": "GB",
    "great britain": "GB",
    "england": "GB",
    "scotland": "GB",
    "wales": "GB",
    "northern ireland": "GB",
}

_GLOBAL_LOCATION_MARKERS: Final[tuple[str, ...]] = (
    "anywhere in the world",
    "global remote",
    "globally remote",
    "remote worldwide",
    "worldwide remote",
    "work from anywhere",
    "worldwide",
)

# Exact generic labels used by job boards for an unbounded remote role.  These
# are not place names.  Without this guard the city gazetteer can interpret a
# token such as ``Any`` as a small real-world locality and manufacture a country
# (and therefore a contradictory currency) from "Any Location".
#
# Keep this exact rather than substring-based: "any location in Canada" still
# names Canada and should retain that applicant geography.
_UNBOUNDED_LOCATION_VALUES: Final[frozenset[str]] = frozenset(
    {
        "any location",
        "anywhere",
        "fully remote",
        "global",
        "remote",
    }
)


@lru_cache(maxsize=1)
def _country_names() -> dict[str, str]:
    names = dict(_COUNTRY_ALIASES)
    locale = Locale.parse("en")
    for code, label in locale.territories.items():
        if len(code) != 2 or not isinstance(label, str):
            continue
        normalized = _normalize_place(label)
        if normalized:
            names[normalized] = code.upper()
    for code, item in geonamescache.GeonamesCache().get_countries().items():
        for value in (item.get("name"), item.get("iso3")):
            if isinstance(value, str) and value.strip():
                names[_normalize_place(value)] = code.upper()
    return names


@lru_cache(maxsize=1)
def _city_names() -> dict[str, tuple[tuple[str, int], ...]]:
    candidates: dict[str, dict[str, int]] = {}
    for item in geonamescache.GeonamesCache().get_cities().values():
        country = item.get("countrycode")
        population = item.get("population")
        if not isinstance(country, str) or not isinstance(population, int):
            continue
        raw_names = [item.get("name"), *(item.get("alternatenames") or [])]
        for raw_name in raw_names:
            if not isinstance(raw_name, str):
                continue
            normalized = _normalize_place(raw_name)
            if len(normalized) < 3:
                continue
            by_country = candidates.setdefault(normalized, {})
            by_country[country] = max(population, by_country.get(country, 0))
    return {
        name: tuple(sorted(values.items(), key=lambda item: item[1], reverse=True))
        for name, values in candidates.items()
    }


def _country_mentions(location: str) -> set[str]:
    normalized = _normalize_place(location)
    padded = f" {normalized} "
    matches = {
        code
        for name, code in _country_names().items()
        if (len(name) >= 3 or name in {"us", "uk"}) and f" {name} " in padded
    }
    return matches


def _country_from_city(location: str) -> str | None:
    normalized = _normalize_place(location)
    if not normalized:
        return None
    matches: dict[str, int] = {}
    tokens = normalized.split()
    candidate_names = {
        " ".join(tokens[start:end])
        for start in range(len(tokens))
        for end in range(start + 1, min(len(tokens), start + 6) + 1)
    }
    city_names = _city_names()
    for name in candidate_names:
        candidates = city_names.get(name, ())
        for country, population in candidates:
            matches[country] = max(matches.get(country, 0), population)
    if not matches:
        return None
    ordered = sorted(matches.items(), key=lambda item: item[1], reverse=True)
    top_country, top_population = ordered[0]
    if len(ordered) == 1:
        return top_country
    second_population = ordered[1][1]
    if top_population >= 100_000 and top_population >= max(1, second_population) * 5:
        return top_country
    return None


def country_from_location(location: str | None) -> str | None:
    """Resolve one unambiguous country from role-location text without web lookup."""

    if not location or not location.strip():
        return None
    normalized = _normalize_place(location)
    if normalized in _UNBOUNDED_LOCATION_VALUES:
        return None
    if any(marker in normalized for marker in _GLOBAL_LOCATION_MARKERS):
        return None
    countries = _country_mentions(location)
    if len(countries) == 1:
        return next(iter(countries))
    if len(countries) > 1:
        return None
    return _country_from_city(location)


def explicit_country_from_location(location: str | None) -> str | None:
    """Return a country only when the source names that country directly.

    Unlike :func:`country_from_location`, this never derives a country from a
    city. It is therefore safe for remote applicant eligibility: an employer's
    Chennai office must not silently become an India-only remote role.
    """

    if not location or not location.strip():
        return None
    countries = _country_mentions(location)
    return next(iter(countries)) if len(countries) == 1 else None


def currency_for_country(country_code: str | None) -> str | None:
    if not country_code:
        return None
    currencies = get_territory_currencies(country_code.upper(), tender=True)
    return currencies[0] if len(currencies) == 1 else None


def infer_compensation_currency(
    *,
    explicit_currency: str | None,
    amount_present: bool,
    role_location: str | None,
    work_mode: str | None = None,
    employer_location: str | None = None,
) -> CurrencyInference:
    """Infer currency only from one strong role-country signal.

    Role location always outranks employer context. Employer location is used
    only for an explicitly local hybrid/onsite role. URL domains and browser
    locale are deliberately absent from this API.
    """

    role_country = country_from_location(role_location)
    contextual_country = role_country
    rationale = "currency_from_role_country" if role_country else None
    normalized_mode = (work_mode or "").strip().casefold().replace("-", "")
    if contextual_country is None and normalized_mode in {"hybrid", "onsite"}:
        contextual_country = country_from_location(employer_location)
        if contextual_country:
            rationale = "currency_from_local_employer_country"
    inferred = currency_for_country(contextual_country)

    explicit = explicit_currency.strip().upper() if explicit_currency else None
    if explicit:
        return CurrencyInference(
            currency=explicit,
            origin="explicit",
            confidence="high",
            rationale_code="currency_explicit",
            country_code=contextual_country,
            conflict_currency=(inferred if inferred and inferred != explicit else None),
        )
    if not amount_present or inferred is None:
        return CurrencyInference(
            currency=None,
            origin="unknown",
            confidence=None,
            rationale_code=None,
            country_code=contextual_country,
        )
    return CurrencyInference(
        currency=inferred,
        origin="contextual_inference",
        confidence="high",
        rationale_code=rationale,
        country_code=contextual_country,
    )
