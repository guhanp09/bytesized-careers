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

import re
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


#: Scenarios whose records stand in for real ones. `edge` exists precisely to
#: hold the incomplete cases, and `empty` holds nothing, so the completeness
#: contract applies to neither.
NORMAL_SCENARIOS: frozenset[str] = frozenset({"default", "busy", "talent", "recruiter"})


def _username_pattern() -> "re.Pattern[str]":
    """The product's own username rule, imported rather than restated.

    Restating it is how the corpus came to mint handles the product rejects.
    Falls back to a copy only if the rule cannot be imported, so validating a
    manifest still does not *require* the application to be importable.
    """

    try:
        from app.services.profile_rules import USERNAME_RE

        return USERNAME_RE
    except Exception:  # pragma: no cover - only when used outside the app
        return re.compile(r"^[a-z0-9][a-z0-9_]{2,19}$")


_USERNAME_RE = _username_pattern()

#: Two is the floor for a portfolio-driven role: one item is a claim, two is a
#: body of work a reviewer can compare against itself.
EVIDENCE_FLOOR = 2

#: Copy that means "we had nothing to put here". Matched on word boundaries and
#: case-insensitively, so a legitimate sentence containing "tested" or "sample
#: rate" is not condemned for the substring — the corpus is full of real prose
#: and a naive `in` check would reject most of it.
PLACEHOLDER_PATTERNS: tuple[str, ...] = (
    r"\blorem ipsum\b",
    r"\btest user\b",
    r"\bsample (?:applicant|user|talent|recruiter|profile)\b",
    r"\bplaceholder\b",
    r"\bTBD\b",
    r"\bN/A\b",
    r"\bfoo\b|\bbar\b|\bbaz\b",
    r"\bjob \d+$",
    r"\bexample\.com\b",
)

#: Every profile field a normal-scenario person must actually carry. Named for
#: the backend column each one restores into, so a gap here is a gap on the
#: rendered profile rather than an abstract schema complaint.
REQUIRED_TALENT_PROFILE: tuple[str, ...] = (
    "username",
    "display_name",
    "headline",
    "bio",
    "location",
    "timezone",
    "availability_status",
)
REQUIRED_TALENT_LISTS: tuple[str, ...] = ("skills", "tools", "roles", "platforms", "formats")

#: A hiring identity somebody has to decide whether to work with.
REQUIRED_HIRING_IDENTITY: tuple[str, ...] = (
    "username",
    "display_name",
    "employer_kind",
    "description",
    "audience_band",
    "headline",
)


def _placeholder_hits(text: object) -> list[str]:
    """Which sentinel patterns a piece of copy trips, if any."""
    if not isinstance(text, str) or not text.strip():
        return []
    return [pattern for pattern in PLACEHOLDER_PATTERNS if re.search(pattern, text, re.IGNORECASE)]


def check_timezone_coverage() -> None:
    """Every location the generator can hand out must map to a real timezone.

    The first version of this map was written against invented location names
    and silently missed half the pool, which produced profiles with no timezone
    and no complaint. A map that can go stale needs something that notices.
    """
    from . import pools

    missing = [name for name, _ in pools.LOCATIONS if name != "Remote" and name not in pools.TIMEZONES]
    if missing:
        raise ManifestError(
            "LOCATIONS entries with no timezone: " + ", ".join(sorted(missing))
        )


