"""Which brand an About field is about, and whether we are sure enough to say.

The worst thing automatic brand enrichment can do is describe the wrong company
confidently. A recruiter posting as *Finance Simplified* from a source page
belonging to *Nabbe* must never get Nabbe's business written under "About
Finance Simplified" — and a brand called "Acme" must get nothing at all, because
there are hundreds of them and picking one is a coin toss dressed as a fact.

So local resolution happens before any lookup, and it only ever uses context
CreatorJobs already owns: the hiring identity attached to the job, the URL the
account registered for it, and whether that identity is verified. A company name
scraped from a job board is *not* an input here. It identifies the source
employer, which is a deliberately separate entity, and treating the two as
interchangeable is the exact confusion this module exists to prevent.

The confidence ladder decides what may happen next:

``verified``          the account proved it owns this identity.
``high_confidence``   the account registered an official URL for it.
``ambiguous``         a name and nothing that pins it to one real brand.
``unresolved``        no usable identity at all.

Only the first two may proceed directly to evidence. An ambiguous local result
may now be passed to the separate context-aware web-discovery resolver, which
must independently establish an official source before anything is fetched or
written. Without that resolver, the honest output remains an empty field.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

#: How firmly a brand is pinned to one real entity.
BrandConfidence = Literal["verified", "high_confidence", "ambiguous", "unresolved"]

#: Hosts that describe brands without being them. A page here may mention a
#: company accurately and is still somebody else writing about them, so it is
#: never the factual authority for what a brand does.
#:
#: This is not a blocklist standing between the feature and correctness — the
#: only URL that reaches enrichment is one the account registered for its own
#: identity. It is a guard against that field being pointed at an aggregator
#: profile and the result being read as official.
_NOT_A_BRANDS_OWN_SITE: frozenset[str] = frozenset(
    {
        "simplyhired.com", "simplyhired.co.in", "indeed.com", "linkedin.com",
        "glassdoor.com", "bebee.com", "naukri.com", "monster.com", "ziprecruiter.com",
        "shine.com", "foundit.in", "internshala.com", "wellfound.com", "angel.co",
        "crunchbase.com", "zoominfo.com", "rocketreach.co", "apollo.io",
        "facebook.com", "reddit.com", "medium.com", "wikipedia.org",
        "sites.google.com", "linktr.ee", "notion.site",
    }
)


@dataclass(frozen=True)
class BrandIdentity:
    """The entity an About field describes, with how sure we are of it."""

    name: str
    confidence: BrandConfidence
    #: The brand's own site, when the account registered one.
    official_url: str | None = None
    #: A description CreatorJobs already holds for this brand.
    existing_description: str | None = None
    #: Why resolution landed where it did. Internal only — never candidate copy.
    reason: str = ""

    @property
    def may_enrich(self) -> bool:
        """Whether held identity data is enough without web discovery."""

        return self.confidence in {"verified", "high_confidence"}


def _registrable_host(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlsplit(url if "//" in url else f"https://{url}")
    if parsed.scheme not in {"", "http", "https"}:
        return None
    host = (parsed.hostname or "").casefold().removeprefix("www.")
    return host or None


def is_brand_owned_host(url: str | None) -> bool:
    """Whether a URL plausibly belongs to the brand rather than about it."""

    host = _registrable_host(url)
    if not host:
        return False
    # Suffix match so "in.indeed.com" and "jobs.linkedin.com" are caught too.
    return not any(
        host == known or host.endswith(f".{known}") for known in _NOT_A_BRANDS_OWN_SITE
    )


def resolve_brand_identity(
    *,
    display_name: str | None,
    official_url: str | None,
    verification_status: str | None,
    existing_description: str | None = None,
) -> BrandIdentity:
    """Decide which brand this is, from context CreatorJobs already owns.

    Deliberately takes plain values rather than a model: the caller is
    responsible for reading the *hiring identity* attached to the job, and
    passing a scraped source employer here would be visible at the call site
    rather than hidden inside a lookup.
    """

    name = (display_name or "").strip()
    if not name:
        return BrandIdentity(
            name="",
            confidence="unresolved",
            reason="no hiring identity is attached to this job",
        )

    description = (existing_description or "").strip() or None
    url = (official_url or "").strip() or None
    verified = (verification_status or "").strip().upper() == "VERIFIED"

    if url and not is_brand_owned_host(url):
        # A directory or aggregator profile. It may well be the right company,
        # and it is still not the brand describing itself.
        return BrandIdentity(
            name=name,
            confidence="ambiguous",
            existing_description=description,
            reason="the registered URL is a third-party profile, not the brand's own site",
        )

    if verified and url:
        return BrandIdentity(
            name=name,
            confidence="verified",
            official_url=url,
            existing_description=description,
            reason="verified identity with a registered official site",
        )
    if url:
        # Not verified, but the account registered this site for its own
        # identity — a far stronger signal than a name search, which is the
        # thing this feature refuses to do.
        return BrandIdentity(
            name=name,
            confidence="high_confidence",
            official_url=url,
            existing_description=description,
            reason="account-registered official site for this identity",
        )
    if verified and description:
        return BrandIdentity(
            name=name,
            confidence="verified",
            existing_description=description,
            reason="verified identity with a description CreatorJobs already holds",
        )

    # A name and nothing else cannot become facts here. The discovery layer may
    # search with job/account context and corroborate an official page; this
    # local resolver deliberately does not pre-approve that later result.
    return BrandIdentity(
        name=name,
        confidence="ambiguous",
        existing_description=description,
        reason="only a brand name is known, which does not identify one real brand",
    )
