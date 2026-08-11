from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import math
import re
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from app.core.job_import_body_sections import (
    experience_requirements_from_body,
    has_conflicting_labelled_experience,
    labelled_experience,
    labelled_experience_requirements,
    normalize_experience_requirement,
)
from app.core.job_page_evidence import classify_job_page
from app.schemas.job_import import MAX_IMPORT_SOURCE_TEXT_LENGTH

#: What the recruiter is told when a page cannot be imported directly.
#:
#: Product language, not diagnostics: the exact classification is kept in
#: metadata for developers. Naming Cloudflare or "scraping" tells a recruiter
#: nothing they can act on, whereas "paste the description" is the next step in
#: every one of these cases.
_CLASSIFICATION_MESSAGES: dict[str, str] = {
    "multi_job_or_index": (
        "This page lists several jobs rather than one. Open the specific job you "
        "want, or paste its description here and I'll continue from that."
    ),
    "blocked_or_challenge": (
        "I can't read this job page directly. Paste the job description here and "
        "I'll continue from it."
    ),
    "thin_or_shell": (
        "I can't read this job page directly — the listing doesn't come through. "
        "Paste the job description here and I'll continue from it."
    ),
    "not_a_job": (
        "I couldn't find a job description on this page. Paste the job text here "
        "and I'll continue from it."
    ),
    "ambiguous": (
        "I can't tell which job this page describes. Paste the job description "
        "here and I'll continue from it."
    ),
}

_CLASSIFICATION_CODES: dict[str, str] = {
    "multi_job_or_index": "JOB_IMPORT_URL_MULTIPLE_JOBS",
    "blocked_or_challenge": "JOB_IMPORT_URL_ACCESS_DECLINED",
    "thin_or_shell": "JOB_IMPORT_URL_NO_JOB_CONTENT",
    "not_a_job": "JOB_IMPORT_URL_NO_JOB_CONTENT",
    "ambiguous": "JOB_IMPORT_URL_NO_JOB_CONTENT",
}

MAX_URL_RESPONSE_BYTES = 1_000_000
MAX_URL_REDIRECTS = 4
URL_CONNECT_TIMEOUT_SECONDS = 5.0

#: How long any single network operation may take.
#:
#: Separate from the total below, which they were not. One number served as both
#: the per-read timeout and the budget for the whole attempt, so a chain of up to
#: five requests — this fetcher follows redirects itself, revalidating the
#: destination each hop — had to finish inside the time allowed for one of them.
#: A single slow hop consumed everything the chain had.
URL_READ_TIMEOUT_SECONDS = 8.0

#: The ceiling on one whole attempt, redirects included.
#:
#: Deliberately larger than one operation and much smaller than the worst case
#: the operation budget permits: it is a stop, not a target. Measured against the
#: reported page, a normal fetch completes in about 0.7s.
URL_TOTAL_TIMEOUT_SECONDS = 15.0

#: One retry, and only for a timeout.
#:
#: A page that answered a moment ago and times out now has told us nothing about
#: itself; a page returning 404 has. So only the transient case is retried, and
#: only once — the recruiter is waiting, and a second failure is an answer.
#: Every attempt re-runs destination validation, so a retry cannot be used to
#: slip past the SSRF checks a first attempt failed.
URL_TIMEOUT_RETRIES = 1
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


def _all_json_ld_jobs(value: object, found: list[dict[str, object]] | None = None) -> list[dict[str, object]]:
    """Every JobPosting in a block, not merely the first.

    A board index publishes its whole results list in one array. Reading only
    the first meant a page of thirty roles looked exactly like a page of one.
    """

    collected = found if found is not None else []
    if len(collected) >= 40:
        return collected
    if isinstance(value, list):
        for item in value:
            _all_json_ld_jobs(item, collected)
        return collected
    if isinstance(value, dict):
        graph = value.get("@graph")
        if graph is not None:
            _all_json_ld_jobs(graph, collected)
        types = value.get("@type")
        names = types if isinstance(types, list) else [types]
        if any(isinstance(n, str) and n.strip().casefold() == "jobposting" for n in names):
            collected.append(value)
    return collected


