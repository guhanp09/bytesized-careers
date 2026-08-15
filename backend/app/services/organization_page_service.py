"""Reading the public page behind an organization URL, on the server's terms.

When someone types their company or channel URL while adding an experience or
authorizing a job, the product offers to fill in the organization's name and
logo from that page's own metadata. Retrieving it means fetching a URL a user
chose, which is the definition of the surface this phase exists to close.

Until now that fetch happened in the Next runtime: it resolved DNS itself,
followed its own redirects, honoured environment proxies, screened hosts with a
pattern list that a decimal-encoded address walks straight through, and read the
whole body before slicing it. This moves the retrieval to the shared
`SafeOutboundFetcher` and returns a small structured result instead — the
browser never receives remote HTML, because the only thing anyone needed from it
was a name and two image URLs.

Platform pages carry the Phase 2C treatment: a caller-owned destination
predicate the boundary evaluates on every hop, so an Instagram profile cannot
redirect the request somewhere that is not Instagram. A general company page has
no such allowlist by nature — the user is telling us about a site we have never
heard of — so it is bounded by the generic network policy alone, which is
already the difference between a pinned public-only request and an arbitrary
one. That distinction is deliberate: inventing a "same site" rule here would
break the many real organizations whose domain redirects to another one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from app.services.safe_outbound_fetch import (
    SafeOutboundFetcher,
    SafeOutboundFetchError,
    SafeOutboundFetchPolicy,
)

#: Enough of a page to reach the metadata in its head, and no more. Real sites
#: put `og:` tags in the first few kilobytes; a megabyte is generous for the ones
#: that ship a large inline stylesheet first.
MAX_PAGE_BYTES = 1024 * 1024
MAX_PARSED_CHARS = 512 * 1024
PAGE_TIMEOUT_SECONDS = 5.0
PAGE_TOTAL_TIMEOUT_SECONDS = 12.0
MAX_REDIRECTS = 4

#: Ceilings for each value handed back. These become suggested names and image
#: URLs in a form, so a page cannot return more than the product can use.
MAX_NAME_CHARS = 255
MAX_URL_CHARS = 2048

YOUTUBE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com"})
INSTAGRAM_HOSTS = frozenset({"instagram.com", "www.instagram.com", "m.instagram.com"})

#: Channel id as it appears in a YouTube page's own metadata.
_CHANNEL_ID = re.compile(r'"(?:channelId|externalId)"\s*:\s*"(UC[0-9A-Za-z_-]{20,})"')
_CHANNEL_ID_META = re.compile(
    r'<meta[^>]+itemprop=["\']channelId["\'][^>]+content=["\'](UC[0-9A-Za-z_-]{20,})["\']',
    re.IGNORECASE,
)


class OrganizationPageError(Exception):
    """The page could not be read. The caller falls back to the URL itself."""


@dataclass(frozen=True)
class OrganizationPageMetadata:
    final_url: str
    site_name: str = ""
    title: str = ""
    image_url: str = ""
    icon_url: str = ""
    youtube_channel_id: str = ""


def _bounded(value: str, limit: int) -> str:
    cleaned = " ".join(value.split())
    return cleaned[:limit]


def platform_for(url: str) -> str:
    host = (urlsplit(url).hostname or "").casefold().removeprefix("www.")
    if host in {item.removeprefix("www.") for item in YOUTUBE_HOSTS} or host == "youtu.be":
        return "youtube"
    if host in {item.removeprefix("www.") for item in INSTAGRAM_HOSTS}:
        return "instagram"
    return "website"


def _destination_predicate(platform: str):
    """The caller's rule about where this request may go, per hop.

    A platform page has an allowlist because we know exactly which site the user
    named. A general website does not: the whole point is that they are telling
    us about somewhere we have never seen, so the generic public-address policy
    is the boundary, and a redirect within it is ordinary.
    """

    if platform == "youtube":
        allowed = YOUTUBE_HOSTS
    elif platform == "instagram":
        allowed = INSTAGRAM_HOSTS
    else:
        return None

    def permitted(candidate: str) -> bool:
        return (urlsplit(candidate).hostname or "").casefold() in allowed

    return permitted


def _policy(platform: str) -> SafeOutboundFetchPolicy:
    return SafeOutboundFetchPolicy(
        max_response_bytes=MAX_PAGE_BYTES,
        allowed_content_types=frozenset({"text/html", "application/xhtml+xml"}),
        user_agent="CreatorJobs-OrganizationResolver/1.0",
        accept="text/html,application/xhtml+xml",
        max_redirects=MAX_REDIRECTS,
        connect_timeout_seconds=PAGE_TIMEOUT_SECONDS,
        read_timeout_seconds=PAGE_TIMEOUT_SECONDS,
        total_timeout_seconds=PAGE_TOTAL_TIMEOUT_SECONDS,
        destination_allowed=_destination_predicate(platform),
    )


class _MetadataParser(HTMLParser):
    """The head tags this feature uses, and nothing else."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.icons: dict[str, str] = {}
        self.title_chunks: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        name = tag.lower()
        attr_map = {key.lower(): (value or "") for key, value in attrs}
        if name == "title":
            self._in_title = True
            return
        if name == "meta":
            key = (attr_map.get("property") or attr_map.get("name") or "").casefold()
            content = attr_map.get("content", "").strip()
            if key and content and key not in self.meta:
                self.meta[key] = content
            return
        if name == "link":
            rel = attr_map.get("rel", "").casefold()
            href = attr_map.get("href", "").strip()
            if not href:
                return
            for candidate in ("apple-touch-icon", "icon"):
                if candidate in rel and candidate not in self.icons:
                    self.icons[candidate] = href

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title and data and len(self.title_chunks) < 20:
            self.title_chunks.append(data)

    @property
    def title(self) -> str:
        return " ".join(" ".join(self.title_chunks).split())

    def first(self, *keys: str) -> str:
        for key in keys:
            value = self.meta.get(key)
            if value:
                return value
        return ""


