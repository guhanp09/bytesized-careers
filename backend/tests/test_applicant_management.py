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


async def _published_job(client: AsyncClient, owner_token: str, title: str = "Long-form gaming editor") -> str:
    job_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": title,
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
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
            "status": "published",
        },
    )
    assert create_listing.status_code == 201
    return create_listing.json()["id"]


async def _application(client: AsyncClient, applicant_token: str, job_id: str) -> str:
    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "I can help.", "portfolio_item_ids": []},
    )
    assert application.status_code == 201
    return application.json()["id"]


async def test_application_manager_note_is_owner_only_and_never_leaks_to_applicant(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(client, email="note_owner@example.com", username="note_owner")
    applicant_token = await _register_verified_login(
        client, email="note_applicant@example.com", username="note_applicant"
    )
    job_id = await _published_job(client, owner_token)
    application_id = await _application(client, applicant_token, job_id)

    # The applicant (sender) cannot write the manager note.
    forbidden = await client.patch(
        f"/api/v1/applications/{application_id}/note",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"note": "sneaky"},
    )
    assert forbidden.status_code == 403

    # The job owner annotates the applicant.
    set_note = await client.patch(
        f"/api/v1/applications/{application_id}/note",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"note": "Strong hooks reel — check rates before interview."},
    )
    assert set_note.status_code == 200
    assert set_note.json()["manager_note"] == "Strong hooks reel — check rates before interview."

    # The owner's received list carries the note.
    received = await client.get(
        "/api/v1/me/applications/received", headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert received.status_code == 200
    assert received.json()[0]["manager_note"] == "Strong hooks reel — check rates before interview."

    # The applicant's sent list and activity summary must never expose it.
    sent = await client.get("/api/v1/me/applications/sent", headers={"Authorization": f"Bearer {applicant_token}"})
    assert sent.status_code == 200
    assert sent.json()[0]["manager_note"] is None
    activity = await client.get(
        "/api/v1/me/activity/summary", headers={"Authorization": f"Bearer {applicant_token}"}
    )
    assert activity.status_code == 200
    assert activity.json()["sent_applications"][0]["manager_note"] is None

    # Clearing works (empty string → null).
    cleared = await client.patch(
        f"/api/v1/applications/{application_id}/note",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"note": "  "},
    )
    assert cleared.status_code == 200
    assert cleared.json()["manager_note"] is None


async def test_interest_manager_note_is_talent_only_and_never_leaks_to_recruiter(
    client: AsyncClient,
) -> None:
    talent_token = await _register_verified_login(client, email="note_talent@example.com", username="note_talent")
    recruiter_token = await _register_verified_login(
        client, email="note_recruiter@example.com", username="note_recruiter"
    )
    listing_id = await _published_talent_listing(client, talent_token)

    interest = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Interested in a retainer."},
    )
    assert interest.status_code == 201
    interest_id = interest.json()["id"]

    # The recruiter (sender) cannot write the manager note.
    forbidden = await client.patch(
        f"/api/v1/talent-interests/{interest_id}/note",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "sneaky"},
    )
    assert forbidden.status_code == 403

    set_note = await client.patch(
        f"/api/v1/talent-interests/{interest_id}/note",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={"note": "Solid channel; ask for scope doc."},
    )
    assert set_note.status_code == 200
    assert set_note.json()["manager_note"] == "Solid channel; ask for scope doc."

    # Recruiter-facing reads never expose it.
    sent = await client.get(
        "/api/v1/me/talent-interests/sent", headers={"Authorization": f"Bearer {recruiter_token}"}
    )
    assert sent.status_code == 200
    assert sent.json()[0]["manager_note"] is None
    activity = await client.get(
        "/api/v1/me/activity/summary", headers={"Authorization": f"Bearer {recruiter_token}"}
    )
    assert activity.status_code == 200
    assert activity.json()["sent_interests"][0]["manager_note"] is None

    # Talent-facing received list carries it.
    received = await client.get(
        "/api/v1/me/talent-interests", headers={"Authorization": f"Bearer {talent_token}"}
    )
    assert received.status_code == 200
    assert received.json()[0]["manager_note"] == "Solid channel; ask for scope doc."