def _distinct_posting_titles(postings: list[dict[str, object]]) -> list[str]:
    """The materially different job titles a page declares.

    Several JobPosting blocks often describe the *same* job — a page may repeat
    it for different syndication targets — so identical titles collapse to one.
    What matters is whether the page is about one role or many.
    """

    seen: list[str] = []
    for posting in postings:
        title = posting.get("title")
        if not isinstance(title, str):
            continue
        cleaned = " ".join(title.split()).strip()
        if cleaned and cleaned.casefold() not in {t.casefold() for t in seen}:
            seen.append(cleaned)
    return seen[:20]


def _posting_identity_fingerprints(postings: list[dict[str, object]]) -> list[str]:
    """Stable identities for materially distinct JobPosting records.

    Title-only deduplication treated two ``Video Editor`` openings at different
    employers or locations as one job.  Prefer publisher identifiers/URLs; when
    absent, fingerprint the bounded identity facts that distinguish postings.
    Exact syndicated repeats still collapse.
    """

    fingerprints: list[str] = []
    for posting in postings[:40]:
        identifier = posting.get("identifier")
        if isinstance(identifier, dict):
            identifier = identifier.get("value") or identifier.get("name")
        explicit = next(
            (
                _bounded_structured_text(value, 500)
                for value in (posting.get("@id"), posting.get("url"), identifier)
                if _bounded_structured_text(value, 500)
            ),
            None,
        )
        if explicit:
            material: object = {"explicit": explicit}
        else:
            organization = posting.get("hiringOrganization")
            employer = (
                _bounded_structured_text(organization.get("name"), 255)
                if isinstance(organization, dict)
                else None
            )
            material = {
                "title": _bounded_structured_text(posting.get("title"), 255),
                "employer": employer,
                "location": _structured_address(posting.get("jobLocation")),
                "salary": _structured_compensation(posting.get("baseSalary")),
                "date_posted": _bounded_structured_text(posting.get("datePosted"), 64),
                "valid_through": _bounded_structured_text(posting.get("validThrough"), 64),
            }
        canonical = json.dumps(
            material,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if digest not in fingerprints:
            fingerprints.append(digest)
    return fingerprints


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
    #: Dropped wherever they appear. Genuinely not the employer's copy about
    #: this job at any nesting depth.
    _IGNORED_TAGS = frozenset({"script", "style", "noscript", "svg", "nav", "form"})

    #: Dropped only as *page* chrome.
    #:
    #: In HTML5 these are sectioning content, not page furniture. Job boards put
    #: the title, the employer, the location and — the case that cost a live
    #: import — the pay chip inside the posting's own ``<header>``. Dropping it
    #: wherever it appeared meant "Up to ₹20,000 a month" never reached the
    #: provider at all, so no amount of downstream comprehension could recover
    #: it: the fact was gone before anything was asked to read it.
    #:
    #: Inside a content root the element belongs to the job. Outside one it is
    #: the site's masthead, which is what this rule was written for.
    _CHROME_TAGS = frozenset({"header", "footer"})

    #: Elements whose contents are the page's own subject matter.
    _CONTENT_ROOTS = frozenset({"main", "article", "section"})
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
            # A definition list is the natural markup for labelled job facts,
            # and it was missing. Source newlines were doing the work instead,
            # so the accepted fixtures passed — they are written one pair per
            # line. Minified HTML, which is what production sites actually
            # serve, puts the whole list on one line, and then
            # "<dt>Compensation</dt><dd>₹5,000/mo</dd><dt>Type</dt><dd>Freelance</dd>"
            # normalised to "₹5,000/moTypeFreelance": the rate absorbed the next
            # label and the engagement was never read at all.
            "dl",
            "dt",
            "dd",
            # The same reasoning for every other structural container. A tag
            # that separates content on screen has to separate it in the text,
            # whatever whitespace the source happened to use.
            "header",
            "footer",
            "nav",
            "figure",
            "figcaption",
            "caption",
            "thead",
            "tbody",
            "tfoot",
            "details",
            "summary",
            "fieldset",
            "legend",
            "hr",
            "pre",
        }
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._ignored_depth = 0
        #: How deep we are inside main/article/section. A header nested in one
        #: of those is the job's own header, not the site's.
        self._content_depth = 0
        self._title_depth = 0
        self._json_ld_depth = 0
        self._json_ld_chunks: list[str] = []
        self._text: list[str] = []
        self._title: list[str] = []
        self.canonical_href: str | None = None
        self.job_posting: dict[str, object] | None = None
        #: Every JobPosting the page declares, not merely the first.
        #:
        #: A board index publishes one per card. Keeping only the first meant a
        #: page listing thirty roles imported as whichever happened to be top of
        #: the list, with no sign anything had been chosen.
        self.job_postings: list[dict[str, object]] = []

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
        chrome = tag in self._CHROME_TAGS and not self._content_depth
        if self._ignored_depth or tag in self._IGNORED_TAGS or clutter or hidden or chrome:
            self._ignored_depth += 1
            return
        if tag in self._CONTENT_ROOTS:
            self._content_depth += 1
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
                    for posting in _all_json_ld_jobs(parsed):
                        if len(self.job_postings) < 40:
                            self.job_postings.append(posting)
            return
        if self._ignored_depth:
            self._ignored_depth -= 1
            return
        if tag in self._CONTENT_ROOTS and self._content_depth:
            self._content_depth -= 1
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