def _absolute(value: str, base_url: str) -> str:
    if not value:
        return ""
    try:
        resolved = urljoin(base_url, value)
    except ValueError:
        return ""
    parts = urlsplit(resolved)
    # Only http(s) leaves this service. `javascript:` and `data:` icon values
    # exist in the wild and must never be handed to a browser as an image URL.
    if parts.scheme not in {"http", "https"}:
        return ""
    return _bounded(resolved, MAX_URL_CHARS)


def _youtube_channel_id(html: str) -> str:
    match = _CHANNEL_ID_META.search(html) or _CHANNEL_ID.search(html)
    return match.group(1) if match else ""


async def read_organization_page(
    url: str,
    *,
    fetcher: SafeOutboundFetcher | None = None,
) -> OrganizationPageMetadata:
    """Fetch one public page and return only the fields the product uses."""

    platform = platform_for(url)
    boundary = fetcher or SafeOutboundFetcher()
    try:
        response = await boundary.fetch(url, _policy(platform))
    except SafeOutboundFetchError as exc:
        raise OrganizationPageError(str(exc.code)) from exc
    if not 200 <= response.status_code < 300:
        raise OrganizationPageError("PAGE_UNAVAILABLE")

    html = response.body.decode(response.encoding, errors="replace")[:MAX_PARSED_CHARS]
    parser = _MetadataParser()
    try:
        parser.feed(html)
        parser.close()
    except (ValueError, RecursionError) as exc:
        raise OrganizationPageError("PAGE_UNREADABLE") from exc

    return OrganizationPageMetadata(
        final_url=_bounded(response.final_url, MAX_URL_CHARS),
        site_name=_bounded(parser.first("og:site_name", "application-name"), MAX_NAME_CHARS),
        title=_bounded(
            parser.first("og:title", "twitter:title") or parser.title, MAX_NAME_CHARS
        ),
        image_url=_absolute(parser.first("og:image", "twitter:image"), response.final_url),
        icon_url=_absolute(
            parser.icons.get("apple-touch-icon") or parser.icons.get("icon", ""),
            response.final_url,
        ),
        youtube_channel_id=_youtube_channel_id(html) if platform == "youtube" else "",
    )
