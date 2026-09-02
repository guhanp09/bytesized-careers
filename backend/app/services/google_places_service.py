"""Bounded access to the fixed Google Places endpoints used by location fields.

The query and place id are user influenced, but the destination is not. Keeping
this adapter separate from the arbitrary-URL fetcher makes that distinction
explicit: TLS still authenticates Google's fixed host, redirects are refused so
the API key cannot escape to another origin, environment proxies and cookies
are disabled, and the decoded response is streamed under a small ceiling.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

import httpx

GOOGLE_PLACES_AUTOCOMPLETE_URL = (
    "https://maps.googleapis.com/maps/api/place/autocomplete/json"
)
GOOGLE_PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"

MIN_QUERY_CHARS = 2
MAX_QUERY_CHARS = 255
# Google intentionally does not publish a provider maximum for place IDs. This
# is CreatorJobs' transport/storage safety ceiling, not a claim about Google.
MAX_PLACE_ID_CHARS = 2048
MAX_PROVIDER_RESPONSE_BYTES = 128 * 1024
MAX_PROVIDER_PREDICTIONS = 64
MAX_SUGGESTIONS = 6
MAX_DISPLAY_NAME_CHARS = 768
MAX_LOCATION_PART_CHARS = 255
PROVIDER_TIMEOUT_SECONDS = 4.0
PROVIDER_TOTAL_TIMEOUT_SECONDS = 6.0


class GooglePlacesNotConfiguredError(Exception):
    """The optional provider key is absent, so the caller may use local data."""


class GooglePlacesInvalidQueryError(ValueError):
    """The caller supplied a query outside the application contract."""


class GooglePlacesInvalidPlaceError(ValueError):
    """The selected provider identifier does not resolve to a supported city."""


class GooglePlacesUnavailableError(Exception):
    """The provider could not safely produce a usable response."""


@dataclass(frozen=True, slots=True)
class GooglePlaceSuggestion:
    place_id: str
    display_name: str
    primary_text: str
    secondary_text: str


@dataclass(frozen=True, slots=True)
class GooglePlaceDetails:
    place_id: str
    display_name: str
    city: str
    region: str
    country: str
    country_code: str
    latitude: float | None = None
    longitude: float | None = None


def _contains_unsafe_codepoint(value: str) -> bool:
    return any(unicodedata.category(character) in {"Cc", "Cf", "Cs"} for character in value)


def _clean_text(value: object, *, max_chars: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split())
    if not normalized or len(normalized) > max_chars or _contains_unsafe_codepoint(normalized):
        return None
    return normalized


def normalize_location_query(value: str) -> str:
    normalized = _clean_text(value, max_chars=MAX_QUERY_CHARS)
    if normalized is None or len(normalized) < MIN_QUERY_CHARS:
        raise GooglePlacesInvalidQueryError("Invalid location query")
    return normalized


def normalize_place_id(value: str) -> str:
    normalized = _clean_text(value, max_chars=MAX_PLACE_ID_CHARS)
    if normalized is None:
        raise GooglePlacesInvalidPlaceError("Invalid place identifier")
    return normalized


def _response_media_type(response: httpx.Response) -> str:
    return response.headers.get("content-type", "").split(";", 1)[0].strip().casefold()


async def _read_bounded_json(response: httpx.Response) -> dict[str, Any]:
    if _response_media_type(response) != "application/json":
        raise GooglePlacesUnavailableError("Google Places returned an unsupported response")

    declared_length = response.headers.get("content-length")
    if declared_length is not None:
        try:
            if int(declared_length) < 0 or int(declared_length) > MAX_PROVIDER_RESPONSE_BYTES:
                raise GooglePlacesUnavailableError(
                    "Google Places response exceeded the configured limit"
                )
        except ValueError:
            raise GooglePlacesUnavailableError(
                "Google Places returned an invalid response"
            ) from None

    body = bytearray()
    async for chunk in response.aiter_bytes():
        body.extend(chunk)
        if len(body) > MAX_PROVIDER_RESPONSE_BYTES:
            raise GooglePlacesUnavailableError(
                "Google Places response exceeded the configured limit"
            )

    def reject_non_json_number(_value: str) -> None:
        raise ValueError("Non-JSON numeric constant")

    try:
        payload = json.loads(body, parse_constant=reject_non_json_number)
    except (ValueError, UnicodeDecodeError):
        raise GooglePlacesUnavailableError(
            "Google Places returned an invalid response"
        ) from None
    if not isinstance(payload, dict):
        raise GooglePlacesUnavailableError("Google Places returned an invalid response")
    return payload


def _normalize_prediction(raw: object) -> GooglePlaceSuggestion | None:
    if not isinstance(raw, dict):
        return None
    place_id = _clean_text(raw.get("place_id"), max_chars=MAX_PLACE_ID_CHARS)
    display_name = _clean_text(raw.get("description"), max_chars=MAX_DISPLAY_NAME_CHARS)
    if place_id is None or display_name is None:
        return None

    formatting = raw.get("structured_formatting")
    if not isinstance(formatting, dict):
        formatting = {}
    fallback_primary = display_name.split(",", 1)[0]
    primary_text = _clean_text(
        formatting.get("main_text") or fallback_primary,
        max_chars=MAX_LOCATION_PART_CHARS,
    )
    if primary_text is None:
        return None
    fallback_secondary = display_name.split(",", 1)[1] if "," in display_name else ""
    secondary_text = _clean_text(
        formatting.get("secondary_text") or fallback_secondary,
        max_chars=MAX_DISPLAY_NAME_CHARS,
    )
    return GooglePlaceSuggestion(
        place_id=place_id,
        display_name=display_name,
        primary_text=primary_text,
        secondary_text=secondary_text or "",
    )


def _component_with_type(components: list[object], component_type: str) -> dict[str, Any] | None:
    for component in components[:64]:
        if not isinstance(component, dict):
            continue
        types = component.get("types")
        if isinstance(types, list) and component_type in types[:16]:
            return component
    return None


def _first_component(components: list[object], component_types: tuple[str, ...]) -> dict[str, Any] | None:
    for component_type in component_types:
        component = _component_with_type(components, component_type)
        if component is not None:
            return component
    return None


def _component_text(component: dict[str, Any] | None, field: str, max_chars: int) -> str | None:
    return _clean_text(component.get(field), max_chars=max_chars) if component else None


def _coordinate(value: object, *, minimum: float, maximum: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or not minimum <= number <= maximum:
        return None
    return number


class GooglePlacesService:
    """One redacted, fixed-destination provider adapter."""

    def __init__(
        self,
        api_key: str | None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        total_timeout_seconds: float = PROVIDER_TOTAL_TIMEOUT_SECONDS,
    ) -> None:
        cleaned_key = api_key.strip() if isinstance(api_key, str) else ""
        self._api_key = cleaned_key or None
        self._transport = transport
        self._total_timeout_seconds = total_timeout_seconds

    def __repr__(self) -> str:
        configured = "<redacted>" if self._api_key else None
        return f"GooglePlacesService(api_key={configured}, destination=<fixed>)"

    async def _request(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        if not self._api_key:
            raise GooglePlacesNotConfiguredError("Google Places is not configured")
        try:
            async with asyncio.timeout(self._total_timeout_seconds):
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(PROVIDER_TIMEOUT_SECONDS, connect=2.0),
                    follow_redirects=False,
                    trust_env=False,
                    transport=self._transport,
                ) as client:
                    async with client.stream(
                        "GET",
                        url,
                        params={**params, "key": self._api_key},
                        headers={
                            "Accept": "application/json",
                            "User-Agent": "CreatorJobs-GooglePlaces/1.0",
                        },
                    ) as response:
                        if response.status_code != 200:
                            raise GooglePlacesUnavailableError(
                                "Google Places is temporarily unavailable"
                            )
                        return await _read_bounded_json(response)
        except (GooglePlacesNotConfiguredError, GooglePlacesUnavailableError):
            raise
        except (TimeoutError, httpx.HTTPError):
            # Never chain the provider exception: its request URL includes the
            # API key and may be rendered by an exception logger.
            raise GooglePlacesUnavailableError(
                "Google Places is temporarily unavailable"
            ) from None

    async def autocomplete(self, query: str) -> tuple[GooglePlaceSuggestion, ...]:
        normalized_query = normalize_location_query(query)
        payload = await self._request(
            GOOGLE_PLACES_AUTOCOMPLETE_URL,
            {
                "input": normalized_query,
                "types": "(cities)",
                "language": "en",
                # Preserve the existing India-first relevance bias without
                # restricting global city results.
                "location": "20.5937,78.9629",
                "radius": "3000000",
            },
        )
        provider_status = payload.get("status")
        if provider_status == "ZERO_RESULTS":
            return ()
        if provider_status != "OK":
            raise GooglePlacesUnavailableError("Google Places is temporarily unavailable")
        predictions = payload.get("predictions")
        if not isinstance(predictions, list):
            raise GooglePlacesUnavailableError("Google Places returned an invalid response")

        seen: set[str] = set()
        suggestions: list[GooglePlaceSuggestion] = []
        for raw in predictions[:MAX_PROVIDER_PREDICTIONS]:
            suggestion = _normalize_prediction(raw)
            if suggestion is None or suggestion.place_id in seen:
                continue
            seen.add(suggestion.place_id)
            suggestions.append(suggestion)
            if len(suggestions) == MAX_SUGGESTIONS:
                break
        return tuple(suggestions)

    async def details(self, place_id: str) -> GooglePlaceDetails:
        normalized_place_id = normalize_place_id(place_id)
        payload = await self._request(
            GOOGLE_PLACE_DETAILS_URL,
            {
                "place_id": normalized_place_id,
                "fields": "place_id,name,address_components,geometry",
                "language": "en",
            },
        )
        provider_status = payload.get("status")
        if provider_status in {"ZERO_RESULTS", "NOT_FOUND", "INVALID_REQUEST"}:
            raise GooglePlacesInvalidPlaceError("Unknown place identifier")
        if provider_status != "OK":
            raise GooglePlacesUnavailableError("Google Places is temporarily unavailable")

        result = payload.get("result")
        if not isinstance(result, dict):
            raise GooglePlacesUnavailableError("Google Places returned an invalid response")
        raw_components = result.get("address_components")
        if not isinstance(raw_components, list):
            raise GooglePlacesUnavailableError("Google Places returned an invalid response")

        city_component = _first_component(
            raw_components,
            (
                "locality",
                "postal_town",
                "administrative_area_level_3",
                "sublocality_level_1",
                "administrative_area_level_2",
            ),
        )
        region_component = _first_component(
            raw_components,
            ("administrative_area_level_1", "administrative_area_level_2"),
        )
        country_component = _component_with_type(raw_components, "country")
        city = _component_text(city_component, "long_name", MAX_LOCATION_PART_CHARS)
        if city is None:
            city = _clean_text(result.get("name"), max_chars=MAX_LOCATION_PART_CHARS)
        region = _component_text(
            region_component, "long_name", MAX_LOCATION_PART_CHARS
        ) or ""
        country = _component_text(
            country_component, "long_name", MAX_LOCATION_PART_CHARS
        )
        if city is None or country is None:
            raise GooglePlacesInvalidPlaceError("Place is not a supported city")

        country_code = _component_text(country_component, "short_name", 8) or ""
        if not re.fullmatch(r"[A-Za-z]{2}", country_code):
            country_code = ""
        else:
            country_code = country_code.upper()

        unique_parts: list[str] = []
        seen_parts: set[str] = set()
        for part in (city, region, country):
            key = part.casefold()
            if key not in seen_parts:
                seen_parts.add(key)
                unique_parts.append(part)
        display_name = ", ".join(unique_parts)
        if len(display_name) > MAX_DISPLAY_NAME_CHARS:
            raise GooglePlacesUnavailableError("Google Places returned an invalid response")

        geometry = result.get("geometry")
        location = geometry.get("location") if isinstance(geometry, dict) else None
        latitude = (
            _coordinate(location.get("lat"), minimum=-90.0, maximum=90.0)
            if isinstance(location, dict)
            else None
        )
        longitude = (
            _coordinate(location.get("lng"), minimum=-180.0, maximum=180.0)
            if isinstance(location, dict)
            else None
        )
        # A half-coordinate is not useful and invites callers to infer the
        # missing half. Return the pair together or not at all.
        if latitude is None or longitude is None:
            latitude = None
            longitude = None

        provider_place_id = _clean_text(
            result.get("place_id"), max_chars=MAX_PLACE_ID_CHARS
        )
        return GooglePlaceDetails(
            place_id=provider_place_id or normalized_place_id,
            display_name=display_name,
            city=city,
            region=region,
            country=country,
            country_code=country_code,
            latitude=latitude,
            longitude=longitude,
        )


__all__ = [
    "GOOGLE_PLACES_AUTOCOMPLETE_URL",
    "GOOGLE_PLACE_DETAILS_URL",
    "MAX_PLACE_ID_CHARS",
    "MAX_PROVIDER_RESPONSE_BYTES",
    "MAX_QUERY_CHARS",
    "GooglePlaceDetails",
    "GooglePlaceSuggestion",
    "GooglePlacesInvalidPlaceError",
    "GooglePlacesInvalidQueryError",
    "GooglePlacesNotConfiguredError",
    "GooglePlacesService",
    "GooglePlacesUnavailableError",
    "normalize_location_query",
    "normalize_place_id",
]
