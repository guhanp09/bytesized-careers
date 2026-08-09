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


@dataclass(frozen=True)
class BrandAboutApplication:
    """What a completed attempt should do to the job row."""

    status: str
    #: Written only when it is still safe to write.
    about: str | None
    applied: bool
    reason: str


def apply_enrichment_result(
    result: BrandEnrichment,
    *,
    about_now: str | None,
    identity_now,
    identity_attempted,
) -> BrandAboutApplication:
    """Decide whether a finished attempt may still be written.

    This is the race the whole feature turns on. Enrichment takes seconds: a
    fetch, a model call. In that window a recruiter can type their own
    description, clear the field, or change which brand they are posting as —
    and the result in hand was computed for a world that no longer exists.

    So the answer is re-checked against the row as it is *now*, not as it was
    when the attempt started. Both losing conditions produce a status rather
    than silence, because "we had an answer and threw it away" is a different
    thing to debug than "we never got one".
    """

    from app.core.brand_about_eligibility import status_for_outcome

    status = status_for_outcome(result.outcome)

    if identity_attempted != identity_now:
        # Identity A's description must never appear under identity B. The
        # result is discarded outright; B is considered on its own merits.
        return BrandAboutApplication(
            "not_attempted",
            None,
            False,
            "the hiring identity changed while enrichment was running",
        )

    if (about_now or "").strip():
        # A recruiter wrote something while we were working. They win, and the
        # status records that they own the field so nothing tries again.
        return BrandAboutApplication(
            "recruiter_owned",
            None,
            False,
            "the recruiter wrote their own description while enrichment ran",
        )

    if not result.writable:
        return BrandAboutApplication(status, None, False, result.detail)

    return BrandAboutApplication(status, result.about, True, result.detail)


class BrandAboutRunner:
    """Claims a job, runs enrichment once, and writes only if still safe.

    The lifecycle deliberately mirrors job-import processing rather than
    inventing a second one: a compare-and-set claim so concurrent callers become
    one attempt, a timestamp so a lost attempt stops being "in progress", and a
    status the trigger reads instead of remembering anything.
    """

    def __init__(self, session, service: BrandEnrichmentService) -> None:
        self._session = session
        self._service = service

    async def run(self, job, identity_row) -> BrandAboutApplication:
        from datetime import UTC, datetime
        from uuid import uuid4

        from app.core.brand_about_eligibility import should_enrich_brand_about
        from app.core.brand_identity import resolve_brand_identity

        decision = should_enrich_brand_about(
            about=job.about_channel,
            hiring_identity_id=job.hiring_identity_id,
            status=job.brand_about_status,
            attempted_identity_id=job.brand_about_identity_id,
            attempted_at=job.brand_about_attempted_at,
        )
        if not decision.eligible:
            return BrandAboutApplication(
                job.brand_about_status or "not_attempted", None, False, decision.reason
            )

        # Claim, atomically.
        #
        # This was a read-then-write, and a browser test with two tabs proved
        # what that costs: both background tasks loaded the job in their own
        # session, both saw "not attempted", both claimed, and the brand's site
        # was fetched twice. Checking eligibility in Python and writing after is
        # a lost update whenever two attempts overlap — which is precisely when
        # the claim is supposed to matter.
        #
        # So the claim is one conditional UPDATE and the winner is decided by
        # the database. A row already claimed by a live attempt does not match,
        # the second caller updates nothing, and only the task that changed a
        # row proceeds to do any expensive work.
        from datetime import timedelta

        from sqlalchemy import or_, update

        from app.core.brand_about_eligibility import ATTEMPT_LIVENESS_SECONDS
        from app.models import Job

        attempt = uuid4()
        claimed_identity = job.hiring_identity_id
        now = datetime.now(UTC)
        cutoff = now - timedelta(seconds=ATTEMPT_LIVENESS_SECONDS)
        claim = (
            update(Job)
            .where(Job.id == job.id)
            .where(
                or_(
                    Job.brand_about_status.is_(None),
                    Job.brand_about_status != "in_progress",
                    Job.brand_about_attempted_at.is_(None),
                    Job.brand_about_attempted_at < cutoff,
                )
            )
            .values(
                brand_about_status="in_progress",
                brand_about_attempt_id=attempt,
                brand_about_identity_id=claimed_identity,
                brand_about_attempted_at=now,
            )
        )
        claimed = await self._session.execute(claim)
        await self._session.commit()
        if claimed.rowcount != 1:
            # Another attempt holds the claim. Doing the work anyway is the
            # duplicate this exists to prevent.
            return BrandAboutApplication(
                "in_progress", None, False, "another attempt already holds the claim"
            )
        await self._session.refresh(job)

        identity = resolve_brand_identity(
            display_name=getattr(identity_row, "display_name", None),
            official_url=getattr(identity_row, "url", None),
            verification_status=getattr(identity_row, "verification_status", None),
            existing_description=getattr(identity_row, "description", None),
        )
        result = await self._service.enrich(identity, existing_about=job.about_channel)

        await self._session.refresh(job)
        if job.brand_about_attempt_id != attempt:
            # Another attempt claimed this job while we worked. Theirs wins;
            # writing here would undo it.
            return BrandAboutApplication(
                job.brand_about_status or "not_attempted",
                None,
                False,
                "a newer attempt superseded this one",
            )

        application = apply_enrichment_result(
            result,
            about_now=job.about_channel,
            identity_now=job.hiring_identity_id,
            identity_attempted=claimed_identity,
        )
        job.brand_about_status = application.status
        if application.applied:
            job.about_channel = application.about
        await self._session.commit()
        return application
