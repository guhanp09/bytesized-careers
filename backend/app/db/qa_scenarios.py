from __future__ import annotations

from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db import seed
from app.db import seed_data_personas as personas
from app.db.creator_scenarios.restore import restore_manifest as _restore_manifest
from app.db.creator_scenarios.schema import SCENARIO_NAMES as _CREATOR_SCENARIO_NAMES
from app.models import (
    Conversation,
    EmailOutbox,
    Engagement,
    EngagementReview,
    HiringIdentity,
    InteractionPrivateNote,
    InteractionStatusEvent,
    InteractionTransitionRequest,
    Job,
    JobApplication,
    Message,
    Notification,
    PortfolioItem,
    Report,
    SavedJob,
    SavedTalentListing,
    TalentInterest,
    TalentListing,
    User,
    UserBlock,
)

SCENARIOS: tuple[dict[str, object], ...] = (
    {
        "key": "profiles-empty",
        "title": "Profiles and empty states",
        "purpose": "Restores complete, incomplete, dual-mode, admin, suspended, and empty profiles.",
        "personas": ["new-empty", "talent-complete", "talent-incomplete", "both-sides"],
        "startRoute": "/you",
        "confirmation": "RESTORE PROFILES",
    },
    {
        "key": "listings-drafts",
        "title": "Listings and drafts",
        "purpose": "Restores published, draft, verification-blocked, paused-ready, and owner listing states.",
        "personas": ["recruiter-active", "recruiter-drafts", "talent-complete", "both-sides"],
        "startRoute": "/drafts",
        "confirmation": "RESTORE LISTINGS",
    },
    {
        "key": "applications",
        "title": "Applications",
        "purpose": "Restores first-message variants and every recruiter application pipeline state.",
        "personas": ["talent-complete", "talent-incomplete", "recruiter-active"],
        "startRoute": "/applications?view=pipeline&mode=recruiter",
        "confirmation": "RESTORE APPLICATIONS",
    },
    {
        "key": "hiring-requests",
        "title": "Hiring requests",
        "purpose": "Restores recruiter outreach, structured answers, and every talent-side request state.",
        "personas": ["recruiter-active", "recruiter-drafts", "both-sides", "notifications"],
        "startRoute": "/applications?view=pipeline&mode=talent",
        "confirmation": "RESTORE REQUESTS",
    },
    {
        "key": "inbox-pipeline",
        "title": "Inbox and pipeline",
        "purpose": "Restores applications, hiring requests, messages, unread state, notes, and lifecycle events.",
        "personas": ["recruiter-active", "talent-complete", "both-sides"],
        "startRoute": "/applications",
        "confirmation": "RESTORE INBOX",
    },
    {
        "key": "engagements-reviews",
        "title": "Engagements and reviews",
        "purpose": "Restores start, active, completion, issue, cancellation, blind, and published-review states.",
        "personas": ["recruiter-active", "both-sides", "talent-incomplete", "notifications"],
        "startRoute": "/applications",
        "confirmation": "RESTORE REVIEWS",
    },
    {
        "key": "saved-notifications",
        "title": "Saved items and notifications",
        "purpose": "Restores saved jobs, saved talent, and a read/unread notification mix.",
        "personas": ["talent-complete", "recruiter-active", "notifications"],
        "startRoute": "/saved",
        "confirmation": "RESTORE SAVED",
    },
    {
        "key": "verification-moderation",
        "title": "Verification and moderation",
        "purpose": "Restores represented identity states, reports, suspended fixture, and moderation queues.",
        "personas": ["recruiter-drafts", "admin"],
        "startRoute": "/admin/reports",
        "confirmation": "RESTORE MODERATION",
    },
    # --- generated creator scenarios ---------------------------------------
    #
    # Content comes entirely from the committed manifests, which frontend Mock
    # mode reads too. Restoring is still confirmation-gated and still refused
    # outside staging/test — this adds a data source, not a new way in.
    *(
        {
            "key": f"creator-{name}",
            "title": f"Creator scenario: {name}",
            "purpose": f"Restores the generated {name!r} manifest (one canonical generator, two consumers).",
            "personas": ["recruiter-active", "talent-complete"],
            "startRoute": f"/applications?seed={name}",
            "confirmation": f"RESTORE {name.upper()}",
        }
        for name in _CREATOR_SCENARIO_NAMES
    ),
    {
        "key": "full-baseline",
        "title": "Full QA baseline",
        "purpose": "Recreates every deterministic QA and marketplace fixture without touching ordinary users.",
        "personas": list(personas.PERSONA_KEYS),
        "startRoute": "/",
        "confirmation": "RESTORE ALL QA DATA",
        "danger": True,
    },
)

