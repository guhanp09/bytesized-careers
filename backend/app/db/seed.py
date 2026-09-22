from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import TypedDict
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.db import seed_data_personas as personas
from app.db.seed_data_jobs import (
    DEMO_JOB_IDS,
    RETIRED_DEMO_JOB_IDS,
    SEEDED_JOBS,
    demo_hiring_identities,
    demo_user_id,
    demo_users,
    identity_specs_by_key,
    job_specs,
    materialize_job_payload,
)
from app.db.seed_data_jobs import (
    _stable_uuid as stable_demo_job_id,
)
from app.db.seed_data_roles import seeded_roles
from app.db.seed_data_talent import SEEDED_TALENT_LISTINGS, SEEDED_TALENT_USERS
from app.models import (
    Conversation,
    Engagement,
    EngagementReview,
    HiringIdentity,
    Job,
    JobApplication,
    Message,
    Notification,
    PortfolioItem,
    Report,
    Role,
    SavedJob,
    SavedTalentListing,
    TalentInterest,
    TalentListing,
    User,
)
from app.repositories.job_repository import JobRepository
from app.schemas import JobCreate
from app.services.job_service import JobService

logger = logging.getLogger(__name__)


class SeedResult(TypedDict):
    inserted: int
    skipped: int
    updated: int


class JobSeedResult(SeedResult):
    created: int
    unchanged: int


def _norm_keys(value: object) -> list[str]:
    return list(value) if isinstance(value, list) else []


def _seed_values_equal(current: object, desired: object) -> bool:
    if isinstance(current, Decimal) or isinstance(desired, Decimal):
        if current is None or desired is None:
            return current is desired
        return Decimal(current) == Decimal(desired)
    return current == desired


async def _ensure_demo_job_principals(session: AsyncSession) -> None:
    user_payloads = demo_users()
    existing_user_rows = await session.execute(
        select(User.id).where(User.id.in_([item["id"] for item in user_payloads]))
    )
    existing_user_ids = set(existing_user_rows.scalars().all())
    for payload in user_payloads:
        if payload["id"] not in existing_user_ids:
            session.add(User(**payload))
    await session.flush()

    identity_payloads = demo_hiring_identities()
    existing_identity_rows = await session.execute(
        select(HiringIdentity.id).where(
            HiringIdentity.id.in_([item["id"] for item in identity_payloads])
        )
    )
    existing_identity_ids = set(existing_identity_rows.scalars().all())
    for payload in identity_payloads:
        if payload["id"] not in existing_identity_ids:
            session.add(HiringIdentity(**payload))
    await session.flush()


