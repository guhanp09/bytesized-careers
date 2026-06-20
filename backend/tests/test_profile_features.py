from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import select

from app.models import EmailVerificationToken, HiringIdentity, User
from app.services.profile_service import (
    HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR,
    ProfileService,
    ProfileValidationError,
    _public_verification_search_text,
    _verification_code_found,
)


async def _latest_token_for_email(email: str) -> str:
    async with TestSessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        row = (
            await session.execute(
                select(EmailVerificationToken)
                .where(EmailVerificationToken.user_id == user.id)
                .order_by(EmailVerificationToken.created_at.desc())
                .limit(1)
            )
        ).scalar_one()
        return row.token


async def _register_verify_login(
    client: AsyncClient,
    *,
    email: str,
    username: str,
    password: str = "supersecure123",
) -> str:
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "username": username},
    )
    assert register.status_code == 200

    token = await _latest_token_for_email(email)
    verify = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verify.status_code == 200

    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return login.json()["access_token"]


def test_public_verification_search_text_keeps_late_youtube_meta_code() -> None:
    public_html = "x" * 650_000 + '<meta name="description" content="CJ-SUHM-TLL5">'

    public_text = _public_verification_search_text(public_html)

    assert _verification_code_found("CJ-SUHM-TLL5", public_text)


def test_verification_code_matching_normalizes_html_and_unicode_dashes() -> None:
    public_text = "Creator bio: CJ &#x2013; SUHM &#x2013; TLL5"

    assert _verification_code_found("CJ-SUHM-TLL5", public_text)


async def test_username_validation_and_uniqueness(client: AsyncClient) -> None:
    first = await client.post(
        "/api/v1/auth/register",
        json={"email": "username-1@example.com", "password": "supersecure123", "username": "alpha_user"},
    )
    assert first.status_code == 200

    duplicate = await client.post(
        "/api/v1/auth/register",
        json={"email": "username-2@example.com", "password": "supersecure123", "username": "alpha_user"},
    )
    assert duplicate.status_code == 409

    invalid = await client.post(
        "/api/v1/auth/register",
        json={"email": "username-3@example.com", "password": "supersecure123", "username": "Bad-Name"},
    )
    assert invalid.status_code == 400

    starts_with_underscore = await client.post(
        "/api/v1/auth/register",
        json={"email": "username-4@example.com", "password": "supersecure123", "username": "_badname"},
    )
    assert starts_with_underscore.status_code == 400


async def test_username_change_limit_and_cooldown(client: AsyncClient) -> None:
    email = "rename-user@example.com"
    bearer = await _register_verify_login(client, email=email, username="rename_user")

    first_change = await client.patch(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"username": "rename_step_one"},
    )
    assert first_change.status_code == 200
    assert first_change.json()["username_change_count"] == 1

    blocked_by_cooldown = await client.patch(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"username": "rename_step_two"},
    )
    assert blocked_by_cooldown.status_code == 400
    assert "changed again after" in str(blocked_by_cooldown.json())

    async with TestSessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        user.username_last_changed_at = datetime.now(UTC) - timedelta(days=31)
        await session.commit()

    second_change = await client.patch(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"username": "rename_step_two"},
    )
    assert second_change.status_code == 200
    assert second_change.json()["username_change_count"] == 2

    blocked_by_limit = await client.patch(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"username": "rename_step_three"},
    )
    assert blocked_by_limit.status_code == 400
    assert "limit reached" in str(blocked_by_limit.json()).lower()


