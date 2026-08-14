from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.config import settings


class YouTubeReauthRequiredError(Exception):
    pass


class YouTubeAPIError(Exception):
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


def _pick_thumbnail(snippet: dict[str, object]) -> str | None:
    thumbnails = snippet.get("thumbnails")
    if not isinstance(thumbnails, dict):
        return None
    for key in ("maxres", "standard", "high", "medium", "default"):
        candidate = thumbnails.get(key)
        if isinstance(candidate, dict):
            url = candidate.get("url")
            if isinstance(url, str) and url:
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
        url = candidate.get("url")
        if not isinstance(url, str) or not url or url in seen_urls:
            continue
        seen_urls.add(url)
        option: dict[str, object] = {"quality": key, "url": url}
        width = _parse_int(candidate.get("width"))
        height = _parse_int(candidate.get("height"))
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

    simple_match = re.fullmatch(r"[A-Za-z0-9_-]{11}", raw)
    if simple_match:
        return raw

    parsed = urlparse(raw)
    host = parsed.netloc.lower().replace("www.", "")

    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
        return candidate if re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate or "") else None

    if host in {"youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            query_video = parse_qs(parsed.query).get("v", [None])[0]
            if query_video and re.fullmatch(r"[A-Za-z0-9_-]{11}", query_video):
                return query_video
        path_parts = [part for part in parsed.path.split("/") if part]
        if len(path_parts) >= 2 and path_parts[0] in {"shorts", "embed", "live"}:
            candidate = path_parts[1]
            if re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate):
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
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value)
    if not match:
        return value
    hours = int(match.group(1) or "0")
    minutes = int(match.group(2) or "0")
    seconds = int(match.group(3) or "0")
    if hours > 0:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def _parse_int(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(stripped)
        except ValueError:
            return None
    return None


def _youtube_error_reasons(response: httpx.Response) -> set[str]:
    try:
        payload = response.json()
    except ValueError:
        return set()
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
        if isinstance(item, dict)
        and isinstance((reason := item.get("reason")), str)
    }


async def fetch_user_youtube_channels(
    access_token: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[YouTubeChannelResult]:
    try:
        async with httpx.AsyncClient(
            timeout=15,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        ) as client:
            response = await client.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "snippet", "mine": "true", "maxResults": "50"},
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        raise YouTubeAPIError("YouTube API is temporarily unavailable") from exc

    if response.status_code == 401:
        raise YouTubeReauthRequiredError("youtube_reauth_required")
    if response.status_code == 403 and _youtube_error_reasons(response).intersection(
        {"authError", "insufficientPermissions"}
    ):
        raise YouTubeReauthRequiredError("youtube_reauth_required")
    if response.status_code != 200:
        raise YouTubeAPIError(f"YouTube API error ({response.status_code})")

    try:
        payload = response.json()
    except ValueError as exc:
        raise YouTubeAPIError("YouTube API returned an invalid response") from exc
    if not isinstance(payload, dict):
        raise YouTubeAPIError("YouTube API returned an invalid response")
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        return []

    channels: list[YouTubeChannelResult] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        channel_id = item.get("id")
        snippet = item.get("snippet")
        if not isinstance(channel_id, str) or not channel_id:
            continue
        if not isinstance(snippet, dict):
            continue
        title = snippet.get("title")
        if not isinstance(title, str) or not title:
            title = "YouTube Channel"
        channels.append(
            YouTubeChannelResult(
                channel_id=channel_id,
                title=title,
                thumbnail_url=_pick_thumbnail(snippet),
            )
        )
    return channels


async def fetch_youtube_video_metadata(video_id: str) -> YouTubeVideoMetadataResult:
    api_key = (settings.youtube_api_key or settings.youtube_data_api_key or "").strip()
    if not api_key:
        raise YouTubeAPIError("YouTube metadata import is not configured yet. Add YOUTUBE_API_KEY or add this project manually.")

    async with httpx.AsyncClient(
        timeout=15,
        follow_redirects=False,
        trust_env=False,
    ) as client:
        response = await client.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={
                "part": "snippet,contentDetails,statistics",
                "id": video_id,
                "key": api_key,
                "maxResults": "1",
            },
        )

    if response.status_code >= 400:
        raise YouTubeAPIError(f"YouTube API error ({response.status_code})")

    payload = response.json()
    raw_items = payload.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise YouTubeAPIError("This YouTube video is unavailable, private, or deleted. Add this project manually instead.")

    item = raw_items[0]
    if not isinstance(item, dict):
        raise YouTubeAPIError("Unexpected YouTube API response")

    snippet = item.get("snippet")
    statistics = item.get("statistics")
    content_details = item.get("contentDetails")
    if not isinstance(snippet, dict):
        raise YouTubeAPIError("Missing snippet in YouTube API response")

    title = snippet.get("title")
    if not isinstance(title, str) or not title.strip():
        title = "YouTube video"

    channel_name = snippet.get("channelTitle")
    if not isinstance(channel_name, str):
        channel_name = None

    channel_id = snippet.get("channelId")
    if not isinstance(channel_id, str):
        channel_id = None

    description = snippet.get("description")
    if isinstance(description, str):
        description = description.strip()[:500] or None
    else:
        description = None

    duration_iso = (
        content_details.get("duration")
        if isinstance(content_details, dict) and isinstance(content_details.get("duration"), str)
        else None
    )
    duration_label = _parse_duration_iso_to_readable(duration_iso)

    return YouTubeVideoMetadataResult(
        video_id=video_id,
        title=title,
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
        video_url=f"https://www.youtube.com/watch?v={video_id}",
    )
