from __future__ import annotations

import asyncio
import ipaddress
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlencode, urljoin, urlparse, urlunparse

import httpx

from app.schemas import PortfolioLinkPreviewPublicMetrics, PortfolioLinkPreviewResponse
from app.services.youtube_service import (
    YouTubeAPIError,
    extract_video_id,
    fetch_youtube_video_metadata,
)

MAX_PREVIEW_BYTES = 512 * 1024
MAX_REDIRECTS = 3
REQUEST_TIMEOUT_SECONDS = 6.0
USER_AGENT = "CreatorJobs-LinkPreview/1.0"

MANUAL_CONTEXT_FIELDS = ["role", "contribution", "tools", "outcome"]


class LinkPreviewValidationError(Exception):
    pass


class LinkPreviewFetchError(Exception):
    pass


def normalize_preview_url(raw_url: str) -> str:
    value = (raw_url or "").strip()
    if not value:
        raise LinkPreviewValidationError("Paste a valid work link.")
    if "://" not in value:
        value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise LinkPreviewValidationError("Work links must use http or https.")
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path or "/", parsed.params, parsed.query, ""))


def _hostname(url: str) -> str:
    host = (urlparse(url).hostname or "").strip().lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def detect_link_source(url: str) -> str:
    host = _hostname(url)
    if host == "youtu.be" or host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        return "youtube"
    if host == "vimeo.com" or host.endswith(".vimeo.com"):
        return "vimeo"
    if host == "drive.google.com":
        return "drive"
    if host == "docs.google.com":
        return "google_docs"
    if host.endswith("notion.so") or host.endswith("notion.site"):
        return "notion"
    if host.endswith("behance.net"):
        return "behance"
    if host.endswith("instagram.com"):
        return "instagram"
    if host.endswith("tiktok.com"):
        return "tiktok"
    return "website" if host else "unknown"


def _provider_name(source_type: str, url: str) -> str:
    names = {
        "youtube": "YouTube",
        "vimeo": "Vimeo",
        "drive": "Google Drive",
        "google_docs": "Google Docs",
        "notion": "Notion",
        "behance": "Behance",
        "instagram": "Instagram",
        "tiktok": "TikTok",
    }
    if source_type in names:
        return names[source_type]
    host = _hostname(url)
    return host or "External link"


def _manual_fields(title: str = "") -> list[str]:
    fields = list(MANUAL_CONTEXT_FIELDS)
    if not title.strip():
        return ["title", *fields]
    return fields


def _manual_response(
    *,
    source_url: str,
    source_type: str,
    canonical_url: str | None = None,
    title: str = "",
    description: str = "",
    thumbnail_url: str = "",
    provider_name: str = "",
    author_name: str = "",
    embed_html: str | None = None,
    confidence: str = "low",
    status: str = "manual_required",
    public_metrics: PortfolioLinkPreviewPublicMetrics | None = None,
) -> PortfolioLinkPreviewResponse:
    provider = provider_name or _provider_name(source_type, canonical_url or source_url)
    return PortfolioLinkPreviewResponse(
        source_type=source_type,  # type: ignore[arg-type]
        source_url=source_url,
        canonical_url=canonical_url or source_url,
        title=title.strip(),
        description=description.strip(),
        thumbnail_url=thumbnail_url.strip(),
        provider_name=provider,
        author_name=author_name.strip(),
        embed_html=embed_html,
        public_metrics=public_metrics or PortfolioLinkPreviewPublicMetrics(),
        confidence=confidence,  # type: ignore[arg-type]
        status=status,  # type: ignore[arg-type]
        manual_required_fields=_manual_fields(title),
    )


def _is_blocked_hostname(host: str) -> bool:
    if not host:
        return True
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".localhost") or host.endswith(".local"):
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return _is_blocked_ip(address)