async def test_public_profile_applies_privacy_and_jobs_split(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="public-owner@example.com",
        username="public_owner",
    )

    update_profile = await client.patch(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "display_name": "Public Owner",
            "headline": "Video editor for horror story channels",
            "bio": "I edit retention-focused horror storytelling videos for YouTube creators.",
            "skills": ["Premiere Pro", "Story pacing"],
            "public_links": ["https://example.com/portfolio"],
            "availability_status": "available",
            "location": "Chennai",
            "timezone": "IST",
            "experience": [
                {
                    "id": "public-owner-current",
                    "role": "Video Editor",
                    "organization_name": "Finance Creator",
                    "organization_url": "https://example.com/finance-creator",
                    "platform": "YouTube",
                    "work_type": "Contract",
                    "work_mode": "Remote",
                    "start_month": "Jan",
                    "start_year": "2025",
                    "is_current": True,
                    "description": "Edited long-form explainers and prepared upload-ready exports.",
                    "tools": ["Premiere Pro", "After Effects"],
                }
            ],
        },
    )
    assert update_profile.status_code == 200
    assert update_profile.json()["experience"][0]["organization_name"] == "Finance Creator"

    update_privacy = await client.patch(
        "/api/v1/me/privacy",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "show_location": False,
            "show_availability": False,
            "show_links": True,
            "show_skills": True,
        },
    )
    assert update_privacy.status_code == 200

    active_job = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Active profile job",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["instagram"],
            "status": "published",
        },
    )
    assert active_job.status_code == 201

    past_job = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Past profile job",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["instagram"],
            "status": "archived",
        },
    )
    assert past_job.status_code == 201

    pending_identity = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "INSTAGRAM",
            "display_name": "Pending Creator Page",
            "handle": "pendingcreator",
            "url": "https://www.instagram.com/pendingcreator",
            "managed_by_agency_name": "Public Owner",
        },
    )
    assert pending_identity.status_code == 201

    verified_identity = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": "Verified Creator Channel",
            "handle": "verifiedcreator",
            "url": "https://www.youtube.com/channel/UC12345678901234567890",
            "managed_by_agency_name": "Public Owner",
        },
    )
    assert verified_identity.status_code == 201
    verified_identity_id = verified_identity.json()["id"]
    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(HiringIdentity).where(HiringIdentity.id == UUID(verified_identity_id))
            )
        ).scalar_one()
        row.verification_status = "VERIFIED"
        row.verification_method = "VERIFICATION_CODE"
        row.verified_at = datetime.now(UTC)
        await session.commit()

    now_item = await client.post(
        "/api/v1/me/portfolio",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Current brand reel",
            "description": "Ongoing project",
            "role_name": "Video Editor",
            "links": ["https://example.com/reel"],
            "tags": ["editing"],
            "status": "now",
            "is_public": True,
        },
    )
    assert now_item.status_code == 201

    _private_item = await client.post(
        "/api/v1/me/portfolio",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Private archive",
            "description": "Should not appear publicly",
            "role_name": "Video Editor",
            "links": ["https://example.com/private"],
            "tags": ["internal"],
            "status": "past",
            "is_public": False,
        },
    )

    public_profile = await client.get("/api/v1/users/public_owner/public-profile")
    assert public_profile.status_code == 200
    data = public_profile.json()
    assert data["username"] == "public_owner"
    assert data["headline"] == "Video editor for horror story channels"
    assert data["bio"] == "I edit retention-focused horror storytelling videos for YouTube creators."
    assert data["location"] == "Chennai"
    assert data["timezone"] == "IST"
    assert data["availability_status"] == "available"
    assert "availability" not in data
    assert data["experience"][0]["role"] == "Video Editor"
    assert data["experience"][0]["organization_name"] == "Finance Creator"
    assert len(data["jobs_active"]) >= 1
    assert len(data["jobs_past"]) >= 1
    assert any(item["title"] == "Current brand reel" for item in data["portfolio_now"])
    assert len(data["portfolio_past"]) == 0
    assert any(
        item["name"] == "Verified Creator Channel"
        and item["authorization_status"] == "verified"
        for item in data["represented_channels"]
    )
    assert all(item["name"] != "Pending Creator Page" for item in data["represented_channels"])
    assert data["stats"]["jobs_posted_count"] >= 2
    assert data["stats"]["projects_count"] >= 1
    assert data["reviews"]["review_count"] == 0

    public_jobs_active = await client.get("/api/v1/users/public_owner/jobs?tab=active")
    assert public_jobs_active.status_code == 200
    assert public_jobs_active.json()["tab"] == "active"
    assert len(public_jobs_active.json()["items"]) >= 1

    public_jobs_past = await client.get("/api/v1/users/public_owner/jobs?tab=past")
    assert public_jobs_past.status_code == 200
    assert public_jobs_past.json()["tab"] == "past"
    assert len(public_jobs_past.json()["items"]) >= 1

    public_portfolio_now = await client.get("/api/v1/users/public_owner/portfolio?tab=now")
    assert public_portfolio_now.status_code == 200
    assert public_portfolio_now.json()["tab"] == "now"
    assert len(public_portfolio_now.json()["items"]) >= 1


