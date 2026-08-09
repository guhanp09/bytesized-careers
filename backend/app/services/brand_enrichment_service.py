"""Filling an empty About field from the brand's own website, or not at all.

Optional enrichment, in the strict sense: every branch that is not clearly safe
ends in "leave it blank and let the recruiter write it". A blank field costs
thirty seconds. A confident description of the wrong company is published under
somebody's brand and nobody can tell it is wrong.

The precedence is fixed and short:

1. **Recruiter text wins, always.** If the field has anything in it, nothing here
   runs. Not on this pass, not on a later one — enrichment has no path that
   overwrites, so "the generated version came back" cannot happen.
2. **A description CreatorJobs already holds** for this identity is used as-is.
   It costs no network call and no model call, and it is what the brand told us
   about itself.
3. **The brand's own website**, but only when the identity is pinned firmly
   enough to be sure which brand that is.
4. **Nothing.**

Two things are deliberately absent. There is no brand-name search: searching a
name finds *a* company, not necessarily this one, and "Acme" would resolve to
whichever Acme ranked highest. And there is no fetch on render — enrichment runs
once, during import, and the result is stored.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal, Protocol

from app.core.brand_identity import BrandIdentity, is_brand_owned_host
from app.core.brand_summary import (
    SummaryVerdict,
    evidence_is_substantial,
    verify_summary,
)
from app.services.job_url_fetcher import PublicJobUrlFetcher, PublicJobUrlFetchError

logger = logging.getLogger(__name__)

#: Why an About field was or was not filled. Internal diagnostics only: none of
#: these ever reach a recruiter as a question or a candidate as copy.
EnrichmentOutcome = Literal[
    "not_attempted",
    "success_existing_description",
    "success_official_site",
    "already_written",
    "no_reliable_identity",
    "no_official_source",
    "fetch_failed",
    "insufficient_evidence",
    "model_declined",
    "ungrounded_summary",
    "error",
]


@dataclass(frozen=True)
class BrandEnrichment:
    """What enrichment produced, and everything needed to explain it."""

    outcome: EnrichmentOutcome
    about: str | None = None
    #: The page the claims came from. Internal — never candidate copy.
    evidence_url: str | None = None
    detail: str = ""

    @property
    def writable(self) -> bool:
        return bool(self.about)


class BrandSummarizer(Protocol):
    """Turns retrieved official copy into a short description of the brand.

    A protocol so the deterministic suite can supply a fake and the grounding
    rules can be tested without a provider call. The real implementation is a
    provider adapter; either way its output is checked before it is used.
    """

    async def summarize(self, *, brand_name: str, evidence: str) -> str | None: ...


#: Sections of a homepage that describe the company rather than decorate it.
_USEFUL_HEADINGS = (
    "about", "who we are", "what we do", "our story", "our mission", "mission",
    "overview", "company",
)


def brand_evidence_from_page(text: str, *, limit: int = 4000) -> str:
    """The part of an official page that describes the brand.

    Prefers an About-like section when the page has one, because a homepage is
    mostly navigation and calls to action. Falls back to the opening prose,
    which on a small brand site is usually the description itself.
    """

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if len(line) < 60 and any(
            line.casefold().startswith(heading) for heading in _USEFUL_HEADINGS
        ):
            section = lines[index + 1 : index + 12]
            body = " ".join(part for part in section if len(part) > 40)
            if body:
                return body[:limit]
    # No About heading: take the substantial prose, skipping nav-sized fragments.
    prose = [line for line in lines if len(line) > 60]
    return " ".join(prose[:8])[:limit]


class BrandEnrichmentService:
    """Fills an empty About field, or explains why it did not."""

    def __init__(
        self,
        summarizer: BrandSummarizer,
        *,
        fetcher: PublicJobUrlFetcher | None = None,
    ) -> None:
        self._summarizer = summarizer
        # The accepted public-URL fetcher, unchanged: SSRF protection, redirect
        # validation, size and time limits, content-type checks. Enrichment adds
        # no new way to reach the network.
        self._fetcher = fetcher or PublicJobUrlFetcher()

    async def enrich(
        self, identity: BrandIdentity, *, existing_about: str | None
    ) -> BrandEnrichment:
        if (existing_about or "").strip():
            # The only branch a recruiter's text needs, and it is first.
            return BrandEnrichment(
                "already_written", detail="the About field already has content"
            )

        if identity.existing_description:
            # CreatorJobs already knows what this brand says about itself.
            return BrandEnrichment(
                "success_existing_description",
                about=identity.existing_description.strip(),
                detail="used the brand description CreatorJobs already holds",
            )

        if not identity.may_enrich:
            return BrandEnrichment(
                "no_reliable_identity", detail=identity.reason
            )

        url = identity.official_url
        if not url or not is_brand_owned_host(url):
            return BrandEnrichment(
                "no_official_source",
                detail="no brand-owned site is registered for this identity",
            )

        try:
            retrieval = await self._fetcher.fetch(url)
        except PublicJobUrlFetchError as exc:
            # A page behind a challenge, a redirect that failed validation, a
            # timeout. All the same answer: leave the field blank.
            return BrandEnrichment("fetch_failed", detail=exc.code)
        except Exception:  # pragma: no cover - enrichment must never escalate
            logger.exception("brand_enrichment_fetch_failed")
            return BrandEnrichment("error", detail="fetch raised")

        evidence = brand_evidence_from_page(retrieval.normalized_text)
        if not evidence_is_substantial(evidence):
            # "Welcome to Acme." Padding this into a paragraph is precisely the
            # failure mode, so the model is never asked.
            return BrandEnrichment(
                "insufficient_evidence",
                evidence_url=retrieval.final_url,
                detail="the official page says too little to describe",
            )

        try:
            proposed = await self._summarizer.summarize(
                brand_name=identity.name, evidence=evidence
            )
        except Exception:  # pragma: no cover - optional enhancement
            logger.exception("brand_enrichment_summary_failed")
            return BrandEnrichment("error", evidence_url=retrieval.final_url, detail="summary raised")

        if not (proposed or "").strip():
            return BrandEnrichment(
                "model_declined",
                evidence_url=retrieval.final_url,
                detail="the model declined to summarise this evidence",
            )

        verdict: SummaryVerdict = verify_summary(
            proposed, evidence=evidence, brand_name=identity.name
        )
        if not verdict.accepted:
            # The model proposed; this decided. An unsupported claim is dropped
            # entirely rather than trimmed, because a partially-invented
            # description is still an invented one.
            return BrandEnrichment(
                "ungrounded_summary",
                evidence_url=retrieval.final_url,
                detail=f"{verdict.reason}: {', '.join(verdict.unsupported)}".strip(": "),
            )

        return BrandEnrichment(
            "success_official_site",
            about=verdict.summary,
            evidence_url=retrieval.final_url,
            detail="summarised from the brand's own site",
        )
