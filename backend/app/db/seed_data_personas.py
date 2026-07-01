"""Dev-only persona seed data.

Realistic, deterministic CreatorJobs personas used by the dev persona switcher
(see ``backend/app/api/v1/routers/dev_personas.py``). Every record uses a stable
``uuid5`` id derived from ``PERSONA_NAMESPACE`` so seeding is idempotent and reset
can target exactly the rows we created — never arbitrary user data.

Unlike the marketplace demo talent users (display-only, no credentials), these
personas are real *logged-in-able* accounts: verified email + a shared known dev
password, so a developer can switch between them with one click. They only ever
exist in development/test because the seeders are environment-gated.

No fake trust signals: ratings, response rates, and live viewer counts are never
fabricated. Verification states appear only on the explicit verification persona.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
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
        "username": "dev-new",
        "account_type": "TALENT",
        "onboarding_intent": "DECIDE_LATER",
        "description": "Fresh account: empty profile, no listings/jobs/portfolio. Tests onboarding + empty states.",
    },
    {
        "key": "talent-complete",
        "label": "Talent — complete profile",
        "username": "dev-talent-pro",
        "account_type": "TALENT",
        "onboarding_intent": "LOOKING_FOR_WORK",
        "description": "Full talent profile, portfolio, a published listing, sent applications, received hiring requests.",
    },
    {
        "key": "talent-incomplete",
        "label": "Talent — incomplete profile",
        "username": "dev-talent-wip",
        "account_type": "TALENT",
        "onboarding_intent": "LOOKING_FOR_WORK",
        "description": "Minimal talent profile, no portfolio, missing tools/niches. Tests the completion checklist.",
    },
    {
        "key": "recruiter-active",
        "label": "Recruiter — active jobs",
        "username": "dev-recruiter",
        "account_type": "EMPLOYER",
        "onboarding_intent": "HIRING_CREATOR_TALENT",
        "description": "Verified hiring identity, several live jobs, received applications, saved talent, sent hiring requests.",
    },
    {
        "key": "recruiter-drafts",
        "label": "Recruiter — drafts/access pending",
        "username": "dev-recruiter-wip",
        "account_type": "EMPLOYER",
        "onboarding_intent": "HIRING_CREATOR_TALENT",
        "description": "Job drafts, a pending channel verification, and a talent-listing draft. Tests drafts + access states.",
    },
    {
        "key": "both-sides",
        "label": "Both sides user",
        "username": "dev-both-sides",
        "account_type": "BOTH",
        "onboarding_intent": "BOTH",
        "description": "Hires and gets hired on one login: talent listing + posted job, sent + received applications/requests.",
    },
    {
        "key": "admin",
        "label": "Admin",
        "username": "dev-admin",
        "account_type": "ADMIN",
        "onboarding_intent": "DECIDE_LATER",
        "description": "Admin account with queued moderation reports. (Admin UI is backend-only today.)",
    },
    {
        "key": "notifications",
        "label": "Notifications test user",
        "username": "dev-notify",
        "account_type": "TALENT",
        "onboarding_intent": "LOOKING_FOR_WORK",
        "description": "A spread of read/unread notifications across event types. Tests the bell + notifications page.",
    },
]

PERSONA_KEYS = [item["key"] for item in PERSONA_DEFS]


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
            "display_name": "Science Daily",
            "headline": "Setting up hiring for a science explainer channel",
            "location": "Remote",
            "timezone": "IST",
            "hiring_type": "own_channel",
            "hiring_primary_platform": "youtube",
            "hiring_platforms": ["youtube"],
            "hiring_niches": ["Science"],
            "hiring_formats": ["Long-form", "Motion graphics"],
            "hiring_website_or_social_url": "https://www.youtube.com/@sciencedaily",
            "hiring_channels_or_pages_managed": "Science Daily (verification pending)",
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
            "display_name": "Dev Admin",
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
            display_name="Science Daily",
            handle="@sciencedaily",
            url="https://www.youtube.com/@sciencedaily",
            verification_status="PENDING",
            verification_method="CODE_IN_DESCRIPTION",
            verification_code="CJ-DEV-SCI-2026",
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
            first_message_requirements=["project_budget", "project_brief", "turnaround", "reference_links"],
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
            application_requirements=["relevant_experience", "portfolio_link", "rate_expectation"],
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
            application_requirements=["relevant_experience", "portfolio_link"],
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

def _application(applicant: str, job_key: str, owner: str, status: str, cover_note: str) -> dict[str, object]:
    return {
        "id": persona_uuid(f"application:{applicant}:{job_key}"),
        "job_id": persona_uuid(f"job:{job_key}"),
        "applicant_user_id": persona_user_id(applicant),
        "job_owner_user_id": persona_user_id(owner),
        "cover_note": cover_note,
        "portfolio_item_ids": [],
        "first_message_answers": {},
        "applicant_snapshot": {},
        "status": status,
        "created_at": SEED_TIME,
    }


def build_persona_applications() -> list[dict[str, object]]:
    return [
        _application(
            "talent-complete", "recruiter-active-1", "recruiter-active", "shortlisted",
            "I edit retention-first finance long-form — here's my reel and a recent 12-min explainer.",
        ),
        _application(
            "talent-complete", "recruiter-active-3", "recruiter-active", "new",
            "Happy to take on the daily shorts — I can start this week.",
        ),
        _application(
            "both-sides", "recruiter-active-1", "recruiter-active", "rejected",
            "I mostly do podcast long-form but wanted to put my name in.",
        ),
        # talent-complete applies to both-sides' job → gives both-sides a received application.
        _application(
            "talent-complete", "both-sides-1", "both-sides", "new",
            "I edit long-form interviews and would love to cut your episodes.",
        ),
    ]


# --- Hiring requests / talent interests -------------------------------------

def _interest(recruiter: str, listing_key: str, owner: str, status: str, note: str) -> dict[str, object]:
    return {
        "id": persona_uuid(f"interest:{recruiter}:{listing_key}"),
        "talent_listing_id": persona_uuid(f"listing:{listing_key}"),
        "recruiter_user_id": persona_user_id(recruiter),
        "owner_user_id": persona_user_id(owner),
        "note": note,
        "first_message_answers": {},
        "status": status,
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
            "Would you edit a couple of interview episodes? Flexible on timeline.",
        ),
        # recruiter-active reaches out to both-sides' listing → both-sides received a hiring request.
        _interest(
            "recruiter-active", "both-sides", "both-sides", "new",
            "We need a podcast-style editor for some founder interviews — interested?",
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
    ]


def all_persona_user_ids() -> list[uuid.UUID]:
    return [persona_user_id(key) for key in PERSONA_KEYS]