async def test_hiring_info_updates_single_profile_post_readiness(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="hiring-ready@example.com",
        username="hiring_ready",
    )

    initial = await client.get(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert initial.status_code == 200
    initial_capabilities = initial.json()["profile_capabilities"]
    assert initial_capabilities["canPostJobs"] is False
    assert "Choose hiring type" in initial_capabilities["missingHiringFields"]

    update = await client.patch(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "display_name": "Hiring Ready",
            "location": "Bengaluru, India",
            "hiring_type": "creator agency",
            "hiring_primary_platform": "YouTube",
            "hiring_website_or_social_url": "https://example.com/agency",
            "hiring_channels_or_pages_managed": "Two creator education channels.",
        },
    )
    assert update.status_code == 200
    data = update.json()
    assert data["hiring_info"]["hiring_type"] == "creator agency"
    assert data["hiring_info"]["primary_platform"] == "YouTube"
    assert data["hiring_info"]["website_or_social_url"] == "https://example.com/agency"
    assert data["hiring_info"]["verification_status"] == "unverified"
    assert data["profile_capabilities"]["canPostJobs"] is False
    assert "Add a YouTube channel or Instagram page you hire for" in data["profile_capabilities"]["missingHiringFields"]

    identity = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": "TechWithRavi",
            "handle": "techwithravi",
            "managed_by_agency_name": "Hiring Ready",
        },
    )
    assert identity.status_code == 201
    identity_data = identity.json()
    assert identity_data["verification_status"] == "UNVERIFIED"
    assert identity_data["managed_by_agency_name"] == "Hiring Ready"

    refreshed = await client.get(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert refreshed.status_code == 200
    data = refreshed.json()
    assert data["profile_capabilities"]["canPostJobs"] is True
    assert data["profile_capabilities"]["hasHiringIdentity"] is True
    assert data["profile_capabilities"]["missingHiringFields"] == []


async def test_hiring_identity_request_verification_is_pending_for_manual_review(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="hiring-identity-verify@example.com",
        username="hiring_id_verify",
    )

    create = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "INDIVIDUAL_CHANNEL",
            "platform": "INSTAGRAM",
            "display_name": "FitWithMegha",
            "handle": "fitwithmegha",
        },
    )
    assert create.status_code == 201
    identity_id = create.json()["id"]

    verify = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/request-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"proof_url": "https://instagram.com/fitwithmegha"},
    )
    assert verify.status_code == 200
    data = verify.json()
    assert data["identity"]["verification_status"] == "PENDING"
    assert data["identity"]["verification_method"] == "INSTAGRAM_LINK_IN_BIO"
    assert data["identity"]["verification_code"].startswith("CJ-")
    assert data["identity"]["verification_code_expires_at"] is not None
    assert data["identity"]["verification_attempt_count"] == 0


async def test_hiring_identity_bio_code_check_success(client: AsyncClient, monkeypatch) -> None:
    bearer = await _register_verify_login(
        client,
        email="hiring-identity-bio-success@example.com",
        username="hiring_bio_success",
    )

    create = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": "Verified Bio Channel",
            "handle": "verifiedbio",
            "url": "https://www.youtube.com/channel/UC12345678901234567890",
            "managed_by_agency_name": "Bio Agency",
        },
    )
    assert create.status_code == 201
    identity_id = create.json()["id"]

    verify = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/request-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"proof_url": "https://www.youtube.com/channel/UC12345678901234567890"},
    )
    assert verify.status_code == 200
    code = verify.json()["identity"]["verification_code"]
    assert code

    async def fake_fetch_public_text(identity: HiringIdentity) -> str:
        prefix, first, second = code.split("-")
        return f"Public channel description with {prefix} \u2013 {first} \u2013 {second} included."

    monkeypatch.setattr(
        ProfileService,
        "_fetch_public_hiring_identity_text",
        staticmethod(fake_fetch_public_text),
    )

    checked = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/check-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={},
    )
    assert checked.status_code == 200
    data = checked.json()
    assert data["identity"]["verification_status"] == "VERIFIED"
    assert data["identity"]["verification_method"] == "VERIFICATION_CODE"
    assert data["identity"]["verified_at"] is not None
    assert data["identity"]["verification_last_error"] is None


