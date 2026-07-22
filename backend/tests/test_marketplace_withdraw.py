from __future__ import annotations

from httpx import AsyncClient

from conftest import create_valid_published_job


async def _register_verified_login(
    client: AsyncClient,
    *,
    email: str,
    username: str,
    password: str = "Password123!",
) -> str:
    register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "username": username,
            "display_name": username.replace("_", " ").title(),
        },
    )
    assert register.status_code in {200, 201}
    verification_url = register.json().get("verification_url")
    assert verification_url
    token = verification_url.rsplit("token=", 1)[-1]
    verify = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verify.status_code == 200
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return login.json()["access_token"]


async def _published_job(client: AsyncClient, owner_token: str) -> str:
    job_response = await create_valid_published_job(
        client,
        owner_token,
        title="Long-form gaming editor",
    )
    assert job_response.status_code == 201
    return job_response.json()["id"]


async def _published_talent_listing(client: AsyncClient, creator_token: str) -> str:
    create_listing = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {creator_token}"},
        json={
            "title": "Video editor open for creator channels",
            "roles": ["Video editor"],
            "niche": "Gaming",
            "formats": ["Long-form"],
            "platforms": ["YouTube"],
            "tools": ["DaVinci Resolve"],
            "work_mode": "remote",
            "location": "Remote",
            "timezone": "IST",
            "availability_status": "available",
            "rate_note": "Contact for pricing",
            "description": "Listing-specific availability for June projects.",
            "status": "published",
        },
    )
    assert create_listing.status_code == 201
    return create_listing.json()["id"]


async def test_applicant_can_withdraw_application_and_owner_is_notified(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="wd_owner@example.com", username="wd_owner")
    applicant_token = await _register_verified_login(
        client, email="wd_applicant@example.com", username="wd_applicant"
    )
    job_id = await _published_job(client, owner_token)

    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "I can help.", "portfolio_item_ids": []},
    )
    assert application.status_code == 201
    application_id = application.json()["id"]

    # Withdrawal is sender-owned; the manager status endpoint cannot forge it.
    forged_withdrawal = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"status": "withdrawn"},
    )
    assert forged_withdrawal.status_code == 422

    # The job owner (not the sender) cannot withdraw someone else's application.
    forbidden = await client.post(
        f"/api/v1/applications/{application_id}/withdraw",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert forbidden.status_code == 403

    # The applicant withdraws their own application.
    withdraw = await client.post(
        f"/api/v1/applications/{application_id}/withdraw",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert withdraw.status_code == 200
    assert withdraw.json()["status"] == "withdrawn"

    # The sent list reflects the new status.
    sent = await client.get(
        "/api/v1/me/applications/sent", headers={"Authorization": f"Bearer {applicant_token}"}
    )
    assert sent.status_code == 200
    assert sent.json()[0]["status"] == "withdrawn"

    # The job owner is notified of the withdrawal.
    owner_notifications = await client.get(
        "/api/v1/notifications", headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert owner_notifications.status_code == 200
    items = owner_notifications.json()["items"]
    assert any(
        item["type"] == "application_withdrawn" and item["resource_id"] == application_id
        for item in items
    )

    # Withdraw is idempotent — calling it again stays 200 / "withdrawn".
    again = await client.post(
        f"/api/v1/applications/{application_id}/withdraw",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert again.status_code == 200
    assert again.json()["status"] == "withdrawn"


async def test_hired_application_cannot_be_withdrawn(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="wd_owner2@example.com", username="wd_owner2")
    applicant_token = await _register_verified_login(
        client, email="wd_applicant2@example.com", username="wd_applicant2"
    )
    job_id = await _published_job(client, owner_token)

    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "Hire me.", "portfolio_item_ids": []},
    )
    assert application.status_code == 201
    application_id = application.json()["id"]

    hire = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"status": "hired"},
    )
    assert hire.status_code == 200

    withdraw = await client.post(
        f"/api/v1/applications/{application_id}/withdraw",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert withdraw.status_code == 409


async def test_recruiter_can_withdraw_talent_interest_and_talent_is_notified(client: AsyncClient) -> None:
    creator_token = await _register_verified_login(client, email="wd_creator@example.com", username="wd_creator")
    recruiter_token = await _register_verified_login(
        client, email="wd_recruiter@example.com", username="wd_recruiter"
    )
    listing_id = await _published_talent_listing(client, creator_token)

    interest = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Interested in an edit test."},
    )
    assert interest.status_code == 201
    interest_id = interest.json()["id"]

    forged_withdrawal = await client.patch(
        f"/api/v1/talent-interests/{interest_id}/status",
        headers={"Authorization": f"Bearer {creator_token}"},
        json={"status": "withdrawn"},
    )
    assert forged_withdrawal.status_code == 422

    # The talent (listing owner / recipient) cannot withdraw the recruiter's request.
    forbidden = await client.post(
        f"/api/v1/talent-interests/{interest_id}/withdraw",
        headers={"Authorization": f"Bearer {creator_token}"},
    )
    assert forbidden.status_code == 403

    # The recruiter who sent it withdraws.
    withdraw = await client.post(
        f"/api/v1/talent-interests/{interest_id}/withdraw",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert withdraw.status_code == 200
    assert withdraw.json()["status"] == "withdrawn"

    # The talent is notified of the withdrawal.
    creator_notifications = await client.get(
        "/api/v1/notifications", headers={"Authorization": f"Bearer {creator_token}"}
    )
    assert creator_notifications.status_code == 200
    items = creator_notifications.json()["items"]
    assert any(
        item["type"] == "talent_interest_withdrawn" and item["resource_id"] == interest_id
        for item in items
    )

    # Idempotent re-withdraw.
    again = await client.post(
        f"/api/v1/talent-interests/{interest_id}/withdraw",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert again.status_code == 200
    assert again.json()["status"] == "withdrawn"