def _structured_addresses(value: object) -> list[str]:
    """Distinct structured locations, kept separate when a page offers many."""

    raw_values = value if isinstance(value, list) else [value]
    addresses: list[str] = []
    for raw in raw_values[:8]:
        address = _structured_address(raw)
        if address and address.casefold() not in {item.casefold() for item in addresses}:
            addresses.append(address[:500])
    return addresses


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


def _structured_location_requirements(value: object) -> list[str]:
    """Bounded geographic eligibility names from schema.org typed values."""

    raw_values = value if isinstance(value, list) else [value]
    requirements: list[str] = []
    for raw in raw_values[:12]:
        requirement = _structured_location_requirement(raw)
        if not requirement:
            continue
        for part in requirement.split("|"):
            cleaned = _bounded_structured_text(part, 120)
            if cleaned and cleaned.casefold() not in {
                item.casefold() for item in requirements
            }:
                requirements.append(cleaned)
    return requirements[:12]


def _numeric_text(value: object) -> str | None:
    """A finite positive JSON number, including numeric strings, as written."""

    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        raw = str(value)
    elif isinstance(value, str):
        raw = value.strip().replace(",", "")
    else:
        return None
    try:
        number = Decimal(raw)
    except InvalidOperation:
        return None
    if not number.is_finite() or number <= 0:
        return None
    return format(number, "f")


def _structured_compensation(value: object) -> str | None:
    # Publishers also state pay as plain wording — "Not disclosed", "Negotiable".
    # Returning nothing for those lost the fact that the page had answered, and
    # the recruiter was asked how the role is paid by a page that said it would
    # not say.
    if isinstance(value, str):
        return _bounded_structured_text(value, 120)
    if not isinstance(value, dict):
        return None
    currency = _bounded_structured_text(value.get("currency"), 3)
    unit = _bounded_structured_text(value.get("unitText"), 32)
    raw_amount = value.get("value")
    amount: str | None = None
    if (single_amount := _numeric_text(raw_amount)) is not None:
        amount = single_amount
    elif isinstance(raw_amount, dict):
        minimum = _numeric_text(raw_amount.get("minValue"))
        maximum = _numeric_text(raw_amount.get("maxValue"))
        if minimum is not None and maximum is not None:
            amount = f"{minimum}-{maximum}"
        elif minimum is not None:
            amount = f"minimum {minimum}"
        elif maximum is not None:
            amount = f"maximum {maximum}"
        else:
            # A single figure lives in `value`, not `minValue`. Reading only the
            # range keys dropped the amount from every page that states one
            # salary — the common case — leaving currency and period behind and
            # the recruiter asked to supply a number the page had printed.
            amount = _numeric_text(raw_amount.get("value"))
        unit = unit or _bounded_structured_text(raw_amount.get("unitText"), 32)
    parts = [currency, amount, f"per {unit}" if unit else None]
    return " ".join(part for part in parts if part) or None