async def test_hiring_identity_bio_code_check_not_found_stays_pending(
    client: AsyncClient,
    monkeypatch,
) -> None:
    bearer = await _register_verify_login(
        client,
        email="hiring-identity-bio-fail@example.com",
        username="hiring_bio_fail",
    )

    create = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "INSTAGRAM",
            "display_name": "Pending Bio Page",
            "handle": "pendingbio",
            "url": "https://www.instagram.com/pendingbio",
            "managed_by_agency_name": "Bio Agency",
        },
    )
    assert create.status_code == 201
    identity_id = create.json()["id"]

    verify = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/request-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"proof_url": "https://www.instagram.com/pendingbio"},
    )
    assert verify.status_code == 200

    async def fake_fetch_public_text(identity: HiringIdentity) -> str:
        return "Public profile text without the verification code."

    monkeypatch.setattr(
        ProfileService,
        "_fetch_public_hiring_identity_text",
        staticmethod(fake_fetch_public_text),
    )

    checked = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/check-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={},
    )
    assert checked.status_code == 400
    assert "could not find the code" in str(checked.json()).lower()

    identities = await client.get(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert identities.status_code == 200
    saved = next(item for item in identities.json()["items"] if item["id"] == identity_id)
    assert saved["verification_status"] == "PENDING"
    assert "could not find the code" in saved["verification_last_error"].lower()


async def test_hiring_identity_bio_code_check_fetch_failure_uses_read_error(
    client: AsyncClient,
    monkeypatch,
) -> None:
    bearer = await _register_verify_login(
        client,
        email="hiring-identity-bio-read-fail@example.com",
        username="hiring_bio_read_fail",
    )

    create = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": "Unreadable Bio Channel",
            "handle": "unreadablebio",
            "url": "https://www.youtube.com/@unreadablebio",
            "managed_by_agency_name": "Bio Agency",
        },
    )
    assert create.status_code == 201
    identity_id = create.json()["id"]

    verify = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/request-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"proof_url": "https://www.youtube.com/@unreadablebio"},
    )
    assert verify.status_code == 200

    async def fake_fetch_public_text(identity: HiringIdentity) -> str:
        raise ProfileValidationError(HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR)

    monkeypatch.setattr(
        ProfileService,
        "_fetch_public_hiring_identity_text",
        staticmethod(fake_fetch_public_text),
    )

    checked = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/check-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={},
    )
    assert checked.status_code == 400
    assert HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR in str(checked.json())

    identities = await client.get(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert identities.status_code == 200
    saved = next(item for item in identities.json()["items"] if item["id"] == identity_id)
    assert saved["verification_status"] == "PENDING"
    assert saved["verification_last_error"] == HIRING_IDENTITY_PUBLIC_PAGE_READ_ERROR


async def test_hiring_identity_bio_code_check_expired_code_is_unverified(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="hiring-identity-bio-expired@example.com",
        username="hiring_bio_expired",
    )

    create = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": "Expired Bio Channel",
            "handle": "expiredbio",
            "url": "https://www.youtube.com/@expiredbio",
            "managed_by_agency_name": "Bio Agency",
        },
    )
    assert create.status_code == 201
    identity_id = create.json()["id"]

    verify = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/request-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"proof_url": "https://www.youtube.com/@expiredbio"},
    )
    assert verify.status_code == 200

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(HiringIdentity).where(HiringIdentity.id == UUID(identity_id))
            )
        ).scalar_one()
        row.verification_code_expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    checked = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/check-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={},
    )
    assert checked.status_code == 400
    assert "verification code expired" in str(checked.json()).lower()

    identities = await client.get(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert identities.status_code == 200
    saved = next(item for item in identities.json()["items"] if item["id"] == identity_id)
    assert saved["verification_status"] == "UNVERIFIED"
    assert "verification code expired" in saved["verification_last_error"].lower()


async def test_hiring_identity_request_verification_rejects_wrong_platform_url(
    client: AsyncClient,
) -> None:
    bearer = await _register_verify_login(
        client,
        email="hiring-identity-bio-invalid-url@example.com",
        username="hiring_bio_badurl",
    )

    create = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": "Invalid URL Channel",
            "handle": "invalidurlbio",
            "managed_by_agency_name": "Bio Agency",
        },
    )
    assert create.status_code == 201
    identity_id = create.json()["id"]

    verify = await client.post(
        f"/api/v1/me/hiring-identities/{identity_id}/request-verification",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"proof_url": "https://example.com/not-a-youtube-channel"},
    )
    assert verify.status_code == 400
    assert "valid YouTube or Instagram" in str(verify.json())