async def test_bulk_application_status_is_quiet_by_default_and_notifies_on_request(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(client, email="bulk_owner@example.com", username="bulk_owner")
    first_token = await _register_verified_login(client, email="bulk_a1@example.com", username="bulk_a1")
    second_token = await _register_verified_login(client, email="bulk_a2@example.com", username="bulk_a2")
    outsider_token = await _register_verified_login(
        client, email="bulk_outsider@example.com", username="bulk_outsider"
    )
    job_id = await _published_job(client, owner_token)
    first_id = await _application(client, first_token, job_id)
    second_id = await _application(client, second_token, job_id)

    # Only the job owner can bulk-move applicants.
    forbidden = await client.post(
        "/api/v1/applications/bulk-status",
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={"ids": [first_id, second_id], "status": "shortlisted"},
    )
    assert forbidden.status_code == 403

    # Unknown ids reject the whole batch (all-or-nothing).
    missing = await client.post(
        "/api/v1/applications/bulk-status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"ids": [first_id, "00000000-0000-0000-0000-000000000000"], "status": "shortlisted"},
    )
    assert missing.status_code == 404

    # "withdrawn" is sender-only vocabulary and not a manager stage.
    invalid = await client.post(
        "/api/v1/applications/bulk-status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"ids": [first_id], "status": "withdrawn"},
    )
    assert invalid.status_code == 422

    moved = await client.post(
        "/api/v1/applications/bulk-status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"ids": [first_id, second_id], "status": "shortlisted"},
    )
    assert moved.status_code == 200
    assert sorted(item["status"] for item in moved.json()) == ["shortlisted", "shortlisted"]

    # Internal pipeline tracking is quiet: no bell notification unless asked for.
    for token in (first_token, second_token):
        notifications = await client.get(
            "/api/v1/notifications", headers={"Authorization": f"Bearer {token}"}
        )
        assert notifications.status_code == 200
        types = [item["type"] for item in notifications.json()["items"]]
        assert "application_status_changed" not in types

    # Opting in (notify: true) restores the bell notification per applicant.
    notified = await client.post(
        "/api/v1/applications/bulk-status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"ids": [first_id, second_id], "status": "interviewing", "notify": True},
    )
    assert notified.status_code == 200
    for token in (first_token, second_token):
        notifications = await client.get(
            "/api/v1/notifications", headers={"Authorization": f"Bearer {token}"}
        )
        types = [item["type"] for item in notifications.json()["items"]]
        assert "application_status_changed" in types


async def test_bulk_interest_status_moves_stage_for_talent_owner(client: AsyncClient) -> None:
    talent_token = await _register_verified_login(client, email="bulk_talent@example.com", username="bulk_talent")
    first_recruiter = await _register_verified_login(client, email="bulk_r1@example.com", username="bulk_r1")
    second_recruiter = await _register_verified_login(client, email="bulk_r2@example.com", username="bulk_r2")
    listing_id = await _published_talent_listing(client, talent_token)

    ids = []
    for token in (first_recruiter, second_recruiter):
        interest = await client.post(
            f"/api/v1/talent-listings/{listing_id}/interest",
            headers={"Authorization": f"Bearer {token}"},
            json={"note": "Interested."},
        )
        assert interest.status_code == 201
        ids.append(interest.json()["id"])

    # A sender cannot bulk-manage the talent's pipeline.
    forbidden = await client.post(
        "/api/v1/talent-interests/bulk-status",
        headers={"Authorization": f"Bearer {first_recruiter}"},
        json={"ids": ids, "status": "declined"},
    )
    assert forbidden.status_code == 403

    moved = await client.post(
        "/api/v1/talent-interests/bulk-status",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={"ids": ids, "status": "declined"},
    )
    assert moved.status_code == 200
    assert sorted(item["status"] for item in moved.json()) == ["declined", "declined"]

    # Quiet by default — informing the recruiter is a separate, explicit act.
    notifications = await client.get(
        "/api/v1/notifications", headers={"Authorization": f"Bearer {first_recruiter}"}
    )
    assert notifications.status_code == 200
    assert "talent_interest_status_changed" not in [
        item["type"] for item in notifications.json()["items"]
    ]