def _bounded_structured_values(
    value: object,
    *,
    maximum_items: int = 12,
    maximum_item_length: int = 96,
    maximum_total_length: int = 500,
) -> str | None:
    raw_values = value if isinstance(value, list) else [value]
    values: list[str] = []
    seen: set[str] = set()
    for raw in raw_values:
        cleaned = _bounded_structured_text(raw, maximum_item_length)
        if not cleaned or cleaned.casefold() in seen:
            continue
        seen.add(cleaned.casefold())
        values.append(cleaned)
        if len(values) >= maximum_items:
            break
    return ", ".join(values)[:maximum_total_length] or None


def _bounded_structured_list(
    value: object,
    *,
    maximum_items: int = 8,
    maximum_item_length: int = 300,
) -> list[str]:
    """HTML-safe, bounded list values from standard JobPosting properties."""

    raw_values = value if isinstance(value, list) else [value]
    items: list[str] = []
    for raw in raw_values[:maximum_items]:
        if not isinstance(raw, str):
            continue
        readable = _strip_html_fragment(raw)
        for line in readable.splitlines():
            cleaned = re.sub(r"^(?:[-*•–—]+|\d+[.)])\s*", "", _clean_text(line)).strip()
            if not cleaned:
                continue
            bounded = cleaned[:maximum_item_length]
            if bounded.casefold() not in {item.casefold() for item in items}:
                items.append(bounded)
            if len(items) >= maximum_items:
                return items
    return items


_EXPLICIT_EXPERIENCE_RANGE = re.compile(
    r"\b(?P<minimum>\d{1,2})\s*(?:-|\u2013|\u2014|to)\s*"
    r"(?P<maximum>\d{1,2})\s+years?\s+of(?:\s+[\w-]+){0,3}\s+experience\b",
    re.IGNORECASE,
)


def _structured_experience_requirement(job_posting: dict[str, object]) -> str | None:
    description = job_posting.get("description")
    prose: tuple[str, ...] = ()
    if isinstance(description, str):
        readable_description = _strip_html_fragment(description)
        # A dedicated Experience row is the publisher's field-level statement.
        # Prefer it to a later prose sentence: the SimplyHired-shaped regression
        # printed "Experience: 1 to 2 yrs" in its facts, then described an ideal
        # candidate as having "1–3 years" below. The old broad search skipped the
        # abbreviation and promoted the weaker prose into Structured experience.
        labelled = labelled_experience(readable_description)
        if labelled is not None:
            if re.search(r"\b(?:years?|months?)$", labelled.value, re.IGNORECASE):
                return f"{labelled.value} of experience"
            return labelled.value
        if has_conflicting_labelled_experience(readable_description):
            # Comparable dedicated rows are a genuine conflict. Never replace
            # both with a weaker prose range merely because the singular helper
            # correctly declined to choose between them.
            return None
        prose = experience_requirements_from_body(readable_description)
        if len(prose) > 1:
            return None

    requirement = job_posting.get("experienceRequirements")
    if isinstance(requirement, str):
        readable = _strip_html_fragment(requirement)
        direct = normalize_experience_requirement(readable)
        if direct:
            return (
                f"{direct} of experience"
                if re.search(r"\b(?:years?|months?)$", direct, re.IGNORECASE)
                else direct
            )
        prose = experience_requirements_from_body(readable)
        if len(prose) == 1:
            return f"{prose[0]} of experience"
        description_prose = experience_requirements_from_body(
            _strip_html_fragment(description) if isinstance(description, str) else ""
        )
        return (
            f"{description_prose[0]} of experience"
            if len(description_prose) == 1
            else None
        )
    if len(prose) == 1:
        # Explicit wording in the employer's description outranks a mechanical
        # month floor, which can be a board-generated approximation.
        return f"{prose[0]} of experience"
    if not isinstance(requirement, dict):
        return None
    months = requirement.get("monthsOfExperience")
    if (
        not isinstance(months, (int, float))
        or isinstance(months, bool)
        or not math.isfinite(months)
        or months < 0
        or months > 600
        or not float(months).is_integer()
    ):
        return None
    return f"At least {int(months)} months of experience"


