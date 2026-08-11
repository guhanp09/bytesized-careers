"""Resolve a job's city from corroborating source context.

A listing page does not always put a city in one canonical slot. Structured
markup may name a neighbourhood, the title may name the city, and the body may
say which city's candidates it wants. Looking at each string in isolation
turns those compatible facts into a conflict. This module reads only explicit
location-shaped evidence and combines it; it does not infer a place from an
employer name, URL, browser locale, or market likelihood.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache

import geonamescache

from app.core.job_import_labelled_fields import primary_job_text
from app.core.job_import_location_resolution import (
    CITY_ALIASES,
    KNOWN_LOCALITIES,
    city_for_location,
)


@dataclass(frozen=True)
class JobCityResolution:
    city: str | None = None
    evidence: list[str] = field(default_factory=list)
    conflicting_cities: list[str] = field(default_factory=list)
    rationale_code: str | None = None

    @property
    def resolved(self) -> bool:
        return self.city is not None and not self.conflicting_cities


def _normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


@lru_cache(maxsize=1)
def _city_catalog() -> dict[str, tuple[str, int]]:
    """Known city spellings, preferring the largest exact-name match.

    The catalog is used only inside title/location-shaped source lines. It is
    not a fuzzy geocoder and makes no network request.
    """

    catalog: dict[str, tuple[str, int]] = {
        key: (value, 10**9) for key, value in CITY_ALIASES.items()
    }
    for item in geonamescache.GeonamesCache().get_cities().values():
        name = item.get("name")
        population = item.get("population")
        if not isinstance(name, str) or not isinstance(population, int):
            continue
        for raw in (name, item.get("ascii"), *(item.get("alternatenames") or [])):
            if not isinstance(raw, str):
                continue
            key = _normalise(raw)
            if len(key) < 3:
                continue
            previous = catalog.get(key)
            if previous is None or population > previous[1]:
                catalog[key] = (name, population)
    return catalog


def _cities_in(value: str, *, prose: bool = False) -> list[str]:
    normalized = _normalise(value)
    if not normalized:
        return []
    tokens = normalized.split()
    catalog = _city_catalog()
    found: list[tuple[int, str]] = []
    for start in range(len(tokens)):
        for end in range(min(len(tokens), start + 5), start, -1):
            phrase = " ".join(tokens[start:end])
            match = catalog.get(phrase)
            if match is None:
                continue
            city, population = match
            # In prose, tiny place names are too collision-prone. A labelled
            # location or title suffix is already structural evidence and may
            # name a smaller city exactly.
            if prose and population < 100_000 and phrase not in CITY_ALIASES:
                continue
            found.append((end - start, CITY_ALIASES.get(city.casefold(), city)))
            break
    ordered = [city for _length, city in sorted(found, reverse=True)]
    return list(dict.fromkeys(ordered))


_LOCATION_ROW = re.compile(
    r"^(?:structured\s+role\s+location|office\s+location|job\s+location|"
    r"work\s+location|location|city)\s*[:\-–]\s*(?P<value>[^\n]{1,180})$",
    re.IGNORECASE,
)
_TITLE_ROW = re.compile(r"^(?:structured\s+job\s+title\s*:\s*)?(?P<value>[^\n]{1,220})$")
_TITLE_LOCATION_SUFFIX = re.compile(
    r"(?:\s+(?:[-–—|])\s+|\b(?:based\s+)?in\s+|\blocation\s*:\s*)"
    r"(?P<value>[^\n|]{2,100})$",
    re.IGNORECASE,
)
_CITY_PREFERENCE = re.compile(
    r"\b(?:prefer|preferred|preference)\b"
    r"(?:\s+(?:is|given))?(?:\s+(?:to|for))?[\s:,-]*"
    r"(?P<place>[^\n.;|]{2,80}?)\s+\b(?:candidate|applicant)s?\b",
    re.IGNORECASE,
)
_CANDIDATE_GEOGRAPHY = re.compile(
    r"\b(?:candidate|applicant)s?\b\s+(?:in|from|based\s+in)\s+"
    r"(?P<place>[^\n.;|]{2,80})",
    re.IGNORECASE,
)
_PHYSICAL_LOCATION_CONTEXT = re.compile(
    r"\b(?:our\s+)?(?:office|studio|workplace|team|role|job)\b[^\n]{0,50}"
    r"\b(?:based|located|situated|working)\b\s+(?:at|in)\b\s+"
    r"(?P<place>[^\n.;|]{2,100})",
    re.IGNORECASE,
)


def _cities_in_title_location(value: str) -> list[str]:
    """Read only a title's explicitly location-shaped suffix.

    City catalogs contain ordinary words such as ``Mobile``, ``Reading``, and
    ``Nice``. Seeing one of those words in a role title is not evidence that the
    job is in that city. A delimiter or an ``in``/``location`` phrase gives the
    suffix location semantics; otherwise another independent location signal
    must carry the resolution.
    """

    match = _TITLE_LOCATION_SUFFIX.search(value.strip())
    if match is None:
        return []
    return _cities_in(match.group("value"), prose=True)


def resolve_job_city(
    source_text: str | None,
    structured_context: dict[str, object] | None,
    *,
    work_mode: str | None,
) -> JobCityResolution:
    """Resolve one corroborated physical-workplace city, or leave it open."""

    if work_mode == "remote":
        return JobCityResolution(rationale_code="remote_geography_preserved")

    observations: list[tuple[str, str]] = []
    seen_title_signals: set[tuple[str, str]] = set()

    def add_title_observations(value: str, evidence: str) -> None:
        # Normalise the underlying title, not its rendering. JSON-LD commonly
        # repeats the same title in the normalized source; that is one signal,
        # not independent corroboration.
        title_key = _normalise(
            re.sub(
                r"^structured\s+job\s+title\s*:\s*",
                "",
                value,
                flags=re.IGNORECASE,
            )
        )
        for city in _cities_in_title_location(value):
            signal = (title_key, city.casefold())
            if signal in seen_title_signals:
                continue
            seen_title_signals.add(signal)
            observations.append((city, evidence))

    context = structured_context or {}
    role_location = context.get("role_location")
    if isinstance(role_location, str) and role_location.strip():
        city = city_for_location(role_location)
        if city:
            observations.append((city, f"Structured role location: {role_location}"))

    title = context.get("job_title")
    if isinstance(title, str):
        add_title_observations(title, f"Structured job title: {title}")

    text = primary_job_text(source_text)
    for index, raw_line in enumerate(text.splitlines()[:160]):
        line = " ".join(raw_line.split()).strip()
        if not line:
            continue
        row = _LOCATION_ROW.match(line)
        if row:
            value = row.group("value")
            direct = city_for_location(value)
            cities = [direct] if direct else _cities_in(value)
            for city in cities:
                if city:
                    observations.append((city, line))
            continue

        # The first line and explicit title lines are title-shaped evidence.
        is_title = index == 0 or line.casefold().startswith("structured job title:")
        is_visible_heading = " | " in line and any(
            marker in line.casefold() for marker in ("job", "editor", "designer", "writer")
        )
        if is_title or is_visible_heading:
            title_match = _TITLE_ROW.match(line)
            if title_match:
                add_title_observations(title_match.group("value"), line)
            continue

        # "We prefer Chennai candidates" is a direct geographic restriction,
        # not incidental prose mentioning a city.
        physical_location = _PHYSICAL_LOCATION_CONTEXT.search(line)
        city_preference = _CITY_PREFERENCE.search(line)
        candidate_geography = _CANDIDATE_GEOGRAPHY.search(line)
        has_location_semantics = bool(
            city_preference or candidate_geography or physical_location
        )
        if has_location_semantics:
            # Once the grammar names the object of “based/located in,” scan the
            # place phrase rather than the whole sentence. GeoNames contains
            # alternate names that collide with ordinary words (notably “The”
            # for Teresina); scanning “The team is located in Chennai” therefore
            # fabricated a second city and converted a settled location into a
            # conflict. Preference wording has no equally stable object shape,
            # so it continues through the bounded full-line reader.
            location_fragment = next(
                match.group("place")
                for match in (physical_location, city_preference, candidate_geography)
                if match is not None
            )
            explicit_cities = _cities_in(location_fragment, prose=True)
            for city in explicit_cities:
                observations.append((city, line))

            # A known locality can settle its containing city only inside an
            # actual workplace-location statement. Ordinary job prose often
            # talks *about* Electronic City or Salt Lake City; reading a token
            # from that prose as the workplace silently relocates the role.
            # Prefer an explicit full city first, so ``Salt Lake City`` never
            # falls back to the Kolkata neighbourhood named ``Salt Lake``.
            if not explicit_cities:
                folded = _normalise(line)
                for locality, city in KNOWN_LOCALITIES.items():
                    if re.search(rf"\b{re.escape(_normalise(locality))}\b", folded):
                        observations.append((city, line))

    unique_cities = list(dict.fromkeys(city for city, _evidence in observations))
    evidence = list(dict.fromkeys(item for _city, item in observations))[:5]
    if len(unique_cities) == 1:
        return JobCityResolution(
            city=unique_cities[0],
            evidence=evidence,
            rationale_code=(
                "corroborated_city_from_source_context"
                if len(evidence) > 1
                else "normalized_explicit_city"
            ),
        )
    if len(unique_cities) > 1:
        return JobCityResolution(
            evidence=evidence,
            conflicting_cities=unique_cities[:8],
            rationale_code="conflicting_explicit_cities",
        )
    return JobCityResolution(rationale_code="city_not_found")
