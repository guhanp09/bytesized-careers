from __future__ import annotations

import json
from html.parser import HTMLParser
from typing import Any, NoReturn
from urllib.parse import urlencode, urljoin, urlparse, urlunparse

from app.schemas import PortfolioLinkPreviewPublicMetrics, PortfolioLinkPreviewResponse
from app.services.safe_outbound_fetch import (
    SafeOutboundFetcher,
    SafeOutboundFetchError,
    SafeOutboundFetchPolicy,
)
from app.services.youtube_service import (
    YouTubeAPIError,
    extract_video_id,
    fetch_youtube_video_metadata,
)

MAX_PREVIEW_BYTES = 512 * 1024
MAX_OEMBED_BYTES = 64 * 1024
#: Ceilings for each metadata field read out of an untrusted page or provider.
#: The stored portfolio title is capped at 255 characters, so a longer suggestion
#: could never be saved as offered; the rest are bounded for the same reason.
MAX_METADATA_TITLE_CHARS = 255
MAX_METADATA_DESCRIPTION_CHARS = 2000
MAX_METADATA_NAME_CHARS = 255
MAX_METADATA_URL_CHARS = 2048
MAX_REDIRECTS = 3
REQUEST_TIMEOUT_SECONDS = 6.0
USER_AGENT = "CreatorJobs-LinkPreview/1.0"
OEMBED_USER_AGENT = "CreatorJobs-LinkPreview-oEmbed/1.0"

HTML_PREVIEW_POLICY = SafeOutboundFetchPolicy(
    max_response_bytes=MAX_PREVIEW_BYTES,
    allowed_content_types=frozenset({"text/html", "application/xhtml+xml", "text/plain"}),
    user_agent=USER_AGENT,
    accept="text/html, application/xhtml+xml, text/plain;q=0.5",
    max_redirects=MAX_REDIRECTS,
    connect_timeout_seconds=3.0,
    read_timeout_seconds=REQUEST_TIMEOUT_SECONDS,
    total_timeout_seconds=REQUEST_TIMEOUT_SECONDS,
)
OEMBED_POLICY = SafeOutboundFetchPolicy(
    max_response_bytes=MAX_OEMBED_BYTES,
    allowed_content_types=frozenset({"application/json"}),
    user_agent=OEMBED_USER_AGENT,
    accept="application/json",
    max_redirects=0,
    connect_timeout_seconds=3.0,
    read_timeout_seconds=REQUEST_TIMEOUT_SECONDS,
    total_timeout_seconds=REQUEST_TIMEOUT_SECONDS,
    max_url_length=8192,
)
ALLOWED_OEMBED_ENDPOINTS = frozenset(
    {
        "https://www.youtube.com/oembed",
        "https://vimeo.com/api/oembed.json",
    }
)

_OUTBOUND_VALIDATION_CODES = frozenset(
    {
        "URL_INVALID",
        "SCHEME_UNSUPPORTED",
        "CREDENTIALS_FORBIDDEN",
        "HOST_UNSAFE",
        "DESTINATION_UNSAFE",
        "PORT_UNSAFE",
        "PEER_UNVERIFIED",
        "PEER_MISMATCH",
    }
)

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


def _is_host_or_subdomain(host: str, domain: str) -> bool:
    return host == domain or host.endswith(f".{domain}")


def detect_link_source(url: str) -> str:
    host = _hostname(url)
    if (
        host == "youtu.be"
        or _is_host_or_subdomain(host, "youtube.com")
        or _is_host_or_subdomain(host, "youtube-nocookie.com")
    ):
        return "youtube"
    if _is_host_or_subdomain(host, "vimeo.com"):
        return "vimeo"
    if host == "drive.google.com":
        return "drive"
    if host == "docs.google.com":
        return "google_docs"
    if _is_host_or_subdomain(host, "notion.so") or _is_host_or_subdomain(host, "notion.site"):
        return "notion"
    if _is_host_or_subdomain(host, "behance.net"):
        return "behance"
    if _is_host_or_subdomain(host, "instagram.com"):
        return "instagram"
    if _is_host_or_subdomain(host, "tiktok.com"):
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