async def test_hiring_identity_can_be_deleted(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="hiring-identity-delete@example.com",
        username="hire_identity_del",
    )

    created = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": "Delete Me Channel",
            "handle": "deleteme",
            "url": "https://www.youtube.com/channel/UC12345678901234567890",
            "managed_by_agency_name": "Delete Agency",
        },
    )
    assert created.status_code == 201
    identity_id = created.json()["id"]

    deleted = await client.delete(
        f"/api/v1/me/hiring-identities/{identity_id}",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert deleted.status_code == 204

    listing = await client.get(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert listing.status_code == 200
    assert all(item["id"] != identity_id for item in listing.json()["items"])


async def test_hiring_info_rejects_invalid_trust_url(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="hiring-invalid-url@example.com",
        username="hiring_invalid_url",
    )

    update = await client.patch(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "display_name": "Hiring Invalid",
            "location": "Remote",
            "hiring_type": "brand",
            "hiring_website_or_social_url": "not-a-url",
        },
    )
    assert update.status_code == 400
    assert "valid http(s) URL" in str(update.json())


async def test_portfolio_crud(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="portfolio-owner@example.com",
        username="portfolio_owner",
    )

    create = await client.post(
        "/api/v1/me/portfolio",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Launch trailer",
            "description": "Motion + edits",
            "role_name": "Video Editor",
            "links": ["https://example.com/trailer"],
            "tags": ["motion", "editing"],
            "status": "now",
            "is_public": True,
        },
    )
    assert create.status_code == 201
    item_id = create.json()["id"]

    listing = await client.get(
        "/api/v1/me/portfolio",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert listing.status_code == 200
    assert any(item["id"] == item_id for item in listing.json()["items"])

    patch = await client.patch(
        f"/api/v1/me/portfolio/{item_id}",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"title": "Launch trailer v2", "status": "past"},
    )
    assert patch.status_code == 200
    assert patch.json()["title"] == "Launch trailer v2"
    assert patch.json()["status"] == "past"

    delete = await client.delete(
        f"/api/v1/me/portfolio/{item_id}",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert delete.status_code == 200

    listing_after = await client.get(
        "/api/v1/me/portfolio",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert listing_after.status_code == 200
    assert all(item["id"] != item_id for item in listing_after.json()["items"])


async def test_upload_banner_persists_and_appears_on_public_profile(client: AsyncClient) -> None:
    bearer = await _register_verify_login(client, email="banner@example.com", username="banneruser")
    png_data_url = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )

    upload = await client.post(
        "/api/v1/me/banner",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"file_name": "cover.png", "content_type": "image/png", "data_url": png_data_url},
    )
    assert upload.status_code == 200
    banner_url = upload.json()["banner_url"]
    assert banner_url and "/banners/" in banner_url

    me = await client.get("/api/v1/me/profile", headers={"Authorization": f"Bearer {bearer}"})
    assert me.status_code == 200
    assert me.json()["banner_url"] == banner_url

    public = await client.get("/api/v1/users/banneruser/public-profile")
    assert public.status_code == 200
    assert public.json()["banner_url"] == banner_url


async def test_upload_banner_rejects_non_image(client: AsyncClient) -> None:
    bearer = await _register_verify_login(client, email="banner2@example.com", username="banneruser2")
    bad = await client.post(
        "/api/v1/me/banner",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"file_name": "x.txt", "content_type": "text/plain", "data_url": "data:text/plain;base64,aGVsbG8="},
    )
    assert bad.status_code == 400


def test_instagram_hiring_identity_url_validation_and_canonicalization() -> None:
    from app.services.profile_service import (
        _allowed_hiring_identity_url,
        _canonical_hiring_identity_public_url,
    )

    # Valid public profile URLs are accepted.
    assert _allowed_hiring_identity_url("https://www.instagram.com/guhanpurushothaman/", "INSTAGRAM")
    assert _allowed_hiring_identity_url("https://instagram.com/guhanpurushothaman", "INSTAGRAM")

    # Post / reel / story / app routes are rejected as non-profile URLs.
    for bad in (
        "https://www.instagram.com/p/abc123/",
        "https://www.instagram.com/reel/abc123/",
        "https://www.instagram.com/stories/guhan/123/",
        "https://www.instagram.com/explore/",
        "https://www.instagram.com/accounts/login/",
    ):
        assert not _allowed_hiring_identity_url(bad, "INSTAGRAM"), bad

    # Non-Instagram hosts are rejected even for the INSTAGRAM platform.
    assert not _allowed_hiring_identity_url("https://evil.example.com/guhan", "INSTAGRAM")

    # Canonicalization strips query/fragment/trailing slash to the bare profile path.
    assert (
        _canonical_hiring_identity_public_url(
            "https://www.instagram.com/guhanpurushothaman/?hl=en", "INSTAGRAM"
        )
        == "https://www.instagram.com/guhanpurushothaman"
    )