SCENARIO_BY_KEY = {str(item["key"]): item for item in SCENARIOS}


def public_scenarios() -> list[dict[str, object]]:
    return [dict(item) for item in SCENARIOS]


def _ensure_safe_environment() -> None:
    if settings.app_env == "production":
        raise RuntimeError("QA scenario restore is not allowed in production.")
    if settings.app_env not in {"staging", "test"}:
        raise RuntimeError("QA scenario restore requires staging or test.")


async def _qa_owned_source_ids(session: AsyncSession) -> tuple[list[UUID], list[UUID]]:
    """Return deterministic plus transient interactions created only by QA personas.

    Scenario restores must be able to undo a real Apply/Hire/Block exercise, but
    they must not delete an ordinary staging user's activity.  A source is QA-owned
    only when both its actor and its listing are part of the deterministic QA
    catalogue.  This lets a future release preserve real users who happen to
    interact with a seeded listing.
    """

    qa_user_ids = personas.all_qa_seed_user_ids()
    application_ids = set(personas.all_persona_application_ids())
    application_ids.update(
        (
            await session.execute(
                select(JobApplication.id).where(
                    JobApplication.applicant_user_id.in_(qa_user_ids),
                    JobApplication.job_id.in_(personas.all_persona_job_ids()),
                )
            )
        ).scalars()
    )
    interest_ids = set(personas.all_persona_interest_ids())
    interest_ids.update(
        (
            await session.execute(
                select(TalentInterest.id).where(
                    TalentInterest.recruiter_user_id.in_(qa_user_ids),
                    TalentInterest.talent_listing_id.in_(personas.all_persona_talent_listing_ids()),
                )
            )
        ).scalars()
    )
    return list(application_ids), list(interest_ids)