def _structured_experience_conflicts(job_posting: dict[str, object]) -> list[str]:
    """Comparable explicit experience claims that disagree."""

    description = job_posting.get("description")
    if isinstance(description, str):
        readable = _strip_html_fragment(description)
        labelled = labelled_experience_requirements(readable)
        if len(labelled) > 1:
            return [row.value for row in labelled][:8]
        if labelled:
            return []
        prose = list(experience_requirements_from_body(readable))
    else:
        prose = []
    requirement = job_posting.get("experienceRequirements")
    if isinstance(requirement, str):
        readable = _strip_html_fragment(requirement)
        direct = normalize_experience_requirement(readable)
        direct_values = [direct] if direct else list(experience_requirements_from_body(readable))
        combined = list(dict.fromkeys([*direct_values, *prose]))
        return combined[:8] if len(combined) > 1 else []
    return prose[:8] if len(prose) > 1 else []


_RESPONSIBILITY_HEADINGS = frozenset(
    {
        "responsibilities",
        "key responsibilities",
        "job responsibilities",
        "roles and responsibilities",
        "duties",
        "job duties",
        "what you will do",
        "what youll do",
    }
)
_QUALIFICATION_HEADINGS = frozenset(
    {
        "qualifications",
        "qualifications required",
        "required qualifications",
        "requirements",
        "job requirements",
        "candidate requirements",
        "required skills",
        "skills required",
        "must have skills",
        "skills and qualifications",
        "requirements and qualifications",
        "requirements qualifications",
        "qualifications and requirements",
        "qualifications requirements",
        "what we are looking for",
        "what were looking for",
    }
)
_PREFERRED_QUALIFICATION_HEADINGS = frozenset(
    {
        "preferred skills",
        "preferred skills optional",
        "preferred qualifications",
        "preferred qualifications optional",
        "nice to have",
    }
)
_APPLICATION_ROUTE_LINE = re.compile(
    r"^(?:apply\s+(?:now|here|at|via|online|by|through|using)\b|to\s+apply\b)",
    re.IGNORECASE,
)
_PREFERRED_QUALIFIER = re.compile(
    r"\b(?:preferred|optional|nice\s+to\s+have|bonus|ideally|helpful)\b",
    re.IGNORECASE,
)
_SECTION_BOUNDARY_HEADINGS = frozenset(
    {
        "about",
        "about company",
        "benefits",
        "company profile",
        "department",
        "education",
        "employment type",
        "experience",
        "how to apply",
        "industry type",
        "key skills",
        "location",
        "role",
        "role category",
        "salary",
    }
)


