"""Bounded access to the two fixed YouTube Data API endpoints.

User-supplied channel/video identifiers can affect only encoded query values;
the destination, credential, redirect policy, time budget, decoded-body ceiling
and normalized output are server owned. OAuth failures keep a deliberately
narrow classification so provider outages never erase a valid stored grant.
"""

from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import parse_qs, urlparse

import httpx
from pydantic import SecretStr

from app.core.config import settings
from app.core.external_url import ExternalUrlError, canonicalize_external_url

YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
YOUTUBE_PROVIDER_URLS = frozenset({YOUTUBE_CHANNELS_URL, YOUTUBE_VIDEOS_URL})

MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024
MAX_PROVIDER_ITEMS = 50
MAX_IDENTIFIER_CHARS = 128
MAX_TITLE_CHARS = 255
MAX_DESCRIPTION_CHARS = 500
MAX_HANDLE_CHARS = 100
MAX_URL_CHARS = 2048
MAX_DURATION_CHARS = 64
PROVIDER_TIMEOUT_SECONDS = 8.0
PROVIDER_CONNECT_TIMEOUT_SECONDS = 2.0
PROVIDER_TOTAL_TIMEOUT_SECONDS = 12.0

YouTubeIdentitySelector = Literal["channel_id", "handle", "username", "video_id"]

_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
_CHANNEL_ID = re.compile(r"UC[A-Za-z0-9_-]{20,126}")


class YouTubeReauthRequiredError(Exception):
    pass


class YouTubeAPIError(Exception):
    pass


class YouTubeNotConfiguredError(YouTubeAPIError):
    pass


class YouTubeInvalidSelectorError(ValueError):
    pass


@dataclass(slots=True)
class YouTubeChannelResult:
    channel_id: str
    title: str
    thumbnail_url: str | None


@dataclass(slots=True)
class YouTubeVideoMetadataResult:
    video_id: str
    title: str
    description: str | None
    thumbnail_url: str | None
    channel_name: str | None
    channel_id: str | None
    view_count: int | None
    like_count: int | None
    comment_count: int | None
    published_date: datetime | None
    duration: str | None
    duration_iso: str | None
    duration_label: str | None
    thumbnail_options: list[dict[str, object]]
    video_url: str


@dataclass(frozen=True, slots=True)
class YouTubeChannelIdentityResult:
    channel_id: str
    title: str
    thumbnail_url: str | None
    handle: str | None
    canonical_url: str


@dataclass(frozen=True, slots=True)
class _YouTubeProviderResponse:
    status_code: int
    payload: dict[str, Any] | None


def _contains_unsafe_codepoint(value: str) -> bool:
    return any(unicodedata.category(character) in {"Cc", "Cf", "Cs"} for character in value)


def _clean_text(value: object, *, max_chars: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split())
    if not normalized or len(normalized) > max_chars or _contains_unsafe_codepoint(normalized):
        return None
    return normalized


def _bounded_text(value: object, *, max_chars: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split())
    if not normalized or _contains_unsafe_codepoint(normalized):
        return None
    return normalized[:max_chars]


def _safe_external_url(value: object, *, max_chars: int = MAX_URL_CHARS) -> str | None:
    cleaned = _clean_text(value, max_chars=max_chars)
    if cleaned is None:
        return None
    try:
        return canonicalize_external_url(cleaned, max_length=max_chars)
    except ExternalUrlError:
        return None


def configured_youtube_api_key() -> str | None:
    for configured in (settings.youtube_api_key, settings.youtube_data_api_key):
        if isinstance(configured, SecretStr):
            value = configured.get_secret_value().strip()
        elif isinstance(configured, str):
            value = configured.strip()
        else:
            value = ""
        if value:
            return value
    return None


def _pick_thumbnail(
    snippet: dict[str, object],
    *,
    max_chars: int = MAX_URL_CHARS,
) -> str | None:
    thumbnails = snippet.get("thumbnails")
    if not isinstance(thumbnails, dict):
        return None
    for key in ("maxres", "standard", "high", "medium", "default"):
        candidate = thumbnails.get(key)
        if isinstance(candidate, dict):
            url = _safe_external_url(candidate.get("url"), max_chars=max_chars)
            if url:
                return url
    return None