async def _delete_qa_lifecycle(session: AsyncSession) -> tuple[list[UUID], list[UUID]]:
    application_ids, interest_ids = await _qa_owned_source_ids(session)
    # Versioned transition rows and delivery intents are part of the same QA
    # lifecycle. Leaving them behind makes a restored interaction look fresh
    # while its idempotency/history records still describe a prior test run.
    if application_ids:
        await session.execute(
            delete(InteractionTransitionRequest).where(
                InteractionTransitionRequest.interaction_type == "application",
                InteractionTransitionRequest.interaction_id.in_(application_ids),
            )
        )
        await session.execute(
            delete(InteractionStatusEvent).where(
                InteractionStatusEvent.interaction_type == "application",
                InteractionStatusEvent.interaction_id.in_(application_ids),
            )
        )
    if interest_ids:
        await session.execute(
            delete(InteractionTransitionRequest).where(
                InteractionTransitionRequest.interaction_type == "hiring_request",
                InteractionTransitionRequest.interaction_id.in_(interest_ids),
            )
        )
        await session.execute(
            delete(InteractionStatusEvent).where(
                InteractionStatusEvent.interaction_type == "hiring_request",
                InteractionStatusEvent.interaction_id.in_(interest_ids),
            )
        )
    delivery_prefixes = [
        *[f"application:{item}:%" for item in application_ids],
        *[f"hiring-request:{item}:%" for item in interest_ids],
    ]
    if delivery_prefixes:
        await session.execute(
            delete(EmailOutbox).where(
                or_(*(EmailOutbox.dedupe_key.like(prefix) for prefix in delivery_prefixes))
            )
        )
    # Blocks are QA-owned only when both participants are fixture users. This
    # clears a prior test run's restriction without touching a real user's block.
    qa_user_ids = personas.all_qa_seed_user_ids()
    await session.execute(
        delete(UserBlock).where(
            UserBlock.blocker_user_id.in_(qa_user_ids),
            UserBlock.blocked_user_id.in_(qa_user_ids),
        )
    )
    engagement_ids = list(
        (
            await session.execute(
                select(Engagement.id).where(
                    or_(
                        Engagement.id.in_(personas.all_review_engagement_ids()),
                        Engagement.application_id.in_(application_ids),
                        Engagement.talent_interest_id.in_(interest_ids),
                    )
                )
            )
        ).scalars()
    )
    if engagement_ids:
        await session.execute(
            delete(EngagementReview).where(EngagementReview.engagement_id.in_(engagement_ids))
        )
    conversation_ids = list(
        (
            await session.execute(
                select(Conversation.id).where(
                    or_(
                        Conversation.id.in_(personas.all_review_conversation_ids()),
                        Conversation.application_id.in_(application_ids),
                        Conversation.talent_interest_id.in_(interest_ids),
                    )
                )
            )
        ).scalars()
    )
    if conversation_ids:
        await session.execute(
            delete(Notification).where(
                Notification.resource_id.in_([str(item) for item in conversation_ids])
            )
        )
        await session.execute(delete(Message).where(Message.conversation_id.in_(conversation_ids)))
        await session.execute(delete(Conversation).where(Conversation.id.in_(conversation_ids)))
    if engagement_ids:
        await session.execute(delete(Engagement).where(Engagement.id.in_(engagement_ids)))
    if application_ids or interest_ids:
        source_ids = [str(item) for item in [*application_ids, *interest_ids]]
        await session.execute(delete(Notification).where(Notification.resource_id.in_(source_ids)))
    if application_ids:
        await session.execute(
            delete(InteractionPrivateNote).where(InteractionPrivateNote.application_id.in_(application_ids))
        )
    if interest_ids:
        await session.execute(
            delete(InteractionPrivateNote).where(
                InteractionPrivateNote.talent_interest_id.in_(interest_ids)
            )
        )
    return application_ids, interest_ids


async def _restore_profiles(session: AsyncSession) -> dict[str, object]:
    safe_fields = {
        "username",
        "display_name",
        "account_type",
        "account_type_selected_at",
        "onboarding_intent",
        "onboarding_intent_selected_at",
        "headline",
        "bio",
        "location",
        "timezone",
        "availability_status",
        "availability",
        "skills",
        "creator_platforms",
        "collaboration_working_hours",
        "collaboration_turnaround",
        "collaboration_revisions",
        "collaboration_tools",
        "public_links",
        "hiring_type",
        "hiring_primary_platform",
        "hiring_platforms",
        "hiring_niches",
        "hiring_genres",
        "hiring_formats",
        "hiring_website_or_social_url",
        "hiring_channels_or_pages_managed",
        "hiring_verification_status",
        "suspended_at",
        "suspension_reason",
        "suspended_by_user_id",
    }
    payloads = personas.build_persona_users()
    defaults: dict[str, object] = {
        "availability_status": "selective",
        "skills": [],
        "creator_platforms": [],
        "public_links": [],
        "hiring_platforms": [],
        "hiring_niches": [],
        "hiring_genres": [],
        "hiring_formats": [],
        "hiring_verification_status": "unverified",
        "suspended_at": None,
        "suspension_reason": None,
        "suspended_by_user_id": None,
    }
    rows = (
        await session.execute(select(User).where(User.id.in_([item["id"] for item in payloads])))
    ).scalars().all()
    by_id = {row.id: row for row in rows}
    updated = 0
    for payload in payloads:
        row = by_id.get(payload["id"])
        if row is None:
            continue
        for field in safe_fields:
            value = payload[field] if field in payload else defaults.get(field)
            setattr(row, field, list(value) if isinstance(value, list) else value)
        updated += 1
    await session.execute(
        delete(PortfolioItem).where(PortfolioItem.id.in_(personas.all_persona_portfolio_item_ids()))
    )
    await session.commit()
    await seed.seed_personas_if_missing(session)
    return {"profiles_updated": updated, "portfolio_restored": True}


