"""The one generator.

Everything a scenario contains is produced here: pools, hero journeys, bulk
records and edge overrides. There is no second implementation anywhere in the
repository, which is the property this whole phase exists to establish.

Determinism is structural rather than careful. `random.Random(seed)` is drawn
from in a fixed order, identifiers come from `scenario_id(...)` keyed by meaning
rather than by position, and every collection is emitted sorted. That means the
same seed produces a byte-identical file, and — more usefully — that adding a
scenario or a pool entry does not renumber the records in the others.
"""

from __future__ import annotations

import json
import random
from dataclasses import asdict
from pathlib import Path
from typing import Any

from . import pools
from .heroes import DAY, HEROES, HOUR, MINUTE
from .schema import (
    MANIFEST_VERSION,
    SCENARIO_NAMES,
    Actor,
    ClientState,
    Engagement,
    IndexEntry,
    Interview,
    Job,
    Manifest,
    Message,
    PortfolioItem,
    Relationship,
    scenario_id,
)

#: One seed per scenario. Fixed constants rather than a derived value so a
#: scenario's content cannot shift because an unrelated one was added.
SCENARIO_SEEDS: dict[str, int] = {
    "empty": 1_000,
    "default": 2_000,
    "busy": 3_000,
    "edge": 4_000,
    "talent": 5_000,
    "recruiter": 6_000,
}

#: The two retired job identifiers. Reused rather than replaced: the codebase
#: already treats these as the canonical closed-job fixtures, and inventing new
#: ones would leave the real constants untested.
RETIRED_JOB_KEYS: tuple[str, ...] = ("job_25", "job_26")


