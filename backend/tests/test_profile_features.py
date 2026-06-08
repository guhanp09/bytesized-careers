from __future__ import annotations

from datetime import UTC, datetime, timedelta

from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import select

from app.models import EmailVerificationToken, User


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
    assert "bio" not in data
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
