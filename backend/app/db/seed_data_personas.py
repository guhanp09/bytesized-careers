"""Dev-only persona seed data.

Realistic, deterministic CreatorJobs personas used by local dev workflows and the
controlled QA persona system. Every record uses a stable
``uuid5`` id derived from ``PERSONA_NAMESPACE`` so seeding is idempotent and reset
can target exactly the rows we created — never arbitrary user data.

Unlike display-only marketplace samples, these are real persisted users. Direct
password login is development/test compatibility only; staging seed paths disable
persona passwords and the QA controller receives short-lived impersonation tokens.
They never become ordinary production accounts because seed and QA gates refuse
production.

No fake trust signals: ratings, response rates, and live viewer counts are never
fabricated. Verification states appear only on the explicit verification persona.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from app.core.security import hash_password

# Distinct from the marketplace SEED_NAMESPACE values so persona ids never collide
# with the demo jobs/talent fixtures.
PERSONA_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "personas.dev.creatorjobs.local")

DEV_PERSONA_PASSWORD = "DevPersona123!"
# A non-reserved TLD so the email passes EmailStr validation on login. `.local` /
# `.test` are special-use names that email-validator rejects; `.dev` reads as a dev
# domain while staying valid. These accounts only ever exist in dev/test databases.
PERSONA_EMAIL_DOMAIN = "persona.creatorjobs.dev"

# A fixed timestamp keeps seeded rows deterministic across runs.
SEED_TIME = datetime(2026, 1, 6, 9, 0, tzinfo=timezone.utc)


def persona_uuid(key: str) -> uuid.UUID:
    """Stable id for any persona-owned record, keyed by a human-readable string."""

    return uuid.uuid5(PERSONA_NAMESPACE, key)


@lru_cache(maxsize=1)
def _password_hash() -> str:
    # Hash once per process; bcrypt is intentionally slow.
    return hash_password(DEV_PERSONA_PASSWORD)


# --- Persona catalogue (drives GET /dev/personas) ---------------------------

# key, label, account_type, onboarding_intent, short purpose description.
PERSONA_DEFS: list[dict[str, str]] = [
    {
        "key": "new-empty",
        "label": "New empty user",
        "username": "dev_new",
        "account_type": "TALENT",
        "onboarding_intent": "DECIDE_LATER",
        "description": "Fresh account: empty profile, no listings/jobs/portfolio. Tests onboarding + empty states.",
    },
    {
        "key": "talent-complete",
        "label": "Talent — complete profile",
        "username": "dev_talent_pro",
        "account_type": "TALENT",
        "onboarding_intent": "LOOKING_FOR_WORK",
        "description": "Full talent profile, portfolio, a published listing, sent applications, received hiring requests.",
    },
    {
        "key": "talent-incomplete",
        "label": "Talent — incomplete profile",
        "username": "dev_talent_wip",
        "account_type": "TALENT",
        "onboarding_intent": "LOOKING_FOR_WORK",
        "description": "Minimal talent profile, no portfolio, missing tools/niches. Tests the completion checklist.",
    },
    {
        "key": "recruiter-active",
        "label": "Recruiter — active jobs",
        "username": "dev_recruiter",
        "account_type": "EMPLOYER",
        "onboarding_intent": "HIRING_CREATOR_TALENT",
        "description": "Verified hiring identity, several live jobs, received applications, saved talent, sent hiring requests.",
    },
    {
        "key": "recruiter-drafts",
        "label": "BrightLab Media — agency",
        "username": "dev_brightlab",
        "account_type": "EMPLOYER",
        "onboarding_intent": "HIRING_CREATOR_TALENT",
        "description": "Agency operator with draft jobs and verified, pending, and failed represented identities.",
    },
    {
        "key": "both-sides",
        "label": "Both sides user",
        "username": "dev_both_sides",
        "account_type": "BOTH",
        "onboarding_intent": "BOTH",
        "description": "Hires and gets hired on one login: talent listing + posted job, sent + received applications/requests.",
    },
    {
        "key": "admin",
        "label": "QA Moderator",
        "username": "dev_admin",
        "account_type": "ADMIN",
        "onboarding_intent": "DECIDE_LATER",
        "description": "Admin account with queued moderation reports. (Admin UI is backend-only today.)",
    },
    {
        "key": "notifications",
        "label": "Notifications test user",
        "username": "dev_notify",
        "account_type": "TALENT",
        "onboarding_intent": "LOOKING_FOR_WORK",
        "description": "A spread of read/unread notifications across event types. Tests the bell + notifications page.",
    },
]

PERSONA_KEYS = [item["key"] for item in PERSONA_DEFS]
QA_FIXTURE_KEYS = ("suspended-fixture",)


def persona_email(key: str) -> str:
    return f"{key}@{PERSONA_EMAIL_DOMAIN}"


def persona_user_id(key: str) -> uuid.UUID:
    return persona_uuid(f"user:{key}")


def persona_public_catalog() -> list[dict[str, str]]:
    """Serializable persona list for the dev API (no secrets beyond the shared dev password)."""

    return [
        {
            "key": item["key"],
            "label": item["label"],
            "email": persona_email(item["key"]),
            "accountType": item["account_type"],
            "description": item["description"],
        }
        for item in PERSONA_DEFS
    ]


# --- User rows --------------------------------------------------------------

def _base_user(key: str) -> dict[str, object]:
    meta = next(item for item in PERSONA_DEFS if item["key"] == key)
    return {
        "id": persona_user_id(key),
        "email": persona_email(key),
        "username": meta["username"],
        "display_name": None,
        "account_type": meta["account_type"],
        "account_type_selected_at": SEED_TIME,
        "onboarding_intent": meta["onboarding_intent"],
        "onboarding_intent_selected_at": SEED_TIME,
        "password_hash": _password_hash(),
        "email_verified_at": SEED_TIME,
        "created_at": SEED_TIME,
    }


def build_persona_users() -> list[dict[str, object]]:
    """One User payload per persona, with realistic profile fields per role."""

    users: list[dict[str, object]] = []

    # 1. New empty user — deliberately bare.
    new_empty = _base_user("new-empty")
    new_empty["display_name"] = "Dev New User"
    users.append(new_empty)

    # 2. Talent — complete profile.
    talent_complete = _base_user("talent-complete")
    talent_complete.update(
        {
            "display_name": "Priya Nair",
            "headline": "Retention-focused long-form editor for finance & education channels",
            "bio": "I edit scripted finance and education videos with calm pacing, clean motion, and retention-first structure.",
            "location": "Bengaluru, India",
            "timezone": "IST",
            "availability_status": "available",
            "availability": "Open to 2 long-form channels",
            "skills": ["Video editor", "Long-form editor", "Motion graphics"],
            "creator_platforms": ["YouTube"],
            "collaboration_working_hours": "IST overlap, 11am–7pm",
            "collaboration_turnaround": "5–7 days per long-form video",
            "collaboration_revisions": "2 rounds included",
            "collaboration_tools": "Premiere Pro, After Effects, Frame.io",
            "public_links": ["https://www.youtube.com/@financesimplified"],
        }
    )
    users.append(talent_complete)

    # 3. Talent — incomplete profile (minimal; missing tools/niches/portfolio).
    talent_incomplete = _base_user("talent-incomplete")
    talent_incomplete.update(
        {
            "display_name": "Rohan Das",
            "headline": "Shorts editor (just getting started)",
            "location": "Pune, India",
            "timezone": "IST",
            "availability_status": "selective",
            "skills": ["Shorts editor"],
        }
    )
    users.append(talent_incomplete)

    # 4. Recruiter — active jobs.
    recruiter_active = _base_user("recruiter-active")
    recruiter_active.update(
        {
            "display_name": "Finance Simplified",
            "headline": "Hiring editors & designers for a finance YouTube channel",
            "location": "Remote",
            "timezone": "IST",
            "hiring_type": "own_channel",
            "hiring_primary_platform": "youtube",
            "hiring_platforms": ["youtube"],
            "hiring_niches": ["Finance", "Education"],
            "hiring_genres": ["Explainers", "Tutorials"],
            "hiring_formats": ["Long-form", "Shorts", "Thumbnails"],
            "hiring_website_or_social_url": "https://www.youtube.com/@financesimplified",
            "hiring_channels_or_pages_managed": "Finance Simplified (own channel)",
            "hiring_verification_status": "verified",
        }
    )
    users.append(recruiter_active)

    # 5. Recruiter — drafts / pending access.
    recruiter_drafts = _base_user("recruiter-drafts")
    recruiter_drafts.update(
        {
            "display_name": "BrightLab Media",
            "headline": "Creator agency hiring for science, fitness, and education channels",
            "location": "Remote",
            "timezone": "IST",
            "hiring_type": "agency",
            "hiring_primary_platform": "youtube",
            "hiring_platforms": ["youtube"],
            "hiring_niches": ["Science"],
            "hiring_formats": ["Long-form", "Motion graphics"],
            "hiring_website_or_social_url": "https://www.youtube.com/@sciencedaily",
            "hiring_channels_or_pages_managed": "Science Daily, FitLab, BrightLab Education",
            "hiring_verification_status": "pending",
        }
    )
    users.append(recruiter_drafts)

    # 6. Both sides user — hires and gets hired.
    both_sides = _base_user("both-sides")
    both_sides.update(
        {
            "display_name": "Aditi Verma",
            "headline": "Podcast producer who edits long-form — and hires for my own show",
            "bio": "I produce and edit a creator-led interview podcast, and occasionally hire editors and thumbnail designers.",
            "location": "Mumbai, India",
            "timezone": "IST",
            "availability_status": "selective",
            "skills": ["Podcast producer", "Long-form editor"],
            "creator_platforms": ["YouTube", "Spotify"],
            "collaboration_working_hours": "IST, flexible",
            "collaboration_turnaround": "1 week per episode",
            "hiring_type": "own_channel",
            "hiring_primary_platform": "youtube",
            "hiring_platforms": ["youtube"],
            "hiring_niches": ["Interviews", "Creators"],
            "hiring_formats": ["Long-form", "Thumbnails"],
            "hiring_website_or_social_url": "https://www.youtube.com/@theinterviewroom",
            "hiring_verification_status": "verified",
        }
    )
    users.append(both_sides)

    # 7. Admin.
    admin = _base_user("admin")
    admin.update(
        {
            "display_name": "QA Moderator",
            "headline": "Platform moderation (dev)",
            "location": "Remote",
        }
    )
    users.append(admin)

    # 8. Notifications test user.
    notifications = _base_user("notifications")
    notifications.update(
        {
            "display_name": "Kabir Sethi",
            "headline": "Script writer for Hindi explainer channels",
            "location": "Delhi, India",
            "timezone": "IST",
            "availability_status": "available",
            "skills": ["Script writer"],
            "creator_platforms": ["YouTube"],
        }
    )
    users.append(notifications)

    # Non-switchable moderation target. It exists only so QA can verify hidden
    # profiles and suspended-account behavior without locking a usable persona.
    suspended = {
        "id": persona_user_id("suspended-fixture"),
        "email": persona_email("suspended-fixture"),
        "username": "qa_suspended",
        "display_name": "Suspended QA Fixture",
        "account_type": "TALENT",
        "account_type_selected_at": SEED_TIME,
        "onboarding_intent": "LOOKING_FOR_WORK",
        "onboarding_intent_selected_at": SEED_TIME,
        "password_hash": _password_hash(),
        "email_verified_at": SEED_TIME,
        "suspended_at": SEED_TIME,
        "suspension_reason": "Deterministic moderation fixture",
        "headline": "Non-switchable moderation test profile",
        "created_at": SEED_TIME,
    }
    users.append(suspended)

    return users


# --- Hiring identities (verification states) --------------------------------

def _identity(key: str, owner: str, **overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": persona_uuid(f"identity:{key}"),
        "owner_user_id": persona_user_id(owner),
        "type": "own_channel",
        "platform": "youtube",
        "display_name": "Channel",
        "verification_status": "UNVERIFIED",
        "verification_method": "NONE",
        "is_agency_represented": False,
        "created_at": SEED_TIME,
    }
    base.update(overrides)
    return base


def build_persona_hiring_identities() -> list[dict[str, object]]:
    return [
        _identity(
            "recruiter-active",
            "recruiter-active",
            display_name="Finance Simplified",
            handle="@financesimplified",
            url="https://www.youtube.com/@financesimplified",
            verification_status="VERIFIED",
            verification_method="YOUTUBE_CHANNEL_LINK",
            verified_at=SEED_TIME,
        ),
        _identity(
            "recruiter-drafts-pending",
            "recruiter-drafts",
            type="represented",
            display_name="Science Daily",
            handle="@sciencedaily",
            url="https://www.youtube.com/@sciencedaily",
            verification_status="PENDING",
            verification_method="CODE_IN_DESCRIPTION",
            verification_code="CJ-DEV-SCI-2026",
            is_agency_represented=True,
            managed_by_agency_name="BrightLab Media",
        ),
        # An explicit failed-verification identity for the verification-states scenario.
        _identity(
            "recruiter-drafts-failed",
            "recruiter-drafts",
            platform="instagram",
            type="represented",
            display_name="Science Daily IG (agency)",
            handle="@sciencedaily.ig",
            url="https://www.instagram.com/sciencedaily.ig",
            is_agency_represented=True,
            managed_by_agency_name="BrightLab Media",
            verification_status="UNVERIFIED",
            verification_method="CODE_IN_DESCRIPTION",
            verification_last_error="Verification code not found in the page bio.",
        ),
        _identity(
            "recruiter-drafts-verified",
            "recruiter-drafts",
            type="represented",
            platform="youtube",
            display_name="FitLab",
            handle="@fitlab",
            url="https://www.youtube.com/@fitlab",
            is_agency_represented=True,
            managed_by_agency_name="BrightLab Media",
            verification_status="VERIFIED",
            verification_method="CODE_IN_DESCRIPTION",
            verified_at=SEED_TIME,
        ),
        _identity(
            "both-sides",
            "both-sides",
            display_name="The Interview Room",
            handle="@theinterviewroom",
            url="https://www.youtube.com/@theinterviewroom",
            verification_status="VERIFIED",
            verification_method="YOUTUBE_CHANNEL_LINK",
            verified_at=SEED_TIME,
        ),
    ]


# --- Talent listings --------------------------------------------------------

def _listing(key: str, owner: str, **overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": persona_uuid(f"listing:{key}"),
        "owner_user_id": persona_user_id(owner),
        "roles": [],
        "content_niches": [],
        "content_genres": [],
        "formats": [],
        "platforms": [],
        "tools": [],
        "languages": [],
        "rate_currency": "INR",
        "availability_status": "selective",
        "portfolio_item_ids": [],
        "first_message_requirements": [],
        "status": "draft",
        "is_featured": False,
        "created_at": SEED_TIME,
    }
    base.update(overrides)
    return base


def build_persona_talent_listings() -> list[dict[str, object]]:
    return [
        _listing(
            "talent-complete",
            "talent-complete",
            title="Retention-focused long-form editor for finance & education channels",
            primary_role="Video editor",
            experience_years=6,
            roles=["Video editor", "Long-form editor"],
            niche="Finance",
            content_niches=["Finance", "Education"],
            content_genres=["Explainers", "Tutorials"],
            formats=["Long-form", "Explainers"],
            platforms=["YouTube"],
            tools=["Premiere Pro", "After Effects", "Frame.io"],
            languages=["Hindi", "English"],
            work_mode="remote",
            location="Bengaluru, India",
            timezone="IST",
            availability_status="available",
            rate_min=20000,
            rate_max=60000,
            rate_note="₹20,000 per long-form video",
            open_slots=2,
            turnaround="5–7 days",
            description="Edits scripted finance/education videos with clean pacing, retention graphs, and calm motion systems.",
            first_message_requirements=[
                "project_budget",
                "project_brief",
                "turnaround",
                "working_hours",
                "channel_or_brand_link",
                "reference_links",
                "start_availability",
                "fit_note",
            ],
            status="published",
            is_featured=True,
        ),
        _listing(
            "both-sides",
            "both-sides",
            title="Podcast producer who also edits long-form interviews",
            primary_role="Podcast producer",
            experience_years=4,
            roles=["Podcast producer", "Long-form editor"],
            niche="Interviews",
            content_niches=["Interviews", "Creators"],
            content_genres=["Interviews"],
            formats=["Long-form", "Podcast"],
            platforms=["YouTube", "Spotify"],
            tools=["Descript", "Premiere Pro", "Riverside"],
            languages=["English"],
            work_mode="remote",
            location="Mumbai, India",
            timezone="IST",
            availability_status="selective",
            rate_min=15000,
            rate_max=40000,
            rate_note="₹15,000 per episode",
            open_slots=1,
            turnaround="1 week",
            description="Produces and edits creator-led interview episodes end to end: cleanup, structure, chapters, and clips.",
            first_message_requirements=[
                "project_budget",
                "project_brief",
                "turnaround",
                "fit_note",
            ],
            status="published",
        ),
        # Recruiter persona also drafting a talent listing — tests draft listings.
        _listing(
            "recruiter-drafts",
            "recruiter-drafts",
            title="Researcher for history channels (draft)",
            primary_role="Researcher",
            roles=["Researcher"],
            niche="History",
            content_niches=["History"],
            formats=["Long-form"],
            platforms=["YouTube"],
            languages=["English"],
            work_mode="remote",
            location="Remote",
            timezone="IST",
            description="Draft listing — still adding tools, rate, and availability.",
            status="draft",
        ),
        _listing(
            "notifications",
            "notifications",
            title="Hindi explainer scriptwriter for science and business channels",
            primary_role="Script writer",
            experience_years=3,
            roles=["Script writer", "Researcher"],
            niche="Education",
            content_niches=["Education", "Science", "Business"],
            content_genres=["Explainers"],
            formats=["Long-form", "Shorts"],
            platforms=["YouTube", "Instagram"],
            tools=["Google Docs", "Notion"],
            languages=["Hindi", "English"],
            work_mode="remote",
            location="Delhi, India",
            timezone="IST",
            availability_status="available",
            rate_note="Contact for pricing",
            turnaround="3–5 days",
            description="Research-led Hindi scripts with clear hooks, simple explanations, and creator-ready structure.",
            first_message_requirements=["project_brief", "channel_or_brand_link", "custom_instruction"],
            first_message_custom_instruction="Share the topic and one reference whose tone you want to match.",
            status="published",
        ),
    ]


# --- Jobs -------------------------------------------------------------------

def _job(key: str, owner: str, **overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": persona_uuid(f"job:{key}"),
        "posted_by_user_id": persona_user_id(owner),
        "category": "Editing",
        "location": "Remote",
        "budget_currency": "INR",
        "budget_unit": "per project",
        "platforms": [],
        "responsibilities": [],
        "requirements": [],
        "application_requirements": [],
        "reference_videos": [],
        "tags": [],
        "languages": [],
        "content_niches": [],
        "content_genres": [],
        "formats_hired_for": [],
        "application_mode": "internal",
        "status": "draft",
        "created_at": SEED_TIME,
    }
    base.update(overrides)
    return base


def build_persona_jobs() -> list[dict[str, object]]:
    """Published jobs (recruiter-active, both-sides) + draft/pending jobs (recruiter-drafts)."""

    verified_identity_id = persona_uuid("identity:recruiter-active")
    return [
        _job(
            "recruiter-active-1",
            "recruiter-active",
            title="Long-form video editor for a finance YouTube channel",
            category="Editing",
            budget_amount=25000,
            experience_level="3-5 years",
            platforms=["youtube"],
            start_timeframe="<1mo",
            work_mode="remote",
            about_channel="A finance education channel publishing weekly long-form explainers.",
            responsibilities=["Edit weekly long-form videos", "Build retention-first structure", "Add light motion graphics"],
            requirements=["3+ years long-form editing", "Premiere Pro + After Effects", "Strong sense of pacing"],
            application_requirements=[
                "expected_rate",
                "relevant_portfolio",
                "turnaround",
                "working_hours",
                "relevant_experience",
                "tools_workflow",
                "start_availability",
                "fit_note",
            ],
            tags=["finance", "long-form", "retention"],
            languages=["Hindi", "English"],
            content_niches=["Finance", "Education"],
            content_genres=["Explainers"],
            formats_hired_for=["Long-form"],
            is_verified=True,
            channel_name="Finance Simplified",
            hiring_identity_id=verified_identity_id,
            hiring_display_name_snapshot="Finance Simplified",
            hiring_platform_snapshot="youtube",
            hiring_verification_status_snapshot="VERIFIED",
            status="published",
        ),
        _job(
            "recruiter-active-2",
            "recruiter-active",
            title="Thumbnail designer for a gaming channel",
            category="Thumbnails",
            budget_amount=1800,
            experience_level="1-3 years",
            platforms=["youtube"],
            start_timeframe="ASAP",
            work_mode="remote",
            about_channel="A high-volume gaming channel needing scroll-stopping thumbnails.",
            responsibilities=["Design 3-4 thumbnails per week", "A/B concept variations"],
            requirements=["Photoshop", "Strong typography and composition"],
            application_requirements=["expected_rate", "relevant_portfolio", "fit_note"],
            tags=["gaming", "thumbnails", "ctr"],
            languages=["English"],
            content_niches=["Gaming"],
            formats_hired_for=["Thumbnails"],
            is_verified=True,
            channel_name="Finance Simplified",
            hiring_identity_id=verified_identity_id,
            hiring_display_name_snapshot="Finance Simplified",
            hiring_platform_snapshot="youtube",
            hiring_verification_status_snapshot="VERIFIED",
            status="published",
        ),
        _job(
            "recruiter-active-3",
            "recruiter-active",
            title="Shorts editor for a fitness creator",
            category="Shorts",
            budget_amount=3000,
            experience_level="1-3 years",
            platforms=["youtube", "instagram"],
            start_timeframe="<1mo",
            work_mode="remote",
            about_channel="A fitness creator scaling daily short-form output.",
            responsibilities=["Cut 5 shorts per week", "Punchy hooks and captions"],
            requirements=["CapCut or Premiere Pro", "Understands short-form retention"],
            application_requirements=["expected_rate", "turnaround", "start_availability", "fit_note"],
            tags=["fitness", "shorts", "reels"],
            languages=["Hindi", "English"],
            content_niches=["Fitness"],
            formats_hired_for=["Shorts", "Reels"],
            channel_name="Finance Simplified",
            status="published",
        ),
        # both-sides posts one published job.
        _job(
            "both-sides-1",
            "both-sides",
            title="Podcast video editor for a creator-led interview show",
            category="Editing",
            budget_amount=12000,
            experience_level="3-5 years",
            platforms=["youtube"],
            start_timeframe="Flexible",
            work_mode="remote",
            about_channel="A weekly interview podcast publishing on YouTube and Spotify.",
            responsibilities=["Edit full episodes", "Cut highlight clips", "Add chapters"],
            requirements=["Multicam podcast editing", "Descript or Premiere Pro"],
            application_requirements=[
                "expected_rate",
                "relevant_portfolio",
                "turnaround",
                "tools_workflow",
            ],
            tags=["podcast", "interviews", "long-form"],
            languages=["English"],
            content_niches=["Interviews"],
            formats_hired_for=["Long-form", "Podcast"],
            is_verified=True,
            channel_name="The Interview Room",
            hiring_identity_id=persona_uuid("identity:both-sides"),
            hiring_display_name_snapshot="The Interview Room",
            hiring_platform_snapshot="youtube",
            hiring_verification_status_snapshot="VERIFIED",
            status="published",
        ),
        # recruiter-drafts: three drafts in different states.
        _job(
            "recruiter-drafts-1",
            "recruiter-drafts",
            title="Scriptwriter for a Hindi explainer channel",
            category="Writing",
            budget_amount=8000,
            platforms=["youtube"],
            about_channel="Science explainers in Hindi.",
            languages=["Hindi"],
            content_niches=["Science"],
            status="draft",
        ),
        _job(
            "recruiter-drafts-2",
            "recruiter-drafts",
            title="Motion graphics editor for a science channel",
            category="Motion Graphics",
            budget_amount=20000,
            platforms=["youtube"],
            about_channel="Animated science explainers — waiting on channel verification before publishing.",
            content_niches=["Science"],
            formats_hired_for=["Motion graphics"],
            hiring_identity_id=persona_uuid("identity:recruiter-drafts-pending"),
            hiring_display_name_snapshot="Science Daily",
            hiring_platform_snapshot="youtube",
            hiring_verification_status_snapshot="PENDING",
            status="draft",
        ),
        _job(
            "recruiter-drafts-3",
            "recruiter-drafts",
            title="Channel manager for a history channel",
            category="Channel Manager",
            budget_amount=30000,
            budget_unit="per month",
            platforms=["youtube"],
            about_channel="History documentary channel — draft, publish not completed yet.",
            content_niches=["History"],
            status="draft",
        ),
        # Non-public listing retained for moderation and soft-delete QA.
        _job(
            "hidden-moderation",
            "recruiter-active",
            title="Hidden moderation fixture — do not publish",
            category="Editing",
            budget_amount=10000,
            platforms=["youtube"],
            work_mode="remote",
            about_channel="Deterministic soft-deleted listing for moderation QA.",
            status="published",
            deleted_at=SEED_TIME,
        ),
    ]


# --- Portfolio items (talent-complete only) ---------------------------------

def build_persona_portfolio_items() -> list[dict[str, object]]:
    owner = persona_user_id("talent-complete")
    common = {
        "user_id": owner,
        "source_type": "youtube",
        "visibility": "public",
        "publish_status": "published",
        "verification_status": "manual",
        "is_public": True,
        "created_at": SEED_TIME,
    }
    return [
        {
            **common,
            "id": persona_uuid("portfolio:talent-complete:1"),
            "title": "How index funds actually work (12-min explainer)",
            "role": "Video editor",
            "role_name": "Video editor",
            "user_role_in_project": "Lead editor",
            "youtube_url": "https://www.youtube.com/watch?v=dev-portfolio-1",
            "source_url": "https://www.youtube.com/watch?v=dev-portfolio-1",
            "channel_name": "Finance Simplified",
            "description": "Restructured the script edit for retention; added chapter motion and clean lower-thirds.",
            "what_i_did": "Restructured the edit for retention, rebuilt chapter transitions, added lower-thirds, and packaged the story so finance concepts were easier to follow.",
            "contribution_highlights": [
                "Reworked the intro hook",
                "Added chapter motion and lower-thirds",
                "Tightened pacing around dense finance explanations",
            ],
            "timestamp_notes": [
                {
                    "id": "hook",
                    "time": "0:12",
                    "seconds": 12,
                    "title": "Hook restructure",
                    "description": "Moved the strongest payoff to the opening and reduced setup time.",
                },
                {
                    "id": "chapter-motion",
                    "time": "0:48",
                    "seconds": 48,
                    "title": "Chapter motion",
                    "description": "Added visual resets so each index-fund concept is easy to track.",
                },
            ],
            "tools": ["Premiere Pro", "After Effects"],
            "content_niches": ["Finance", "Education"],
            "content_genres": ["Explainers"],
            "platforms": ["YouTube"],
            "formats": ["Long-form video"],
            "results": ["12-min explainer", "Chaptered edit"],
            "contribution_tags": ["Editing", "Motion graphics", "Pacing"],
            "is_featured": True,
        },
        {
            **common,
            "id": persona_uuid("portfolio:talent-complete:2"),
            "title": "Why startups fail — education explainer",
            "role": "Long-form editor",
            "role_name": "Long-form editor",
            "user_role_in_project": "Editor",
            "youtube_url": "https://www.youtube.com/watch?v=dev-portfolio-2",
            "source_url": "https://www.youtube.com/watch?v=dev-portfolio-2",
            "channel_name": "Finance Simplified",
            "description": "Tightened a 20-minute cut to 13 minutes while keeping the narrative arc intact.",
            "what_i_did": "Cut a loose 20-minute education draft into a sharper 13-minute story, preserving the argument while removing dead air and repeated beats.",
            "contribution_highlights": [
                "Reduced runtime without losing context",
                "Reordered sections for clearer story flow",
                "Prepared review notes for the channel team",
            ],
            "timestamp_notes": [
                {
                    "id": "argument-reset",
                    "time": "1:05",
                    "seconds": 65,
                    "title": "Argument reset",
                    "description": "Reordered the explanation so the failure pattern lands before the examples.",
                }
            ],
            "tools": ["Premiere Pro", "Frame.io"],
            "content_niches": ["Business", "Education"],
            "content_genres": ["Case studies", "Explainers"],
            "platforms": ["YouTube"],
            "formats": ["Long-form video"],
            "results": ["20 min cut reduced to 13 min"],
            "contribution_tags": ["Editing", "Story structure"],
            "is_featured": False,
        },
    ]


# --- Applications (sent + received across personas) -------------------------

def _application(
    applicant: str,
    job_key: str,
    owner: str,
    status: str,
    cover_note: str,
    answers: dict[str, object] | None = None,
) -> dict[str, object]:
    applicant_user = next(
        user for user in build_persona_users()
        if user["id"] == persona_user_id(applicant)
    )
    return {
        "id": persona_uuid(f"application:{applicant}:{job_key}"),
        "job_id": persona_uuid(f"job:{job_key}"),
        "applicant_user_id": persona_user_id(applicant),
        "job_owner_user_id": persona_user_id(owner),
        "cover_note": cover_note,
        "portfolio_item_ids": [],
        "first_message_answers": answers or {},
        "applicant_snapshot": {
            "display_name": applicant_user.get("display_name"),
            "username": applicant_user.get("username"),
            "headline": applicant_user.get("headline"),
            "skills": applicant_user.get("skills") or [],
            "location": applicant_user.get("location"),
            "timezone": applicant_user.get("timezone"),
        },
        "status": status,
        "participant_status": (
            status
            if status in {"interviewing", "hired", "rejected", "withdrawn"}
            else "new"
        ),
        "created_at": SEED_TIME,
    }


def build_persona_applications() -> list[dict[str, object]]:
    applications = [
        _application(
            "talent-complete", "recruiter-active-1", "recruiter-active", "shortlisted",
            "Hi, I came across the listing and would love to help with the finance channel edits.",
            answers={
                "expected_rate": {"amount": "25000", "unit": "per video"},
                "relevant_portfolio": [
                    {
                        "id": str(persona_uuid("portfolio:talent-complete:1")),
                        "title": "How index funds actually work (12-min explainer)",
                        "url": "https://www.youtube.com/watch?v=dev-portfolio-1",
                    },
                    {
                        "id": str(persona_uuid("portfolio:talent-complete:2")),
                        "title": "Why startups fail — education explainer",
                        "url": "https://www.youtube.com/watch?v=dev-portfolio-2",
                    },
                ],
                "turnaround": {"value": "5", "unit": "days"},
                "working_hours": "Evenings IST",
                "relevant_experience": "6 years editing finance and education explainers.",
                "tools_workflow": ["Premiere Pro", "After Effects", "Frame.io"],
                "start_availability": "Within 1 week",
                "fit_note": "I already edit finance explainers, so I can match the channel's pacing quickly.",
            },
        ),
        _application(
            "talent-complete", "recruiter-active-3", "recruiter-active", "new",
            "Hi, I can help with the daily shorts workflow.",
            answers={
                "expected_rate": {"amount": "3000", "unit": "per video"},
                "turnaround": {"value": "2", "unit": "days"},
                "start_availability": "Immediately",
                "fit_note": "I can keep a repeatable short-form cadence without slowing the channel down.",
            },
        ),
        _application(
            "both-sides", "recruiter-active-1", "recruiter-active", "rejected",
            "Hi, I mostly do podcast long-form and wanted to put my name in.",
            answers={
                "expected_rate": {"amount": "18000", "unit": "per video"},
                "relevant_portfolio": [
                    {
                        "id": "link:podcast-case-study",
                        "title": "Podcast case study",
                        "url": "https://portfolio.example.com/podcast-case-study",
                    }
                ],
                "turnaround": {"value": "7", "unit": "days"},
                "working_hours": "Flexible overlap",
                "relevant_experience": "4 years producing and editing creator interviews.",
                "tools_workflow": ["Descript", "Premiere Pro", "Riverside"],
                "start_availability": "Within 2 weeks",
                "fit_note": "The role is close to my long-form interview workflow, though finance is a newer niche for me.",
            },
        ),
        # talent-complete applies to both-sides' job → gives both-sides a received application.
        _application(
            "talent-complete", "both-sides-1", "both-sides", "new",
            "Hi, I edit long-form interviews and would love to cut your episodes.",
            answers={
                "expected_rate": {"amount": "15000", "unit": "per video"},
                "relevant_portfolio": [
                    {
                        "id": str(persona_uuid("portfolio:talent-complete:2")),
                        "title": "Why startups fail — education explainer",
                        "url": "https://www.youtube.com/watch?v=dev-portfolio-2",
                    }
                ],
                "turnaround": {"value": "1", "unit": "weeks"},
                "tools_workflow": ["Premiere Pro", "Frame.io"],
            },
        ),
        _application(
            "new-empty", "recruiter-active-1", "recruiter-active", "reviewing",
            "I am building my first public portfolio and can complete a short paid editing test.",
            answers={
                "expected_rate": {"amount": "9000", "unit": "per video"},
                "turnaround": {"value": "6", "unit": "days"},
                "fit_note": "I am ready to demonstrate my workflow through a scoped paid test.",
            },
        ),
        _application(
            "talent-incomplete", "both-sides-1", "both-sides", "interviewing",
            "I am early in my career and would like to complete a short paid editing test.",
            answers={
                "expected_rate": {"amount": "8000", "unit": "per episode"},
                "turnaround": {"value": "7", "unit": "days"},
                "tools_workflow": ["Premiere Pro"],
            },
        ),
        _application(
            "notifications", "both-sides-1", "both-sides", "archived",
            "I write interview research briefs and can also support chapter planning.",
            answers={
                "expected_rate": {"amount": "6000", "unit": "per episode"},
                "turnaround": {"value": "4", "unit": "days"},
                "tools_workflow": ["Google Docs", "Notion"],
            },
        ),
        _application(
            "new-empty", "recruiter-active-2", "recruiter-active", "withdrawn",
            "Historical withdrawn application used to verify empty-profile edge handling.",
            answers={},
        ),
    ]
    # Review-system scenarios. These are real hired source records so Inbox and
    # Pipeline exercise the same contracts as user-created engagements.
    for applicant, job_key, owner, label in (
        ("both-sides", "recruiter-active-3", "recruiter-active", "active"),
        ("talent-incomplete", "recruiter-active-1", "recruiter-active", "start-pending"),
        ("talent-incomplete", "recruiter-active-2", "recruiter-active", "completion-pending"),
        ("both-sides", "recruiter-active-2", "recruiter-active", "review-eligible"),
        ("notifications", "recruiter-active-1", "recruiter-active", "blind-review"),
        ("notifications", "recruiter-active-2", "recruiter-active", "published-reviews"),
        ("talent-incomplete", "recruiter-active-3", "recruiter-active", "cancelled"),
        ("notifications", "recruiter-active-3", "recruiter-active", "ended-after-start"),
        ("notifications", "hidden-moderation", "recruiter-active", "moderated-review"),
    ):
        applications.append(
            _application(
                applicant,
                job_key,
                owner,
                "hired",
                f"Review-system demo application: {label}.",
                answers={
                    "expected_rate": {"amount": "25000", "unit": "per project"},
                    "fit_note": f"Deterministic {label} engagement for UI testing.",
                },
            )
        )
    return applications


# --- Engagement and blind-review scenarios ---------------------------------

REVIEW_WINDOW_END = SEED_TIME.replace(year=2030)
RESPONSE_DEADLINE = REVIEW_WINDOW_END

REVIEW_SCENARIOS: tuple[dict[str, object], ...] = (
    {"key": "active", "applicant": "both-sides", "job": "recruiter-active-3", "status": "active"},
    {"key": "start-pending", "applicant": "talent-incomplete", "job": "recruiter-active-1", "status": "start_pending"},
    {"key": "completion-pending", "applicant": "talent-incomplete", "job": "recruiter-active-2", "status": "completion_pending"},
    {"key": "review-eligible", "applicant": "both-sides", "job": "recruiter-active-2", "status": "completed"},
    {"key": "blind-review", "applicant": "notifications", "job": "recruiter-active-1", "status": "completed"},
    {"key": "published-reviews", "applicant": "notifications", "job": "recruiter-active-2", "status": "completed"},
    {"key": "cancelled", "applicant": "talent-incomplete", "job": "recruiter-active-3", "status": "cancelled_before_start"},
    {"key": "ended-after-start", "applicant": "notifications", "job": "recruiter-active-3", "status": "ended_after_start"},
    {"key": "moderated-review", "applicant": "notifications", "job": "hidden-moderation", "status": "completed"},
)


def build_persona_engagements() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for scenario in REVIEW_SCENARIOS:
        key = str(scenario["key"])
        applicant = str(scenario["applicant"])
        job_key = str(scenario["job"])
        state = str(scenario["status"])
        application_id = persona_uuid(f"application:{applicant}:{job_key}")
        row: dict[str, object] = {
            "id": persona_uuid(f"engagement:{key}"),
            "source_type": "job_application",
            "source_record_id": application_id,
            "application_id": application_id,
            "recruiter_user_id": persona_user_id("recruiter-active"),
            "talent_user_id": persona_user_id(applicant),
            "context_snapshot": {
                "context_label": f"Review demo · {key.replace('-', ' ')}",
                "recruiter_name": "Finance Simplified",
                "talent_name": next(
                    str(user.get("display_name") or "Talent")
                    for user in build_persona_users()
                    if user["id"] == persona_user_id(applicant)
                ),
            },
            "status": state,
            "created_at": SEED_TIME,
        }
        if state == "start_pending":
            row.update(
                start_requested_by_user_id=persona_user_id(applicant),
                start_requested_at=SEED_TIME,
                start_response_due_at=RESPONSE_DEADLINE,
            )
        if state in {"active", "completion_pending", "completed", "ended_after_start"}:
            row["started_at"] = SEED_TIME + timedelta(days=1)
        if state == "completion_pending":
            row.update(
                completion_requested_by_user_id=persona_user_id(applicant),
                completion_requested_at=SEED_TIME + timedelta(days=6),
                completion_response_due_at=RESPONSE_DEADLINE,
                requested_outcome="completed",
                completion_note="All agreed deliverables were sent.",
            )
        if state in {"completed", "ended_after_start"}:
            row.update(
                finalized_at=SEED_TIME + timedelta(days=7),
                review_window_ends_at=REVIEW_WINDOW_END,
            )
        if state == "cancelled_before_start":
            row["finalized_at"] = SEED_TIME + timedelta(days=1)
        rows.append(row)
    return rows


def build_persona_engagement_reviews() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []

    def review(
        key: str,
        direction: str,
        reviewer: str | None,
        reviewee: str,
        status: str,
        rating: int,
        feedback: str,
    ) -> dict[str, object]:
        reviewer_user = (
            next(user for user in build_persona_users() if user["id"] == persona_user_id(reviewer))
            if reviewer is not None
            else None
        )
        published_at = SEED_TIME + timedelta(days=8) if status in {"published", "hidden"} else None
        row: dict[str, object] = {
            "id": persona_uuid(f"engagement-review:{key}:{direction}"),
            "engagement_id": persona_uuid(f"engagement:{key}"),
            "reviewer_user_id": persona_user_id(reviewer) if reviewer is not None else None,
            "reviewee_user_id": persona_user_id(reviewee),
            "direction": direction,
            "reviewer_snapshot": {
                "display_name": (
                    reviewer_user.get("display_name") or reviewer_user.get("username")
                    if reviewer_user is not None
                    else "Former collaborator"
                ),
                "avatar_url": reviewer_user.get("avatar_url") if reviewer_user is not None else None,
                "role": "Hiring team" if direction == "recruiter_to_talent" else "Creator talent",
            },
            "overall_rating": rating,
            "dimension_ratings": {},
            "public_feedback": feedback,
            "status": status,
            "submitted_at": SEED_TIME + timedelta(days=8),
            "published_at": published_at,
            "created_at": SEED_TIME + timedelta(days=8),
        }
        if status == "hidden":
            row.update(
                hidden_at=SEED_TIME + timedelta(days=9),
                hidden_by_user_id=persona_user_id("admin"),
                hidden_reason="Deterministic hidden review for moderation QA.",
            )
        return row

    rows.append(
        review(
            "blind-review",
            "talent_to_recruiter",
            "notifications",
            "recruiter-active",
            "submitted",
            4,
            "The brief was clear and decisions were prompt throughout the project.",
        )
    )
    rows.extend(
        [
            review(
                "published-reviews",
                "talent_to_recruiter",
                "notifications",
                "recruiter-active",
                "published",
                5,
                "Clear expectations, thoughtful feedback, and a professional collaboration.",
            ),
            review(
                "published-reviews",
                "recruiter_to_talent",
                "recruiter-active",
                "notifications",
                "published",
                4,
                "Reliable delivery and strong attention to the intended audience.",
            ),
        ]
    )
    # One moderated review and one published review whose author no longer exists
    # exercise hidden-content exclusion and the "Former collaborator" fallback.
    rows.extend(
        [
            review(
                "moderated-review",
                "talent_to_recruiter",
                "notifications",
                "recruiter-active",
                "hidden",
                2,
                "This review stays out of public aggregates while moderation is active.",
            ),
            review(
                "moderated-review",
                "recruiter_to_talent",
                None,
                "notifications",
                "published",
                4,
                "Clear communication and a thoughtful final handoff.",
            ),
        ]
    )
    return rows


def build_persona_review_conversations() -> list[dict[str, object]]:
    return [
        {
            "id": persona_uuid(f"conversation:engagement:{scenario['key']}"),
            "context_type": "job_application",
            "application_id": persona_uuid(f"application:{scenario['applicant']}:{scenario['job']}"),
            "job_id": persona_uuid(f"job:{scenario['job']}"),
            "participant_a_user_id": persona_user_id(str(scenario["applicant"])),
            "participant_b_user_id": persona_user_id("recruiter-active"),
            "last_message_at": SEED_TIME + timedelta(days=7),
            "metadata_json": {},
            "created_at": SEED_TIME,
        }
        for scenario in REVIEW_SCENARIOS
    ]


def build_persona_review_messages() -> list[dict[str, object]]:
    event_copy = {
        "active": "Work started.",
        "start-pending": "Work start confirmation requested.",
        "completion-pending": "Completion confirmation requested.",
        "review-eligible": "Engagement completed.",
        "blind-review": "Engagement completed. Feedback is available.",
        "published-reviews": "Engagement feedback published.",
        "cancelled": "Engagement cancelled before work started.",
        "ended-after-start": "Engagement ended after work began.",
        "moderated-review": "Engagement feedback entered moderation.",
    }
    return [
        {
            "id": persona_uuid(f"message:engagement:{scenario['key']}"),
            "conversation_id": persona_uuid(f"conversation:engagement:{scenario['key']}"),
            "sender_user_id": persona_user_id(str(scenario["applicant"])),
            "body": event_copy[str(scenario["key"])],
            "metadata_json": {
                "kind": "engagement_update",
                "engagement_id": str(persona_uuid(f"engagement:{scenario['key']}")),
            },
            "created_at": SEED_TIME + timedelta(days=7),
        }
        for scenario in REVIEW_SCENARIOS
    ]


def all_review_engagement_ids() -> list[uuid.UUID]:
    return [persona_uuid(f"engagement:{scenario['key']}") for scenario in REVIEW_SCENARIOS]


def all_review_conversation_ids() -> list[uuid.UUID]:
    return [persona_uuid(f"conversation:engagement:{scenario['key']}") for scenario in REVIEW_SCENARIOS]


# --- Hiring requests / talent interests -------------------------------------

def _interest(
    recruiter: str,
    listing_key: str,
    owner: str,
    status: str,
    note: str,
    answers: dict[str, object] | None = None,
    job_key: str | None = None,
) -> dict[str, object]:
    return {
        "id": persona_uuid(f"interest:{recruiter}:{listing_key}"),
        "talent_listing_id": persona_uuid(f"listing:{listing_key}"),
        "recruiter_user_id": persona_user_id(recruiter),
        "owner_user_id": persona_user_id(owner),
        "job_id": persona_uuid(f"job:{job_key}") if job_key else None,
        "note": note,
        "first_message_answers": answers or {},
        "status": status,
        "participant_status": (
            status if status in {"contacted", "declined", "withdrawn"} else "new"
        ),
        "created_at": SEED_TIME,
    }


def build_persona_interests() -> list[dict[str, object]]:
    # NOTE: recruiter-active → talent-complete is deliberately NOT seeded. That is the
    # default "send hiring request" workflow, and the dev workflow tester must create
    # it for real so the talent genuinely receives fresh state — not reuse a fixture.
    return [
        # both-sides (as recruiter) reaches out to talent-complete → talent-complete received.
        _interest(
            "both-sides", "talent-complete", "talent-complete", "contacted",
            "Hi, I came across your listing and would like to discuss a small interview-editing batch.",
            answers={
                "project_budget": {"amount": "40000", "unit": "per project"},
                "project_brief": "Two interview episodes with long-form cleanup, chapters, and Shorts cutdowns.",
                "turnaround": {"value": "1", "unit": "weeks"},
                "working_hours": "Flexible overlap",
                "channel_or_brand_link": "https://youtube.com/@interviewroom",
                "reference_links": [
                    "https://youtube.com/watch?v=reference-interview-1",
                    "https://youtube.com/watch?v=reference-interview-2",
                ],
                "start_availability": "Within 2 weeks",
                "fit_note": "Your finance and education pacing work looks relevant to our interview edits.",
            },
            job_key="both-sides-1",
        ),
        # recruiter-active reaches out to both-sides' listing → both-sides received a hiring request.
        _interest(
            "recruiter-active", "both-sides", "both-sides", "new",
            "Hi, we need a podcast-style editor for founder interviews.",
            answers={
                "project_budget": {"amount": "30000", "unit": "per month"},
                "project_brief": "Four founder interviews per month with cleanup, chapters, and highlight clips.",
                "turnaround": {"value": "5", "unit": "days"},
                "fit_note": "Your interview-production background matches the format we publish weekly.",
            },
            job_key="recruiter-active-1",
        ),
        _interest(
            "recruiter-active", "notifications", "notifications", "reviewing",
            "We are reviewing writers for a six-video Hindi finance series.",
            answers={
                "project_brief": "Six Hindi finance explainers for first-time investors.",
                "channel_or_brand_link": "https://youtube.com/@financesimplified",
                "custom_instruction": "Begin with one topic you would simplify first and explain why.",
            },
            job_key="recruiter-active-3",
        ),
        _interest(
            "recruiter-drafts", "notifications", "notifications", "declined",
            "BrightLab invited you to a science Shorts scripting sprint.",
            answers={
                "project_brief": "Ten science Shorts scripts for a represented creator.",
                "channel_or_brand_link": "https://youtube.com/@sciencedaily",
                "custom_instruction": "Share one science myth you would turn into a 45-second script.",
            },
        ),
        _interest(
            "both-sides", "notifications", "notifications", "archived",
            "Archived outreach for a completed podcast research batch.",
            answers={
                "project_brief": "Interview research and chapter notes for four episodes.",
                "channel_or_brand_link": "https://youtube.com/@theinterviewroom",
                "custom_instruction": "Name one interview you would use as a structural reference.",
            },
            job_key="both-sides-1",
        ),
        _interest(
            "new-empty", "notifications", "notifications", "withdrawn",
            "Withdrawn test outreach used to verify sender-side history states.",
            answers={},
        ),
    ]


# --- Saved items ------------------------------------------------------------

def build_persona_saved_jobs() -> list[dict[str, object]]:
    return [
        {
            "id": persona_uuid("savedjob:talent-complete:recruiter-active-2"),
            "user_id": persona_user_id("talent-complete"),
            "job_id": persona_uuid("job:recruiter-active-2"),
            "note": "Thumbnail gig to revisit",
            "job_snapshot": {},
            "created_at": SEED_TIME,
        },
        {
            "id": persona_uuid("savedjob:talent-complete:both-sides-1"),
            "user_id": persona_user_id("talent-complete"),
            "job_id": persona_uuid("job:both-sides-1"),
            "note": "Podcast editing — good fit",
            "job_snapshot": {},
            "created_at": SEED_TIME,
        },
    ]


def build_persona_saved_talent() -> list[dict[str, object]]:
    return [
        {
            "id": persona_uuid("savedtalent:recruiter-active:talent-complete"),
            "user_id": persona_user_id("recruiter-active"),
            "talent_listing_id": persona_uuid("listing:talent-complete"),
            "note": "Strong long-form editor — shortlist",
            "talent_snapshot": {},
            "created_at": SEED_TIME,
        },
    ]


# --- Notifications (for the notifications persona) --------------------------

def build_persona_notifications() -> list[dict[str, object]]:
    recipient = persona_user_id("notifications")

    def notif(idx: int, type_: str, category: str, priority: str, title: str, body: str, read: bool) -> dict[str, object]:
        return {
            "id": persona_uuid(f"notif:notifications:{idx}"),
            "user_id": recipient,
            "type": type_,
            "category": category,
            "priority": priority,
            "title": title,
            "body": body,
            "read_at": SEED_TIME if read else None,
            "created_at": SEED_TIME,
        }

    return [
        notif(1, "new_applicant", "transactional", "high",
              "New applicant", "Priya Nair applied to “Scriptwriter for a Hindi explainer channel”.", False),
        notif(2, "application_status_changed", "transactional", "high",
              "You were shortlisted", "Your application to “Long-form video editor” was moved to shortlisted.", False),
        notif(3, "talent_interest_received", "transactional", "high",
              "New hiring request", "Finance Simplified sent you a hiring request.", False),
        notif(4, "job_posted_successfully", "transactional", "normal",
              "Your job is live", "“Shorts editor for a fitness creator” is now published.", True),
        notif(5, "talent_listing_created", "transactional", "low",
              "Listing published", "Your talent listing is now visible in the marketplace.", True),
        notif(6, "application_status_changed", "transactional", "normal",
              "Application update", "An application you sent was viewed by the recruiter.", True),
    ]


# --- Reports (for the admin moderation queue) -------------------------------

def build_persona_reports() -> list[dict[str, object]]:
    return [
        {
            "id": persona_uuid("report:1"),
            "reporter_user_id": persona_user_id("talent-complete"),
            "target_type": "job",
            "target_id": str(persona_uuid("job:recruiter-active-2")),
            "category": "suspicious",
            "note": "Rate seems too low for the described scope (dev demo report).",
            "status": "open",
            "created_at": SEED_TIME,
        },
        {
            "id": persona_uuid("report:2"),
            "reporter_user_id": persona_user_id("notifications"),
            "target_type": "talent_listing",
            "target_id": str(persona_uuid("listing:both-sides")),
            "category": "spam",
            "note": "Possible duplicate listing (dev demo report).",
            "status": "open",
            "created_at": SEED_TIME,
        },
        {
            "id": persona_uuid("report:moderated-review"),
            "reporter_user_id": persona_user_id("both-sides"),
            "target_type": "review",
            "target_id": str(
                persona_uuid("engagement-review:moderated-review:talent_to_recruiter")
            ),
            "category": "harassment",
            "note": "Resolved deterministic report for hidden-review QA.",
            "status": "resolved",
            "admin_note": "Hidden while the moderation fixture is active.",
            "resolved_by_user_id": persona_user_id("admin"),
            "resolved_at": SEED_TIME + timedelta(days=9),
            "action": "hide_review",
            "created_at": SEED_TIME,
        },
    ]


def all_persona_user_ids() -> list[uuid.UUID]:
    return [persona_user_id(key) for key in PERSONA_KEYS]


def all_qa_seed_user_ids() -> list[uuid.UUID]:
    return all_persona_user_ids() + [persona_user_id(key) for key in QA_FIXTURE_KEYS]


def all_persona_hiring_identity_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_hiring_identities()]


def all_persona_talent_listing_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_talent_listings()]


def all_persona_job_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_jobs()]


def all_persona_portfolio_item_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_portfolio_items()]


def all_persona_application_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_applications()]


def all_persona_interest_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_interests()]


def all_persona_saved_job_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_saved_jobs()]


def all_persona_saved_talent_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_saved_talent()]


def all_persona_notification_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_notifications()]


def all_persona_report_ids() -> list[uuid.UUID]:
    return [uuid.UUID(str(item["id"])) for item in build_persona_reports()]
