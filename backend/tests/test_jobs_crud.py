from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import select

from app.models import HiringIdentity


async def _create_oauth_user(client: AsyncClient, *, email: str, provider_id: str) -> tuple[str, str]:
    exchange = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": email,
            "provider_account_id": provider_id,
            "access_token": f"{provider_id}-access-token",
            "refresh_token": f"{provider_id}-refresh-token",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert exchange.status_code == 200
    data = exchange.json()
    return data["access_token"], data["user"]["id"]


async def test_create_and_fetch_job(client: AsyncClient) -> None:
    payload = {
        "title": "Senior Video Editor",
        "category": "Editing",
        "location": "Remote",
        "budget_amount": "1200.00",
        "budget_max": "2400.00",
        "budget_note": None,
        "budget_currency": "INR",
        "budget_unit": "per month",
        "experience_level": "3-5 years",
        "platforms": ["instagram"],
        "start_timeframe": "ASAP",
        "about_channel": "A fintech education channel.",
        "responsibilities": ["Edit long-form videos", "Collaborate with script team"],
        "requirements": ["Premiere Pro", "After Effects"],
        "how_to_apply": "Share your portfolio and availability.",
        "reference_videos": [
            {
                "title": "Pacing reference",
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            }
        ],
        "tags": ["premiere", "storytelling"],
        "languages": ["Hindi", "English"],
        "content_niches": ["Finance", " finance ", "", "Education"],
        "content_genres": ["Explainers", "Explainers"],
        "formats_hired_for": ["Long-form video", "Thumbnails"],
        "channel_name": "Finance Creator",
        "channel_profile_slug": "finance-creator",
        "status": "published",
    }

    create_response = await client.post("/api/v1/jobs", json=payload)
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["title"] == payload["title"]
    assert created["status"] == "published"
    assert Decimal(str(created["budget_amount"])) == Decimal("1200.00")
    assert Decimal(str(created["budget_max"])) == Decimal("2400.00")
    assert created["budget_note"] is None
    assert created["budget_unit"] == "per month"
    assert created["reference_videos"][0]["title"] == "Pacing reference"
    assert created["languages"] == ["Hindi", "English"]
    assert created["content_niches"] == ["Finance", "Education"]
    assert created["content_genres"] == ["Explainers"]
    assert created["formats_hired_for"] == ["Long-form video", "Thumbnails"]

    job_id = created["id"]
    get_response = await client.get(f"/api/v1/jobs/{job_id}")
    assert get_response.status_code == 200
    fetched = get_response.json()
    assert fetched["id"] == job_id
    assert fetched["platforms"] == ["instagram"]
    assert fetched["languages"] == ["Hindi", "English"]
    assert fetched["content_niches"] == ["Finance", "Education"]
    assert fetched["content_genres"] == ["Explainers"]
    assert fetched["formats_hired_for"] == ["Long-form video", "Thumbnails"]
    assert fetched["channel_profile_slug"] == "finance-creator"
    assert fetched["reference_videos"][0]["title"] == "Pacing reference"

    searched = await client.get("/api/v1/jobs", params={"q": "thumbnails"})
    assert searched.status_code == 200
    assert any(item["id"] == job_id for item in searched.json()["items"])


async def test_job_budget_note_persists_for_contact_pricing(client: AsyncClient) -> None:
    payload = {
        "title": "Creator partnerships lead",
        "category": "Strategy",
        "location": "Remote",
        "budget_amount": None,
        "budget_max": None,
        "budget_note": "  Contact   for pricing  ",
        "budget_currency": "INR",
        "budget_unit": "per project",
        "platforms": ["youtube"],
        "about_channel": "A creator-led business channel.",
        "status": "draft",
    }

    create_response = await client.post("/api/v1/jobs", json=payload)
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["budget_amount"] is None
    assert created["budget_max"] is None
    assert created["budget_note"] == "Contact for pricing"

    get_response = await client.get(f"/api/v1/jobs/{created['id']}")
    assert get_response.status_code == 200
    fetched = get_response.json()
    assert fetched["budget_note"] == "Contact for pricing"

async def test_authenticated_create_sets_posted_by_user_id(client: AsyncClient) -> None:
    bearer, user_id = await _create_oauth_user(
        client,
        email="jobs-owner@example.com",
        provider_id="google-jobs-owner",
    )

    create_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Authenticated Instagram Editor",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["instagram"],
            "status": "published",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["posted_by_user_id"] == user_id