class Builder:
    """Accumulates one scenario. Not reused across scenarios."""

    def __init__(self, scenario: str, seed: int, description: str) -> None:
        self.scenario = scenario
        self.seed = seed
        self.description = description
        self.rng = random.Random(seed)
        self.actors: dict[str, Actor] = {}
        self.jobs: list[Job] = []
        self.portfolio: list[PortfolioItem] = []
        #: Portfolio already built per owner. A person has one portfolio, not
        #: one per application, so a second call reuses it rather than minting
        #: duplicate ids for the same work.
        self._portfolio_by_owner: dict[str, list[str]] = {}
        self.relationships: list[Relationship] = []
        self.client_state: list[ClientState] = []
        self.index: list[IndexEntry] = []

    # --- actors -------------------------------------------------------------

    def recruiter(self, slot: int) -> Actor:
        handle, name, kind, subs, cadence = pools.CHANNELS[slot % len(pools.CHANNELS)]
        actor_id = scenario_id("actor", self.scenario, "recruiter", slot)
        if actor_id not in self.actors:
            self.actors[actor_id] = Actor(
                id=actor_id,
                username=f"{handle}",
                display_name=name,
                email=f"{handle}@scenario.invalid",
                sides=["recruiter"],
                employer_kind=kind,
                channel_handle=handle,
                subscribers=subs,
                upload_cadence=cadence,
                location=pools.LOCATIONS[slot % len(pools.LOCATIONS)][0],
            )
        return self.actors[actor_id]

    def talent(self, slot: int, *, name: str | None = None, deactivated: bool = False) -> Actor:
        actor_id = scenario_id("actor", self.scenario, "talent", slot)
        if actor_id not in self.actors:
            first = pools.FIRST_NAMES[slot % len(pools.FIRST_NAMES)]
            last = pools.LAST_NAMES[(slot // len(pools.FIRST_NAMES) + slot) % len(pools.LAST_NAMES)]
            display = name or f"{first} {last}"
            role = pools.ROLES[slot % len(pools.ROLES)]
            location, _ = pools.LOCATIONS[slot % len(pools.LOCATIONS)]
            self.actors[actor_id] = Actor(
                id=actor_id,
                username=f"talent{slot:03d}",
                display_name=display,
                email=f"talent{slot:03d}@scenario.invalid",
                sides=["talent"],
                headline=f"{role} for creator-led channels",
                location=location,
                # Every fourth profile has no avatar, so the initials fallback is
                # exercised routinely rather than only in the edge scenario.
                avatar_url=None if slot % 4 == 0 else f"https://avatars.scenario.invalid/{slot:03d}.jpg",
                deactivated=deactivated,
            )
        return self.actors[actor_id]

    # --- jobs ---------------------------------------------------------------

    def job(self, owner: Actor, slot: int, *, status: str = "published", legacy_key: str | None = None) -> Job:
        role = pools.ROLES[slot % len(pools.ROLES)]
        platform = pools.PLATFORMS[slot % len(pools.PLATFORMS)]
        formats = list(pools.PLATFORM_FORMATS.get(platform, ("Long-form video",)))[:2]
        niche = pools.NICHES[slot % len(pools.NICHES)]
        unit, currency, low, high = pools.COMMERCIAL_STRUCTURES[slot % len(pools.COMMERCIAL_STRUCTURES)]
        value, tunit, basis = pools.TURNAROUNDS[slot % len(pools.TURNAROUNDS)]
        location, _ = pools.LOCATIONS[slot % len(pools.LOCATIONS)]
        job = Job(
            id=scenario_id("job", self.scenario, legacy_key or slot),
            owner_id=owner.id,
            title=f"{role} for {niche.lower()} channel",
            platforms=[platform],
            formats=formats,
            niches=[niche],
            turnaround_value=value,
            turnaround_unit=tunit,
            turnaround_basis=basis,
            compensation_mode="range" if high else "fixed",
            compensation_min=float(low),
            compensation_max=float(high) if high else None,
            compensation_currency=currency,
            compensation_unit=unit,
            location=location,
            work_mode=pools.WORK_MODES[slot % len(pools.WORK_MODES)],
            experience=("1–3 years", "2–4 years", "3–5 years")[slot % 3],
            status=status,
            posted_offset=-((slot % 30) + 1) * DAY,
            tags=[formats[0], niche],
            legacy_key=legacy_key,
        )
        self.jobs.append(job)
        return job

    # --- portfolio ----------------------------------------------------------

    def portfolio_for(self, owner: Actor, count: int, *, slot: int, quirk: str | None = None) -> list[str]:
        existing = self._portfolio_by_owner.get(owner.id, [])
        if len(existing) >= count:
            # Applying to a second job attaches the same work, which is both
            # what really happens and what keeps ids unique.
            return existing[:count]
        ids: list[str] = list(existing)
        for index in range(len(existing), count):
            item_id = scenario_id("portfolio", self.scenario, owner.id, index)
            title = pools.PORTFOLIO_TITLES[(slot + index) % len(pools.PORTFOLIO_TITLES)]
            media = ("video", "video", "image", "link")[(slot + index) % 4]
            platform = pools.PLATFORMS[(slot + index) % len(pools.PLATFORMS)]
            # A third of items carry no thumbnail at all, which is the ordinary
            # case for an application's `relevant_portfolio` answer and the
            # reason the deterministic posters exist.
            has_thumb = (slot + index) % 3 != 0
            broken = quirk == "broken_thumbnail" and index == 0
            self.portfolio.append(
                PortfolioItem(
                    id=item_id,
                    owner_id=owner.id,
                    title=title,
                    media=media,
                    url=None if media == "link" and index % 5 == 4 else f"https://work.scenario.invalid/{item_id[:8]}",
                    thumbnail_url=(
                        f"https://thumbs.scenario.invalid/broken/{item_id[:8]}.jpg"
                        if broken
                        else (f"https://thumbs.scenario.invalid/{item_id[:8]}.jpg" if has_thumb else None)
                    ),
                    thumbnail_broken=broken,
                    duration_seconds=(180 + (slot + index) * 37) % 3600 if media == "video" else None,
                    platform=platform,
                    format=pools.PLATFORM_FORMATS.get(platform, ("Long-form video",))[0],
                    niche=pools.NICHES[(slot + index) % len(pools.NICHES)],
                    role=pools.PORTFOLIO_ROLES[(slot + index) % len(pools.PORTFOLIO_ROLES)],
                )
            )
            ids.append(item_id)
        self._portfolio_by_owner[owner.id] = ids
        return ids

    # --- relationships ------------------------------------------------------

    def relationship(
        self,
        *,
        key: str,
        kind: str,
        job: Job | None,
        recruiter: Actor,
        talent: Actor,
        stage: str,
        participant_stage: str | None,
        created: int,
        updated: int | None = None,
        messages: list[tuple[str, int, str]] | None = None,
        portfolio_ids: list[str] | None = None,
        **extra: Any,
    ) -> Relationship:
        rel_id = scenario_id("relationship", self.scenario, key)
        conversation_id = scenario_id("conversation", self.scenario, key)
        built: list[Message] = []
        for index, (who, offset, body) in enumerate(messages or []):
            sender = recruiter.id if who == "recruiter" else (talent.id if who == "talent" else None)
            built.append(
                Message(
                    id=scenario_id("message", self.scenario, key, index),
                    conversation_id=conversation_id,
                    sender_id=sender,
                    body=body,
                    offset_seconds=offset,
                    kind="status" if who == "system" else "text",
                    read=True,
                )
            )
        rel = Relationship(
            id=rel_id,
            kind=kind,
            job_id=job.id if job else None,
            recruiter_id=recruiter.id,
            talent_id=talent.id,
            stage=stage,
            participant_stage=participant_stage,
            created_offset=created,
            updated_offset=updated if updated is not None else (built[-1].offset_seconds if built else created),
            conversation_id=conversation_id,
            messages=built,
            portfolio_ids=portfolio_ids or [],
            **extra,
        )
        self.relationships.append(rel)
        return rel

    def add_index(
        self,
        rel: Relationship,
        *,
        persona: str,
        route: str,
        condition: str,
        action: str,
    ) -> None:
        self.index.append(
            IndexEntry(
                scenario=self.scenario,
                persona=persona,
                route=route,
                job_id=rel.job_id,
                relationship_id=rel.id,
                conversation_id=rel.conversation_id,
                expected_stage=rel.stage,
                expected_condition=condition,
                action_to_test=action,
            )
        )

    # --- output -------------------------------------------------------------

    def build(self) -> Manifest:
        stage_counts: dict[str, int] = {}
        for rel in self.relationships:
            stage_counts[rel.stage] = stage_counts.get(rel.stage, 0) + 1
        payment_counts: dict[str, int] = {}
        for rel in self.relationships:
            if rel.engagement and rel.engagement.payment_state:
                payment_counts[rel.engagement.payment_state] = (
                    payment_counts.get(rel.engagement.payment_state, 0) + 1
                )
        return Manifest(
            version=MANIFEST_VERSION,
            scenario=self.scenario,
            seed=self.seed,
            description=self.description,
            actors=sorted(self.actors.values(), key=lambda a: a.id),
            jobs=sorted(self.jobs, key=lambda j: j.id),
            portfolio=sorted(self.portfolio, key=lambda p: p.id),
            relationships=sorted(self.relationships, key=lambda r: r.id),
            client_state=sorted(self.client_state, key=lambda c: c.id),
            index=sorted(self.index, key=lambda e: (e.relationship_id, e.expected_condition)),
            stats={
                "actors": len(self.actors),
                "jobs": len(self.jobs),
                "portfolio_items": len(self.portfolio),
                "relationships": len(self.relationships),
                "conversations": sum(1 for r in self.relationships if r.conversation_id),
                "messages": sum(len(r.messages) for r in self.relationships),
                "applications": sum(1 for r in self.relationships if r.kind == "application"),
                "hiring_requests": sum(1 for r in self.relationships if r.kind == "hiring_request"),
                "interviews": sum(1 for r in self.relationships if r.interview),
                "engagements": sum(1 for r in self.relationships if r.engagement),
                "stages": dict(sorted(stage_counts.items())),
                "payment_states": dict(sorted(payment_counts.items())),
                "client_state": len(self.client_state),
            },
        )


# --- hero placement ---------------------------------------------------------


def _place_heroes(builder: Builder, *, recruiter_slot: int = 0) -> None:
    """Lay every hand-authored journey into the scenario."""

    recruiter = builder.recruiter(recruiter_slot)
    for index, hero in enumerate(HEROES):
        talent = builder.talent(200 + index)
        job = builder.job(recruiter, index) if hero["kind"] == "application" else None
        portfolio_ids = builder.portfolio_for(talent, int(hero.get("portfolio", 0)), slot=index)
        extra: dict[str, Any] = {}
        if hero.get("starred"):
            extra["starred"] = True
        if hero.get("manager_note"):
            extra["manager_note"] = hero["manager_note"]
        if hero.get("historical"):
            extra["historical"] = hero["historical"]
        if hero.get("unread"):
            extra["unread"] = int(hero["unread"])
        if hero.get("cover_note"):
            extra["cover_note"] = hero["cover_note"]

        rel = builder.relationship(
            key=f"hero:{hero['key']}",
            kind=str(hero["kind"]),
            job=job,
            recruiter=recruiter,
            talent=talent,
            stage=str(hero["stage"]),
            participant_stage=hero.get("participant_stage"),
            created=int(hero["created"]),
            messages=list(hero.get("messages", [])),
            portfolio_ids=portfolio_ids,
            **extra,
        )
        if hero.get("interview"):
            spec = hero["interview"]
            rel.interview = Interview(
                id=scenario_id("interview", builder.scenario, hero["key"]),
                relationship_id=rel.id,
                state=str(spec["state"]),
                scheduled_offset=int(spec["scheduled"]),
                detail=spec.get("detail"),
                note=spec.get("note"),
            )
        if hero.get("engagement"):
            spec = hero["engagement"]
            rel.engagement = Engagement(
                id=scenario_id("engagement", builder.scenario, hero["key"]),
                relationship_id=rel.id,
                state=str(spec["state"]),
                payment_state=spec.get("payment_state"),
                payment_note=spec.get("payment_note"),
                payment_offset=spec.get("payment_offset", -2 * DAY),
                started_offset=spec.get("started"),
                completed_offset=spec.get("completed"),
            )
        builder.add_index(
            rel,
            persona="recruiter" if hero["kind"] == "application" else "talent",
            route="/applications?view=inbox&mode=recruiter"
            if hero["kind"] == "application"
            else "/applications?view=inbox&mode=talent",
            condition=str(hero["condition"]),
            action=str(hero["action"]),
        )


def _bulk(
    builder: Builder,
    *,
    count: int,
    job: Job,
    recruiter: Actor,
    stage_cycle: tuple[str, ...],
    talent_base: int,
    key_prefix: str,
    with_messages: bool = True,
    salt: int = 0,
) -> None:
    """Volume. Varied enough to be believable, deterministic enough to diff."""

    for index in range(count):
        talent = builder.talent(talent_base + index)
        stage = stage_cycle[index % len(stage_cycle)]
        created = -((index % 45) + 1) * DAY - (index % 11) * HOUR
        messages: list[tuple[str, int, str]] = []
        if with_messages:
            messages.append(
                ("talent", created, pools.APPLICANT_OPENERS[index % len(pools.APPLICANT_OPENERS)])
            )
            if index % 3 == 0:
                messages.append(
                    ("recruiter", created + 6 * HOUR, pools.RECRUITER_FOLLOWUPS[index % len(pools.RECRUITER_FOLLOWUPS)])
                )
            if index % 5 == 0:
                messages.append(
                    ("talent", created + 9 * HOUR, pools.TALENT_FOLLOWUPS[index % len(pools.TALENT_FOLLOWUPS)])
                )
        portfolio_count = (0, 1, 2, 3, 5, 8)[index % 6]
        portfolio_ids = builder.portfolio_for(talent, portfolio_count, slot=index)
        rel = builder.relationship(
            key=f"{key_prefix}:{index}",
            kind="application",
            job=job,
            recruiter=recruiter,
            talent=talent,
            stage=stage,
            # A private decision is exactly a stage the counterparty has not
            # been given, so every fourth rejection is deliberately unshared.
            participant_stage="reviewing" if stage == "rejected" and index % 4 == 0 else stage,
            created=created,
            messages=messages,
            portfolio_ids=portfolio_ids,
            starred=index % 9 == 0,
            snoozed_offset=2 * DAY if index % 13 == 0 else None,
            unread=1 if index % 7 == 0 else 0,
            archived=stage == "archived",
        )
        if stage == "hired":
            # Salted: "hired" lands at a fixed position in the stage cycle, so
            # without this every job would produce the same payment state and
            # the coverage would collapse to one value.
            payment = ("funded", "work_in_progress", "released", "not_applicable", "funding_pending")[
                (index + salt) % 5
            ]
            rel.engagement = Engagement(
                id=scenario_id("engagement", builder.scenario, f"{key_prefix}:{index}"),
                relationship_id=rel.id,
                state=(
                    "active"
                    if payment in {"funded", "work_in_progress"}
                    else ("ready_to_start", "completion_pending", "completed")[(index + salt) % 3]
                ),
                payment_state=payment,
                payment_offset=-3 * DAY,
                started_offset=created + 3 * DAY,
            )
        if stage == "interviewing":
            rel.interview = Interview(
                id=scenario_id("interview", builder.scenario, f"{key_prefix}:{index}"),
                relationship_id=rel.id,
                state="confirmed" if index % 2 == 0 else "proposed",
                scheduled_offset=(index % 6 + 1) * DAY,
                detail=f"https://meet.scenario.invalid/{index:03d}",
            )


# --- the six scenarios ------------------------------------------------------


def _empty(builder: Builder) -> None:
    """Enough identity to load the app, and nothing else.

    The trap this guards is a scenario that looks empty but is not: an archived
    record, a snoozed one, a stale draft — anything that keeps a queue count
    non-zero and stops the genuine empty states ever being seen.
    """

    builder.recruiter(0)
    builder.talent(0)


def _default(builder: Builder) -> None:
    """A broad, realistic dataset for ordinary design and workflow QA."""

    _place_heroes(builder)
    stage_cycle = (
        "new", "reviewing", "interviewing", "hired", "rejected",
        "new", "reviewing", "withdrawn", "archived", "reviewing",
    )
    # Sixteen jobs across four recruiters, so per-job summaries and the job
    # filter have something real to group.
    job_index = 100
    for recruiter_slot in range(4):
        recruiter = builder.recruiter(recruiter_slot)
        for offset in range(4):
            job = builder.job(recruiter, job_index)
            _bulk(
                builder,
                count=9,
                job=job,
                recruiter=recruiter,
                stage_cycle=stage_cycle,
                talent_base=1_000 + job_index * 20,
                key_prefix=f"default:{job_index}",
                salt=job_index,
            )
            job_index += 1

    # Outbound requests, so the Talent side of `default` is not an afterthought.
    recruiter = builder.recruiter(0)
    for index in range(24):
        talent = builder.talent(5_000 + index)
        stage = ("new", "reviewing", "accepted", "declined", "withdrawn", "archived")[index % 6]
        created = -((index % 30) + 1) * DAY
        rel = builder.relationship(
            key=f"default:request:{index}",
            kind="hiring_request",
            job=None,
            recruiter=recruiter,
            talent=talent,
            stage=stage,
            participant_stage=stage,
            created=created,
            messages=[("recruiter", created, pools.RECRUITER_OPENERS[index % len(pools.RECRUITER_OPENERS)])],
            unread=1 if index % 4 == 0 else 0,
        )
        if index == 0:
            builder.add_index(
                rel,
                persona="talent",
                route="/applications?view=inbox&mode=talent",
                condition="Inbound hiring request awaiting a reply",
                action="Reply and confirm the request leaves the needs-you queue.",
            )

    _retired_jobs(builder)


def _busy(builder: Builder) -> None:
    """A studio's workload: the volume cases, and the counting cases."""

    recruiter = builder.recruiter(7)  # Pixelforge Studio
    stage_cycle = ("new", "reviewing", "interviewing", "rejected", "new", "reviewing")

    # The pagination case. 214 applicants on one job, which is the number the
    # incremental-loading test measures against.
    big = builder.job(recruiter, 300)
    _bulk(
        builder, count=214, job=big, recruiter=recruiter, stage_cycle=stage_cycle,
        talent_base=10_000, key_prefix="busy:big", with_messages=False,
    )
    builder.add_index(
        builder.relationships[-1],
        persona="recruiter",
        route="/applications?view=pipeline&mode=recruiter",
        condition="Job carrying 214 applicants",
        action="Confirm the board loads incrementally rather than rendering every applicant.",
    )

    # The counting cases: 47, exactly one, and zero.
    mid = builder.job(recruiter, 301)
    _bulk(builder, count=47, job=mid, recruiter=recruiter, stage_cycle=stage_cycle,
          talent_base=20_000, key_prefix="busy:mid")
    single = builder.job(recruiter, 302)
    _bulk(builder, count=1, job=single, recruiter=recruiter, stage_cycle=("new",),
          talent_base=30_000, key_prefix="busy:one")
    builder.job(recruiter, 303)  # zero applicants, deliberately

    # A fifth job so the recruiter is running five at once.
    fifth = builder.job(recruiter, 304)
    _bulk(builder, count=12, job=fifth, recruiter=recruiter, stage_cycle=stage_cycle,
          talent_base=40_000, key_prefix="busy:fifth")

    # A conversation long enough to test message virtualisation and scrolling.
    # On its own job: attaching it to `mid` would quietly make the deliberate
    # 47-applicant case a 48-applicant one.
    long_job = builder.job(recruiter, 305)
    talent = builder.talent(50_000)
    long_messages: list[tuple[str, int, str]] = []
    for turn in range(44):
        who = "talent" if turn % 2 == 0 else "recruiter"
        pool = pools.TALENT_FOLLOWUPS if who == "talent" else pools.RECRUITER_FOLLOWUPS
        long_messages.append((who, -30 * DAY + turn * 3 * HOUR, pool[turn % len(pool)]))
    rel = builder.relationship(
        key="busy:long-thread",
        kind="application",
        job=long_job,
        recruiter=recruiter,
        talent=talent,
        stage="interviewing",
        participant_stage="interviewing",
        created=-30 * DAY,
        messages=long_messages,
        portfolio_ids=builder.portfolio_for(talent, 9, slot=3),
        unread=17,
    )
    builder.add_index(
        rel, persona="recruiter", route="/applications?view=inbox&mode=recruiter",
        condition="Conversation with 44 messages and 17 unread",
        action="Scroll the thread and confirm it stays responsive.",
    )
    _payment_coverage(builder)
    _retired_jobs(builder)


def _edge(builder: Builder) -> None:
    """Identity, content, conflict and error cases, concentrated."""

    recruiter = builder.recruiter(2)
    job = builder.job(recruiter, 400)

    # Names that break layout and identity handling.
    for index, (name, why) in enumerate(pools.EDGE_NAMES):
        talent = builder.talent(60_000 + index, name=name, deactivated=(index == 3))
        rel = builder.relationship(
            key=f"edge:name:{index}",
            kind="application",
            job=job,
            recruiter=recruiter,
            talent=talent,
            stage="reviewing",
            participant_stage="reviewing",
            created=-(index + 1) * DAY,
            messages=[("talent", -(index + 1) * DAY, "Applying for this role — samples attached.")],
            portfolio_ids=builder.portfolio_for(talent, index % 3, slot=index),
        )
        builder.add_index(rel, persona="recruiter",
                          route="/applications?view=pipeline&mode=recruiter",
                          condition=why, action="Check the name renders without breaking the card.")

    # The duplicate-name case needs a *second* record, not a second name.
    dup = builder.talent(60_100, name="Priya Nair")
    builder.relationship(
        key="edge:duplicate-name",
        kind="application", job=job, recruiter=recruiter, talent=dup,
        stage="reviewing", participant_stage="reviewing", created=-2 * DAY,
        messages=[("talent", -2 * DAY, "Second Priya — different person, same pipeline.")],
        portfolio_ids=builder.portfolio_for(dup, 2, slot=11),
    )

    # Message content that breaks rendering.
    for index, (body, why) in enumerate(pools.EDGE_MESSAGES):
        talent = builder.talent(61_000 + index)
        rel = builder.relationship(
            key=f"edge:message:{index}",
            kind="application", job=job, recruiter=recruiter, talent=talent,
            stage="new", participant_stage="new", created=-(index + 1) * HOUR,
            messages=[("talent", -(index + 1) * HOUR, body)],
            portfolio_ids=[], unread=1,
        )
        builder.add_index(rel, persona="recruiter",
                          route="/applications?view=inbox&mode=recruiter",
                          condition=why, action="Open the thread and check the message renders.")

    # Portfolio extremes, including a thumbnail chosen to fail loading.
    for index, (count, quirk, why) in enumerate((
        (0, None, "zero portfolio items"),
        (1, None, "exactly one portfolio item"),
        (22, None, "22 portfolio items — progressive disclosure"),
        (4, "broken_thumbnail", "portfolio whose first thumbnail 404s"),
    )):
        talent = builder.talent(62_000 + index)
        rel = builder.relationship(
            key=f"edge:portfolio:{index}",
            kind="application", job=job, recruiter=recruiter, talent=talent,
            stage="reviewing", participant_stage="reviewing", created=-(index + 3) * DAY,
            messages=[("talent", -(index + 3) * DAY, "Samples attached.")],
            portfolio_ids=builder.portfolio_for(talent, count, slot=20 + index, quirk=quirk),
        )
        builder.add_index(rel, persona="recruiter",
                          route="/applications?view=inbox&mode=recruiter",
                          condition=why, action="Check the portfolio surface handles this count.")

    # Contradictory and historical states. Each is marked, because none of them
    # is reachable through the current transition rules.
    conflicts = (
        ("rejected-after-hired", "rejected", "hired",
         "Marked Hired, then reversed to Not proceeding. Kept as a real historical conflict.",
         "record reversed after a hire"),
        ("closed-job-pending", "new", "new",
         "The job was closed while this applicant was still pending.",
         "pending applicant on a closed job"),
        ("withdrawn-mid-engagement", "withdrawn", "withdrawn",
         "Withdrawn after the engagement had already started.",
         "withdrawal during an active engagement"),
    )
    for index, (key, stage, participant, note, why) in enumerate(conflicts):
        talent = builder.talent(63_000 + index)
        rel = builder.relationship(
            key=f"edge:{key}",
            kind="application", job=job, recruiter=recruiter, talent=talent,
            stage=stage, participant_stage=participant, created=-(20 + index) * DAY,
            messages=[("talent", -(20 + index) * DAY, "Applying for the role.")],
            portfolio_ids=builder.portfolio_for(talent, 2, slot=30 + index),
            historical=note,
        )
        if key == "withdrawn-mid-engagement":
            rel.engagement = Engagement(
                id=scenario_id("engagement", builder.scenario, key),
                relationship_id=rel.id, state="ended_after_start",
                payment_state="refunded", payment_offset=-4 * DAY, started_offset=-18 * DAY,
            )
        builder.add_index(rel, persona="recruiter",
                          route="/applications?view=pipeline&mode=recruiter",
                          condition=why, action="Confirm no action is offered that the state cannot support.")

    # A silent counterparty: a request nobody ever answered.
    quiet = builder.talent(64_000)
    builder.relationship(
        key="edge:silent",
        kind="hiring_request", job=None, recruiter=recruiter, talent=quiet,
        stage="new", participant_stage="new", created=-40 * DAY,
        messages=[("recruiter", -40 * DAY, "Are you taking new clients this quarter?")],
    )

    # An interview already in the past that was never closed out.
    stale = builder.talent(64_100)
    stale_rel = builder.relationship(
        key="edge:expired-interview",
        kind="application", job=job, recruiter=recruiter, talent=stale,
        stage="interviewing", participant_stage="interviewing", created=-25 * DAY,
        messages=[("talent", -25 * DAY, "Looking forward to speaking.")],
        portfolio_ids=builder.portfolio_for(stale, 3, slot=40),
    )
    stale_rel.interview = Interview(
        id=scenario_id("interview", builder.scenario, "expired"),
        relationship_id=stale_rel.id, state="proposed", scheduled_offset=-6 * DAY,
        detail="https://meet.scenario.invalid/expired",
    )
    builder.add_index(stale_rel, persona="recruiter",
                      route="/applications?view=inbox&mode=recruiter",
                      condition="interview time already passed, still unconfirmed",
                      action="Check the arrangement reads as lapsed rather than upcoming.")

    # Payment edges beyond the hero set.
    for index, state in enumerate(("expired", "refunded", "setup_pending", "not_applicable")):
        talent = builder.talent(65_000 + index)
        rel = builder.relationship(
            key=f"edge:payment:{state}",
            kind="application", job=job, recruiter=recruiter, talent=talent,
            stage="hired", participant_stage="hired", created=-(35 + index) * DAY,
            messages=[("talent", -(35 + index) * DAY, "Applying for the role.")],
            portfolio_ids=builder.portfolio_for(talent, 3, slot=50 + index),
        )
        rel.engagement = Engagement(
            id=scenario_id("engagement", builder.scenario, f"payment:{state}"),
            relationship_id=rel.id, state="completed", payment_state=state,
            payment_offset=-5 * DAY, started_offset=-30 * DAY, completed_offset=-6 * DAY,
        )
        builder.add_index(rel, persona="recruiter",
                          route="/applications?view=inbox&mode=recruiter",
                          condition=f"payment state {state}",
                          action="Confirm the payment card states this without implying funds are held.")

    _client_states(builder)
    _retired_jobs(builder)


def _talent(builder: Builder) -> None:
    """The Talent side, seen from the talent's own account."""

    _place_heroes(builder)
    recruiter_a = builder.recruiter(0)
    recruiter_b = builder.recruiter(3)
    me = builder.talent(70_000, name="Priya Nair")

    # Several applications to the *same* recruiter, which is where a naive
    # grouping collapses distinct records into one.
    for index in range(4):
        job = builder.job(recruiter_a, 500 + index)
        stage = ("new", "reviewing", "interviewing", "rejected")[index]
        created = -(index + 2) * DAY
        rel = builder.relationship(
            key=f"talent:same-recruiter:{index}",
            kind="application", job=job, recruiter=recruiter_a, talent=me,
            stage=stage, participant_stage=stage, created=created,
            messages=[("talent", created, pools.APPLICANT_OPENERS[index % len(pools.APPLICANT_OPENERS)])],
            portfolio_ids=builder.portfolio_for(me, 5, slot=index),
        )
        if index == 0:
            builder.add_index(rel, persona="talent",
                              route="/applications?view=inbox&mode=talent",
                              condition="several applications to one recruiter",
                              action="Confirm each application stays a distinct row.")

    # Inbound requests in every talent-facing outcome.
    for index, stage in enumerate(("new", "reviewing", "accepted", "declined", "withdrawn", "archived")):
        created = -(index + 1) * 3 * DAY
        rel = builder.relationship(
            key=f"talent:request:{index}",
            kind="hiring_request", job=None, recruiter=recruiter_b, talent=me,
            stage=stage, participant_stage=stage, created=created,
            messages=[("recruiter", created, pools.RECRUITER_OPENERS[index % len(pools.RECRUITER_OPENERS)])],
            unread=1 if stage == "new" else 0,
            archived=stage == "archived",
        )
        builder.add_index(rel, persona="talent",
                          route="/applications?view=inbox&mode=talent",
                          condition=f"hiring request in {stage}",
                          action="Confirm the talent-facing wording matches the state.")

    # The legacy label, from the side that was actually told.
    legacy = builder.job(recruiter_b, 520)
    rel = builder.relationship(
        key="talent:legacy-shortlisted",
        kind="application", job=legacy, recruiter=recruiter_b, talent=me,
        stage="shortlisted", participant_stage="shortlisted", created=-55 * DAY,
        messages=[("recruiter", -50 * DAY, "You're on our shortlist for the next batch.")],
        portfolio_ids=builder.portfolio_for(me, 3, slot=7),
        historical="Legacy Shortlisted, communicated. Reads as Under consideration to the talent.",
    )
    builder.add_index(rel, persona="talent", route="/applications?view=inbox&mode=talent",
                      condition="legacy Shortlisted shown as Under consideration",
                      action="Confirm the talent never sees the raw Shortlisted label.")
    _retired_jobs(builder)


def _recruiter(builder: Builder) -> None:
    """The Recruiter side, with every management state on one board."""

    _place_heroes(builder)
    recruiter = builder.recruiter(0)
    stages = ("new", "reviewing", "interviewing", "hired", "rejected", "withdrawn", "archived")
    for job_offset in range(3):
        job = builder.job(recruiter, 600 + job_offset)
        for index, stage in enumerate(stages):
            talent = builder.talent(80_000 + job_offset * 50 + index)
            created = -(index + 1) * 2 * DAY
            rel = builder.relationship(
                key=f"recruiter:{job_offset}:{index}",
                kind="application", job=job, recruiter=recruiter, talent=talent,
                stage=stage,
                participant_stage="reviewing" if stage == "rejected" and index % 2 == 0 else stage,
                created=created,
                messages=[("talent", created, pools.APPLICANT_OPENERS[index % len(pools.APPLICANT_OPENERS)])],
                portfolio_ids=builder.portfolio_for(talent, (index % 4) + 1, slot=index),
                starred=index == 1,
                snoozed_offset=3 * DAY if index == 2 else None,
                unread=1 if index in {0, 3} else 0,
                archived=stage == "archived",
                manager_note="Strong on pacing, unproven on motion." if index == 1 else None,
            )
            if stage == "hired":
                rel.engagement = Engagement(
                    id=scenario_id("engagement", builder.scenario, f"recruiter:{job_offset}:{index}"),
                    relationship_id=rel.id,
                    state="start_pending" if job_offset == 0 else "completed",
                    payment_state=("setup_pending", "released", "funded")[job_offset],
                    payment_offset=-2 * DAY, started_offset=created + DAY,
                )
            if job_offset == 0:
                builder.add_index(rel, persona="recruiter",
                                  route="/applications?view=pipeline&mode=recruiter",
                                  condition=f"stage {stage}",
                                  action="Move the record and confirm the transition is offered honestly.")
    _retired_jobs(builder)


def _payment_coverage(builder: Builder) -> None:
    """Five records in every payment and engagement state.

    Deliberate rather than emergent. Distribution alone leaves the rare states —
    disputed, refunded, expired — with one or two records each, which is not
    enough to look at a state properly or to hold a coverage assertion. A studio
    with a large book of work genuinely does carry every one of these at once,
    so `busy` is where they live.
    """

    from .schema import ENGAGEMENT_STATES, PAYMENT_STATES

    recruiter = builder.recruiter(7)
    job = builder.job(recruiter, 350)
    slot = 0
    for state_index, payment in enumerate(PAYMENT_STATES):
        for repeat in range(5):
            talent = builder.talent(70_500 + slot)
            created = -(20 + slot) * DAY
            rel = builder.relationship(
                key=f"busy:payment:{payment}:{repeat}",
                kind="application", job=job, recruiter=recruiter, talent=talent,
                stage="hired", participant_stage="hired", created=created,
                messages=[("talent", created, pools.APPLICANT_OPENERS[slot % len(pools.APPLICANT_OPENERS)])],
                portfolio_ids=builder.portfolio_for(talent, (slot % 3) + 1, slot=slot),
            )
            rel.engagement = Engagement(
                id=scenario_id("engagement", builder.scenario, f"payment:{payment}:{repeat}"),
                relationship_id=rel.id,
                # Engagement state cycles independently of payment state, which
                # is the separation these records exist to demonstrate.
                state=ENGAGEMENT_STATES[(state_index + repeat) % len(ENGAGEMENT_STATES)],
                payment_state=payment,
                payment_offset=-(repeat + 1) * DAY,
                started_offset=created + 2 * DAY,
                completed_offset=created + 12 * DAY if repeat % 2 == 0 else None,
            )
            if repeat == 0:
                builder.add_index(
                    rel, persona="recruiter",
                    route="/applications?view=inbox&mode=recruiter",
                    condition=f"payment {payment} with engagement {rel.engagement.state}",
                    action="Confirm the payment plane and the work status are reported separately.",
                )
            slot += 1


def _retired_jobs(builder: Builder) -> None:
    """job_25 and job_26 — the canonical closed jobs, reused not reinvented."""

    recruiter = builder.recruiter(1)
    for index, legacy in enumerate(RETIRED_JOB_KEYS):
        job = builder.job(recruiter, 900 + index, status="closed", legacy_key=legacy)
        for offset in range(2):
            talent = builder.talent(90_000 + index * 10 + offset)
            created = -(90 + index * 10 + offset) * DAY
            rel = builder.relationship(
                key=f"retired:{legacy}:{offset}",
                kind="application", job=job, recruiter=recruiter, talent=talent,
                stage=("reviewing", "rejected")[offset],
                participant_stage=("reviewing", "rejected")[offset],
                created=created,
                messages=[("talent", created, "Applying while this was still open.")],
                portfolio_ids=builder.portfolio_for(talent, 2, slot=60 + offset),
                historical=f"Applicant left pending on retired job {legacy}.",
            )
            if offset == 0:
                builder.add_index(rel, persona="recruiter",
                                  route="/applications?view=pipeline&mode=recruiter",
                                  condition=f"pending applicant on retired job {legacy}",
                                  action="Confirm no action is offered that would reopen a closed job.")


def _client_states(builder: Builder) -> None:
    """Conditions that live in the browser, never in a table."""

    targets = [rel for rel in builder.relationships if rel.kind == "application"][:3]
    specs = (
        ("draft", "I was halfway through writing this when", "an unsent composer draft"),
        ("send_failed", "This one failed to send.", "a message whose send failed"),
        ("broken_image", None, "an image chosen to fail loading"),
    )
    for rel, (kind, body, note) in zip(targets, specs):
        builder.client_state.append(
            ClientState(
                id=scenario_id("client_state", builder.scenario, kind),
                relationship_id=rel.id,
                kind=kind,
                body=body,
                note=note,
            )
        )


SCENARIO_BUILDERS = {
    "empty": (_empty, "Authenticated, with genuinely nothing in the workspace."),
    "default": (_default, "A broad realistic dataset for ordinary design and workflow QA."),
    "busy": (_busy, "A studio workload: volume, counting edges, and a long thread."),
    "edge": (_edge, "Identity, content, conflict and error cases, concentrated."),
    "talent": (_talent, "The Talent side, seen from the talent's own account."),
    "recruiter": (_recruiter, "The Recruiter side, with every management state on one board."),
}


def generate(scenario: str) -> Manifest:
    if scenario not in SCENARIO_BUILDERS:
        raise ValueError(f"Unknown scenario {scenario!r}. Known: {', '.join(sorted(SCENARIO_BUILDERS))}")
    build_fn, description = SCENARIO_BUILDERS[scenario]
    builder = Builder(scenario, SCENARIO_SEEDS[scenario], description)
    build_fn(builder)
    return builder.build()


def _prune(value: Any) -> Any:
    """Drop nulls and empty collections so the manifests stay readable.

    A consumer treats a missing key exactly as it treats a null, and keeping
    both forms would double the diff noise whenever a field is added.
    """

    if isinstance(value, dict):
        return {k: _prune(v) for k, v in value.items() if v is not None and v != [] and v != {}}
    if isinstance(value, list):
        return [_prune(item) for item in value]
    return value


def manifest_json(manifest: Manifest) -> str:
    """The exact bytes committed to git.

    Sorted keys and a fixed indent, with a trailing newline, so a regeneration
    diff is a content diff rather than a formatting one.
    """

    return json.dumps(_prune(asdict(manifest)), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def write_all(directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for scenario in SCENARIO_NAMES:
        path = directory / f"{scenario}.json"
        path.write_text(manifest_json(generate(scenario)), encoding="utf-8")
        written.append(path)
    return written
