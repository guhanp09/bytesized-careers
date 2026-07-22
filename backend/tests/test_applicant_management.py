from __future__ import annotations

from uuid import uuid4

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


async def _published_job(client: AsyncClient, owner_token: str, title: str = "Long-form gaming editor") -> str:
    job_response = await create_valid_published_job(client, owner_token, title=title)
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


async def test_application_private_note_history_persists_and_is_owner_only(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="history_owner@example.com", username="history_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="history_applicant@example.com", username="history_applicant"
    )
    job_id = await _published_job(client, owner_token, "Editor for a history channel")
    application_id = await _application(client, applicant_token, job_id)

    forbidden_list = await client.get(
        f"/api/v1/applications/{application_id}/notes",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert forbidden_list.status_code == 403
    forbidden_create = await client.post(
        f"/api/v1/applications/{application_id}/notes",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"body": "Applicant must not see this."},
    )
    assert forbidden_create.status_code == 403

    first = await client.post(
        f"/api/v1/applications/{application_id}/notes",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"body": "Check the long-form edit before the call."},
    )
    second = await client.post(
        f"/api/v1/applications/{application_id}/notes",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"body": "Ask about availability for the paid test."},
    )
    assert first.status_code == 201
    assert second.status_code == 201

    persisted = await client.get(
        f"/api/v1/applications/{application_id}/notes",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert persisted.status_code == 200
    assert [note["body"] for note in persisted.json()] == [
        "Ask about availability for the paid test.",
        "Check the long-form edit before the call.",
    ]

    deleted = await client.delete(
        f"/api/v1/applications/{application_id}/notes/{second.json()['id']}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert deleted.status_code == 204
    remaining = await client.get(
        f"/api/v1/applications/{application_id}/notes",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert [note["body"] for note in remaining.json()] == [
        "Check the long-form edit before the call."
    ]
    received = await client.get(
        "/api/v1/me/applications/received",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert received.json()[0]["manager_note"] == "Check the long-form edit before the call."


async def test_interest_private_note_history_persists_and_is_talent_only(
    client: AsyncClient,
) -> None:
    talent_token = await _register_verified_login(
        client, email="history_talent@example.com", username="history_talent"
    )
    recruiter_token = await _register_verified_login(
        client, email="history_recruiter@example.com", username="history_recruiter"
    )
    listing_id = await _published_talent_listing(client, talent_token)
    interest = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Would like to discuss a six-video engagement."},
    )
    assert interest.status_code == 201
    interest_id = interest.json()["id"]

    forbidden = await client.get(
        f"/api/v1/talent-interests/{interest_id}/notes",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert forbidden.status_code == 403

    first = await client.post(
        f"/api/v1/talent-interests/{interest_id}/notes",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={"body": "Confirm whether source files are organized."},
    )
    second = await client.post(
        f"/api/v1/talent-interests/{interest_id}/notes",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={"body": "Their proposed timeline works for me."},
    )
    assert first.status_code == 201
    assert second.status_code == 201

    persisted = await client.get(
        f"/api/v1/talent-interests/{interest_id}/notes",
        headers={"Authorization": f"Bearer {talent_token}"},
    )
    assert [note["body"] for note in persisted.json()] == [
        "Their proposed timeline works for me.",
        "Confirm whether source files are organized.",
    ]

    forbidden_delete = await client.delete(
        f"/api/v1/talent-interests/{interest_id}/notes/{first.json()['id']}",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert forbidden_delete.status_code == 403
    deleted = await client.delete(
        f"/api/v1/talent-interests/{interest_id}/notes/{second.json()['id']}",
        headers={"Authorization": f"Bearer {talent_token}"},
    )
    assert deleted.status_code == 204
    remaining = await client.get(
        f"/api/v1/talent-interests/{interest_id}/notes",
        headers={"Authorization": f"Bearer {talent_token}"},
    )
    assert [note["body"] for note in remaining.json()] == [
        "Confirm whether source files are organized."
    ]


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

    # The applicants still see their participant-facing relationship as pending;
    # shortlisting is private until the manager explicitly shares it.
    for token in (first_token, second_token):
        sent = await client.get(
            "/api/v1/me/applications/sent",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert sent.json()[0]["status"] == "new"

    # Internal pipeline tracking is quiet: no bell notification unless asked for.
    for token in (first_token, second_token):
        notifications = await client.get(
            "/api/v1/notifications", headers={"Authorization": f"Bearer {token}"}
        )
        assert notifications.status_code == 200
        types = [item["type"] for item in notifications.json()["items"]]
        assert "application_status_changed" not in types

    # Participant-facing outcomes are consequential and cannot be bulk-applied.
    notified = await client.post(
        "/api/v1/applications/bulk-status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"ids": [first_id, second_id], "status": "interviewing"},
    )
    assert notified.status_code == 422
    for token in (first_token, second_token):
        notifications = await client.get(
            "/api/v1/notifications", headers={"Authorization": f"Bearer {token}"}
        )
        types = [item["type"] for item in notifications.json()["items"]]
        assert "application_status_changed" not in types
        sent = await client.get(
            "/api/v1/me/applications/sent",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert sent.json()[0]["status"] == "new"


async def test_bulk_interest_status_moves_stage_for_talent_owner(client: AsyncClient) -> None:
    talent_token = await _register_verified_login(client, email="bulk_talent@example.com", username="bulk_talent")
    first_recruiter = await _register_verified_login(client, email="bulk_r1@example.com", username="bulk_r1")
    second_recruiter = await _register_verified_login(client, email="bulk_r2@example.com", username="bulk_r2")
    third_recruiter = await _register_verified_login(client, email="bulk_r3@example.com", username="bulk_r3")
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
        json={"ids": ids, "status": "reviewing"},
    )
    assert forbidden.status_code == 403

    shared_bulk = await client.post(
        "/api/v1/talent-interests/bulk-status",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={"ids": ids, "status": "declined"},
    )
    assert shared_bulk.status_code == 422

    moved = await client.post(
        "/api/v1/talent-interests/bulk-status",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={"ids": ids, "status": "reviewing"},
    )
    assert moved.status_code == 200
    assert sorted(item["status"] for item in moved.json()) == ["reviewing", "reviewing"]

    terminal_reopen = await client.post(
        "/api/v1/talent-interests/bulk-status",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={"ids": ids, "status": "accepted"},
    )
    assert terminal_reopen.status_code == 422

    third_interest = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {third_recruiter}"},
        json={"note": "Interested in a separate accepted-path fixture."},
    )
    accepted = await client.post(
        f"/api/v1/talent-interests/{third_interest.json()['id']}/transition",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={"status": "accepted", "expected_version": 1, "idempotency_key": str(uuid4())},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["current_status"] == "accepted"
    assert accepted.json()["interest"]["engagement"]["status"] == "ready_to_start"

    # Private bulk organization produces no participant-facing outcome.
    notifications = await client.get(
        "/api/v1/notifications", headers={"Authorization": f"Bearer {first_recruiter}"}
    )
    assert notifications.status_code == 200
    assert "talent_interest_status_changed" not in [
        item["type"] for item in notifications.json()["items"]
    ]
    sent = await client.get(
        "/api/v1/me/talent-interests/sent",
        headers={"Authorization": f"Bearer {first_recruiter}"},
    )
    assert sent.json()[0]["status"] == "new"


async def test_internal_application_stages_stay_private_until_explicitly_shared(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="privacy_owner@example.com", username="privacy_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="privacy_applicant@example.com", username="privacy_applicant"
    )
    outsider_token = await _register_verified_login(
        client, email="privacy_outsider@example.com", username="privacy_outsider"
    )
    job_id = await _published_job(client, owner_token, "Private pipeline test role")
    application_id = await _application(client, applicant_token, job_id)
    owner_h = {"Authorization": f"Bearer {owner_token}"}
    applicant_h = {"Authorization": f"Bearer {applicant_token}"}

    conversation_id = (
        await client.get(
            f"/api/v1/me/applications/{application_id}/conversation", headers=owner_h
        )
    ).json()["conversation"]["id"]

    reviewing = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers=owner_h,
        json={"status": "reviewing"},
    )
    assert reviewing.status_code == 200
    assert reviewing.json()["status"] == "reviewing"

    sender_view = await client.get("/api/v1/me/applications/sent", headers=applicant_h)
    assert sender_view.json()[0]["status"] == "new"
    sender_notifications = await client.get("/api/v1/notifications", headers=applicant_h)
    assert not any(
        item["type"] == "application_status_changed"
        for item in sender_notifications.json()["items"]
    )
    sender_conversation = await client.get(
        f"/api/v1/me/conversations/{conversation_id}", headers=applicant_h
    )
    assert not any(
        message["kind"] == "status_update"
        for message in sender_conversation.json()["messages"]
    )

    shortlisted = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers=owner_h,
        json={"status": "shortlisted"},
    )
    assert shortlisted.status_code == 200
    assert (await client.get("/api/v1/me/applications/sent", headers=applicant_h)).json()[0][
        "status"
    ] == "new"

    shared = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/status-update",
        headers=owner_h,
        json={
            "stage": "shortlisted",
            "expected_version": shortlisted.json()["status_version"],
            "idempotency_key": str(uuid4()),
        },
    )
    assert shared.status_code == 201
    assert (await client.get("/api/v1/me/applications/sent", headers=applicant_h)).json()[0][
        "status"
    ] == "shortlisted"

    forbidden = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={"status": "interviewing"},
    )
    assert forbidden.status_code == 403

    rejected = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers=owner_h,
        json={"status": "rejected"},
    )
    assert rejected.status_code == 200
    assert (await client.get("/api/v1/me/applications/sent", headers=applicant_h)).json()[0][
        "status"
    ] == "shortlisted"
    can_reopen_private_decision = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers=owner_h,
        json={"status": "reviewing"},
    )
    assert can_reopen_private_decision.status_code == 200


async def test_private_archive_does_not_publish_or_close_an_active_conversation(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="archive_owner@example.com", username="archive_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="archive_applicant@example.com", username="archive_applicant"
    )
    job_id = await _published_job(client, owner_token, "Archive-only pipeline role")
    application_id = await _application(client, applicant_token, job_id)
    owner_h = {"Authorization": f"Bearer {owner_token}"}
    applicant_h = {"Authorization": f"Bearer {applicant_token}"}
    conversation_id = (
        await client.get(
            f"/api/v1/me/applications/{application_id}/conversation", headers=owner_h
        )
    ).json()["conversation"]["id"]

    archived = await client.post(
        f"/api/v1/applications/{application_id}/archive",
        headers=owner_h,
        json={"archived": True},
    )
    assert archived.status_code == 200
    assert (await client.get("/api/v1/me/applications/sent", headers=applicant_h)).json()[0][
        "status"
    ] == "new"
    detail = await client.get(
        f"/api/v1/me/conversations/{conversation_id}", headers=applicant_h
    )
    assert detail.json()["conversation"]["is_closed"] is False
    reply = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "Following up on my application."},
    )
    assert reply.status_code == 201
