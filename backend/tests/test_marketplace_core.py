from __future__ import annotations

from httpx import AsyncClient


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


async def test_saved_jobs_applications_notifications_reports_and_launch_entitlement(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="owner@example.com", username="job_owner")
    applicant_token = await _register_verified_login(client, email="applicant@example.com", username="applicant")

    job_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Long-form gaming editor",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
    )
    assert job_response.status_code == 201
    job_id = job_response.json()["id"]

    checkout = await client.post(
        "/api/v1/checkout/launch-free",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"kind": "job_post", "target_type": "job", "target_id": job_id},
    )
    assert checkout.status_code == 201
    assert checkout.json()["source"] == "free_launch"

    save = await client.post(
        f"/api/v1/jobs/{job_id}/save",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"note": "Looks relevant"},
    )
    assert save.status_code == 200
    saved = await client.get("/api/v1/me/saved-jobs", headers={"Authorization": f"Bearer {applicant_token}"})
    assert saved.status_code == 200
    assert saved.json()[0]["job_id"] == job_id

    saved_summary = await client.get(
        "/api/v1/me/saved/summary",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert saved_summary.status_code == 200
    assert saved_summary.json()["jobs"][0]["job"]["title"] == "Long-form gaming editor"

    remove_saved = await client.delete(
        f"/api/v1/jobs/{job_id}/save",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert remove_saved.status_code == 200
    assert remove_saved.json()["ok"] is True

    saved_summary_after_remove = await client.get(
        "/api/v1/me/saved/summary",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert saved_summary_after_remove.status_code == 200
    assert saved_summary_after_remove.json()["jobs"] == []

    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "I can help.", "portfolio_item_ids": []},
    )
    assert application.status_code == 201
    application_id = application.json()["id"]

    sent = await client.get("/api/v1/me/applications/sent", headers={"Authorization": f"Bearer {applicant_token}"})
    assert sent.status_code == 200
    assert sent.json()[0]["id"] == application_id

    received = await client.get(
        "/api/v1/me/applications/received",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert received.status_code == 200
    assert received.json()[0]["id"] == application_id

    status_update = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"status": "shortlisted"},
    )
    assert status_update.status_code == 200
    assert status_update.json()["status"] == "shortlisted"

    notifications = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {applicant_token}"})
    assert notifications.status_code == 200
    assert notifications.json()["unread_count"] >= 1

    report = await client.post(
        "/api/v1/reports",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"target_type": "job", "target_id": job_id, "category": "suspicious", "note": "Test report"},
    )
    assert report.status_code == 201
    assert report.json()["target_type"] == "job"


