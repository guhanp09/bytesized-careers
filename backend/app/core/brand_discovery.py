"""Finding a brand's own website, when CreatorJobs was never told it.

Enrichment previously stopped at a hard limit: it could describe a brand only if
the account had already registered an official URL or CreatorJobs already held a
description. Everything else fell back to an empty field and a recruiter
googling their own company — the exact manual work this product exists to remove.

Discovery lifts that limit without lifting the safety that made the limit worth
having. Two rules shape everything here.

**Search discovers; it never describes.** A result snippet is a fragment written
by a search engine about a page, and generating a company biography from one is
how the wrong company's business ends up under somebody's job. Search answers
only "which URL is this brand's own site?" — the answer is then fetched through
the accepted public-URL fetcher and grounded exactly as a registered URL would
be. Nothing a search returns reaches a candidate.

**A name is not an identity.** "Pulse" is a fitness studio, a payments company
and a health system. Resolution therefore consumes the job's own context —
industry, role, place, the employer the page names — and returns a verdict, not
a best guess. Two plausible candidates is `ambiguous`, and ambiguous produces
nothing at all. A blank field costs a recruiter a paragraph; the wrong company's
description is published under their brand and neither they nor a candidate can
tell.
"""

from __future__ import annotations

import ipaddress
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal, Protocol
from urllib.parse import urlsplit

from app.core.brand_identity import is_brand_owned_host

#: How firmly a discovered site is tied to the brand we are describing.
DiscoveryVerdict = Literal[
    "verified_match",
    "high_confidence_match",
    "ambiguous",
    "no_match",
]

#: Verdicts that may lead to a fetch. Anything else stops here.
_ACTIONABLE: frozenset[str] = frozenset({"verified_match", "high_confidence_match"})

#: Hosts that describe organisations without being them. A result here can still
#: help *identify* a brand, but it is never the official source, and a page here
#: must never become the grounding evidence for what a company does.
_NOT_OFFICIAL: frozenset[str] = frozenset(
    {
        "wikipedia.org", "crunchbase.com", "zoominfo.com", "rocketreach.co",
        "apollo.io", "glassdoor.com", "indeed.com", "simplyhired.com",
        "simplyhired.co.in", "linkedin.com", "naukri.com", "shine.com",
        "monster.com", "ziprecruiter.com", "wellfound.com", "angel.co",
        "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com",
        "bebee.com", "foundit.in", "internshala.com", "reddit.com",
        "medium.com", "facebook.com", "pinterest.com", "quora.com",
        "bloomberg.com", "owler.com", "trustpilot.com", "yelp.com",
    }
)


@dataclass(frozen=True)
class BrandContext:
    """What CreatorJobs knows about the brand it is trying to find.

    Deliberately more than a name. Searching a bare name is what makes a common
    one dangerous, so every corroborating fact the job already established is
    carried into resolution.
    """

    name: str
    #: The employer the source page named, when it differs from the identity.
    source_employer: str | None = None
    #: Role/industry words from the job, for disambiguation only.
    industry_terms: tuple[str, ...] = ()
    role_terms: tuple[str, ...] = ()
    location: str | None = None
    #: Account-owned channel handle/domain fragments that distinguish a common
    #: name. These are corroboration hints, never URLs a client can make us fetch.
    known_identifiers: tuple[str, ...] = ()
    #: Host of the page the job was imported from. Never a brand candidate —
    #: carried so a result on the same host can be recognised and rejected.
    source_host: str | None = None

    def query_terms(self) -> list[str]:
        """Search phrasings, most specific first.

        Ordered so a disambiguating query runs before a bare one. A caller that
        stops at the first usable answer therefore stops at the most qualified.
        """

        name = _bounded_text(self.name, 160)
        if not name:
            return []
        terms: list[str] = []
        if self.industry_terms:
            terms.append(
                f'"{name}" {" ".join(_bounded_terms(self.industry_terms, 3))} official site'
            )
        if self.known_identifiers:
            terms.append(
                f'"{name}" {" ".join(_bounded_terms(self.known_identifiers, 2))} official'
            )
        if self.role_terms:
            terms.append(
                f'"{name}" {" ".join(_bounded_terms(self.role_terms, 2))} careers official'
            )
        if self.location:
            terms.append(f'"{name}" {_bounded_text(self.location, 120)} official site')
        terms.append(f'"{name}" official website')
        terms.append(f'"{name}" company about')
        return [term[:320] for term in terms]


