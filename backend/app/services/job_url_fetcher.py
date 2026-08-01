from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from app.schemas.job_import import MAX_IMPORT_SOURCE_TEXT_LENGTH

MAX_URL_RESPONSE_BYTES = 1_000_000
MAX_URL_REDIRECTS = 4
URL_CONNECT_TIMEOUT_SECONDS = 5.0
URL_TOTAL_TIMEOUT_SECONDS = 12.0
URL_USER_AGENT = "CreatorJobs-PublicJobImporter/1.0"
ALLOWED_URL_CONTENT_TYPES = frozenset({"text/html", "application/xhtml+xml", "text/plain"})

Resolver = Callable[[str, int], Awaitable[list[ipaddress.IPv4Address | ipaddress.IPv6Address]]]


class PublicJobUrlFetchError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class PublicJobUrlRetrieval:
    entered_url: str
    final_url: str
    title: str | None
    normalized_text: str
    content_type: str
    retrieved_at: datetime
    metadata: dict[str, object]


def _clean_text(value: str) -> str:
    return re.sub(r"[ \t\f\v]+", " ", value).strip()


def _safe_json_ld_job(value: object) -> dict[str, object] | None:
    if isinstance(value, list):
        for item in value:
            found = _safe_json_ld_job(item)
            if found is not None:
                return found
        return None
    if not isinstance(value, dict):
        return None
    type_value = value.get("@type")
    types = type_value if isinstance(type_value, list) else [type_value]
    if any(str(item).casefold() == "jobposting" for item in types):
        return value
    graph = value.get("@graph")
    if graph is not None:
        found = _safe_json_ld_job(graph)
        if found is not None:
            return found
    for item in value.values():
        if isinstance(item, (dict, list)):
            found = _safe_json_ld_job(item)
            if found is not None:
                return found
    return None