async def seed_jobs_from_seed_data_if_missing(session: AsyncSession) -> JobSeedResult:
    """Validate and idempotently upsert the development-only demo job portfolio."""

    if settings.app_env not in {"development", "test"}:
        raise RuntimeError("Demo job seeding is allowed only in development or test.")

    await seed_roles_if_missing(session)
    await _ensure_demo_job_principals(session)

    existing_rows = await session.execute(select(Job).where(Job.id.in_(DEMO_JOB_IDS)))
    existing_by_id = {row.id: row for row in existing_rows.scalars().all()}
    retired_rows = await session.execute(select(Job).where(Job.id.in_(RETIRED_DEMO_JOB_IDS)))
    retired_jobs = list(retired_rows.scalars().all())

    service = JobService(JobRepository(session))
    identities = identity_specs_by_key()
    role_names = {spec["role"].casefold() for spec in job_specs()}
    role_rows = await session.execute(select(Role).where(func.lower(Role.name).in_(role_names)))
    roles_by_name = {role.name.casefold(): role for role in role_rows.scalars().all()}
    now = datetime.now(UTC)
    inserted = 0
    updated = 0
    unchanged = 0
    skipped = 0

    # Old deterministic fixtures must not remain accidentally visible after the
    # portfolio refresh. Retire only those known seed IDs; never delete them or
    # alter an arbitrary user-created job.
    for retired_job in retired_jobs:
        if retired_job.status == "closed":
            skipped += 1
            continue
        await service.repository.update(
            retired_job,
            {"status": "closed", "closed_at": retired_job.closed_at or now},
        )
        updated += 1

    for spec in job_specs():
        job_id = stable_demo_job_id(spec["key"])
        existing = existing_by_id.get(job_id)
        identity = identities.get(spec["identity_key"])
        if identity is None:
            raise RuntimeError(f"Unknown demo hiring identity: {spec['identity_key']}")
        role = roles_by_name.get(spec["role"].casefold())
        if role is None:
            raise RuntimeError(f"Unknown demo role dependency: {spec['role']}")

        raw_payload = materialize_job_payload(
            spec,
            identity_spec=identity,
            role_id=role.id,
            now=now,
            existing_deadline=existing.deadline_at if existing is not None else None,
            existing_start_date=existing.start_date if existing is not None else None,
        )
        payload = JobCreate.model_validate(raw_payload)
        desired = await service.prepare_job_create(
            payload,
            actor_user_id=demo_user_id(identity["owner_key"]),
        )
        desired.update(
            {
                "views": spec["views"],
                "applicants": spec["applicants"],
                "response_rate": spec["response_rate"],
            }
        )

        if spec["status"] == "paused":
            desired["paused_at"] = existing.paused_at if existing is not None else now
        elif spec["status"] == "closed":
            desired["closed_at"] = existing.closed_at if existing is not None else now

        if existing is None:
            desired["id"] = job_id
            desired["created_at"] = now - timedelta(hours=int(spec["posted_hours_ago"]))
            desired["updated_at"] = desired["created_at"]
            await service.repository.create(desired)
            inserted += 1
            continue

        changes = {
            field: value
            for field, value in desired.items()
            if not _seed_values_equal(getattr(existing, field, None), value)
        }
        if changes:
            await service.repository.update(existing, changes)
            updated += 1
        else:
            unchanged += 1

    await session.commit()
    logger.info(
        "seed_jobs_complete",
        extra={
            "inserted": inserted,
            "skipped": skipped,
            "updated": updated,
            "unchanged": unchanged,
            "total_seed_records": len(DEMO_JOB_IDS),
        },
    )
    return {
        "inserted": inserted,
        "created": inserted,
        "updated": updated,
        "unchanged": unchanged,
        "skipped": skipped,
    }


async def seed_talent_from_seed_data_if_missing(session: AsyncSession) -> SeedResult:
    inserted = 0
    skipped = 0
    updated = 0

    user_ids = [UUID(str(item["id"])) for item in SEEDED_TALENT_USERS]
    existing_user_rows = await session.execute(select(User.id).where(User.id.in_(user_ids)))
    existing_user_ids = {row for row in existing_user_rows.scalars().all()}
    for payload in SEEDED_TALENT_USERS:
        user_id = UUID(str(payload["id"]))
        if user_id in existing_user_ids:
            continue
        session.add(User(**payload))

    # SessionLocal deliberately disables autoflush. Flush parent users before
    # inserting the listings that reference them so fresh Postgres/Neon databases
    # never observe an unresolved owner_user_id.
    await session.flush()

    listing_ids = [UUID(str(item["id"])) for item in SEEDED_TALENT_LISTINGS]
    existing_listing_rows = await session.execute(select(TalentListing).where(TalentListing.id.in_(listing_ids)))
    existing_by_id = {row.id: row for row in existing_listing_rows.scalars().all()}

    for payload in SEEDED_TALENT_LISTINGS:
        listing_id = UUID(str(payload["id"]))
        existing = existing_by_id.get(listing_id)
        if existing is not None:
            # Reconcile demo hiring-request requirements onto already-seeded listings
            # (seeding is otherwise insert-only). Only this presentational column on
            # deterministic seed ids is touched — no user-created data is changed.
            desired = _norm_keys(payload.get("first_message_requirements"))
            if _norm_keys(existing.first_message_requirements) != desired:
                existing.first_message_requirements = desired
                updated += 1
            else:
                skipped += 1
            continue
        session.add(TalentListing(**payload))
        inserted += 1

    await session.commit()
    logger.info(
        "seed_talent_complete",
        extra={
            "inserted": inserted,
            "skipped": skipped,
            "updated": updated,
            "total_seed_records": len(SEEDED_TALENT_LISTINGS),
        },
    )
    return {"inserted": inserted, "skipped": skipped, "updated": updated}