@dataclass(frozen=True)
class DiscoveryResult:
    """A verdict, and the site it points at when there is one."""

    verdict: DiscoveryVerdict
    official_url: str | None = None
    #: Internal only. Never candidate copy, never a recruiter message.
    detail: str = ""
    considered: tuple[str, ...] = field(default_factory=tuple)
    #: A provider/network failure uses ``no_match`` as its public-safe verdict,
    #: but remains retryable in the persisted lifecycle.
    failed: bool = False

    @property
    def usable(self) -> bool:
        return self.verdict in _ACTIONABLE and bool(self.official_url)


class BrandSiteFinder(Protocol):
    """Resolves a brand to its own website, or declines.

    A protocol so the deterministic suite can supply exact verdicts and the
    ladder can be tested without a network. Implementations must return a
    verdict, never prose: the contract is "which site is this", not "what does
    this company do".
    """

    async def find_official_site(self, context: BrandContext) -> DiscoveryResult: ...


_WORD = re.compile(r"[^\W_]+", re.UNICODE)
_LEGAL_SUFFIXES = frozenset(
    {
        "co", "company", "corp", "corporation", "inc", "incorporated", "limited",
        "llc", "llp", "ltd", "plc", "private", "pvt",
    }
)
_GENERIC_BRAND_WORDS = frozenset(
    {
        "agency", "brand", "creative", "creator", "creators", "digital", "group",
        "lab", "labs", "media", "network", "official", "one", "production",
        "productions", "studio", "studios", "team",
    }
)
_WEAK_CONTEXT_WORDS = frozenset(
    {
        "and", "company", "content", "creator", "digital", "job", "media",
        "official", "role", "services", "team", "the", "website",
    }
)


