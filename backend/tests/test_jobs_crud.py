from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from httpx import AsyncClient


async def test_create_and_fetch_job(client: AsyncClient) -> None:
    payload = {
        "title": "Senior Video Editor",
        "category": "Editing",
        "location": "Remote",
        "budget_amount": "1200.00",
        "budget_max": "2400.00",
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
    assert created["budget_unit"] == "per month"
    assert created["reference_videos"][0]["title"] == "Pacing reference"

    job_id = created["id"]
    get_response = await client.get(f"/api/v1/jobs/{job_id}")
    assert get_response.status_code == 200
    fetched = get_response.json()
    assert fetched["id"] == job_id
    assert fetched["platforms"] == ["instagram"]
    assert fetched["channel_profile_slug"] == "finance-creator"
    assert fetched["reference_videos"][0]["title"] == "Pacing reference"


async def test_authenticated_create_sets_posted_by_user_id(client: AsyncClient) -> None:
    exchange = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": "jobs-owner@example.com",
            "provider_account_id": "google-jobs-owner",
            "access_token": "jobs-owner-access-token",
            "refresh_token": "jobs-owner-refresh-token",
            "expires_at": int(datetime.now(timezone.utc).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert exchange.status_code == 200

    exchange_data = exchange.json()
    bearer = exchange_data["access_token"]
    user_id = exchange_data["user"]["id"]

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