def _raise_preview_boundary_error(exc: SafeOutboundFetchError) -> NoReturn:
    if exc.code in _OUTBOUND_VALIDATION_CODES:
        message = (
            "Work links must use http or https."
            if exc.code in {"URL_INVALID", "SCHEME_UNSUPPORTED"}
            else "This link cannot be previewed."
        )
        raise LinkPreviewValidationError(message) from exc
    raise LinkPreviewFetchError("Public preview metadata is temporarily unavailable.") from exc


async def _assert_public_http_url(
    url: str,
    *,
    fetcher: SafeOutboundFetcher | None = None,
) -> None:
    boundary = fetcher or SafeOutboundFetcher()
    try:
        await boundary.validate_destination(url, HTML_PREVIEW_POLICY)
    except SafeOutboundFetchError as exc:
        _raise_preview_boundary_error(exc)


async def _fetch_text_url(
    url: str,
    *,
    fetcher: SafeOutboundFetcher | None = None,
) -> tuple[str, str]:
    boundary = fetcher or SafeOutboundFetcher()
    try:
        response = await boundary.fetch(url, HTML_PREVIEW_POLICY)
    except SafeOutboundFetchError as exc:
        _raise_preview_boundary_error(exc)
    if not 200 <= response.status_code < 300:
        raise LinkPreviewFetchError(f"Preview request failed ({response.status_code}).")
    return response.final_url, response.body.decode(response.encoding, errors="replace")


async def _fetch_oembed_json(
    endpoint: str,
    work_url: str,
    *,
    fetcher: SafeOutboundFetcher | None = None,
) -> dict[str, Any]:
    if endpoint not in ALLOWED_OEMBED_ENDPOINTS:
        raise LinkPreviewFetchError("This oEmbed provider is not supported.")
    query = urlencode({"url": work_url, "format": "json"})
    url = f"{endpoint}?{query}"
    boundary = fetcher or SafeOutboundFetcher()
    try:
        response = await boundary.fetch(url, OEMBED_POLICY)
    except SafeOutboundFetchError as exc:
        _raise_preview_boundary_error(exc)
    if not 200 <= response.status_code < 300:
        raise LinkPreviewFetchError(f"oEmbed request failed ({response.status_code}).")
    try:
        payload = json.loads(response.body.decode(response.encoding))
    except (LookupError, UnicodeError, json.JSONDecodeError) as exc:
        raise LinkPreviewFetchError("The oEmbed provider returned invalid JSON.") from exc
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


def _bounded(value: str, limit: int) -> str:
    """Clamp one metadata field read out of an untrusted page.

    The fetch boundary caps the body, but a single `og:description` may still be
    most of that body. These values are returned to the browser and offered as
    defaults for a saved portfolio item, so each field is limited to a length
    that is usable in the product rather than to whatever the page chose.
    Truncation is deliberate: a preview is a suggestion the creator edits, and
    refusing the whole preview because one field is long would cost them the
    rest of it.
    """

    return value[:limit] if len(value) > limit else value


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
        "canonical_url": _bounded(urljoin(base_url, canonical) if canonical else base_url, MAX_METADATA_URL_CHARS),
        "title": _bounded(_first_meta(parser, "og:title", "twitter:title") or parser.title, MAX_METADATA_TITLE_CHARS),
        "description": _bounded(
            _first_meta(parser, "og:description", "twitter:description", "description"),
            MAX_METADATA_DESCRIPTION_CHARS,
        ),
        "thumbnail_url": _bounded(urljoin(base_url, image) if image else "", MAX_METADATA_URL_CHARS),
        "provider_name": _bounded(
            _first_meta(parser, "og:site_name", "application-name") or _provider_name(detect_link_source(base_url), base_url),
            MAX_METADATA_NAME_CHARS,
        ),
        "author_name": _bounded(_first_meta(parser, "article:author", "author"), MAX_METADATA_NAME_CHARS),
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