async def _restore_applications(session: AsyncSession) -> dict[str, object]:
    application_ids, _ = await _delete_qa_lifecycle(session)
    if application_ids:
        await session.execute(delete(JobApplication).where(JobApplication.id.in_(application_ids)))
    await session.commit()
    result = await seed.seed_review_scenarios(session)
    return {"applications_and_lifecycle": result}


async def _restore_interests(session: AsyncSession) -> dict[str, object]:
    _, interest_ids = await _delete_qa_lifecycle(session)
    if interest_ids:
        await session.execute(delete(TalentInterest).where(TalentInterest.id.in_(interest_ids)))
    await session.commit()
    result = await seed.seed_applications_workspace(session)
    await seed.seed_review_scenarios(session)
    return {"hiring_requests": result, "lifecycle_restored": True}


async def _restore_inbox(session: AsyncSession) -> dict[str, object]:
    applications = await _restore_applications(session)
    interests = await _restore_interests(session)
    return {"applications": applications, "interests": interests}


async def _restore_reviews(session: AsyncSession) -> dict[str, object]:
    await _delete_qa_lifecycle(session)
    await session.commit()
    return {"reviews": await seed.seed_review_scenarios(session)}


async def _restore_saved_notifications(session: AsyncSession) -> dict[str, object]:
    await session.execute(delete(SavedJob).where(SavedJob.id.in_(personas.all_persona_saved_job_ids())))
    await session.execute(
        delete(SavedTalentListing).where(
            SavedTalentListing.id.in_(personas.all_persona_saved_talent_ids())
        )
    )
    await session.execute(
        delete(Notification).where(Notification.id.in_(personas.all_persona_notification_ids()))
    )
    await session.commit()
    return {
        "saved": await seed.seed_saved_items(session),
        "notifications": await seed.seed_notifications_scenario(session),
    }


async def _restore_verification_moderation(session: AsyncSession) -> dict[str, object]:
    identities = personas.build_persona_hiring_identities()
    rows = (
        await session.execute(
            select(HiringIdentity).where(HiringIdentity.id.in_([item["id"] for item in identities]))
        )
    ).scalars().all()
    by_id = {row.id: row for row in rows}
    for payload in identities:
        row = by_id.get(payload["id"])
        if row is None:
            continue
        for key, value in payload.items():
            if key not in {"id", "owner_user_id", "created_at"}:
                setattr(row, key, value)
    await session.execute(delete(Report).where(Report.id.in_(personas.all_persona_report_ids())))
    suspended = (
        await session.execute(
            select(User).where(User.id == personas.persona_user_id("suspended-fixture"))
        )
    ).scalar_one_or_none()
    if suspended is not None:
        payload = next(
            item
            for item in personas.build_persona_users()
            if item["id"] == personas.persona_user_id("suspended-fixture")
        )
        suspended.suspended_at = payload["suspended_at"]
        suspended.suspension_reason = payload["suspension_reason"]
    hidden_job_payload = next(
        item for item in personas.build_persona_jobs()
        if item["id"] == personas.persona_uuid("job:hidden-moderation")
    )
    hidden_job = await session.get(Job, hidden_job_payload["id"])
    if hidden_job is not None:
        hidden_job.deleted_at = hidden_job_payload["deleted_at"]
    hidden_review_payload = next(
        item for item in personas.build_persona_engagement_reviews()
        if item["id"] == personas.persona_uuid(
            "engagement-review:moderated-review:talent_to_recruiter"
        )
    )
    hidden_review = await session.get(EngagementReview, hidden_review_payload["id"])
    if hidden_review is not None:
        hidden_review.status = str(hidden_review_payload["status"])
        hidden_review.hidden_at = hidden_review_payload["hidden_at"]
        hidden_review.hidden_by_user_id = hidden_review_payload["hidden_by_user_id"]
        hidden_review.hidden_reason = str(hidden_review_payload["hidden_reason"])
    await session.commit()
    return {
        "reports": await seed.seed_reports_scenario(session),
        "identities_restored": True,
        "hidden_listing_restored": hidden_job is not None,
        "moderated_review_restored": hidden_review is not None,
    }