def _normalized_heading(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def _description_section(value: str) -> tuple[str, str | None] | None:
    heading, separator, remainder = value.partition(":")
    normalized = _normalized_heading(heading if separator else value.rstrip(":"))
    if normalized in _RESPONSIBILITY_HEADINGS:
        section = "responsibilities"
    elif normalized in _QUALIFICATION_HEADINGS:
        section = "qualifications"
    elif normalized in _PREFERRED_QUALIFICATION_HEADINGS:
        section = "preferred_qualifications"
    else:
        return None
    inline_value = remainder.strip() if separator else ""
    return section, inline_value or None


def _description_section_boundary(value: str) -> bool:
    normalized = _normalized_heading(value.rstrip(":"))
    if normalized in _SECTION_BOUNDARY_HEADINGS:
        return True
    label, separator, _detail = value.partition(":")
    return bool(
        separator and _normalized_heading(label) in _SECTION_BOUNDARY_HEADINGS
    )


_INLINE_DESCRIPTION_BOUNDARY = re.compile(
    r"\b(?:key\s+responsibilities|responsibilities|"
    r"requirements(?:\s*&\s*qualifications)?|"
    r"qualifications(?:\s*&\s*requirements)?|"
    r"preferred\s+(?:skills|qualifications)|nice\s+to\s+have|"
    r"salary|compensation|how\s+to\s+apply)\s*:",
    re.IGNORECASE,
)


def _description_lines(readable: str) -> list[str]:
    """Physical lines plus labelled clauses embedded on one minified line."""

    lines: list[str] = []
    for physical in readable.splitlines():
        cleaned = _clean_text(physical)
        if not cleaned:
            continue
        matches = list(_INLINE_DESCRIPTION_BOUNDARY.finditer(cleaned))
        starts = [match.start() for match in matches]
        if not starts:
            lines.append(cleaned)
            continue
        if starts and starts[0] > 0:
            starts.insert(0, 0)
        clauses = [
            _clean_text(cleaned[start:end])
            for start, end in zip(starts, [*starts[1:], len(cleaned)], strict=True)
            if _clean_text(cleaned[start:end])
        ]
        lines.extend(clauses or [cleaned])
    return lines


def _structured_description_context(description: object) -> dict[str, object]:
    """Keep bounded, labelled facts from the JobPosting description itself."""

    if not isinstance(description, str):
        return {}
    readable = _strip_html_fragment(description)
    lines = _description_lines(readable)
    if not lines:
        return {}

    summary_lines: list[str] = []
    responsibilities: list[str] = []
    qualifications: list[str] = []
    preferred_qualifications: list[str] = []
    active_section: str | None = None
    saw_section = False
    for raw_line in lines:
        section_line = _description_section(raw_line)
        if section_line is not None:
            active_section, inline_value = section_line
            saw_section = True
            if inline_value is None:
                continue
            raw_line = inline_value
        if active_section is not None and _description_section_boundary(raw_line):
            active_section = None
            continue

        cleaned = re.sub(r"^(?:[-*•–—]+|\d+[.)])\s*", "", raw_line).strip()
        if not cleaned:
            continue
        if active_section is not None and _APPLICATION_ROUTE_LINE.match(cleaned):
            active_section = None
            continue
        if active_section == "responsibilities":
            if len(responsibilities) < 5:
                bounded = _bounded_structured_text(cleaned, 300)
                if bounded and bounded.casefold() not in {
                    item.casefold() for item in responsibilities
                }:
                    responsibilities.append(bounded)
            continue
        if active_section == "qualifications":
            target = (
                preferred_qualifications
                if _PREFERRED_QUALIFIER.search(cleaned)
                else qualifications
            )
            if len(target) < 5:
                bounded = _bounded_structured_text(cleaned, 300)
                if bounded and bounded.casefold() not in {
                    item.casefold() for item in target
                }:
                    target.append(bounded)
            continue
        if active_section == "preferred_qualifications":
            if len(preferred_qualifications) < 5:
                bounded = _bounded_structured_text(cleaned, 300)
                if bounded and bounded.casefold() not in {
                    item.casefold() for item in preferred_qualifications
                }:
                    preferred_qualifications.append(bounded)
            continue
        if not saw_section and len(summary_lines) < 3:
            summary_lines.append(cleaned)

    context: dict[str, object] = {}
    role_summary = _bounded_structured_text(" ".join(summary_lines), 1000)
    if role_summary:
        context["role_summary"] = role_summary
    if responsibilities:
        context["responsibilities"] = responsibilities
    if qualifications:
        context["qualifications"] = qualifications
    if preferred_qualifications:
        context["preferred_qualifications"] = preferred_qualifications
    return context


_EXPLICIT_REMOTE_DESCRIPTION = re.compile(
    r"\b(?:fully\s+remote|100\s*%\s*remote|remote\s+(?:job|role|position)|"
    r"work\s+from\s+home|wfh)\b",
    re.IGNORECASE,
)
_REMOTE_AREA_DESCRIPTION = re.compile(
    r"\b(?:remote|work\s+from\s+home|wfh)\s*"
    r"(?:(?:only\s+)?(?:in|from|within)\s+|[-:–—]\s*|\s+)"
    r"(?P<area>[A-Za-z][A-Za-z .'/+-]{1,60})(?=$|[.;,])",
    re.IGNORECASE,
)


def _merge_context_items(context: dict[str, object], key: str, additions: list[str]) -> None:
    current = context.get(key)
    values = list(current) if isinstance(current, list) else []
    for item in additions:
        if item.casefold() not in {existing.casefold() for existing in values}:
            values.append(item)
        if len(values) >= 8:
            break
    if values:
        context[key] = values


def _job_posting_context(job_posting: dict[str, object] | None) -> dict[str, object]:
    if job_posting is None:
        return {}
    context: dict[str, object] = {}
    job_title = _bounded_structured_text(job_posting.get("title"), 255)
    if job_title:
        context["job_title"] = job_title
    description = job_posting.get("description")
    context.update(_structured_description_context(description))

    # schema.org exposes these as first-class JobPosting properties.  They are
    # publisher-owned facts, not hints, and must survive even when the prose
    # description uses no headings at all.
    direct_responsibilities = _bounded_structured_list(job_posting.get("responsibilities"))
    if direct_responsibilities:
        _merge_context_items(context, "responsibilities", direct_responsibilities)
    direct_qualifications = _bounded_structured_list(job_posting.get("qualifications"))
    if direct_qualifications:
        required: list[str] = []
        preferred: list[str] = []
        for item in direct_qualifications:
            (preferred if _PREFERRED_QUALIFIER.search(item) else required).append(item)
        _merge_context_items(context, "qualifications", required)
        _merge_context_items(context, "preferred_qualifications", preferred)
    organization = job_posting.get("hiringOrganization")
    if isinstance(organization, dict):
        employer = _bounded_structured_text(organization.get("name"))
        employer_location = _structured_address(organization)
        raw_about = organization.get("description")
        about_summary = (
            _bounded_structured_text(_strip_html_fragment(raw_about), 1000)
            if isinstance(raw_about, str)
            else None
        )
        if employer:
            context["employer_name"] = employer
        if employer_location:
            context["employer_location"] = employer_location
        if about_summary:
            context["about_summary"] = about_summary
    role_locations = _structured_addresses(job_posting.get("jobLocation"))
    if len(role_locations) == 1:
        context["role_location"] = role_locations[0]
    elif role_locations:
        context["role_locations"] = role_locations
    remote_requirements = _structured_location_requirements(
        job_posting.get("applicantLocationRequirements")
    )
    if remote_requirements:
        context["remote_eligibility"] = " | ".join(remote_requirements)[:500]
        # Typed Country/AdministrativeArea names are safe geographic labels.
        # Keep the individual values so a scalar join never hides a choice.
        context["remote_eligibility_areas"] = remote_requirements
    location_type = _bounded_structured_text(job_posting.get("jobLocationType"), 64)
    readable_description = (
        _strip_html_fragment(description) if isinstance(description, str) else ""
    )
    if not location_type and _EXPLICIT_REMOTE_DESCRIPTION.search(readable_description):
        location_type = "TELECOMMUTE"
    if "remote_eligibility" not in context:
        area_match = _REMOTE_AREA_DESCRIPTION.search(readable_description)
        if area_match:
            area = _bounded_structured_text(area_match.group("area"), 120)
            if area:
                context["remote_eligibility"] = area
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
    industry = _bounded_structured_values(job_posting.get("industry"))
    if industry:
        context["industry"] = industry
    skills = _bounded_structured_values(job_posting.get("skills"))
    if skills:
        context["skills"] = skills
    experience_requirement = _structured_experience_requirement(job_posting)
    if experience_requirement:
        context["experience_requirement"] = experience_requirement
    experience_conflicts = _structured_experience_conflicts(job_posting)
    if experience_conflicts:
        context["experience_requirement_conflicts"] = experience_conflicts
    for source_key, context_key, maximum in (
        ("workHours", "work_hours", 160),
        ("validThrough", "valid_through", 64),
        ("jobStartDate", "job_start_date", 64),
    ):
        value = _bounded_structured_text(job_posting.get(source_key), maximum)
        if value:
            context[context_key] = value
    return context


def _structured_context_lines(context: dict[str, object]) -> list[str]:
    labels = {
        "job_title": "Structured job title",
        "role_summary": "Structured role summary",
        "about_summary": "Structured employer summary",
        "responsibilities": "Structured responsibility",
        "qualifications": "Structured qualification",
        "preferred_qualifications": "Structured preferred qualification",
        "employer_name": "Structured employer",
        "employer_location": "Structured employer location",
        "role_location": "Structured role location",
        "role_locations": "Structured role location",
        "remote_eligibility": "Structured remote eligibility",
        "remote_eligibility_areas": "Structured remote eligibility",
        "location_type": "Structured work location type",
        "employment_type": "Structured employment type",
        "compensation": "Structured compensation",
        "industry": "Structured industry",
        "skills": "Structured skills",
        "experience_requirement": "Structured experience requirement",
        "experience_requirement_conflicts": "Structured conflicting experience requirement",
        "work_hours": "Structured work hours",
        "valid_through": "Structured application valid through",
        "job_start_date": "Structured job start date",
    }
    lines: list[str] = []
    for key, value in context.items():
        label = labels.get(key)
        if label is None:
            continue
        if isinstance(value, str):
            lines.append(f"{label}: {value}")
        elif isinstance(value, list):
            lines.extend(f"{label}: {item}" for item in value if isinstance(item, str))
    return lines


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
        "json_ld_job_titles": _distinct_posting_titles(parser.job_postings),
        "json_ld_job_identities": _posting_identity_fingerprints(parser.job_postings),
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
        """Retrieve a public page, retrying a timeout once and nothing else.

        The retry exists because a timeout is not evidence about the page. A
        live import of a page that normally answers in under a second failed
        outright on a momentary network stall, and the recruiter was shown a
        failure for something that would have worked if asked twice.

        Only the timeout is retried. A refusal, a redirect loop, an oversized
        body or a blocked destination are all answers, and repeating the request
        would neither change them nor respect the site.
        """

        for attempt in range(URL_TIMEOUT_RETRIES + 1):
            last = attempt >= URL_TIMEOUT_RETRIES
            try:
                async with asyncio.timeout(URL_TOTAL_TIMEOUT_SECONDS):
                    return await self._fetch_with_operation_timeouts(raw_url)
            except TimeoutError as exc:
                # The whole-attempt deadline.
                if last:
                    raise PublicJobUrlFetchError(
                        "JOB_IMPORT_URL_TIMEOUT",
                        "The public page took too long to respond.",
                        status_code=504,
                    ) from exc
            except PublicJobUrlFetchError as exc:
                # A single stalled operation, already named by the layer below.
                # Anything else it raises is an answer about the page, so it
                # propagates on the first attempt rather than being repeated.
                if last or exc.code != "JOB_IMPORT_URL_TIMEOUT":
                    raise
        raise AssertionError("unreachable")  # pragma: no cover

    async def _fetch_with_operation_timeouts(
        self,
        raw_url: str,
    ) -> PublicJobUrlRetrieval:
        entered_url = await self._validate_destination(raw_url)
        current_url = entered_url
        timeout = httpx.Timeout(
            URL_READ_TIMEOUT_SECONDS,
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
                        if response.status_code == 401:
                            raise PublicJobUrlFetchError(
                                "JOB_IMPORT_URL_AUTH_REQUIRED",
                                "This page requires sign-in and cannot be imported.",
                            )
                        if response.status_code == 403:
                            # Not a sign-in wall. A 403 here is almost always a
                            # site declining automated access — a bot check
                            # answering "Just a moment..." rather than a login
                            # form. Telling the recruiter to sign in sends them
                            # looking for a password that would not help, so the
                            # message says what actually happened and points at
                            # the paste fallback, which does work.
                            raise PublicJobUrlFetchError(
                                "JOB_IMPORT_URL_ACCESS_DECLINED",
                                "This site declined an automated request for the "
                                "page. Open it in your browser and paste the job "
                                "text instead.",
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

                # Fetching a page is not the same as finding a job on it, and
                # what came back instead decides what the recruiter should be
                # told. A board index, a bot check and a client-rendered shell
                # all need different sentences and all need the paste path.
                evidence = classify_job_page(
                    normalized,
                    declared_job_titles=metadata.get("json_ld_job_titles") or [],
                    declared_job_identities=metadata.get("json_ld_job_identities") or [],
                )
                metadata["page_classification"] = evidence.classification
                metadata["page_classification_reason"] = evidence.reason
                if not evidence.may_extract:
                    raise PublicJobUrlFetchError(
                        _CLASSIFICATION_CODES[evidence.classification],
                        _CLASSIFICATION_MESSAGES[evidence.classification],
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
