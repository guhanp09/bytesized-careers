"""The backend consumer.

Reads a generated manifest and writes it into a disposable local database. It
authors no content — every fact comes from the manifest, which is the same file
frontend Mock mode reads.

**Historical states are inserted directly, deliberately.** Driving these records
through the real transition service would be the purist choice and the wrong
one: a scenario needs a *disputed payment on a completed engagement* to exist,
not to be arrived at, and forcing the journey would fire notifications nobody
asked for, take minutes instead of seconds, and — for the legacy Shortlisted and
conflict fixtures — be impossible, since the current rules cannot produce them.
That is exactly why those records are worth seeding.

Every direct insertion is listed in `DIRECT_INSERTIONS` below so the exception
is documented rather than discovered. Nothing here weakens the production
authorization or transition services; it writes rows beside them.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models import (
    Conversation,
    Job,
    JobApplication,
    Message,
    TalentInterest,
    TalentListing,
    User,
)
from app.models.review import Engagement

from .schema import SCENARIO_NAMES, scenario_id
from .validation import ManifestError, check_version

#: Where the committed manifests live, relative to this package.
MANIFEST_DIR = Path(__file__).resolve().parents[4] / "fixtures" / "creator_scenarios" / "generated"

#: Documented direct insertions — states written straight to the tables rather
#: than reached through the transition service, and why each one has to be.
DIRECT_INSERTIONS: dict[str, str] = {
    "application.status": (
        "Historical stages including the retired 'shortlisted' are written directly. "
        "APPLICATION_TRANSITIONS no longer offers Shortlisted as a target, so a legacy "
        "row cannot be reached by any sequence of legal moves."
    ),
    "application.participant_status": (
        "A private decision is a status the counterparty was never told. Reaching it "
        "through the service would send the notification the fixture exists to show absent."
    ),
    "engagement.payment_state": (
        "No endpoint writes payment state — by design, since there is no payment "
        "processing. The column is populated directly so the read-only UI has data."
    ),
    "engagement.status": (
        "Engagement states are seeded at their target value rather than walked through "
        "start/completion requests, which would need both participants and emit reminders."
    ),
    "talent_listing": (
        "A hiring request is legally about a talent listing — talent_interests.talent_listing_id "
        "is NOT NULL. The manifest models the relationship, not the container, so the restore "
        "materialises one empty listing per talent who receives a request. It carries no scenario "
        "content: every fact the QA session looks at still comes from the manifest."
    ),
    "conversation.messages": (
        "Message history is inserted with its own timestamps. Sending through the "
        "messaging service would stamp everything 'now' and destroy the ordering the "
        "scenario is demonstrating."
    ),
}

#: A fixed password for every generated actor. These accounts only ever exist in
#: a disposable local database; the environment gate is what keeps them there.
SCENARIO_PASSWORD = "ScenarioQa123!"


def load_manifest(scenario: str, directory: Path | None = None) -> dict[str, Any]:
    """Read and version-check a manifest. Never falls back to another scenario."""

    if scenario not in SCENARIO_NAMES:
        raise KeyError(f"Unknown scenario {scenario!r}. Known: {', '.join(SCENARIO_NAMES)}")
    path = (directory or MANIFEST_DIR) / f"{scenario}.json"
    if not path.exists():
        raise ManifestError(
            f"No generated manifest for {scenario!r}. "
            "Run: python -m app.db.creator_scenarios"
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    check_version(int(payload.get("version", -1)))
    return payload


def _instant(anchor: datetime, offset_seconds: int | None) -> datetime | None:
    if offset_seconds is None:
        return None
    return anchor + timedelta(seconds=offset_seconds)


async def restore_manifest(
    session: AsyncSession,
    scenario: str,
    *,
    anchor: datetime | None = None,
    directory: Path | None = None,
) -> dict[str, object]:
    """Write one scenario into the database, replacing any previous run of it.

    Repeat-safe: every identifier is deterministic, so restoring twice reaches
    the same state rather than doubling the data. That matters because a QA
    session restores repeatedly.
    """

    payload = load_manifest(scenario, directory)
    # Restore-time anchor by default, so a developer sees "4h ago" rather than a
    # date from whenever the manifest was generated.
    at = anchor or datetime.now(UTC)

    actors = payload.get("actors", [])
    jobs = payload.get("jobs", [])
    relationships = payload.get("relationships", [])

    actor_ids = [UUID(actor["id"]) for actor in actors]
    job_ids = [UUID(job["id"]) for job in jobs]
    rel_ids = [UUID(rel["id"]) for rel in relationships]

    # --- clear this scenario's previous rows, in dependency order -----------
    if rel_ids:
        await session.execute(delete(Engagement).where(Engagement.source_record_id.in_(rel_ids)))
        # A conversation points at whichever record it belongs to, so both
        # columns have to be swept — a hiring request's thread is not reachable
        # through application_id.
        conversation_ids = select(Conversation.id).where(
            (Conversation.application_id.in_(rel_ids)) | (Conversation.talent_interest_id.in_(rel_ids))
        )
        await session.execute(delete(Message).where(Message.conversation_id.in_(conversation_ids)))
        await session.execute(
            delete(Conversation).where(
                (Conversation.application_id.in_(rel_ids))
                | (Conversation.talent_interest_id.in_(rel_ids))
            )
        )
        await session.execute(delete(JobApplication).where(JobApplication.id.in_(rel_ids)))
        await session.execute(delete(TalentInterest).where(TalentInterest.id.in_(rel_ids)))
    if job_ids:
        await session.execute(delete(Job).where(Job.id.in_(job_ids)))
    if actor_ids:
        await session.execute(delete(TalentListing).where(TalentListing.owner_user_id.in_(actor_ids)))
    if actor_ids:
        await session.execute(delete(User).where(User.id.in_(actor_ids)))
    await session.flush()

    # --- actors -------------------------------------------------------------
    password = hash_password(SCENARIO_PASSWORD)
    for actor in actors:
        session.add(
            User(
                id=UUID(actor["id"]),
                email=actor["email"],
                username=actor["username"],
                display_name=actor["display_name"],
                password_hash=password,
                email_verified_at=at,
                headline=actor.get("headline"),
                avatar_url=actor.get("avatar_url"),
                location=actor.get("location"),
                # A deactivated account is modelled as suspended, which is what
                # the product actually has — there is no separate `is_active`.
                suspended_at=at if actor.get("deactivated") else None,
                suspension_reason="Deactivated scenario fixture" if actor.get("deactivated") else None,
            )
        )
    await session.flush()

    # --- jobs ---------------------------------------------------------------
    for job in jobs:
        session.add(
            Job(
                id=UUID(job["id"]),
                posted_by_user_id=UUID(job["owner_id"]),
                title=job["title"],
                platforms=job.get("platforms", []),
                formats_hired_for=job.get("formats", []),
                content_niches=job.get("niches", []),
                turnaround_value=job.get("turnaround_value"),
                turnaround_unit=job.get("turnaround_unit"),
                turnaround_basis=job.get("turnaround_basis"),
                compensation_mode=job.get("compensation_mode"),
                budget_amount=job.get("compensation_min"),
                budget_max=job.get("compensation_max"),
                budget_currency=job.get("compensation_currency"),
                budget_unit=job.get("compensation_unit"),
                location=job.get("location"),
                work_mode=job.get("work_mode"),
                status="published" if job.get("status") != "closed" else "closed",
                created_at=_instant(at, job.get("posted_offset", -86_400)),
            )
        )
    await session.flush()

    # --- talent listings ----------------------------------------------------
    #
    # See DIRECT_INSERTIONS["talent_listing"]: a structural container the table
    # requires, not scenario content.
    listing_for: dict[str, UUID] = {}
    needs_listing = {rel["talent_id"] for rel in relationships if rel["kind"] != "application"}
    for actor in actors:
        if actor["id"] not in needs_listing:
            continue
        listing_id = UUID(scenario_id("talent_listing", scenario, actor["id"]))
        listing_for[actor["id"]] = listing_id
        session.add(
            TalentListing(
                id=listing_id,
                owner_user_id=UUID(actor["id"]),
                title=actor.get("headline") or f"{actor['display_name']} — available for work",
                roles=[],
                content_niches=[],
                content_genres=[],
                formats=[],
                platforms=[],
                tools=[],
                languages=[],
                availability_status="available",
                rate_currency="INR",
                portfolio_item_ids=[],
                first_message_requirements=[],
                status="published",
                created_at=at,
                updated_at=at,
            )
        )
    await session.flush()

    counts = {"actors": len(actors), "jobs": len(jobs), "applications": 0, "hiring_requests": 0,
              "conversations": 0, "messages": 0, "engagements": 0}

    # --- relationships ------------------------------------------------------
    #
    # Two passes, on purpose. A conversation references its application, and an
    # engagement references both — relying on the ORM to work the order out from
    # one batch is how this failed the first time. Applications and interests
    # land and are flushed first; everything that points at them follows.
    for rel in relationships:
        rel_id = UUID(rel["id"])
        created = _instant(at, rel["created_offset"])
        updated = _instant(at, rel["updated_offset"])
        if rel["kind"] == "application":
            session.add(
                JobApplication(
                    id=rel_id,
                    job_id=UUID(rel["job_id"]),
                    applicant_user_id=UUID(rel["talent_id"]),
                    job_owner_user_id=UUID(rel["recruiter_id"]),
                    cover_note=rel.get("cover_note"),
                    portfolio_item_ids=rel.get("portfolio_ids", []),
                    applicant_snapshot={},
                    # Direct: see DIRECT_INSERTIONS["application.status"].
                    status=rel["stage"],
                    participant_status=rel.get("participant_stage") or rel["stage"],
                    manager_note=rel.get("manager_note"),
                    created_at=created,
                    updated_at=updated,
                )
            )
            counts["applications"] += 1
        else:
            session.add(
                TalentInterest(
                    id=rel_id,
                    talent_listing_id=listing_for[rel["talent_id"]],
                    recruiter_user_id=UUID(rel["recruiter_id"]),
                    owner_user_id=UUID(rel["talent_id"]),
                    note=rel.get("cover_note"),
                    status=rel["stage"],
                    participant_status=rel.get("participant_stage") or rel["stage"],
                    created_at=created,
                    updated_at=updated,
                )
            )
            counts["hiring_requests"] += 1

    await session.flush()

    for rel in relationships:
        rel_id = UUID(rel["id"])
        created = _instant(at, rel["created_offset"])
        updated = _instant(at, rel["updated_offset"])
        messages = rel.get("messages") or []
        if rel.get("conversation_id"):
            session.add(
                Conversation(
                    id=UUID(rel["conversation_id"]),
                    context_type="job_application" if rel["kind"] == "application" else "talent_interest",
                    application_id=rel_id if rel["kind"] == "application" else None,
                    talent_interest_id=rel_id if rel["kind"] != "application" else None,
                    job_id=UUID(rel["job_id"]) if rel.get("job_id") else None,
                    participant_a_user_id=UUID(rel["recruiter_id"]),
                    participant_b_user_id=UUID(rel["talent_id"]),
                    created_at=created,
                    updated_at=updated,
                )
            )
            counts["conversations"] += 1
            for message in messages:
                session.add(
                    Message(
                        id=UUID(message["id"]),
                        conversation_id=UUID(message["conversation_id"]),
                        sender_user_id=UUID(message["sender_id"]) if message.get("sender_id") else None,
                        body=message["body"],
                        # Direct: see DIRECT_INSERTIONS["conversation.messages"].
                        created_at=_instant(at, message["offset_seconds"]),
                    )
                )
                counts["messages"] += 1

        engagement = rel.get("engagement")
        if engagement:
            session.add(
                Engagement(
                    id=UUID(engagement["id"]),
                    source_type="job_application" if rel["kind"] == "application" else "talent_interest",
                    source_record_id=rel_id,
                    application_id=rel_id if rel["kind"] == "application" else None,
                    talent_interest_id=rel_id if rel["kind"] != "application" else None,
                    recruiter_user_id=UUID(rel["recruiter_id"]),
                    talent_user_id=UUID(rel["talent_id"]),
                    context_snapshot={},
                    # Direct: see DIRECT_INSERTIONS["engagement.status"] and
                    # DIRECT_INSERTIONS["engagement.payment_state"].
                    status=engagement["state"],
                    payment_state=engagement.get("payment_state"),
                    payment_note=engagement.get("payment_note"),
                    payment_state_updated_at=_instant(at, engagement.get("payment_offset")),
                    started_at=_instant(at, engagement.get("started_offset")),
                    finalized_at=_instant(at, engagement.get("completed_offset")),
                )
            )
            counts["engagements"] += 1

    await session.flush()
    return {
        "scenario": scenario,
        "manifest_version": payload["version"],
        "seed": payload.get("seed"),
        **counts,
        "direct_insertions": sorted(DIRECT_INSERTIONS),
    }