async def _restore_listings(session: AsyncSession) -> dict[str, object]:
    application_ids, interest_ids = await _delete_qa_lifecycle(session)
    if application_ids:
        await session.execute(delete(JobApplication).where(JobApplication.id.in_(application_ids)))
    if interest_ids:
        await session.execute(delete(TalentInterest).where(TalentInterest.id.in_(interest_ids)))
    await session.execute(
        delete(SavedJob).where(SavedJob.id.in_(personas.all_persona_saved_job_ids()))
    )
    await session.execute(
        delete(SavedTalentListing).where(
            SavedTalentListing.id.in_(personas.all_persona_saved_talent_ids())
        )
    )

    async def reconcile(model, payloads: list[dict[str, object]], immutable: set[str]) -> int:
        rows = (
            await session.execute(select(model).where(model.id.in_([item["id"] for item in payloads])))
        ).scalars().all()
        by_id = {row.id: row for row in rows}
        updated = 0
        for payload in payloads:
            row = by_id.get(payload["id"])
            if row is None:
                continue
            for key, value in payload.items():
                if key in immutable:
                    continue
                if hasattr(row, key):
                    if isinstance(value, list):
                        value = list(value)
                    elif isinstance(value, dict):
                        value = dict(value)
                    setattr(row, key, value)
            updated += 1
        return updated

    jobs_updated = await reconcile(
        Job,
        personas.build_persona_jobs(),
        {"id", "posted_by_user_id", "created_at"},
    )
    # Restore soft-deletion state explicitly because most payloads intentionally
    # omit it while the moderation fixture includes it.
    job_payloads = {item["id"]: item for item in personas.build_persona_jobs()}
    job_rows = (
        await session.execute(select(Job).where(Job.id.in_(job_payloads)))
    ).scalars().all()
    for row in job_rows:
        row.deleted_at = job_payloads[row.id].get("deleted_at")

    listings_updated = await reconcile(
        TalentListing,
        personas.build_persona_talent_listings(),
        {"id", "owner_user_id", "created_at"},
    )
    identities_updated = await reconcile(
        HiringIdentity,
        personas.build_persona_hiring_identities(),
        {"id", "owner_user_id", "created_at"},
    )
    await session.commit()
    return {
        "reconciled": {
            "jobs": jobs_updated,
            "talent_listings": listings_updated,
            "hiring_identities": identities_updated,
        },
        "baseline": await seed.seed_full_demo(session),
    }


async def _restore_full_baseline(session: AsyncSession) -> dict[str, object]:
    """Restore deterministic fixtures without deleting arbitrary related rows."""

    return {
        "profiles": await _restore_profiles(session),
        "listings": await _restore_listings(session),
        "inbox": await _restore_inbox(session),
        "reviews": await _restore_reviews(session),
        "saved_notifications": await _restore_saved_notifications(session),
        "verification_moderation": await _restore_verification_moderation(session),
    }


RESTORERS: dict[str, Callable[[AsyncSession], Awaitable[dict[str, object]]]] = {
    "profiles-empty": _restore_profiles,
    "listings-drafts": _restore_listings,
    "applications": _restore_applications,
    "hiring-requests": _restore_interests,
    "inbox-pipeline": _restore_inbox,
    "engagements-reviews": _restore_reviews,
    "saved-notifications": _restore_saved_notifications,
    "verification-moderation": _restore_verification_moderation,
}


async def restore_scenario(session: AsyncSession, key: str) -> dict[str, object]:
    _ensure_safe_environment()
    if key == "full-baseline":
        return await _restore_full_baseline(session)
    # Generated scenarios go through the same gate as every other restore; only
    # the source of the content differs.
    if key.startswith("creator-"):
        name = key.removeprefix("creator-")
        if name not in _CREATOR_SCENARIO_NAMES:
            raise KeyError(key)
        return await _restore_manifest(session, name)
    restorer = RESTORERS.get(key)
    if restorer is None:
        raise KeyError(key)
    return await restorer(session)