def _bounded_text(value: object, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _bounded_terms(values: tuple[str, ...], limit: int) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for raw in values:
        term = _bounded_text(raw, 80)
        folded = term.casefold()
        if not term or folded in seen:
            continue
        seen.add(folded)
        terms.append(term)
        if len(terms) >= limit:
            break
    return terms


def _tokens(value: object) -> tuple[str, ...]:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    return tuple(
        token.casefold()
        for token in _WORD.findall(normalized)
        if len(token) > 1
    )


def _name_tokens(value: object) -> tuple[str, ...]:
    """Identity tokens, retaining dotted-acronym letters such as A.C.M.E."""

    normalized = unicodedata.normalize("NFKD", str(value or ""))
    return tuple(token.casefold() for token in _WORD.findall(normalized))


def brand_name_fingerprint(value: object) -> str:
    """Punctuation-insensitive identity key, never a fuzzy company guess."""

    tokens = [token for token in _name_tokens(value) if token not in _LEGAL_SUFFIXES]
    return "".join(tokens)


def brand_names_equivalent(left: object, right: object) -> bool:
    """Recognise spelling/punctuation variants while refusing partial names."""

    first = brand_name_fingerprint(left)
    second = brand_name_fingerprint(right)
    return bool(first and second and first == second)


def source_copy_matches_identity(
    *, brand_name: str, source_employer: str | None, evidence: str
) -> bool:
    """Whether a job-page company section belongs to the selected identity.

    A structured employer is authoritative about whose page this is. When one is
    absent, the section itself must name the selected brand. This prevents a
    perfectly factual paragraph about the source employer from appearing under a
    different recruiter-selected CreatorJobs identity.
    """

    if source_employer:
        return brand_names_equivalent(brand_name, source_employer)
    fingerprint = brand_name_fingerprint(brand_name)
    return bool(fingerprint and fingerprint in brand_name_fingerprint(evidence))


def discovered_page_matches_identity(
    *,
    context: BrandContext,
    evidence: str,
    final_url: str,
    verdict: DiscoveryVerdict,
) -> bool:
    """Corroborate a search answer using the fetched official page itself.

    The provider may propose a URL; it does not get to make that URL true. The
    fetched page/domain must name the brand, and a high-confidence (rather than
    verified) match with disambiguating job context must reflect at least one of
    those contextual facts. A common-name wrong-company page therefore fails
    closed even when a model sounded confident about it.
    """

    brand = brand_name_fingerprint(context.name)
    if not brand:
        return False
    host = host_of(final_url) or ""
    page_fingerprint = brand_name_fingerprint(evidence)
    host_fingerprint = brand_name_fingerprint(host.split(".", 1)[0])
    if brand not in page_fingerprint and brand not in host_fingerprint:
        return False

    evidence_tokens = set(_tokens(f"{evidence} {host}"))
    industry_tokens = {
        token
        for value in context.industry_terms
        for token in _tokens(value)
        if len(token) > 2 and token not in _WEAK_CONTEXT_WORDS
    }
    location_tokens = {
        token
        for token in _tokens(context.location)
        if len(token) > 2 and token not in _WEAK_CONTEXT_WORDS
    }
    role_tokens = {
        token
        for value in context.role_terms
        for token in _tokens(value)
        if len(token) > 3 and token not in _WEAK_CONTEXT_WORDS
    }
    identifier_tokens = {
        token
        for value in context.known_identifiers
        for token in _tokens(value)
        if len(token) > 2 and token not in {"youtube", "instagram", "tiktok"}
    }

    # Context is ordered by how well it distinguishes two businesses with the
    # same name. A matching city must not rescue the wrong industry, and a role
    # word is used only when the source established nothing stronger.
    if identifier_tokens:
        contextual_match = bool(identifier_tokens & evidence_tokens)
    elif industry_tokens:
        contextual_match = bool(industry_tokens & evidence_tokens)
    elif location_tokens:
        contextual_match = bool(location_tokens & evidence_tokens)
    elif role_tokens:
        contextual_match = bool(role_tokens & evidence_tokens)
    else:
        contextual_match = False

    name_tokens = [
        token
        for token in _name_tokens(context.name)
        if token not in _LEGAL_SUFFIXES and token not in _GENERIC_BRAND_WORDS
    ]
    distinctive_name = len(name_tokens) >= 2

    # A distinctive exact brand name plus its own matching page/domain can be
    # verified without a homepage repeating job-context words. Generic/common
    # names (Pulse, Nova, Studio One, Creator Lab) need corroborating context no
    # matter how confident the provider sounded.
    if distinctive_name:
        return True
    return contextual_match


def host_of(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlsplit(url if "//" in url else f"https://{url}")
    if parsed.scheme not in {"", "http", "https"}:
        return None
    host = (parsed.hostname or "").casefold().removeprefix("www.")
    return host or None


def _is_known_non_official(host: str) -> bool:
    return any(host == known or host.endswith(f".{known}") for known in _NOT_OFFICIAL)


def looks_official(url: str | None, *, source_host: str | None = None) -> bool:
    """Whether a URL could be the brand's own site rather than a page about it.

    Three refusals, each for a failure that has happened in this product before:
    a directory profile treated as authoritative, the job board the import came
    from treated as the employer, and a scheme the safe fetcher would refuse
    anyway.
    """

    host = host_of(url)
    if not host:
        return False
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return False
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        # The secure fetcher independently rejects non-public resolutions. This
        # early refusal keeps even a provider-attested literal address from
        # becoming a candidate source.
        return False
    if _is_known_non_official(host):
        return False
    if source_host and (host == source_host or host.endswith(f".{source_host}")):
        # The page the job was imported from is transport, not the hiring brand.
        return False
    return is_brand_owned_host(url)


def accept_discovery(
    result: DiscoveryResult, *, context: BrandContext
) -> DiscoveryResult:
    """Re-check a finder's verdict against rules the server owns.

    The finder is an untrusted component in exactly the way the extraction
    provider is: useful, and never the last word. A confident verdict pointing
    at an aggregator, at the job board the import came from, or at nothing at
    all is refused here regardless of how sure it claimed to be.
    """

    if result.verdict not in _ACTIONABLE:
        return result
    if not result.official_url:
        return DiscoveryResult(
            "no_match", None, "the finder claimed a match without naming a site"
        )
    if not looks_official(result.official_url, source_host=context.source_host):
        return DiscoveryResult(
            "ambiguous",
            None,
            "the proposed site is a third-party profile or the import's own host",
            result.considered,
        )
    return result
