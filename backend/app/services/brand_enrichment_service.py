"""Filling an empty About field from trustworthy brand evidence, or not at all.

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
3. **An explicit company introduction on the imported page**, when that page's
   employer matches the selected hiring identity.
4. **The brand's own website** — registered first, or safely discovered from
   context and corroborated after retrieval.
5. **Nothing.**

There is still no fetch on render. Discovery is server-owned background work,
and search only identifies a candidate official URL; it is never candidate copy.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal, Protocol
from urllib.parse import urlsplit

from app.core.brand_discovery import (
    BrandContext,
    BrandSiteFinder,
    discovered_page_matches_identity,
    host_of,
    looks_official,
    source_copy_matches_identity,
)
from app.core.brand_identity import BrandIdentity, is_brand_owned_host
from app.core.brand_summary import (
    evidence_is_substantial,
    verify_summary,
)
from app.services.job_url_fetcher import (
    PublicBrandUrlFetcher,
    PublicJobUrlFetcher,
    PublicJobUrlFetchError,
)

logger = logging.getLogger(__name__)

#: Why an About field was or was not filled. Internal diagnostics only: none of
#: these ever reach a recruiter as a question or a candidate as copy.
EnrichmentOutcome = Literal[
    "not_attempted",
    "success_existing_description",
    "success_official_site",
    "already_written",
    "success_source_page",
    "no_reliable_identity",
    "no_official_source",
    "ambiguous_brand",
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

    async def summarize(
        self,
        *,
        brand_name: str,
        evidence: str,
        job_context: str | None = None,
        source_authority: str = "official_site",
    ) -> str | None: ...


#: Sections of a homepage that describe the company rather than decorate it.
_USEFUL_HEADINGS = (
    "about", "who we are", "what we do", "our story", "our mission", "mission",
    "overview", "company",
)


#: Headings under which a job page introduces the company rather than the role.
#:
#: Deliberately narrower than the homepage list: a job post is mostly about the
#: job, so only a section that announces itself as being about the *company* is
#: taken. "Responsibilities" and "Benefits" describe the work and the package.
_SOURCE_BRAND_HEADINGS = (
    "about us", "about the company", "about our company", "who we are",
    "our company", "our channel", "our story", "our mission", "company overview",
    "about the team", "about the brand", "structured employer summary",
)

#: Wording that is legally or administratively required rather than descriptive.
#: A page's EEO statement says nothing a candidate wants to know about the brand.
_NOT_BRAND_COPY = (
    "equal opportunity", "e-verify", "privacy policy", "cookie",
    "affirmative action",
    "reasonable accommodation", "background check", "at-will", "disclaimer",
    "ignore previous instruction", "ignore all previous instruction", "system:",
    "apply at", "apply via", "click here", "send your application",
)


def brand_evidence_from_source_page(text: str | None, *, limit: int = 4000) -> str:
    """A company introduction the imported job page already carries.

    Only a section that names itself as being about the company counts. The rest
    of a job post is about the job, and treating "Benefits" or an EEO statement
    as a brand description produces copy no candidate wants and no employer
    wrote for that purpose.
    """

    if not text:
        return ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        raw_heading, separator, inline = line.partition(":")
        heading = raw_heading.casefold().strip()
        named_about = (
            heading.startswith("about ")
            and not any(
                excluded in heading
                for excluded in ("role", "job", "position", "opportunity")
            )
        )
        if len(raw_heading) > 80 or not (
            named_about
            or any(heading.startswith(known) for known in _SOURCE_BRAND_HEADINGS)
        ):
            continue
        body: list[str] = []
        inline = inline.strip() if separator else ""
        if len(inline) >= 40 and not any(
            marker in inline.casefold() for marker in _NOT_BRAND_COPY
        ):
            body.append(inline)
        for candidate in lines[index + 1 : index + 10]:
            lowered = candidate.casefold()
            if any(marker in lowered for marker in _NOT_BRAND_COPY):
                break
            if len(candidate) < 40:
                # A short line after the paragraph is the next heading.
                if body:
                    break
                continue
            body.append(candidate)
        if body:
            return " ".join(body)[:limit]
    return ""


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
            body = " ".join(
                part
                for part in section
                if len(part) > 40
                and not any(marker in part.casefold() for marker in _NOT_BRAND_COPY)
            )
            if body:
                return body[:limit]
    # No About heading: take the substantial prose, skipping nav-sized fragments.
    prose = [
        line
        for line in lines
        if len(line) > 60
        and not any(marker in line.casefold() for marker in _NOT_BRAND_COPY)
    ]
    return " ".join(prose[:8])[:limit]


class BrandEnrichmentService:
    """Fills an empty About field, or explains why it did not."""

    def __init__(
        self,
        summarizer: BrandSummarizer,
        *,
        fetcher: PublicJobUrlFetcher | None = None,
        finder: BrandSiteFinder | None = None,
    ) -> None:
        self._summarizer = summarizer
        # Optional by design. Without a finder the service behaves exactly as it
        # did before discovery existed: registered URL or nothing.
        self._finder = finder
        # Brand pages use a larger but still bounded response allowance and do
        # not need to classify as a job. Scheme, SSRF, DNS, redirect, timeout and
        # content-type protections remain the accepted fetcher's implementation.
        self._fetcher = fetcher or PublicBrandUrlFetcher()

    async def _discover(self, identity: BrandIdentity, context):
        """Ask the finder which site belongs to this brand, then re-check it.

        Returns ``None`` when discovery is not configured at all, which keeps the
        pre-discovery behaviour intact for any caller that does not supply a
        finder.
        """

        from app.core.brand_discovery import accept_discovery

        if self._finder is None:
            return None
        resolved = context or BrandContext(name=identity.name)
        try:
            found = await self._finder.find_official_site(resolved)
        except Exception:  # pragma: no cover - discovery is optional
            # A search outage means no source was found, not that the brand is
            # unidentifiable. Returning None here would report the wrong reason
            # and make a transient failure look like a settled verdict.
            logger.exception("brand_discovery_failed")
            from app.core.brand_discovery import DiscoveryResult

            return DiscoveryResult(
                "no_match", None, "discovery was unavailable", failed=True
            )
        # The finder is untrusted in the same way the extraction provider is.
        return accept_discovery(found, context=resolved)

    async def _summarise(
        self,
        identity: BrandIdentity,
        *,
        evidence: str,
        evidence_url: str | None,
        context: BrandContext | None,
        source_authority: str,
    ) -> BrandEnrichment:
        """One grounding path for every rung of the ladder.

        Source-page copy, a registered site and a discovered site all arrive
        here, so a claim the evidence does not support is refused identically
        wherever the evidence came from.
        """

        try:
            proposed = await self._summarizer.summarize(
                brand_name=identity.name,
                evidence=evidence,
                job_context=_summary_job_context(context),
                source_authority=source_authority,
            )
        except Exception:  # pragma: no cover - optional enhancement
            logger.exception("brand_enrichment_summary_failed")
            return BrandEnrichment("error", evidence_url=evidence_url, detail="summary raised")

        if not (proposed or "").strip():
            return BrandEnrichment(
                "model_declined",
                evidence_url=evidence_url,
                detail="the model declined to summarise this evidence",
            )

        verdict = verify_summary(proposed, evidence=evidence, brand_name=identity.name)
        if not verdict.accepted:
            return BrandEnrichment(
                "ungrounded_summary",
                evidence_url=evidence_url,
                detail=f"{verdict.reason}: {', '.join(verdict.unsupported)}".strip(": "),
            )

        return BrandEnrichment(
            "success_source_page" if evidence_url is None else "success_official_site",
            about=verdict.summary,
            evidence_url=evidence_url,
            detail="summarised from the job page" if evidence_url is None
            else "summarised from the brand's own site",
        )

    async def enrich(
        self,
        identity: BrandIdentity,
        *,
        existing_about: str | None,
        source_text: str | None = None,
        context: BrandContext | None = None,
    ) -> BrandEnrichment:
        """Fill an empty About field from the cheapest trustworthy source.

        A strict ladder, cheapest and strongest first. Each rung that answers
        stops the ladder, so a job whose own page introduces the company costs
        no search, no fetch and no model call — and a brand nobody can identify
        costs nothing at all.

        1. the recruiter's own text — nothing runs;
        2. a description CreatorJobs already holds;
        3. a company introduction the imported page already carries;
        4. a registered brand-owned site;
        5. a site discovered by search, when the brand is identifiable;
        6. nothing.
        """

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

        # Every discovery path gets a server-owned context, even when a direct
        # service caller did not supply job details. That keeps the fetched-page
        # corroboration mandatory: common names with no context fail closed
        # instead of bypassing the check merely because ``context`` was None.
        context = context or BrandContext(name=identity.name)

        # Level 3. The page the job came from often introduces the company
        # itself, and that copy is already retrieved, already about the right
        # employer, and free. Searching the web for something sitting in the
        # source would be waste and an unnecessary chance to find the wrong
        # company.
        from_source = brand_evidence_from_source_page(source_text)
        source_matches = bool(
            from_source
            and source_copy_matches_identity(
                brand_name=identity.name,
                source_employer=context.source_employer if context else None,
                evidence=from_source,
            )
        )
        if source_matches and evidence_is_substantial(from_source):
            return await self._summarise(
                identity,
                evidence=from_source,
                evidence_url=None,
                context=context,
                source_authority="imported_job_page_company_section",
            )

        url = identity.official_url if is_brand_owned_host(identity.official_url) else None
        discovery_verdict = None

        if url is None:
            # Level 5. No registered site. Before discovery existed this was the
            # end of the road — `may_enrich` meant "pinned firmly enough to
            # describe *without* looking anything up", and a name alone never
            # qualified. Discovery changes what a name can lead to, so the
            # question becomes whether the brand is identifiable enough to
            # search for, and the discovery *verdict* becomes the authority.
            #
            # The safety is unchanged in the only direction that matters:
            # ambiguous still writes nothing.
            if not identity.name.strip():
                return BrandEnrichment("no_reliable_identity", detail=identity.reason)

            discovered = await self._discover(identity, context)
            if discovered is None:
                # No finder configured: exactly the pre-discovery behaviour.
                return BrandEnrichment(
                    "no_reliable_identity" if not identity.may_enrich else "no_official_source",
                    detail=identity.reason,
                )
            if not discovered.usable:
                # A blank field costs a paragraph. The wrong company's
                # description is published under somebody's brand.
                return BrandEnrichment(
                    "error" if discovered.failed else (
                    "ambiguous_brand"
                    if discovered.verdict == "ambiguous"
                    else "no_official_source"
                    ),
                    detail=discovered.detail,
                )
            url = discovered.official_url
            discovery_verdict = discovered.verdict

        try:
            retrieval = await self._fetcher.fetch(url)
        except PublicJobUrlFetchError as exc:
            # A page behind a challenge, a redirect that failed validation, a
            # timeout. All the same answer: leave the field blank.
            return BrandEnrichment("fetch_failed", detail=exc.code)
        except Exception:  # pragma: no cover - enrichment must never escalate
            logger.exception("brand_enrichment_fetch_failed")
            return BrandEnrichment("error", detail="fetch raised")

        if not looks_official(
            retrieval.final_url,
            source_host=context.source_host if context else None,
        ):
            return BrandEnrichment(
                "ambiguous_brand",
                detail="the retrieved page resolved to a third-party or source host",
            )

        evidence = brand_evidence_from_page(retrieval.normalized_text)
        if not evidence_is_substantial(evidence):
            # "Welcome to Acme." Padding this into a paragraph is precisely the
            # failure mode, so the model is never asked.
            return BrandEnrichment(
                "insufficient_evidence",
                evidence_url=retrieval.final_url,
                detail="the official page says too little to describe",
            )

        if discovery_verdict is not None and context is not None and not discovered_page_matches_identity(
            context=context,
            evidence=evidence,
            final_url=retrieval.final_url,
            verdict=discovery_verdict,
        ):
            return BrandEnrichment(
                "ambiguous_brand",
                evidence_url=retrieval.final_url,
                detail="the fetched page did not corroborate the selected identity and job context",
            )

        return await self._summarise(
            identity,
            evidence=evidence,
            evidence_url=retrieval.final_url,
            context=context,
            source_authority=(
                "discovered_official_site"
                if discovery_verdict is not None
                else "registered_official_site"
            ),
        )


def _summary_job_context(context: BrandContext | None) -> str | None:
    """Small relevance hint for Luna; never an additional factual source."""

    if context is None:
        return None
    parts = [
        *context.industry_terms[:4],
        *context.role_terms[:2],
        context.location or "",
    ]
    value = " | ".join(" ".join(str(part).split())[:100] for part in parts if part)
    return value[:500] or None


async def import_brand_inputs_for_job(
    session, job, identity_row
) -> tuple[str | None, BrandContext]:
    """Load private import evidence and build bounded discovery context.

    The association is server-owned: a client supplies neither source text nor a
    fetch URL. When no import is linked, native job fields still provide a useful
    (smaller) context for a registered CreatorJobs hiring identity.
    """

    from sqlalchemy import select

    from app.models import JobImportDraft, JobImportSource

    source = (
        await session.execute(
            select(JobImportSource)
            .join(JobImportDraft, JobImportDraft.source_id == JobImportSource.id)
            .where(
                JobImportDraft.target_job_id == job.id,
                JobImportDraft.deleted_at.is_(None),
                JobImportSource.deleted_at.is_(None),
                JobImportSource.content_redacted_at.is_(None),
            )
            .order_by(JobImportDraft.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    structured: dict[str, object] = {}
    source_text: str | None = None
    source_url: str | None = None
    if source is not None:
        source_text = (source.original_text or "")[:120_000] or None
        source_url = str(source.final_source_url or source.source_url or "") or None
        metadata = source.retrieval_metadata
        if isinstance(metadata, dict) and isinstance(metadata.get("structured_context"), dict):
            structured = metadata["structured_context"]

    industry_terms = _bounded_unique_terms(
        [
            *_as_text_values(structured.get("industry")),
            *list(getattr(job, "content_niches", None) or []),
            *list(getattr(job, "content_genres", None) or []),
        ],
        maximum=6,
    )
    role_terms = _bounded_unique_terms(
        [
            structured.get("job_title"),
            getattr(job, "primary_role_name_snapshot", None),
            getattr(job, "role_specialization", None),
            getattr(job, "title", None),
        ],
        maximum=4,
    )
    location = next(
        (
            value
            for value in (
                structured.get("role_location"),
                getattr(job, "location", None),
                structured.get("employer_location"),
            )
            if isinstance(value, str) and value.strip()
        ),
        None,
    )
    return source_text, BrandContext(
        name=" ".join(str(getattr(identity_row, "display_name", "") or "").split())[:160],
        source_employer=(
            " ".join(str(structured.get("employer_name") or "").split())[:160] or None
        ),
        industry_terms=industry_terms,
        role_terms=role_terms,
        location=" ".join(location.split())[:160] if location else None,
        known_identifiers=_bounded_unique_terms(
            [
                getattr(identity_row, "handle", None),
                (
                    f"{getattr(identity_row, 'platform', '')} "
                    f"{getattr(identity_row, 'handle', '')}"
                    if getattr(identity_row, "handle", None)
                    else None
                ),
            ],
            maximum=2,
        ),
        source_host=host_of(source_url),
    )


def _as_text_values(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else [value]


def _bounded_unique_terms(
    values: list[object], *, maximum: int
) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            continue
        value = " ".join(raw.split())[:100]
        folded = value.casefold()
        if not value or folded in seen:
            continue
        seen.add(folded)
        result.append(value)
        if len(result) >= maximum:
            break
    return tuple(result)


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

    async def run(
        self,
        job,
        identity_row,
        *,
        source_text: str | None = None,
        context: BrandContext | None = None,
    ) -> BrandAboutApplication:
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

        # A persisted edit can win in the small window between the atomic claim
        # and the first provider/network operation. Re-check before paying for
        # work as well as after it: the final check is the correctness barrier,
        # while this one avoids a search/fetch/model call whose result is already
        # guaranteed to be discarded.
        if job.brand_about_attempt_id != attempt:
            return BrandAboutApplication(
                job.brand_about_status or "not_attempted",
                None,
                False,
                "a newer attempt superseded this one before work began",
            )
        if job.hiring_identity_id != claimed_identity:
            job.brand_about_status = "not_attempted"
            job.brand_about_attempt_id = None
            await self._session.commit()
            return BrandAboutApplication(
                "not_attempted",
                None,
                False,
                "the hiring identity changed before enrichment began",
            )
        if (job.about_channel or "").strip():
            job.brand_about_status = "recruiter_owned"
            job.brand_about_attempt_id = None
            await self._session.commit()
            return BrandAboutApplication(
                "recruiter_owned",
                None,
                False,
                "the recruiter wrote their own description before work began",
            )

        identity = resolve_brand_identity(
            display_name=getattr(identity_row, "display_name", None),
            official_url=getattr(identity_row, "url", None),
            verification_status=getattr(identity_row, "verification_status", None),
            existing_description=getattr(identity_row, "description", None),
        )
        result = await self._service.enrich(
            identity,
            existing_about=job.about_channel,
            source_text=source_text,
            context=context,
        )

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
        logger.info(
            "brand_about_enrichment_completed",
            extra={
                "job_id": str(job.id),
                "hiring_identity_id": str(claimed_identity),
                "outcome": result.outcome,
                "applied": application.applied,
                "evidence_host": (
                    urlsplit(result.evidence_url).hostname
                    if result.evidence_url
                    else None
                ),
            },
        )
        return application