def _is_blocked_ip(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return bool(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


async def _assert_public_http_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise LinkPreviewValidationError("Work links must use http or https.")
    host = parsed.hostname.lower()
    if _is_blocked_hostname(host):
        raise LinkPreviewValidationError("This link cannot be previewed.")

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        resolved = await asyncio.to_thread(socket.getaddrinfo, host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise LinkPreviewFetchError("Could not resolve this link.") from exc

    for _family, _, _, _, sockaddr in resolved:
        raw_ip = sockaddr[0]
        try:
            address = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        if _is_blocked_ip(address):
            raise LinkPreviewValidationError("This link cannot be previewed.")


async def _fetch_text_url(url: str) -> tuple[str, str]:
    current_url = url
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await _assert_public_http_url(current_url)
            try:
                async with client.stream("GET", current_url, follow_redirects=False) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            raise LinkPreviewFetchError("Redirect response was missing a location.")
                        current_url = urljoin(current_url, location)
                        continue
                    if response.status_code >= 400:
                        raise LinkPreviewFetchError(f"Preview request failed ({response.status_code}).")

                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > MAX_PREVIEW_BYTES:
                            remaining = MAX_PREVIEW_BYTES - (total - len(chunk))
                            if remaining > 0:
                                chunks.append(chunk[:remaining])
                            break
                        chunks.append(chunk)
                    encoding = response.encoding or "utf-8"
                    return str(response.url), b"".join(chunks).decode(encoding, errors="replace")
            except httpx.HTTPError as exc:
                raise LinkPreviewFetchError(str(exc)) from exc
    raise LinkPreviewFetchError("Too many redirects.")


async def _fetch_oembed_json(endpoint: str, work_url: str) -> dict[str, Any]:
    query = urlencode({"url": work_url, "format": "json"})
    url = f"{endpoint}?{query}"
    await _assert_public_http_url(url)
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        try:
            response = await client.get(url, follow_redirects=True)
            if response.status_code >= 400:
                raise LinkPreviewFetchError(f"oEmbed request failed ({response.status_code}).")
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise LinkPreviewFetchError(str(exc)) from exc
    return payload if isinstance(payload, dict) else {}


class OpenGraphParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, str] = {}
        self.canonical_url = ""
        self.title_chunks: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key.lower(): (value or "") for key, value in attrs}
        if tag.lower() == "title":
            self._in_title = True
            return
        if tag.lower() == "meta":
            key = (attr_map.get("property") or attr_map.get("name") or "").lower()
            content = attr_map.get("content") or ""
            if key and content and key not in self.meta:
                self.meta[key] = content.strip()
            return
        if tag.lower() == "link":
            rel = attr_map.get("rel", "").lower()
            href = attr_map.get("href") or ""
            if "canonical" in rel and href:
                self.canonical_url = href.strip()

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title and data:
            self.title_chunks.append(data)

    @property
    def title(self) -> str:
        return " ".join(" ".join(self.title_chunks).split()).strip()


def _first_meta(parser: OpenGraphParser, *keys: str) -> str:
    for key in keys:
        value = parser.meta.get(key)
        if value:
            return value.strip()
    return ""


def _parse_html_metadata(html: str, base_url: str) -> dict[str, str]:
    parser = OpenGraphParser()
    parser.feed(html[:MAX_PREVIEW_BYTES])
    canonical = parser.canonical_url or _first_meta(parser, "og:url")
    image = _first_meta(parser, "og:image", "twitter:image", "twitter:image:src")
    return {
        "canonical_url": urljoin(base_url, canonical) if canonical else base_url,
        "title": _first_meta(parser, "og:title", "twitter:title") or parser.title,
        "description": _first_meta(parser, "og:description", "twitter:description", "description"),
        "thumbnail_url": urljoin(base_url, image) if image else "",
        "provider_name": _first_meta(parser, "og:site_name", "application-name") or _provider_name(detect_link_source(base_url), base_url),
        "author_name": _first_meta(parser, "article:author", "author"),
    }


def _status_for_metadata(title: str, thumbnail_url: str, description: str) -> tuple[str, str]:
    if title and (thumbnail_url or description):
        return "ok", "medium"
    if title:
        return "partial", "low"
    return "manual_required", "low"


async def _preview_youtube(url: str) -> PortfolioLinkPreviewResponse:
    source_type = "youtube"
    video_id = extract_video_id(url)
    if video_id:
        try:
            metadata = await fetch_youtube_video_metadata(video_id)
            return _manual_response(
                source_url=metadata.video_url,
                canonical_url=metadata.video_url,
                source_type=source_type,
                title=metadata.title,
                description=metadata.description or "",
                thumbnail_url=metadata.thumbnail_url or "",
                provider_name="YouTube",
                author_name=metadata.channel_name or "",
                confidence="high",
                status="ok",
                public_metrics=PortfolioLinkPreviewPublicMetrics(
                    views=metadata.view_count,
                    likes=metadata.like_count,
                    comments=metadata.comment_count,
                    duration=metadata.duration_label or metadata.duration_iso,
                ),
            ).model_copy(update={"published_at": metadata.published_date})
        except YouTubeAPIError:
            pass

    try:
        payload = await _fetch_oembed_json("https://www.youtube.com/oembed", url)
    except (LinkPreviewFetchError, LinkPreviewValidationError):
        return _manual_response(source_url=url, source_type=source_type, provider_name="YouTube")

    title = str(payload.get("title") or "")
    thumbnail_url = str(payload.get("thumbnail_url") or "")
    author_name = str(payload.get("author_name") or "")
    return _manual_response(
        source_url=url,
        source_type=source_type,
        title=title,
        thumbnail_url=thumbnail_url,
        provider_name="YouTube",
        author_name=author_name,
        embed_html=str(payload.get("html") or "") or None,
        confidence="medium" if title else "low",
        status="partial" if title else "manual_required",
    )


async def _preview_oembed(url: str, *, source_type: str, endpoint: str) -> PortfolioLinkPreviewResponse:
    try:
        payload = await _fetch_oembed_json(endpoint, url)
    except (LinkPreviewFetchError, LinkPreviewValidationError):
        return _manual_response(source_url=url, source_type=source_type)

    title = str(payload.get("title") or "")
    thumbnail_url = str(payload.get("thumbnail_url") or "")
    author_name = str(payload.get("author_name") or "")
    provider_name = str(payload.get("provider_name") or "") or _provider_name(source_type, url)
    return _manual_response(
        source_url=url,
        source_type=source_type,
        title=title,
        thumbnail_url=thumbnail_url,
        provider_name=provider_name,
        author_name=author_name,
        embed_html=str(payload.get("html") or "") or None,
        confidence="medium" if title else "low",
        status="partial" if title else "manual_required",
    )


async def _preview_html(url: str, *, source_type: str) -> PortfolioLinkPreviewResponse:
    try:
        final_url, html = await _fetch_text_url(url)
    except LinkPreviewValidationError:
        raise
    except LinkPreviewFetchError:
        return _manual_response(source_url=url, source_type=source_type)

    metadata = _parse_html_metadata(html, final_url)
    status, confidence = _status_for_metadata(
        metadata["title"],
        metadata["thumbnail_url"],
        metadata["description"],
    )
    return _manual_response(
        source_url=url,
        canonical_url=metadata["canonical_url"],
        source_type=source_type,
        title=metadata["title"],
        description=metadata["description"],
        thumbnail_url=metadata["thumbnail_url"],
        provider_name=metadata["provider_name"],
        author_name=metadata["author_name"],
        confidence=confidence,
        status=status,
    )


async def preview_portfolio_link(raw_url: str) -> PortfolioLinkPreviewResponse:
    url = normalize_preview_url(raw_url)
    source_type = detect_link_source(url)
    try:
        await _assert_public_http_url(url)
    except LinkPreviewValidationError:
        raise
    except LinkPreviewFetchError:
        return _manual_response(source_url=url, source_type=source_type)

    if source_type == "youtube":
        return await _preview_youtube(url)
    if source_type == "vimeo":
        return await _preview_oembed(url, source_type="vimeo", endpoint="https://vimeo.com/api/oembed.json")
    return await _preview_html(url, source_type=source_type)