class _VisibleJobHtmlParser(HTMLParser):
    _IGNORED_TAGS = frozenset(
        {"script", "style", "noscript", "svg", "nav", "footer", "header", "form"}
    )
    _BLOCK_TAGS = frozenset(
        {
            "address",
            "article",
            "aside",
            "blockquote",
            "br",
            "div",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "li",
            "main",
            "p",
            "section",
            "table",
            "td",
            "th",
            "tr",
            "ul",
            "ol",
        }
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._ignored_depth = 0
        self._title_depth = 0
        self._json_ld_depth = 0
        self._json_ld_chunks: list[str] = []
        self._text: list[str] = []
        self._title: list[str] = []
        self.canonical_href: str | None = None
        self.job_posting: dict[str, object] | None = None

    @staticmethod
    def _attributes(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {key.casefold(): value or "" for key, value in attrs}

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        tag = tag.casefold()
        values = self._attributes(attrs)
        if tag == "link" and "canonical" in values.get("rel", "").casefold().split():
            self.canonical_href = values.get("href") or self.canonical_href
        if (
            tag == "script"
            and values.get("type", "").split(";", 1)[0].strip().casefold() == "application/ld+json"
        ):
            self._json_ld_depth = 1
            self._json_ld_chunks = []
            return
        if self._json_ld_depth:
            self._json_ld_depth += 1
            return
        marker = f"{values.get('id', '')} {values.get('class', '')}".casefold()
        clutter = bool(
            tag in {"aside", "div", "section"}
            and re.search(r"\b(cookie|consent|navigation|newsletter|modal|popup)\b", marker)
        )
        hidden = values.get("aria-hidden", "").casefold() == "true" or "hidden" in values
        if self._ignored_depth or tag in self._IGNORED_TAGS or clutter or hidden:
            self._ignored_depth += 1
            return
        if tag == "title":
            self._title_depth += 1
        if tag in self._BLOCK_TAGS:
            self._text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if self._json_ld_depth:
            self._json_ld_depth -= 1
            if self._json_ld_depth == 0:
                raw = "".join(self._json_ld_chunks).strip()
                if raw:
                    try:
                        parsed = json.loads(raw)
                    except (json.JSONDecodeError, RecursionError):
                        parsed = None
                    found = _safe_json_ld_job(parsed)
                    if found is not None and self.job_posting is None:
                        self.job_posting = found
            return
        if self._ignored_depth:
            self._ignored_depth -= 1
            return
        if tag == "title" and self._title_depth:
            self._title_depth -= 1
        if tag in self._BLOCK_TAGS:
            self._text.append("\n")

    def handle_data(self, data: str) -> None:
        if self._json_ld_depth:
            self._json_ld_chunks.append(data)
            return
        if self._ignored_depth:
            return
        if self._title_depth:
            self._title.append(data)
        self._text.append(data)

    @property
    def page_title(self) -> str | None:
        title = _clean_text(" ".join(self._title))
        return title[:255] or None

    @property
    def visible_text(self) -> str:
        lines = [_clean_text(line) for line in "".join(self._text).splitlines()]
        compact: list[str] = []
        for line in lines:
            if not line or (compact and compact[-1] == line):
                continue
            compact.append(line)
        return "\n".join(compact)


def _strip_html_fragment(value: str) -> str:
    parser = _VisibleJobHtmlParser()
    parser.feed(value)
    parser.close()
    return parser.visible_text


def _bounded_structured_text(value: object, maximum: int = 255) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = _clean_text(value)
    return cleaned[:maximum] or None


def _structured_address(value: object) -> str | None:
    if isinstance(value, list):
        addresses = [item for item in (_structured_address(entry) for entry in value) if item]
        return " | ".join(dict.fromkeys(addresses))[:500] or None
    if not isinstance(value, dict):
        return None
    address = value.get("address") if isinstance(value.get("address"), dict) else value
    if not isinstance(address, dict):
        return None
    raw_country = address.get("addressCountry")
    country = (
        _bounded_structured_text(raw_country.get("name"))
        if isinstance(raw_country, dict)
        else _bounded_structured_text(raw_country)
    )
    parts = [
        _bounded_structured_text(address.get("addressLocality")),
        _bounded_structured_text(address.get("addressRegion")),
        country,
    ]
    return ", ".join(dict.fromkeys(part for part in parts if part)) or None


def _structured_location_requirement(value: object) -> str | None:
    if isinstance(value, list):
        values = [
            item for item in (_structured_location_requirement(entry) for entry in value) if item
        ]
        return " | ".join(dict.fromkeys(values))[:500] or None
    if isinstance(value, str):
        return _bounded_structured_text(value)
    if not isinstance(value, dict):
        return None
    return _bounded_structured_text(value.get("name")) or _structured_address(value)


def _structured_compensation(value: object) -> str | None:
    if not isinstance(value, dict):
        return None
    currency = _bounded_structured_text(value.get("currency"), 3)
    unit = _bounded_structured_text(value.get("unitText"), 32)
    raw_amount = value.get("value")
    amount: str | None = None
    if isinstance(raw_amount, (int, float)) and not isinstance(raw_amount, bool):
        amount = str(raw_amount)
    elif isinstance(raw_amount, dict):
        minimum = raw_amount.get("minValue")
        maximum = raw_amount.get("maxValue")
        if isinstance(minimum, (int, float)) and not isinstance(minimum, bool):
            amount = str(minimum)
            if isinstance(maximum, (int, float)) and not isinstance(maximum, bool):
                amount = f"{amount}-{maximum}"
        unit = unit or _bounded_structured_text(raw_amount.get("unitText"), 32)
    parts = [currency, amount, f"per {unit}" if unit else None]
    return " ".join(part for part in parts if part) or None


def _job_posting_context(job_posting: dict[str, object] | None) -> dict[str, str]:
    if job_posting is None:
        return {}
    context: dict[str, str] = {}
    organization = job_posting.get("hiringOrganization")
    if isinstance(organization, dict):
        employer = _bounded_structured_text(organization.get("name"))
        employer_location = _structured_address(organization)
        if employer:
            context["employer_name"] = employer
        if employer_location:
            context["employer_location"] = employer_location
    role_location = _structured_address(job_posting.get("jobLocation"))
    if role_location:
        context["role_location"] = role_location
    remote_eligibility = _structured_location_requirement(
        job_posting.get("applicantLocationRequirements")
    )
    if remote_eligibility:
        context["remote_eligibility"] = remote_eligibility
    location_type = _bounded_structured_text(job_posting.get("jobLocationType"), 64)
    if location_type:
        context["location_type"] = location_type
    employment = job_posting.get("employmentType")
    if isinstance(employment, list):
        employment_text = ", ".join(
            item for item in (_bounded_structured_text(entry, 64) for entry in employment) if item
        )
    else:
        employment_text = _bounded_structured_text(employment, 128) or ""
    if employment_text:
        context["employment_type"] = employment_text[:128]
    compensation = _structured_compensation(job_posting.get("baseSalary"))
    if compensation:
        context["compensation"] = compensation
    return context


def _structured_context_lines(context: dict[str, str]) -> list[str]:
    labels = {
        "employer_name": "Structured employer",
        "employer_location": "Structured employer location",
        "role_location": "Structured role location",
        "remote_eligibility": "Structured remote eligibility",
        "location_type": "Structured work location type",
        "employment_type": "Structured employment type",
        "compensation": "Structured compensation",
    }
    return [f"{labels[key]}: {value}" for key, value in context.items() if key in labels]


def normalize_public_job_html(
    html_text: str,
    *,
    final_url: str,
) -> tuple[str, str | None, dict[str, object]]:
    parser = _VisibleJobHtmlParser()
    try:
        parser.feed(html_text)
        parser.close()
    except (ValueError, RecursionError) as exc:
        raise PublicJobUrlFetchError(
            "JOB_IMPORT_URL_HTML_INVALID",
            "The public page could not be read safely.",
        ) from exc

    title = parser.page_title
    structured_title: str | None = None
    structured_description: str | None = None
    structured_context = _job_posting_context(parser.job_posting)
    if parser.job_posting is not None:
        raw_title = parser.job_posting.get("title")
        if isinstance(raw_title, str):
            structured_title = _clean_text(raw_title)[:255] or None
        raw_description = parser.job_posting.get("description")
        if isinstance(raw_description, str):
            structured_description = _strip_html_fragment(raw_description)

    pieces = [
        structured_title,
        "\n".join(_structured_context_lines(structured_context)),
        structured_description,
        parser.visible_text,
    ]
    normalized_lines: list[str] = []
    seen: set[str] = set()
    for piece in pieces:
        if not piece:
            continue
        for line in piece.splitlines():
            cleaned = _clean_text(line)
            key = cleaned.casefold()
            if not cleaned or key in seen:
                continue
            seen.add(key)
            normalized_lines.append(cleaned)
    normalized = "\n".join(normalized_lines)
    if len(normalized) > MAX_IMPORT_SOURCE_TEXT_LENGTH:
        normalized = normalized[:MAX_IMPORT_SOURCE_TEXT_LENGTH]
    if not normalized.strip():
        raise PublicJobUrlFetchError(
            "JOB_IMPORT_URL_EMPTY_CONTENT",
            "The public page did not contain readable job-listing text.",
        )

    canonical_url: str | None = None
    if parser.canonical_href:
        candidate = urljoin(final_url, parser.canonical_href.strip())
        candidate_parts = urlsplit(candidate)
        final_parts = urlsplit(final_url)
        if (
            candidate_parts.scheme in {"http", "https"}
            and not candidate_parts.username
            and not candidate_parts.password
            and candidate_parts.netloc.casefold() == final_parts.netloc.casefold()
        ):
            canonical_url = urlunsplit(
                (
                    candidate_parts.scheme,
                    candidate_parts.netloc,
                    candidate_parts.path or "/",
                    candidate_parts.query,
                    "",
                )
            )

    metadata: dict[str, object] = {
        "canonical_url": canonical_url,
        "json_ld_job_posting": parser.job_posting is not None,
        "structured_title_found": structured_title is not None,
        "structured_context": structured_context,
    }
    return normalized, structured_title or title, metadata


async def _default_resolver(
    hostname: str,
    port: int,
) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    loop = asyncio.get_running_loop()
    try:
        rows = await loop.getaddrinfo(
            hostname,
            port,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise PublicJobUrlFetchError(
            "JOB_IMPORT_URL_DNS_FAILED",
            "The public page address could not be resolved.",
        ) from exc
    addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for row in rows:
        raw = row[4][0]
        try:
            address = ipaddress.ip_address(raw)
        except ValueError:
            continue
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise PublicJobUrlFetchError(
            "JOB_IMPORT_URL_DNS_FAILED",
            "The public page address could not be resolved.",
        )
    return addresses


class PublicJobUrlFetcher:
    def __init__(
        self,
        *,
        resolver: Resolver = _default_resolver,
        transport: httpx.AsyncBaseTransport | None = None,
        allow_test_loopback: bool = False,
    ) -> None:
        self._resolver = resolver
        self._transport = transport
        self._allow_test_loopback = allow_test_loopback

    async def _validate_destination(self, raw_url: str) -> str:
        try:
            parts = urlsplit(raw_url)
            port = parts.port
        except ValueError as exc:
            raise PublicJobUrlFetchError(
                "JOB_IMPORT_URL_INVALID",
                "Enter a valid public job-listing URL.",
            ) from exc
        if parts.scheme.casefold() not in {"http", "https"}:
            raise PublicJobUrlFetchError(
                "JOB_IMPORT_URL_SCHEME_UNSUPPORTED",
                "Only public HTTP and HTTPS job-listing URLs are supported.",
            )
        if parts.username is not None or parts.password is not None:
            raise PublicJobUrlFetchError(
                "JOB_IMPORT_URL_CREDENTIALS_FORBIDDEN",
                "URLs containing usernames or passwords are not supported.",
            )
        hostname = parts.hostname
        if not hostname:
            raise PublicJobUrlFetchError(
                "JOB_IMPORT_URL_INVALID",
                "Enter a valid public job-listing URL.",
            )
        normalized_host = hostname.rstrip(".").casefold()
        if (
            normalized_host == "localhost"
            or normalized_host.endswith((".localhost", ".local", ".internal"))
            or ("." not in normalized_host and ":" not in normalized_host)
        ):
            raise PublicJobUrlFetchError(
                "JOB_IMPORT_URL_UNSAFE_DESTINATION",
                "That address is not a public website.",
            )
        resolved_port = port or (443 if parts.scheme.casefold() == "https" else 80)
        addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address]
        try:
            literal = ipaddress.ip_address(normalized_host)
        except ValueError:
            try:
                addresses = await self._resolver(normalized_host, resolved_port)
            except PublicJobUrlFetchError:
                raise
            except (OSError, TimeoutError) as exc:
                raise PublicJobUrlFetchError(
                    "JOB_IMPORT_URL_DNS_FAILED",
                    "The public page address could not be resolved.",
                ) from exc
        else:
            addresses = [literal]
        if not self._allow_test_loopback and any(not address.is_global for address in addresses):
            raise PublicJobUrlFetchError(
                "JOB_IMPORT_URL_UNSAFE_DESTINATION",
                "That address is not a public website.",
            )
        return urlunsplit(
            (
                parts.scheme.casefold(),
                parts.netloc,
                parts.path or "/",
                parts.query,
                "",
            )
        )

    async def fetch(self, raw_url: str) -> PublicJobUrlRetrieval:
        try:
            async with asyncio.timeout(URL_TOTAL_TIMEOUT_SECONDS):
                return await self._fetch_with_operation_timeouts(raw_url)
        except TimeoutError as exc:
            raise PublicJobUrlFetchError(
                "JOB_IMPORT_URL_TIMEOUT",
                "The public page took too long to respond.",
                status_code=504,
            ) from exc

    async def _fetch_with_operation_timeouts(
        self,
        raw_url: str,
    ) -> PublicJobUrlRetrieval:
        entered_url = await self._validate_destination(raw_url)
        current_url = entered_url
        timeout = httpx.Timeout(
            URL_TOTAL_TIMEOUT_SECONDS,
            connect=URL_CONNECT_TIMEOUT_SECONDS,
        )
        async with httpx.AsyncClient(
            follow_redirects=False,
            timeout=timeout,
            trust_env=False,
            transport=self._transport,
        ) as client:
            for redirect_count in range(MAX_URL_REDIRECTS + 1):
                # Resolve immediately before every network request, including every
                # redirect target. This narrows the DNS-rebinding window and ensures
                # redirects never bypass the destination policy.
                current_url = await self._validate_destination(current_url)
                try:
                    async with client.stream(
                        "GET",
                        current_url,
                        headers={
                            "User-Agent": URL_USER_AGENT,
                            "Accept": "text/html, application/xhtml+xml, text/plain;q=0.8",
                        },
                    ) as response:
                        if response.status_code in {301, 302, 303, 307, 308}:
                            location = response.headers.get("location")
                            if not location:
                                raise PublicJobUrlFetchError(
                                    "JOB_IMPORT_URL_REDIRECT_INVALID",
                                    "The public page returned an invalid redirect.",
                                )
                            if redirect_count >= MAX_URL_REDIRECTS:
                                raise PublicJobUrlFetchError(
                                    "JOB_IMPORT_URL_TOO_MANY_REDIRECTS",
                                    "The public page redirected too many times.",
                                )
                            current_url = urljoin(current_url, location)
                            continue
                        if response.status_code in {401, 403}:
                            raise PublicJobUrlFetchError(
                                "JOB_IMPORT_URL_AUTH_REQUIRED",
                                "This page requires sign-in and cannot be imported.",
                            )
                        if response.status_code >= 400:
                            raise PublicJobUrlFetchError(
                                "JOB_IMPORT_URL_FETCH_FAILED",
                                "The public page could not be retrieved.",
                                status_code=502,
                            )
                        content_type = (
                            response.headers.get("content-type", "")
                            .split(";", 1)[0]
                            .strip()
                            .casefold()
                        )
                        if content_type not in ALLOWED_URL_CONTENT_TYPES:
                            raise PublicJobUrlFetchError(
                                "JOB_IMPORT_URL_CONTENT_TYPE_UNSUPPORTED",
                                "That URL does not point to a supported text or HTML page.",
                                status_code=415,
                            )
                        content_length = response.headers.get("content-length")
                        if content_length and content_length.isdigit():
                            if int(content_length) > MAX_URL_RESPONSE_BYTES:
                                raise PublicJobUrlFetchError(
                                    "JOB_IMPORT_URL_RESPONSE_TOO_LARGE",
                                    "The public page is too large to import safely.",
                                    status_code=413,
                                )
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > MAX_URL_RESPONSE_BYTES:
                                raise PublicJobUrlFetchError(
                                    "JOB_IMPORT_URL_RESPONSE_TOO_LARGE",
                                    "The public page is too large to import safely.",
                                    status_code=413,
                                )
                        encoding = response.encoding or "utf-8"
                        page_text = bytes(body).decode(encoding, errors="replace")
                except PublicJobUrlFetchError:
                    raise
                except httpx.TimeoutException as exc:
                    raise PublicJobUrlFetchError(
                        "JOB_IMPORT_URL_TIMEOUT",
                        "The public page took too long to respond.",
                        status_code=504,
                    ) from exc
                except httpx.HTTPError as exc:
                    raise PublicJobUrlFetchError(
                        "JOB_IMPORT_URL_FETCH_FAILED",
                        "The public page could not be retrieved.",
                        status_code=502,
                    ) from exc

                if content_type == "text/plain":
                    normalized = "\n".join(
                        line
                        for line in (_clean_text(item) for item in page_text.splitlines())
                        if line
                    )[:MAX_IMPORT_SOURCE_TEXT_LENGTH]
                    if not normalized:
                        raise PublicJobUrlFetchError(
                            "JOB_IMPORT_URL_EMPTY_CONTENT",
                            "The public page did not contain readable job-listing text.",
                        )
                    title = None
                    metadata: dict[str, object] = {
                        "canonical_url": None,
                        "json_ld_job_posting": False,
                        "structured_title_found": False,
                    }
                else:
                    normalized, title, metadata = normalize_public_job_html(
                        page_text,
                        final_url=current_url,
                    )
                if len(normalized) < 80 and re.search(
                    r"\b(sign in|log in|authentication required)\b",
                    normalized,
                    flags=re.IGNORECASE,
                ):
                    raise PublicJobUrlFetchError(
                        "JOB_IMPORT_URL_AUTH_REQUIRED",
                        "This page requires sign-in and cannot be imported.",
                    )
                metadata.update(
                    {
                        "status_code": response.status_code,
                        "redirect_count": redirect_count,
                        "retrieved_content_type": content_type,
                        "response_bytes": len(body),
                    }
                )
                return PublicJobUrlRetrieval(
                    entered_url=entered_url,
                    final_url=current_url,
                    title=title,
                    normalized_text=normalized,
                    content_type=content_type,
                    retrieved_at=datetime.now(UTC),
                    metadata=metadata,
                )
        raise PublicJobUrlFetchError(
            "JOB_IMPORT_URL_TOO_MANY_REDIRECTS",
            "The public page redirected too many times.",
        )