async def seed_roles_if_missing(session: AsyncSession) -> SeedResult:
    """Ensure the role catalog (Specialization picker) is populated.

    Insert-only and idempotent: existing roles are matched by name (case-insensitive)
    and never modified, so this is safe to run on every startup in any environment.
    It backfills dev databases built via ``create_all`` (which skip the migration that
    seeds roles) and tops up additional roles in environments created by migrations.
    """

    inserted = 0
    skipped = 0
    rows = await session.execute(select(Role.name))
    existing = {str(name).strip().lower() for (name,) in rows.all()}
    for item in seeded_roles():
        if str(item["name"]).strip().lower() in existing:
            skipped += 1
            continue
        session.add(
            Role(
                id=item["id"],
                name=item["name"],
                category=item["category"],
                description=item["description"],
            )
        )
        inserted += 1

    if inserted:
        await session.commit()

    logger.info(
        "seed_roles_complete",
        extra={"inserted": inserted, "skipped": skipped},
    )
    return {"inserted": inserted, "skipped": skipped, "updated": 0}


async def seed_marketplace_demo_data_if_missing(session: AsyncSession) -> dict[str, SeedResult]:
    jobs = await seed_jobs_from_seed_data_if_missing(session)
    talent = await seed_talent_from_seed_data_if_missing(session)
    return {"jobs": jobs, "talent": talent}


# --------------------------------------------------------------------------
# Dev persona seeding + reset (development/test only).
#
# These build on the realistic, deterministic persona fixtures in
# ``seed_data_personas``. Every helper is idempotent (insert-if-missing on stable
# uuids) so it is safe to run repeatedly. ``reset_dev_seed_data`` only ever deletes
# rows tied to persona/seed user ids — never arbitrary user data — and re-asserts the
# environment defensively even though the dev routes already gate on it.
# --------------------------------------------------------------------------


async def _insert_missing(
    session: AsyncSession, model: type, payloads: list[dict[str, object]]
) -> dict[str, int]:
    """Idempotently insert model rows keyed by their deterministic ``id``."""

    if not payloads:
        return {"inserted": 0, "skipped": 0}
    ids = [payload["id"] for payload in payloads]
    existing_rows = await session.execute(select(model.id).where(model.id.in_(ids)))
    existing_ids = set(existing_rows.scalars().all())
    inserted = 0
    skipped = 0
    for payload in payloads:
        if payload["id"] in existing_ids:
            skipped += 1
            continue
        session.add(model(**payload))
        inserted += 1
    return {"inserted": inserted, "skipped": skipped}


async def seed_personas_if_missing(session: AsyncSession) -> dict[str, dict[str, int]]:
    """Create the dev login personas and everything they own (insert order is FK-safe)."""

    counts: dict[str, dict[str, int]] = {}
    user_payloads = personas.build_persona_users()
    counts["users"] = await _insert_missing(session, User, user_payloads)
    await session.flush()

    # Older persona fixtures used hyphenated handles, which the public username
    # contract rejects. Reconcile only deterministic seed-owned users so rerunning
    # the staging seed repairs existing databases without touching real accounts.
    seeded_user_rows = await session.execute(
        select(User).where(User.id.in_([payload["id"] for payload in user_payloads]))
    )
    seeded_users_by_id = {row.id: row for row in seeded_user_rows.scalars().all()}
    usernames_updated = 0
    for payload in user_payloads:
        row = seeded_users_by_id.get(payload["id"])
        desired_username = str(payload["username"])
        if row is not None and row.username != desired_username:
            row.username = desired_username
            usernames_updated += 1
    counts["users"]["updated"] = usernames_updated
    await session.flush()

    identity_payloads = personas.build_persona_hiring_identities()
    counts["hiring_identities"] = await _insert_missing(session, HiringIdentity, identity_payloads)
    await session.flush()

    # Earlier deterministic persona rows used obsolete enum spellings. A
    # fresh QA database is correct after the fixture update, but insert-only
    # seeding would leave existing local/staging persona identities unreadable.
    # Repair only the known legacy values on our stable persona IDs; leave
    # verification state and any independently edited identity data untouched.
    legacy_values = {
        "type": {"own_channel": "INDIVIDUAL_CHANNEL", "represented": "AGENCY_REPRESENTED_CHANNEL"},
        "platform": {"youtube": "YOUTUBE", "instagram": "INSTAGRAM"},
        "verification_method": {
            "YOUTUBE_CHANNEL_LINK": "MANUAL_ADMIN_REVIEW",
            "CODE_IN_DESCRIPTION": "VERIFICATION_CODE",
        },
    }
    seeded_identity_rows = await session.execute(
        select(HiringIdentity).where(
            HiringIdentity.id.in_([payload["id"] for payload in identity_payloads])
        )
    )
    identities_updated = 0
    for row in seeded_identity_rows.scalars():
        changed = False
        for field, mapping in legacy_values.items():
            current = getattr(row, field)
            replacement = mapping.get(current)
            if replacement is not None:
                setattr(row, field, replacement)
                changed = True
        identities_updated += int(changed)
    counts["hiring_identities"]["updated"] = identities_updated
    await session.flush()

    counts["talent_listings"] = await _insert_missing(
        session, TalentListing, personas.build_persona_talent_listings()
    )
    await session.flush()

    counts["jobs"] = await _insert_missing(session, Job, personas.build_persona_jobs())
    await session.flush()

    counts["portfolio_items"] = await _insert_missing(
        session, PortfolioItem, personas.build_persona_portfolio_items()
    )
    await session.flush()

    await session.commit()
    logger.info("seed_personas_complete", extra={"counts": counts})
    return counts


