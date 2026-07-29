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
    PortfolioItem,
    TalentInterest,
    TalentListing,
    User,
    UserContentStyle,
)
from app.models.review import Engagement

from .schema import SCENARIO_NAMES, scenario_id
from .validation import ManifestError, check_version


def _duration_label(seconds: object) -> str | None:
    """Seconds as the product already writes durations: `m:ss`, or `h:mm:ss`.

    The manifest stores an integer so both consumers format it themselves. This
    matches `youtube_service`'s label exactly — a second duration format in the
    same column would be indistinguishable from corrupt data.
    """

    if not isinstance(seconds, int) or seconds <= 0:
        return None
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"

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
        # Both cascade from `users`, but restore is also run against databases
        # where a previous scenario left rows behind, so they are swept by hand
        # in dependency order rather than trusted to the FK.
        await session.execute(delete(PortfolioItem).where(PortfolioItem.user_id.in_(actor_ids)))
        await session.execute(delete(UserContentStyle).where(UserContentStyle.user_id.in_(actor_ids)))
    if actor_ids:
        await session.execute(delete(User).where(User.id.in_(actor_ids)))
    await session.flush()

    # --- actors -------------------------------------------------------------
    #
    # The manifest names its profile fields after the *product* concept, not
    # after a column, because the same file is read by the frontend. So this is
    # a translation, not a copy — and the backend splits talent-side from
    # recruiter-side metadata (`creator_platforms` vs `hiring_platforms`,
    # content style vs `hiring_niches`), which the manifest deliberately does
    # not. Which side an actor's lists belong to is decided here, by `sides`.
    password = hash_password(SCENARIO_PASSWORD)
    for actor in actors:
        hires = "recruiter" in (actor.get("sides") or [])
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
                bio=actor.get("bio"),
                timezone=actor.get("timezone"),
                availability_status=actor.get("availability_status") or "selective",
                availability=actor.get("availability"),
                skills=list(actor.get("skills") or []),
                public_links=list(actor.get("public_links") or []),
                # `collaboration_tools` is one free-text line in the product, so
                # the list is joined rather than silently truncated to its head.
                collaboration_tools=", ".join(actor.get("tools") or []) or None,
                collaboration_turnaround=actor.get("turnaround"),
                collaboration_working_hours=actor.get("working_hours"),
                work_mode=actor.get("work_mode"),
                creator_platforms=[] if hires else list(actor.get("platforms") or []),
                hiring_platforms=list(actor.get("platforms") or []) if hires else [],
                hiring_niches=list(actor.get("niches") or []) if hires else [],
                hiring_formats=list(actor.get("formats") or []) if hires else [],
                hiring_channels_or_pages_managed=actor.get("description") if hires else None,
                hiring_verification_status=actor.get("verification_status") or "unverified",
                # A deactivated account is modelled as suspended, which is what
                # the product actually has — there is no separate `is_active`.
                suspended_at=at if actor.get("deactivated") else None,
                suspension_reason="Deactivated scenario fixture" if actor.get("deactivated") else None,
            )
        )
    await session.flush()

    # A talent's niche and formats live in their content style, which is a
    # separate row. Skipping it left the public profile's "what I make" section
    # empty on the backend path while Mock mode filled it in.
    for actor in actors:
        if "recruiter" in (actor.get("sides") or []):
            continue
        niches = list(actor.get("niches") or [])
        formats = list(actor.get("formats") or [])
        if not niches and not formats:
            continue
        session.add(
            UserContentStyle(
                id=UUID(scenario_id("content-style", actor["id"])),
                user_id=UUID(actor["id"]),
                primary_niche=niches[0] if niches else None,
                format=formats,
                tone=[],
            )
        )
    await session.flush()

    # --- jobs ---------------------------------------------------------------
    #
    # A job carries its hiring identity, because that is what the other side of
    # the marketplace sees. Without it an applicant reviewing their own sent
    # application had no one to look at: the workspace fell back to the literal
    # word "Recruiter" for every recruiter at once. The name is the owner's own
    # display name — the same derivation the Mock consumer uses, and the same
    # person the applicant already messaged, so nothing new is disclosed.
    actor_by_id = {actor["id"]: actor for actor in actors}
    for job in jobs:
        owner = actor_by_id.get(job["owner_id"], {})
        session.add(
            Job(
                id=UUID(job["id"]),
                posted_by_user_id=UUID(job["owner_id"]),
                title=job["title"],
                channel_name=owner.get("display_name"),
                channel_profile_slug=owner.get("username"),
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
                experience_level=job.get("experience"),
                tags=job.get("tags", []),
                # Private prompts the recruiter authored. Restored so the
                # screened path is exercisable against a real backend, not only
                # in Mock.
                screening_questions=job.get("screening_questions") or None,
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
                # The talent context card reads rate, experience and
                # availability off the listing. Leaving them at defaults gave
                # Backend mode a card with a name and nothing else.
                availability_status=actor.get("availability") or "available",
                experience_years=actor.get("experience_years"),
                rate_min=actor.get("rate_min"),
                rate_max=actor.get("rate_max"),
                rate_currency=actor.get("rate_currency") or "INR",
                location=actor.get("location"),
                portfolio_item_ids=[],
                first_message_requirements=[],
                status="published",
                created_at=at,
                updated_at=at,
            )
        )
    await session.flush()

    # Portfolio, indexed so a relationship can carry the *answer* the product
    # reads — `relevant_portfolio` — and not only the ids. Phase 3's portfolio
    # surface reads the answer, so storing ids alone left the backend path
    # showing an empty portfolio while Mock mode showed a full one.
    portfolio_by_id = {item["id"]: item for item in payload.get("portfolio", [])}

    # The same items as real rows. The answer payload above is what an
    # *application* shows; these are what the applicant's own profile shows.
    # Only the first existed, so every canonical profile reached from a review
    # displayed no work at all — on the one page whose entire job is to show it.
    for item in payload.get("portfolio", []):
        owner_id = item.get("owner_id")
        if not owner_id or owner_id not in actor_by_id:
            continue
        session.add(
            PortfolioItem(
                id=UUID(item["id"]),
                user_id=UUID(owner_id),
                source_type="custom",
                source_url=item.get("url"),
                title=item["title"],
                description=item.get("description"),
                contribution_summary=item.get("contribution"),
                role=item.get("role"),
                role_name=item.get("role"),
                media_url=item.get("url"),
                thumbnail_url=item.get("thumbnail_url"),
                duration=_duration_label(item.get("duration_seconds")),
                tools=list(item.get("tools") or []),
                platforms=[item["platform"]] if item.get("platform") else [],
                formats=[item["format"]] if item.get("format") else [],
                content_niches=[item["niche"]] if item.get("niche") else [],
                visibility="public",
                is_public=True,
                publish_status="published",
                portfolio_status="now",
                status="now",
                created_at=at,
                updated_at=at,
            )
        )
    await session.flush()

    def _first_message_answers(rel: dict[str, Any]) -> dict[str, Any]:
        """Everything the requester submitted, in one field.

        `relevant_portfolio` is derived from the attached ids rather than stored
        twice; the rest come straight from the manifest. Both live in the same
        column because that is where the product reads them from.
        """

        answers = dict(rel.get("answers") or {})
        if rel.get("portfolio_ids"):
            answers["relevant_portfolio"] = _portfolio_answer(rel)
        return answers

    def _applicant_snapshot(talent_id: str) -> dict[str, Any]:
        actor = actor_by_id.get(talent_id, {})
        return {
            "display_name": actor.get("display_name"),
            "username": actor.get("username"),
            "user_id": talent_id,
            "headline": actor.get("headline"),
            "location": actor.get("location"),
        }

    def _portfolio_answer(rel: dict[str, Any]) -> list[dict[str, Any]]:
        entries = []
        for item_id in rel.get("portfolio_ids", []):
            item = portfolio_by_id.get(item_id)
            if not item:
                continue
            entries.append(
                {
                    "id": item["id"],
                    "title": item["title"],
                    "url": item.get("url"),
                    "thumbnail_url": item.get("thumbnail_url"),
                    "duration": item.get("duration_seconds"),
                    "platform": item.get("platform"),
                    "format": item.get("format"),
                    "niche": item.get("niche"),
                    "role": item.get("role"),
                }
            )
        return entries

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
                    first_message_answers=_first_message_answers(rel),
                    # What the product records about the applicant at the moment
                    # they applied. A name alone left the recruiter's context
                    # card with a heading and nothing under it.
                    applicant_snapshot=_applicant_snapshot(rel["talent_id"]),
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
                    first_message_answers=_first_message_answers(rel),
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
                    # Archive is per participant. Writing only the record and
                    # not this left an archived scenario looking unarchived on
                    # the backend path.
                    participant_a_archived_at=updated if rel.get("archived") else None,
                    participant_b_archived_at=updated if rel.get("archived") else None,
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
                        # The curated structured payload for the message kinds
                        # the Inbox renders natively — the screening question
                        # snapshot and the answers to it. Everything else keeps
                        # an empty metadata object, exactly as a plain message
                        # posted through the service would.
                        metadata_json=message.get("metadata") or {},
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