def _thumbnail_options(snippet: dict[str, object]) -> list[dict[str, object]]:
    thumbnails = snippet.get("thumbnails")
    if not isinstance(thumbnails, dict):
        return []

    options: list[dict[str, object]] = []
    seen_urls: set[str] = set()
    for key in ("maxres", "standard", "high", "medium", "default"):
        candidate = thumbnails.get(key)
        if not isinstance(candidate, dict):
            continue
        url = _safe_external_url(candidate.get("url"))
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        option: dict[str, object] = {"quality": key, "url": url}
        width = _parse_int(candidate.get("width"), maximum=100_000)
        height = _parse_int(candidate.get("height"), maximum=100_000)
        if width is not None:
            option["width"] = width
        if height is not None:
            option["height"] = height
        options.append(option)
    return options


def extract_video_id(youtube_url: str) -> str | None:
    raw = (youtube_url or "").strip()
    if not raw:
        return None

    simple_match = _VIDEO_ID.fullmatch(raw)
    if simple_match:
        return raw

    parsed = urlparse(raw)
    host = parsed.netloc.lower().replace("www.", "")

    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
        return candidate if _VIDEO_ID.fullmatch(candidate or "") else None

    if host in {"youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            query_video = parse_qs(parsed.query).get("v", [None])[0]
            if query_video and _VIDEO_ID.fullmatch(query_video):
                return query_video
        path_parts = [part for part in parsed.path.split("/") if part]
        if len(path_parts) >= 2 and path_parts[0] in {"shorts", "embed", "live"}:
            candidate = path_parts[1]
            if _VIDEO_ID.fullmatch(candidate):
                return candidate

    return None


def _parse_published_date(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _parse_duration_iso_to_readable(duration_iso: object) -> str | None:
    if not isinstance(duration_iso, str) or not duration_iso.strip():
        return None
    value = duration_iso.strip().upper()
    if len(value) > MAX_DURATION_CHARS or _contains_unsafe_codepoint(value):
        return None
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value)
    if not match:
        return None
    hours = int(match.group(1) or "0")
    minutes = int(match.group(2) or "0")
    seconds = int(match.group(3) or "0")
    if hours > 0:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def _parse_int(value: object, *, maximum: int = 9_223_372_036_854_775_807) -> int | None:
    if isinstance(value, bool):
        return None
    parsed: int
    if isinstance(value, int):
        parsed = value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            parsed = int(stripped)
        except ValueError:
            return None
    elif not isinstance(value, int):
        return None
    return parsed if 0 <= parsed <= maximum else None


def _youtube_error_reasons(payload: dict[str, Any] | None) -> set[str]:
    if not isinstance(payload, dict):
        return set()
    error = payload.get("error")
    if not isinstance(error, dict):
        return set()
    errors = error.get("errors")
    if not isinstance(errors, list):
        return set()
    return {
        reason
        for item in errors
        if isinstance(item, dict) and isinstance((reason := item.get("reason")), str)
    }


def _parse_json_body(body: bytes) -> dict[str, Any]:
    def reject_non_json_number(_value: str) -> None:
        raise ValueError("Non-JSON numeric constant")

    try:
        payload = json.loads(body, parse_constant=reject_non_json_number)
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise YouTubeAPIError("YouTube API returned an invalid response") from None
    if not isinstance(payload, dict):
        raise YouTubeAPIError("YouTube API returned an invalid response")
    return payload


async def _read_provider_response(
    response: httpx.Response,
) -> _YouTubeProviderResponse:
    declared_length = response.headers.get("content-length")
    if declared_length is not None:
        try:
            length = int(declared_length)
        except ValueError:
            raise YouTubeAPIError("YouTube API returned an invalid response") from None
        if length < 0 or length > MAX_PROVIDER_RESPONSE_BYTES:
            raise YouTubeAPIError("YouTube API response exceeded the configured limit")

    body = bytearray()
    async for chunk in response.aiter_bytes():
        body.extend(chunk)
        if len(body) > MAX_PROVIDER_RESPONSE_BYTES:
            raise YouTubeAPIError("YouTube API response exceeded the configured limit")

    media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
    is_json = media_type == "application/json" or media_type.endswith("+json")
    if response.status_code == 200:
        if not is_json or not body:
            raise YouTubeAPIError("YouTube API returned an invalid response")
        return _YouTubeProviderResponse(response.status_code, _parse_json_body(body))

    # Error bodies are never reflected. Parse bounded JSON only when it can be
    # used to distinguish an explicit OAuth permission failure from an ordinary
    # provider outage. A non-JSON error remains an ordinary provider error.
    try:
        payload = _parse_json_body(body) if is_json and body else None
    except YouTubeAPIError:
        payload = None
    return _YouTubeProviderResponse(response.status_code, payload)


def _normalize_selector(
    selector: YouTubeIdentitySelector,
    value: str,
) -> str:
    normalized = _clean_text(value, max_chars=MAX_IDENTIFIER_CHARS)
    if normalized is None:
        raise YouTubeInvalidSelectorError("Invalid YouTube identifier")
    if selector == "video_id":
        if not _VIDEO_ID.fullmatch(normalized):
            raise YouTubeInvalidSelectorError("Invalid YouTube video identifier")
        return normalized
    if selector == "channel_id":
        if not _CHANNEL_ID.fullmatch(normalized):
            raise YouTubeInvalidSelectorError("Invalid YouTube channel identifier")
        return normalized
    if selector == "handle":
        normalized = normalized.removeprefix("@")
    if selector not in {"handle", "username"}:
        raise YouTubeInvalidSelectorError("Unsupported YouTube selector")
    if (
        not normalized
        or len(normalized) > MAX_HANDLE_CHARS
        or any(character.isspace() or character in "/?#&=" for character in normalized)
    ):
        raise YouTubeInvalidSelectorError("Invalid YouTube channel identifier")
    return normalized


def _first_item(payload: dict[str, Any]) -> dict[str, Any] | None:
    raw_items = payload.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return None
    item = raw_items[0]
    return item if isinstance(item, dict) else None


def _channel_identity(item: dict[str, Any]) -> YouTubeChannelIdentityResult | None:
    channel_id = _clean_text(item.get("id"), max_chars=MAX_IDENTIFIER_CHARS)
    snippet = item.get("snippet")
    if channel_id is None or not _CHANNEL_ID.fullmatch(channel_id) or not isinstance(snippet, dict):
        return None
    localized = snippet.get("localized")
    localized_title = localized.get("title") if isinstance(localized, dict) else None
    title = _bounded_text(localized_title, max_chars=MAX_TITLE_CHARS) or _bounded_text(
        snippet.get("title"), max_chars=MAX_TITLE_CHARS
    )
    if title is None:
        return None
    custom_url = _clean_text(snippet.get("customUrl"), max_chars=MAX_HANDLE_CHARS)
    handle = custom_url.lstrip("/") if custom_url else None
    if handle and not handle.startswith("@"):
        handle = f"@{handle}"
    if handle and len(handle) > MAX_HANDLE_CHARS:
        handle = None
    return YouTubeChannelIdentityResult(
        channel_id=channel_id,
        title=title,
        thumbnail_url=_pick_thumbnail(snippet),
        handle=handle,
        canonical_url=f"https://www.youtube.com/channel/{channel_id}",
    )


class YouTubeProviderClient:
    """One fixed-destination, redacted boundary for YouTube Data API reads."""

    def __init__(
        self,
        api_key: str | None = None,
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
        return f"YouTubeProviderClient(api_key={configured}, destination=<fixed>)"

    async def _request(
        self,
        endpoint: str,
        *,
        params: dict[str, str],
        access_token: str | None = None,
        use_api_key: bool = False,
    ) -> _YouTubeProviderResponse:
        if endpoint not in YOUTUBE_PROVIDER_URLS:
            raise YouTubeAPIError("YouTube API destination is not allowed")
        request_params = dict(params)
        if use_api_key:
            if not self._api_key:
                raise YouTubeNotConfiguredError(
                    "YouTube metadata import is not configured yet. Add this project manually."
                )
            request_params["key"] = self._api_key
        headers = {
            "Accept": "application/json",
            "User-Agent": "CreatorJobs-YouTube/1.0",
        }
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"

        try:
            async with asyncio.timeout(self._total_timeout_seconds):
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(
                        PROVIDER_TIMEOUT_SECONDS,
                        connect=PROVIDER_CONNECT_TIMEOUT_SECONDS,
                    ),
                    follow_redirects=False,
                    trust_env=False,
                    transport=self._transport,
                ) as client:
                    async with client.stream(
                        "GET",
                        endpoint,
                        params=request_params,
                        headers=headers,
                    ) as response:
                        return await _read_provider_response(response)
        except (YouTubeNotConfiguredError, YouTubeAPIError):
            raise
        except (TimeoutError, httpx.HTTPError):
            # Provider exceptions can contain the request URL (and therefore an
            # API key). The caller receives one fixed, privacy-safe failure.
            raise YouTubeAPIError("YouTube API is temporarily unavailable") from None

    async def fetch_user_channels(
        self,
        access_token: str,
    ) -> list[YouTubeChannelResult]:
        response = await self._request(
            YOUTUBE_CHANNELS_URL,
            params={"part": "snippet", "mine": "true", "maxResults": "50"},
            access_token=access_token,
        )
        if response.status_code == 401:
            raise YouTubeReauthRequiredError("youtube_reauth_required")
        if response.status_code == 403 and _youtube_error_reasons(response.payload).intersection(
            {"authError", "insufficientPermissions"}
        ):
            raise YouTubeReauthRequiredError("youtube_reauth_required")
        if response.status_code != 200 or response.payload is None:
            raise YouTubeAPIError("YouTube API is temporarily unavailable")

        raw_items = response.payload.get("items")
        # This result replaces linked-channel authority. A malformed or partial
        # collection must never masquerade as a successful empty/full snapshot.
        if (
            not isinstance(raw_items, list)
            or len(raw_items) > MAX_PROVIDER_ITEMS
            or response.payload.get("nextPageToken")
        ):
            raise YouTubeAPIError("YouTube API returned an incomplete channel response")
        channels: list[YouTubeChannelResult] = []
        seen: set[str] = set()
        for item in raw_items:
            if not isinstance(item, dict):
                raise YouTubeAPIError("YouTube API returned an invalid channel response")
            channel_id = _clean_text(item.get("id"), max_chars=MAX_IDENTIFIER_CHARS)
            snippet = item.get("snippet")
            if (
                channel_id is None
                or not _CHANNEL_ID.fullmatch(channel_id)
                or not isinstance(snippet, dict)
            ):
                raise YouTubeAPIError("YouTube API returned an invalid channel response")
            if channel_id in seen:
                continue
            seen.add(channel_id)
            title = _bounded_text(snippet.get("title"), max_chars=MAX_TITLE_CHARS)
            channels.append(
                YouTubeChannelResult(
                    channel_id=channel_id,
                    title=title or "YouTube Channel",
                    thumbnail_url=_pick_thumbnail(snippet, max_chars=1024),
                )
            )
        return channels

    async def resolve_channel_identity(
        self,
        selector: YouTubeIdentitySelector,
        value: str,
    ) -> YouTubeChannelIdentityResult | None:
        normalized = _normalize_selector(selector, value)
        try:
            async with asyncio.timeout(self._total_timeout_seconds):
                if selector == "video_id":
                    video_response = await self._request(
                        YOUTUBE_VIDEOS_URL,
                        params={"part": "snippet", "id": normalized, "maxResults": "1"},
                        use_api_key=True,
                    )
                    if video_response.status_code != 200 or video_response.payload is None:
                        raise YouTubeAPIError("YouTube API is temporarily unavailable")
                    video = _first_item(video_response.payload)
                    snippet = video.get("snippet") if isinstance(video, dict) else None
                    channel_id = (
                        _clean_text(snippet.get("channelId"), max_chars=MAX_IDENTIFIER_CHARS)
                        if isinstance(snippet, dict)
                        else None
                    )
                    if channel_id is None or not _CHANNEL_ID.fullmatch(channel_id):
                        return None
                    normalized = channel_id
                    selector = "channel_id"

                filter_key = {
                    "channel_id": "id",
                    "handle": "forHandle",
                    "username": "forUsername",
                }[selector]
                filter_values = (
                    (f"@{normalized}", normalized) if selector == "handle" else (normalized,)
                )
                for filter_value in filter_values:
                    channel_response = await self._request(
                        YOUTUBE_CHANNELS_URL,
                        params={
                            "part": "snippet",
                            filter_key: filter_value,
                            "maxResults": "1",
                        },
                        use_api_key=True,
                    )
                    if channel_response.status_code != 200 or channel_response.payload is None:
                        raise YouTubeAPIError("YouTube API is temporarily unavailable")
                    identity = _channel_identity(_first_item(channel_response.payload) or {})
                    if identity is not None:
                        return identity
                return None
        except (YouTubeNotConfiguredError, YouTubeAPIError):
            raise
        except TimeoutError:
            raise YouTubeAPIError("YouTube API is temporarily unavailable") from None

    async def fetch_video_metadata(
        self,
        video_id: str,
    ) -> YouTubeVideoMetadataResult:
        normalized_video_id = _normalize_selector("video_id", video_id)
        response = await self._request(
            YOUTUBE_VIDEOS_URL,
            params={
                "part": "snippet,contentDetails,statistics",
                "id": normalized_video_id,
                "maxResults": "1",
            },
            use_api_key=True,
        )
        if response.status_code != 200 or response.payload is None:
            raise YouTubeAPIError("YouTube API is temporarily unavailable")
        item = _first_item(response.payload)
        if item is None:
            raise YouTubeAPIError(
                "This YouTube video is unavailable, private, or deleted. "
                "Add this project manually instead."
            )

        snippet = item.get("snippet")
        statistics = item.get("statistics")
        content_details = item.get("contentDetails")
        if not isinstance(snippet, dict):
            raise YouTubeAPIError("YouTube API returned an invalid response")

        title = _bounded_text(snippet.get("title"), max_chars=MAX_TITLE_CHARS)
        channel_name = _bounded_text(snippet.get("channelTitle"), max_chars=MAX_TITLE_CHARS)
        channel_id = _clean_text(snippet.get("channelId"), max_chars=MAX_IDENTIFIER_CHARS)
        if channel_id is not None and not _CHANNEL_ID.fullmatch(channel_id):
            channel_id = None
        description = _bounded_text(snippet.get("description"), max_chars=MAX_DESCRIPTION_CHARS)
        duration_iso = (
            _clean_text(content_details.get("duration"), max_chars=MAX_DURATION_CHARS)
            if isinstance(content_details, dict)
            else None
        )
        duration_label = _parse_duration_iso_to_readable(duration_iso)
        if duration_label is None:
            duration_iso = None

        return YouTubeVideoMetadataResult(
            video_id=normalized_video_id,
            title=title or "YouTube video",
            description=description,
            thumbnail_url=_pick_thumbnail(snippet),
            channel_name=channel_name,
            channel_id=channel_id,
            view_count=(
                _parse_int(statistics.get("viewCount")) if isinstance(statistics, dict) else None
            ),
            like_count=(
                _parse_int(statistics.get("likeCount")) if isinstance(statistics, dict) else None
            ),
            comment_count=(
                _parse_int(statistics.get("commentCount")) if isinstance(statistics, dict) else None
            ),
            published_date=_parse_published_date(snippet.get("publishedAt")),
            duration=duration_label,
            duration_iso=duration_iso,
            duration_label=duration_label,
            thumbnail_options=_thumbnail_options(snippet),
            video_url=(f"https://www.youtube.com/watch?v={normalized_video_id}"),
        )


async def fetch_user_youtube_channels(
    access_token: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[YouTubeChannelResult]:
    return await YouTubeProviderClient(transport=transport).fetch_user_channels(access_token)


async def fetch_youtube_video_metadata(
    video_id: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    api_key: str | None = None,
) -> YouTubeVideoMetadataResult:
    configured_key = configured_youtube_api_key() if api_key is None else api_key
    return await YouTubeProviderClient(
        configured_key,
        transport=transport,
    ).fetch_video_metadata(video_id)


__all__ = [
    "MAX_IDENTIFIER_CHARS",
    "MAX_PROVIDER_RESPONSE_BYTES",
    "YOUTUBE_CHANNELS_URL",
    "YOUTUBE_VIDEOS_URL",
    "YouTubeAPIError",
    "YouTubeChannelIdentityResult",
    "YouTubeChannelResult",
    "YouTubeIdentitySelector",
    "YouTubeInvalidSelectorError",
    "YouTubeNotConfiguredError",
    "YouTubeProviderClient",
    "YouTubeReauthRequiredError",
    "YouTubeVideoMetadataResult",
    "extract_video_id",
    "configured_youtube_api_key",
    "fetch_user_youtube_channels",
    "fetch_youtube_video_metadata",
]