async def disable_staging_persona_passwords(session: AsyncSession) -> int:
    """Make deterministic demo personas unusable as shared staging accounts.

    The public staging seed reuses persona-owned rows to demonstrate lifecycle
    outcomes, but their development password is intentionally documented in the
    repository. Replace it with an unlogged random credential after every staging
    seed, including idempotent reruns over an existing database.
    """

    rows = await session.execute(
        select(User).where(User.id.in_(personas.all_qa_seed_user_ids()))
    )
    users = list(rows.scalars().all())
    if not users:
        return 0

    disabled_hash = hash_password(secrets.token_urlsafe(48))
    for user in users:
        user.password_hash = disabled_hash
    await session.commit()
    return len(users)


async def seed_applications_workspace(session: AsyncSession) -> dict[str, dict[str, int]]:
    await seed_personas_if_missing(session)
    counts = {
        "applications": await _insert_missing(
            session, JobApplication, personas.build_persona_applications()
        )
    }
    await session.flush()
    counts["interests"] = await _insert_missing(
        session, TalentInterest, personas.build_persona_interests()
    )
    await session.flush()
    await session.commit()
    return counts


async def seed_review_scenarios(session: AsyncSession) -> dict[str, dict[str, int]]:
    """Insert deterministic lifecycle states after their users and sources exist."""

    await seed_applications_workspace(session)
    counts = {
        "engagements": await _insert_missing(
            session, Engagement, personas.build_persona_engagements()
        )
    }
    await session.flush()
    counts["reviews"] = await _insert_missing(
        session, EngagementReview, personas.build_persona_engagement_reviews()
    )
    await session.flush()
    counts["conversations"] = await _insert_missing(
        session, Conversation, personas.build_persona_review_conversations()
    )
    await session.flush()
    counts["messages"] = await _insert_missing(
        session, Message, personas.build_persona_review_messages()
    )
    await session.flush()
    await session.commit()
    return counts


async def seed_drafts(session: AsyncSession) -> dict[str, dict[str, int]]:
    # Draft jobs + a draft talent listing live on the recruiter-drafts persona, so
    # ensuring personas materialises the drafts scenario.
    return await seed_personas_if_missing(session)


async def seed_notifications_scenario(session: AsyncSession) -> dict[str, dict[str, int]]:
    await seed_personas_if_missing(session)
    counts = {
        "notifications": await _insert_missing(
            session, Notification, personas.build_persona_notifications()
        )
    }
    await session.flush()
    await session.commit()
    return counts


async def seed_saved_items(session: AsyncSession) -> dict[str, dict[str, int]]:
    await seed_personas_if_missing(session)
    counts = {
        "saved_jobs": await _insert_missing(session, SavedJob, personas.build_persona_saved_jobs())
    }
    await session.flush()
    counts["saved_talent"] = await _insert_missing(
        session, SavedTalentListing, personas.build_persona_saved_talent()
    )
    await session.flush()
    await session.commit()
    return counts


async def seed_verification_states(session: AsyncSession) -> dict[str, dict[str, int]]:
    # Hiring identities in verified / pending / failed states ship with the personas.
    return await seed_personas_if_missing(session)


async def seed_reports_scenario(session: AsyncSession) -> dict[str, dict[str, int]]:
    await seed_personas_if_missing(session)
    counts = {"reports": await _insert_missing(session, Report, personas.build_persona_reports())}
    await session.flush()
    await session.commit()
    return counts


