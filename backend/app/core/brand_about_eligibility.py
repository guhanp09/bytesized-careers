"""Whether a job's About field may be filled automatically, decided once.

Every condition that stops enrichment lives here, and nothing else is allowed to
have its own slightly different opinion. That matters more than it sounds: the
conditions are checked by the trigger, by the runner before it starts work, and
by the writer before it stores a result, and three copies drifting apart is how
"recruiter text always wins" quietly becomes "usually wins".

The decision is deliberately conservative. Every branch that is not clearly safe
returns "no", because the cost of a wrong "no" is a recruiter typing a sentence
and the cost of a wrong "yes" is a false description published under their brand.

Two of these are not obvious and are worth stating:

**A recruiter who clears the field has decided something.** An empty field that
has never been enriched and an empty field somebody deliberately emptied look
identical, and regenerating the second one overrides a person on purpose. The
stored status is what tells them apart.

**An attempt has to be able to die.** A claim with no liveness rule leaves a job
permanently mid-flight after a restart, and "in progress forever" is worse than
"failed", because failed is retryable and forever is not.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final, Literal
from uuid import UUID

#: Persisted lifecycle of one job's brand About enrichment.
BrandAboutStatus = Literal[
    "not_attempted",
    "in_progress",
    "success",
    "skipped_existing_content",
    "no_reliable_identity",
    "no_official_source",
    "insufficient_evidence",
    "failed",
    "recruiter_owned",
]

#: Statuses that are settled: trying again would either repeat work or override
#: a decision somebody made.
_SETTLED: Final[frozenset[str]] = frozenset(
    {"success", "recruiter_owned", "skipped_existing_content"}
)

#: How long a claimed attempt may run before it is presumed lost.
#:
#: Generous relative to the work — a bounded fetch plus one model call — and
#: short enough that a process killed mid-attempt does not strand the job. The
#: same reasoning as the import attempt liveness rule, for the same reason.
ATTEMPT_LIVENESS_SECONDS: Final[float] = 180.0


@dataclass(frozen=True)
class EnrichmentDecision:
    """Whether to enrich, and the reason either way. The reason is internal."""

    eligible: bool
    reason: str

    def __bool__(self) -> bool:  # pragma: no cover - convenience only
        return self.eligible


def attempt_is_stale(attempted_at: datetime | None, *, now: datetime | None = None) -> bool:
    """Whether a claimed attempt has been running long enough to be presumed dead."""

    if attempted_at is None:
        return True
    moment = now or datetime.now(UTC)
    if attempted_at.tzinfo is None:
        attempted_at = attempted_at.replace(tzinfo=UTC)
    return moment - attempted_at > timedelta(seconds=ATTEMPT_LIVENESS_SECONDS)


def should_enrich_brand_about(
    *,
    about: str | None,
    hiring_identity_id: UUID | None,
    status: str | None,
    attempted_identity_id: UUID | None,
    attempted_at: datetime | None,
    now: datetime | None = None,
) -> EnrichmentDecision:
    """The one place that decides whether automatic enrichment may run.

    Takes plain values rather than a model so the trigger, the runner and the
    writer can all ask the same question about the same job at different points
    without any of them needing a session.
    """

    if (about or "").strip():
        # Whatever is there — recruiter-written or previously generated — is
        # content, and enrichment has nothing to add to a field that is full.
        return EnrichmentDecision(False, "the About field already has content")

    if hiring_identity_id is None:
        # Without a CreatorJobs hiring identity there is no brand to describe.
        # A source employer scraped from a page is explicitly not a substitute.
        return EnrichmentDecision(False, "no hiring identity is attached to this job")

    current = status or "not_attempted"

    if current in _SETTLED:
        if current == "success" and attempted_identity_id != hiring_identity_id:
            # The brand changed after a successful enrichment for a different
            # one, and the field is empty again — so the new brand has never
            # been considered. This is the one way a settled status reopens.
            return EnrichmentDecision(True, "the hiring identity changed after a previous result")
        # Includes the deliberate case: a recruiter emptied generated text, the
        # status records that they own it, and regenerating would override them.
        return EnrichmentDecision(False, f"already settled as {current}")

    if current == "in_progress":
        if attempt_is_stale(attempted_at, now=now):
            # A process died mid-attempt. Reclaiming is what stops a job sitting
            # in "in progress" forever.
            return EnrichmentDecision(True, "the previous attempt is stale and may be retried")
        return EnrichmentDecision(False, "an attempt is already running")

    if current in {"no_reliable_identity", "no_official_source", "insufficient_evidence"}:
        # Nothing about the world changed, so retrying reaches the same answer
        # and costs another lookup. Unless the brand itself changed.
        if attempted_identity_id is not None and attempted_identity_id != hiring_identity_id:
            return EnrichmentDecision(True, "a different hiring identity is now selected")
        return EnrichmentDecision(False, f"already determined: {current}")

    if current == "failed":
        # Retryable, but only once the claim has aged out — otherwise a failing
        # site would be re-fetched on every save.
        if attempt_is_stale(attempted_at, now=now):
            return EnrichmentDecision(True, "a previous attempt failed and may be retried")
        return EnrichmentDecision(False, "a recent attempt failed")

    return EnrichmentDecision(True, "never attempted for this job")


def status_for_outcome(outcome: str) -> BrandAboutStatus:
    """Translate an engine outcome into the persisted lifecycle status."""

    return {
        "success_official_site": "success",
        "success_existing_description": "success",
        "already_written": "skipped_existing_content",
        "no_reliable_identity": "no_reliable_identity",
        "no_official_source": "no_official_source",
        "insufficient_evidence": "insufficient_evidence",
        "model_declined": "insufficient_evidence",
        "ungrounded_summary": "insufficient_evidence",
        "fetch_failed": "failed",
        "error": "failed",
    }.get(outcome, "failed")
