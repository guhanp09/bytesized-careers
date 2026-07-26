"""Manifest validation.

Runs before anything writes to a database and before the frontend adapts a
manifest. A seed that half-loads because one record pointed at a job that was
never generated is far more expensive to diagnose than one that refuses to load
at all, so every failure here is loud and names the offending record.

The enum checks compare against the *live* backend constants rather than the
manifest's own copies. Restating the vocabularies in `schema.py` keeps the
manifest readable as data, but if the backend retires a status and the manifest
does not follow, this is where that shows up.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .schema import (
    APPLICATION_STAGES,
    ENGAGEMENT_STATES,
    INTEREST_STAGES,
    INTERVIEW_STATES,
    MANIFEST_VERSION,
    PAYMENT_STATES,
    Manifest,
)


class ManifestError(ValueError):
    """Raised for any structural problem. Never swallowed by a consumer."""


def _fail(problems: list[str]) -> None:
    if problems:
        raise ManifestError(
            f"{len(problems)} manifest problem(s):\n  - " + "\n  - ".join(problems[:40])
        )


def check_version(version: int) -> None:
    """Refuse a manifest this build does not understand.

    Explicitly not a best-effort read: a newer manifest may have moved a field,
    and silently ignoring it would seed subtly wrong data that looks fine.
    """

    if version != MANIFEST_VERSION:
        raise ManifestError(
            f"Manifest version {version} is not supported by this build "
            f"(expected {MANIFEST_VERSION}). Regenerate the manifests, or check out a build that "
            "understands this version."
        )


def validate(manifest: Manifest) -> None:
    check_version(manifest.version)
    problems: list[str] = []

    actor_ids = {actor.id for actor in manifest.actors}
    job_ids = {job.id for job in manifest.jobs}
    portfolio_ids = {item.id for item in manifest.portfolio}
    relationship_ids = {rel.id for rel in manifest.relationships}

    # --- no duplicates ------------------------------------------------------
    for label, values in (
        ("actor", [a.id for a in manifest.actors]),
        ("job", [j.id for j in manifest.jobs]),
        ("portfolio", [p.id for p in manifest.portfolio]),
        ("relationship", [r.id for r in manifest.relationships]),
    ):
        if len(values) != len(set(values)):
            seen: set[str] = set()
            for value in values:
                if value in seen:
                    problems.append(f"duplicate {label} id {value}")
                seen.add(value)

    # --- ownership ----------------------------------------------------------
    for job in manifest.jobs:
        if job.owner_id not in actor_ids:
            problems.append(f"job {job.id} references unknown owner {job.owner_id}")
    for item in manifest.portfolio:
        if item.owner_id not in actor_ids:
            problems.append(f"portfolio {item.id} references unknown owner {item.owner_id}")

    message_ids: set[str] = set()
    conversation_ids: set[str] = set()

    for rel in manifest.relationships:
        if rel.recruiter_id not in actor_ids:
            problems.append(f"relationship {rel.id} references unknown recruiter {rel.recruiter_id}")
        if rel.talent_id not in actor_ids:
            problems.append(f"relationship {rel.id} references unknown talent {rel.talent_id}")
        if rel.recruiter_id == rel.talent_id:
            problems.append(f"relationship {rel.id} has the same actor on both sides")
        # An application is always about a job; a hiring request never is.
        if rel.kind == "application" and not rel.job_id:
            problems.append(f"application {rel.id} has no job")
        if rel.kind == "hiring_request" and rel.job_id:
            problems.append(f"hiring request {rel.id} should not reference a job")
        # A hiring request has no interview stage and no legacy Shortlisted.
        # Seeding one would create a record the backend could never produce.
        allowed = APPLICATION_STAGES if rel.kind == "application" else INTEREST_STAGES
        if rel.stage not in allowed:
            problems.append(f"{rel.kind} {rel.id} has stage {rel.stage!r}, which that kind cannot hold")
        if rel.participant_stage and rel.participant_stage not in allowed:
            problems.append(
                f"{rel.kind} {rel.id} shows participants {rel.participant_stage!r}, which that kind cannot hold"
            )
        if rel.job_id and rel.job_id not in job_ids:
            problems.append(f"relationship {rel.id} references unknown job {rel.job_id}")
        for item_id in rel.portfolio_ids:
            if item_id not in portfolio_ids:
                problems.append(f"relationship {rel.id} references unknown portfolio item {item_id}")
        if rel.conversation_id:
            if rel.conversation_id in conversation_ids:
                problems.append(f"conversation {rel.conversation_id} is attached to more than one relationship")
            conversation_ids.add(rel.conversation_id)

        for message in rel.messages:
            if message.id in message_ids:
                problems.append(f"duplicate message id {message.id}")
            message_ids.add(message.id)
            if message.conversation_id != rel.conversation_id:
                problems.append(
                    f"message {message.id} belongs to {message.conversation_id} but sits on {rel.id}"
                )
            # A null sender is the platform speaking; anything else must be one
            # of the two participants.
            if message.sender_id is not None and message.sender_id not in {rel.recruiter_id, rel.talent_id}:
                problems.append(f"message {message.id} was sent by someone outside the conversation")

        if rel.interview:
            if rel.interview.relationship_id != rel.id:
                problems.append(f"interview {rel.interview.id} points at the wrong relationship")
            if rel.interview.state not in INTERVIEW_STATES:
                problems.append(f"interview {rel.interview.id} has unknown state {rel.interview.state}")

        if rel.engagement:
            if rel.engagement.relationship_id != rel.id:
                problems.append(f"engagement {rel.engagement.id} points at the wrong relationship")
            if rel.engagement.state not in ENGAGEMENT_STATES:
                problems.append(f"engagement {rel.engagement.id} has unknown state {rel.engagement.state}")
            if rel.engagement.payment_state and rel.engagement.payment_state not in PAYMENT_STATES:
                problems.append(
                    f"engagement {rel.engagement.id} has unknown payment state {rel.engagement.payment_state}"
                )

        # Personal organisation belongs to a participant, so it can only exist
        # on a real relationship — which is guaranteed by it living here.
        if rel.snoozed_offset is not None and rel.archived:
            problems.append(f"relationship {rel.id} is both archived and snoozed")

    # --- transient state ----------------------------------------------------
    for entry in manifest.client_state:
        if entry.relationship_id not in relationship_ids:
            problems.append(f"client state {entry.id} references unknown relationship {entry.relationship_id}")

    # --- index --------------------------------------------------------------
    for entry in manifest.index:
        if entry.relationship_id not in relationship_ids:
            problems.append(f"index entry references unknown relationship {entry.relationship_id}")
        if entry.scenario != manifest.scenario:
            problems.append(f"index entry claims scenario {entry.scenario} inside {manifest.scenario}")

    # --- orphans ------------------------------------------------------------
    referenced_portfolio = {item for rel in manifest.relationships for item in rel.portfolio_ids}
    orphan_portfolio = portfolio_ids - referenced_portfolio
    if orphan_portfolio and manifest.scenario != "empty":
        # Portfolio belongs to a person, not to an application, so an unattached
        # item is legitimate — but a scenario made *entirely* of them means the
        # attachment step silently failed.
        if len(orphan_portfolio) == len(portfolio_ids) and portfolio_ids:
            problems.append("no portfolio item is attached to any relationship")

    _fail(problems)


def check_backend_enums() -> None:
    """Cross-check the manifest vocabularies against the live backend.

    Kept separate from `validate` because it imports application modules; a
    consumer validating a manifest should not need the ORM loaded.
    """

    from app.services.interaction_status import APPLICATION_TRANSITIONS, INTEREST_TRANSITIONS
    from app.schemas.reviews import EngagementStatus, PaymentState
    from typing import get_args

    problems: list[str] = []
    backend_payment = set(get_args(PaymentState))
    if set(PAYMENT_STATES) != backend_payment:
        problems.append(
            f"payment states drifted: manifest {sorted(set(PAYMENT_STATES) - backend_payment)} extra, "
            f"backend {sorted(backend_payment - set(PAYMENT_STATES))} missing"
        )
    backend_engagement = set(get_args(EngagementStatus))
    if set(ENGAGEMENT_STATES) != backend_engagement:
        problems.append(
            f"engagement states drifted: manifest {sorted(set(ENGAGEMENT_STATES) - backend_engagement)} extra, "
            f"backend {sorted(backend_engagement - set(ENGAGEMENT_STATES))} missing"
        )
    known_application = set(APPLICATION_TRANSITIONS) | {
        target for targets in APPLICATION_TRANSITIONS.values() for target in targets
    }
    known_interest = set(INTEREST_TRANSITIONS) | {
        target for targets in INTEREST_TRANSITIONS.values() for target in targets
    }
    from .schema import APPLICATION_STAGES, INTEREST_STAGES

    unknown_app = set(APPLICATION_STAGES) - known_application
    if unknown_app:
        problems.append(f"application stages unknown to the backend: {sorted(unknown_app)}")
    unknown_int = set(INTEREST_STAGES) - known_interest
    if unknown_int:
        problems.append(f"interest stages unknown to the backend: {sorted(unknown_int)}")
    _fail(problems)


def summarize(manifest: Manifest) -> dict[str, Any]:
    """Counts a coverage test can assert against without re-walking the tree."""

    return dict(asdict(manifest)["stats"])