async def seed_full_demo(session: AsyncSession) -> dict[str, object]:
    """One deterministic dataset: roles + marketplace demo + all personas + relationships."""

    roles = await seed_roles_if_missing(session)
    persona_counts = await seed_personas_if_missing(session)
    marketplace = await seed_marketplace_demo_data_if_missing(session)
    applications = await seed_applications_workspace(session)
    reviews = await seed_review_scenarios(session)
    saved = await seed_saved_items(session)
    notifications = await seed_notifications_scenario(session)
    reports = await seed_reports_scenario(session)
    return {
        "roles": roles,
        "marketplace": marketplace,
        "personas": persona_counts,
        "applications": applications,
        "reviews": reviews,
        "saved": saved,
        "notifications": notifications,
        "reports": reports,
    }


async def reset_dev_seed_data(session: AsyncSession) -> dict[str, object]:
    """Delete only persona/seed-owned rows, then recreate the full demo baseline.

    Hard-asserts a non-production environment as a second line of defence behind the
    route-level gate. Deletes are scoped to deterministic persona ids and demo seed
    ids, so user-created records are never touched.
    """

    if settings.app_env == "production":
        raise RuntimeError("reset_dev_seed_data is not allowed in production.")

    persona_user_ids = personas.all_qa_seed_user_ids()
    seed_talent_user_ids = [UUID(str(item["id"])) for item in SEEDED_TALENT_USERS]
    seed_job_user_ids = [UUID(str(item["id"])) for item in demo_users()]
    target_user_ids = persona_user_ids + seed_talent_user_ids + seed_job_user_ids
    seed_job_ids = [UUID(str(item["id"])) for item in SEEDED_JOBS] + list(RETIRED_DEMO_JOB_IDS)
    seed_listing_ids = [UUID(str(item["id"])) for item in SEEDED_TALENT_LISTINGS]

    # Children first; jobs/listings reference users via SET NULL so they need an
    # explicit owner-scoped delete (a user delete would orphan, not remove them).
    await session.execute(
        delete(EngagementReview).where(
            EngagementReview.engagement_id.in_(personas.all_review_engagement_ids())
        )
    )
    await session.execute(
        delete(Message).where(
            Message.conversation_id.in_(personas.all_review_conversation_ids())
        )
    )
    await session.execute(
        delete(Conversation).where(Conversation.id.in_(personas.all_review_conversation_ids()))
    )
    await session.execute(
        delete(Engagement).where(Engagement.id.in_(personas.all_review_engagement_ids()))
    )
    await session.execute(
        delete(Notification).where(
            or_(
                Notification.user_id.in_(target_user_ids),
                Notification.actor_user_id.in_(target_user_ids),
            )
        )
    )
    await session.execute(
        delete(Report).where(
            or_(
                Report.reporter_user_id.in_(target_user_ids),
                Report.resolved_by_user_id.in_(target_user_ids),
            )
        )
    )
    await session.execute(delete(SavedJob).where(SavedJob.user_id.in_(target_user_ids)))
    await session.execute(
        delete(SavedTalentListing).where(SavedTalentListing.user_id.in_(target_user_ids))
    )
    await session.execute(
        delete(JobApplication).where(
            or_(
                JobApplication.applicant_user_id.in_(target_user_ids),
                JobApplication.job_owner_user_id.in_(target_user_ids),
            )
        )
    )
    await session.execute(
        delete(TalentInterest).where(
            or_(
                TalentInterest.recruiter_user_id.in_(target_user_ids),
                TalentInterest.owner_user_id.in_(target_user_ids),
            )
        )
    )
    await session.execute(delete(PortfolioItem).where(PortfolioItem.user_id.in_(target_user_ids)))
    await session.execute(delete(HiringIdentity).where(HiringIdentity.owner_user_id.in_(target_user_ids)))
    await session.execute(
        delete(Job).where(or_(Job.posted_by_user_id.in_(target_user_ids), Job.id.in_(seed_job_ids)))
    )
    await session.execute(
        delete(TalentListing).where(
            or_(
                TalentListing.owner_user_id.in_(target_user_ids),
                TalentListing.id.in_(seed_listing_ids),
            )
        )
    )
    await session.execute(delete(User).where(User.id.in_(target_user_ids)))
    await session.commit()

    recreated = await seed_full_demo(session)
    logger.info("reset_dev_seed_data_complete")
    return {"status": "reset", "recreated": recreated}