async def test_talent_listing_save_interest_and_notifications(client: AsyncClient) -> None:
    creator_token = await _register_verified_login(client, email="creator@example.com", username="creator")
    recruiter_token = await _register_verified_login(client, email="recruiter@example.com", username="recruiter")

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
    listing_id = create_listing.json()["id"]

    public_list = await client.get("/api/v1/talent-listings")
    assert public_list.status_code == 200
    assert any(item["id"] == listing_id for item in public_list.json()["items"])

    save = await client.post(
        f"/api/v1/talent-listings/{listing_id}/save",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Good fit"},
    )
    assert save.status_code == 200

    saved_summary = await client.get(
        "/api/v1/me/saved/summary",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert saved_summary.status_code == 200
    assert saved_summary.json()["talent"][0]["talent"]["title"] == "Video editor open for creator channels"

    remove_saved = await client.delete(
        f"/api/v1/talent-listings/{listing_id}/save",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert remove_saved.status_code == 200
    assert remove_saved.json()["ok"] is True

    saved_summary_after_remove = await client.get(
        "/api/v1/me/saved/summary",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert saved_summary_after_remove.status_code == 200
    assert saved_summary_after_remove.json()["talent"] == []

    interest = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Interested in an edit test."},
    )
    assert interest.status_code == 201
    interest_id = interest.json()["id"]

    received = await client.get(
        "/api/v1/me/talent-interests",
        headers={"Authorization": f"Bearer {creator_token}"},
    )
    assert received.status_code == 200
    assert received.json()[0]["id"] == interest_id

    notifications = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {creator_token}"})
    assert notifications.status_code == 200
    assert notifications.json()["unread_count"] >= 1

    creator_activity = await client.get(
        "/api/v1/me/activity/summary",
        headers={"Authorization": f"Bearer {creator_token}"},
    )
    assert creator_activity.status_code == 200
    creator_activity_data = creator_activity.json()
    assert creator_activity_data["received_interests"][0]["id"] == interest_id
    assert creator_activity_data["related_talent_listings"][0]["id"] == listing_id

    recruiter_activity = await client.get(
        "/api/v1/me/activity/summary",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert recruiter_activity.status_code == 200
    assert recruiter_activity.json()["sent_interests"][0]["id"] == interest_id


async def test_talent_interest_can_be_attached_to_recruiter_job(client: AsyncClient) -> None:
    talent_token = await _register_verified_login(
        client,
        email="talent-invite@example.com",
        username="talent_invite",
    )
    recruiter_token = await _register_verified_login(
        client,
        email="recruiter-invite@example.com",
        username="recruiter_invite",
    )
    other_recruiter_token = await _register_verified_login(
        client,
        email="other-recruiter-invite@example.com",
        username="other_invite",
    )

    listing_response = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={
            "title": "Thumbnail designer for creator-led channels",
            "roles": ["Thumbnail designer"],
            "platforms": ["YouTube"],
            "tools": ["Photoshop"],
            "work_mode": "remote",
            "status": "published",
        },
    )
    assert listing_response.status_code == 201
    listing_id = listing_response.json()["id"]

    job_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={
            "title": "YouTube thumbnail designer",
            "category": "Thumbnails",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
    )
    assert job_response.status_code == 201
    job_id = job_response.json()["id"]

    wrong_owner = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {other_recruiter_token}"},
        json={"job_id": job_id, "note": "Can you work on this?"},
    )
    assert wrong_owner.status_code == 403

    invite = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"job_id": job_id, "note": "Can you work on this?"},
    )
    assert invite.status_code == 201
    assert invite.json()["job_id"] == job_id
    invite_id = invite.json()["id"]

    duplicate_invite = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"job_id": job_id, "note": "Updated invite context."},
    )
    assert duplicate_invite.status_code == 201
    assert duplicate_invite.json()["id"] == invite_id
    assert duplicate_invite.json()["note"] == "Updated invite context."
    assert duplicate_invite.json()["status"] == "new"

    sent = await client.get(
        "/api/v1/me/talent-interests/sent",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert sent.status_code == 200
    assert len(sent.json()) == 1
    assert sent.json()[0]["job_id"] == job_id


async def test_job_and_talent_drafts_resume_by_updating_existing_records(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client,
        email="draft-resume@example.com",
        username="draft_resume",
    )

    job_draft = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Draft editor role",
            "category": "Editing",
            "location": "Remote",
            "status": "draft",
        },
    )
    assert job_draft.status_code == 201
    job_id = job_draft.json()["id"]

    resumed_job = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"title": "Published editor role", "status": "published"},
    )
    assert resumed_job.status_code == 200
    assert resumed_job.json()["id"] == job_id
    assert resumed_job.json()["title"] == "Published editor role"
    assert resumed_job.json()["status"] == "published"

    talent_draft = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Draft retention editor listing",
            "roles": ["Video editor"],
            "tools": ["Premiere Pro"],
            "work_mode": "remote",
            "status": "draft",
        },
    )
    assert talent_draft.status_code == 201
    listing_id = talent_draft.json()["id"]

    resumed_listing = await client.patch(
        f"/api/v1/talent-listings/{listing_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"title": "Published retention editor listing", "status": "published"},
    )
    assert resumed_listing.status_code == 200
    assert resumed_listing.json()["id"] == listing_id
    assert resumed_listing.json()["title"] == "Published retention editor listing"
    assert resumed_listing.json()["status"] == "published"

    activity = await client.get(
        "/api/v1/me/activity/summary",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert activity.status_code == 200
    data = activity.json()
    assert any(item["id"] == job_id for item in data["my_jobs"])
    assert any(item["id"] == listing_id for item in data["my_talent_listings"])