def _check_profile_completeness(manifest: Manifest, problems: list[str]) -> None:
    """The completeness contract, enforced at generation rather than hoped for.

    A corpus that renders an empty profile is not a smaller corpus, it is a
    misleading one: every QA pass over it concludes the product looks fine on
    data no real user will ever have. So generation fails rather than producing
    a scenario that cannot be reviewed.
    """
    if manifest.scenario not in NORMAL_SCENARIOS:
        return

    actors = {actor.id: actor for actor in manifest.actors}
    owned: dict[str, int] = {}
    for item in manifest.portfolio:
        owned[item.owner_id] = owned.get(item.owner_id, 0) + 1

    # --- handles must be unique and route-able ------------------------------
    handles: dict[str, str] = {}
    for actor in manifest.actors:
        slug = (actor.username or "").strip()
        if not slug:
            problems.append(f"actor {actor.id} has no username, so it has no profile route")
            continue
        if not _USERNAME_RE.fullmatch(slug):
            # Checked against the product's own rule, imported rather than
            # restated. An approximation ("lowercase, no spaces") is what let
            # every canonical handle be hyphenated — which the product rejects,
            # so every scenario profile 404'd on the backend path while the
            # Mock path, which matches for itself, looked fine.
            problems.append(f"actor {actor.id} has an invalid profile slug {slug!r}")
        if slug in handles:
            problems.append(f"duplicate handle {slug!r} on actors {handles[slug]} and {actor.id}")
        handles[slug] = actor.id

    # --- everyone in a live relationship must be reviewable -----------------
    for rel in manifest.relationships:
        if rel.archived:
            continue
        for role, actor_id in (("talent", rel.talent_id), ("recruiter", rel.recruiter_id)):
            actor = actors.get(actor_id)
            if actor is None:
                problems.append(f"relationship {rel.id} references unknown {role} {actor_id}")
                continue
            required = REQUIRED_HIRING_IDENTITY if role == "recruiter" else REQUIRED_TALENT_PROFILE
            for field_name in required:
                if not getattr(actor, field_name, None):
                    problems.append(
                        f"{role} {actor.username or actor.id} in {rel.id} has no {field_name}"
                    )
            if role == "talent":
                for field_name in REQUIRED_TALENT_LISTS:
                    if not getattr(actor, field_name, None):
                        problems.append(f"talent {actor.username} has an empty {field_name}")
                if owned.get(actor_id, 0) < EVIDENCE_FLOOR:
                    problems.append(
                        f"talent {actor.username} carries {owned.get(actor_id, 0)} evidence "
                        f"items; a normal scenario needs at least {EVIDENCE_FLOOR}"
                    )
        if rel.kind == "application" and not rel.job_id:
            problems.append(f"application {rel.id} has no job context")

    # --- portfolio integrity ------------------------------------------------
    for item in manifest.portfolio:
        if item.owner_id not in actors:
            problems.append(f"portfolio {item.id} is owned by unknown actor {item.owner_id}")
        if not (item.description or "").strip():
            problems.append(f"portfolio {item.id} has no description")
        for url in (item.url, item.thumbnail_url):
            if url and not str(url).startswith(("http://", "https://")):
                problems.append(f"portfolio {item.id} has a malformed URL {url!r}")
    for rel in manifest.relationships:
        for item_id in rel.portfolio_ids:
            owner = next((p.owner_id for p in manifest.portfolio if p.id == item_id), None)
            if owner is not None and owner != rel.talent_id:
                problems.append(
                    f"relationship {rel.id} attaches portfolio {item_id} owned by another actor"
                )

    # --- screening fixtures must be answerable ------------------------------
    questions_by_conversation: dict[str, list[dict[str, Any]]] = {}
    for rel in manifest.relationships:
        for message in rel.messages:
            if message.kind == "screening_questions":
                questions_by_conversation[rel.id] = list(message.metadata.get("questions") or [])
    for rel in manifest.relationships:
        asked = questions_by_conversation.get(rel.id)
        for message in rel.messages:
            if message.kind != "screening_answers":
                continue
            if asked is None:
                problems.append(f"relationship {rel.id} answers screening questions nobody asked")
                continue
            positions = {int(q.get("position", -1)) for q in asked}
            for answer in message.metadata.get("answers") or []:
                if int(answer.get("position", -1)) not in positions:
                    problems.append(
                        f"relationship {rel.id} answers question "
                        f"{answer.get('position')}, which was not asked"
                    )
                if answer.get("required") and not str(answer.get("response") or "").strip():
                    problems.append(
                        f"relationship {rel.id} leaves required question "
                        f"{answer.get('position')} unanswered"
                    )

    # --- no filler ----------------------------------------------------------
    for actor in manifest.actors:
        for field_name in ("display_name", "headline", "bio", "description"):
            for pattern in _placeholder_hits(getattr(actor, field_name, None)):
                problems.append(f"actor {actor.username} has placeholder {field_name} ({pattern})")
    for item in manifest.portfolio:
        for field_name in ("title", "description"):
            for pattern in _placeholder_hits(getattr(item, field_name, None)):
                problems.append(f"portfolio {item.id} has placeholder {field_name} ({pattern})")
    for job in manifest.jobs:
        for pattern in _placeholder_hits(job.title):
            problems.append(f"job {job.id} has a placeholder title ({pattern})")


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

    # --- database constraints the fixture must also respect -----------------
    #
    # A manifest that cannot be restored is not a manifest. The product allows a
    # recruiter one standing interest per talent listing
    # (`talent_interests.talent_listing_id, recruiter_user_id` is unique), and a
    # scenario once carried six from one recruiter to one person — which passed
    # every check here and then failed at the INSERT. Checking it at generation
    # time turns a stack trace into a sentence.
    standing_interest: dict[tuple[str, str], int] = {}
    for rel in manifest.relationships:
        if rel.kind == "application":
            continue
        pair = (rel.talent_id, rel.recruiter_id)
        standing_interest[pair] = standing_interest.get(pair, 0) + 1
    for (talent_id, recruiter_id), count in sorted(standing_interest.items()):
        if count > 1:
            problems.append(
                f"recruiter {recruiter_id} holds {count} hiring requests to talent {talent_id}; "
                "the product permits one per listing and the restore will fail"
            )

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

    _check_profile_completeness(manifest, problems)

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