async def test_job_update_and_delete_require_owner(client: AsyncClient) -> None:
    owner_bearer, owner_user_id = await _create_oauth_user(
        client,
        email="jobs-mutation-owner@example.com",
        provider_id="google-jobs-mutation-owner",
    )
    other_bearer, _ = await _create_oauth_user(
        client,
        email="jobs-mutation-other@example.com",
        provider_id="google-jobs-mutation-other",
    )

    create_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_bearer}"},
        json={
            "title": "Owned Instagram Editor",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["instagram"],
            "status": "published",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["posted_by_user_id"] == owner_user_id
    job_id = created["id"]

    unauth_update = await client.patch(f"/api/v1/jobs/{job_id}", json={"title": "Nope"})
    assert unauth_update.status_code == 401

    wrong_owner_update = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers={"Authorization": f"Bearer {other_bearer}"},
        json={"title": "Wrong owner update"},
    )
    assert wrong_owner_update.status_code == 403

    owner_update = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers={"Authorization": f"Bearer {owner_bearer}"},
        json={
            "title": "Owner updated title",
            "content_niches": ["Gaming", "gaming", ""],
            "content_genres": ["Shorts/Reels"],
            "formats_hired_for": ["Shorts/Reels", "Captions"],
        },
    )
    assert owner_update.status_code == 200
    updated = owner_update.json()
    assert updated["title"] == "Owner updated title"
    assert updated["content_niches"] == ["Gaming"]
    assert updated["content_genres"] == ["Shorts/Reels"]
    assert updated["formats_hired_for"] == ["Shorts/Reels", "Captions"]

    wrong_owner_delete = await client.delete(
        f"/api/v1/jobs/{job_id}",
        headers={"Authorization": f"Bearer {other_bearer}"},
    )
    assert wrong_owner_delete.status_code == 403

    owner_delete = await client.delete(
        f"/api/v1/jobs/{job_id}",
        headers={"Authorization": f"Bearer {owner_bearer}"},
    )
    assert owner_delete.status_code == 200
    assert owner_delete.json()["status"] == "archived"

    fetch_deleted = await client.get(f"/api/v1/jobs/{job_id}")
    assert fetch_deleted.status_code == 404


async def test_job_create_with_hiring_identity_requires_owner_and_snapshots(client: AsyncClient) -> None:
    owner_bearer, owner_user_id = await _create_oauth_user(
        client,
        email="jobs-hiring-identity-owner@example.com",
        provider_id="google-jobs-hiring-identity-owner",
    )
    other_bearer, _ = await _create_oauth_user(
        client,
        email="jobs-hiring-identity-other@example.com",
        provider_id="google-jobs-hiring-identity-other",
    )

    identity = await client.post(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {owner_bearer}"},
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": "TechWithRavi",
            "handle": "techwithravi",
            "url": "https://www.youtube.com/@techwithravi",
            "managed_by_agency_name": "GrowthStack Agency",
        },
    )
    assert identity.status_code == 201
    identity_id = identity.json()["id"]

    wrong_owner_create = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {other_bearer}"},
        json={
            "title": "Wrong owner identity job",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "hiring_identity_id": identity_id,
            "status": "published",
        },
    )
    assert wrong_owner_create.status_code == 403

    blocked_publish = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_bearer}"},
        json={
            "title": "Blocked represented channel editor",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "hiring_identity_id": identity_id,
            "status": "published",
        },
    )
    assert blocked_publish.status_code == 403
    assert blocked_publish.json()["error"]["code"] == "REPRESENTATION_VERIFICATION_REQUIRED"

    draft_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_bearer}"},
        json={
            "title": "Represented channel draft",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "hiring_identity_id": identity_id,
            "status": "draft",
        },
    )
    assert draft_response.status_code == 201
    draft = draft_response.json()
    assert draft["hiring_verification_status_snapshot"] == "UNVERIFIED"

    async with TestSessionLocal() as session:
        row = (
            await session.execute(select(HiringIdentity).where(HiringIdentity.id == UUID(identity_id)))
        ).scalar_one()
        row.verification_status = "VERIFIED"
        row.verification_method = "VERIFICATION_CODE"
        row.verified_at = datetime.now(UTC)
        await session.commit()

    create_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_bearer}"},
        json={
            "title": "Represented channel editor",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "hiring_identity_id": identity_id,
            "status": "published",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["posted_by_user_id"] == owner_user_id
    assert created["hiring_identity_id"] == identity_id
    assert created["hiring_display_name_snapshot"] == "TechWithRavi"
    assert created["hiring_platform_snapshot"] == "YOUTUBE"
    assert created["hiring_verification_status_snapshot"] == "VERIFIED"
    assert created["hiring_external_url_snapshot"] == "https://www.youtube.com/@techwithravi"
    assert created["managed_by_agency_name_snapshot"] == "GrowthStack Agency"
    assert created["agency_profile_slug"] == "jobs_hiring_identity"
    assert created["channel_profile_slug"] is None


async def test_job_application_requirements_persist_and_round_trip(client: AsyncClient) -> None:
    """A job can declare structured first-message requirements that survive create + fetch."""
    requirements = [
        "expected_rate",
        "relevant_portfolio",
        "turnaround",
        "fit_note",
    ]
    create_response = await client.post(
        "/api/v1/jobs",
        json={
            "title": "Finance channel editor",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "application_requirements": requirements,
            "status": "published",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["application_requirements"] == requirements

    job_id = created["id"]
    fetched = (await client.get(f"/api/v1/jobs/{job_id}")).json()
    assert fetched["application_requirements"] == requirements


async def test_job_without_application_requirements_defaults_to_empty(client: AsyncClient) -> None:
    """Backward compatibility: jobs created without optional list fields report empty lists."""
    create_response = await client.post(
        "/api/v1/jobs",
        json={
            "title": "Legacy job without requirements",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["application_requirements"] == []
    assert created["content_niches"] == []
    assert created["content_genres"] == []
    assert created["formats_hired_for"] == []
