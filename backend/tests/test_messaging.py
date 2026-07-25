from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from conftest import create_valid_published_job


async def _register_verified_login(client: AsyncClient, *, email: str, username: str) -> str:
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Password123!", "username": username, "display_name": username.title()},
    )
    assert register.status_code in {200, 201}
    token = register.json()["verification_url"].rsplit("token=", 1)[-1]
    await client.post("/api/v1/auth/verify-email", json={"token": token})
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return login.json()["access_token"]


async def _published_job(client: AsyncClient, owner_token: str) -> str:
    resp = await create_valid_published_job(
        client,
        owner_token,
        title="Editor for finance channel",
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def _apply(client: AsyncClient, applicant_token: str, job_id: str) -> str:
    resp = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "I can help.", "portfolio_item_ids": []},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_application_creates_conversation_and_messaging_round_trip(client: AsyncClient) -> None:
    owner = await _register_verified_login(client, email="m_owner@example.com", username="m_owner")
    applicant = await _register_verified_login(client, email="m_applicant@example.com", username="m_applicant")
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)

    # Both sides resolve the same conversation; it starts with no messages (the opening
    # cover note stays as application detail, not duplicated into the thread).
    applicant_h = {"Authorization": f"Bearer {applicant}"}
    owner_h = {"Authorization": f"Bearer {owner}"}
    convo_a = await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_h)
    assert convo_a.status_code == 200
    conversation_id = convo_a.json()["conversation"]["id"]
    assert convo_a.json()["messages"] == []

    convo_b = await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=owner_h)
    assert convo_b.json()["conversation"]["id"] == conversation_id

    # Applicant sends a real message.
    sent = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "Hi — happy to share more samples."},
    )
    assert sent.status_code == 201
    assert sent.json()["from_me"] is True

    # Owner sees it, with unread state, and a real message_received notification.
    owner_view = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=owner_h)
    assert [m["body"] for m in owner_view.json()["messages"]] == ["Hi — happy to share more samples."]
    assert owner_view.json()["messages"][0]["from_me"] is False
    assert owner_view.json()["conversation"]["unread_count"] == 1

    notifs = await client.get("/api/v1/notifications", headers=owner_h)
    message_notifs = [n for n in notifs.json()["items"] if n["type"] == "message_received"]
    assert message_notifs
    assert message_notifs[0]["resource_id"] == conversation_id
    assert message_notifs[0]["action_url"] == (
        f"/applications?view=inbox&mode=recruiter&thread={application_id}"
    )

    # Owner reads → unread clears.
    await client.post(f"/api/v1/me/conversations/{conversation_id}/read", headers=owner_h)
    after = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=owner_h)
    assert after.json()["conversation"]["unread_count"] == 0

    reply = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=owner_h,
        json={"body": "Thanks — I’ll review these today."},
    )
    assert reply.status_code == 201
    applicant_notifications = (
        await client.get("/api/v1/notifications", headers=applicant_h)
    ).json()["items"]
    owner_reply_notification = next(
        item
        for item in applicant_notifications
        if item["type"] == "message_received" and item["resource_id"] == conversation_id
    )
    assert owner_reply_notification["action_url"] == (
        f"/applications?view=inbox&mode=talent&thread={application_id}"
    )


async def test_talent_interest_creates_conversation(client: AsyncClient) -> None:
    creator = await _register_verified_login(client, email="mi_creator@example.com", username="mi_creator")
    recruiter = await _register_verified_login(client, email="mi_recruiter@example.com", username="mi_recruiter")
    listing = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {creator}"},
        json={"title": "Editor open for channels", "roles": ["Video editor"], "status": "published"},
    )
    listing_id = listing.json()["id"]
    interest = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter}"},
        json={"note": "Interested!"},
    )
    interest_id = interest.json()["id"]

    convo = await client.get(
        f"/api/v1/me/talent-interests/{interest_id}/conversation",
        headers={"Authorization": f"Bearer {recruiter}"},
    )
    assert convo.status_code == 200
    assert convo.json()["conversation"]["context_type"] == "talent_interest"
    conversation_id = convo.json()["conversation"]["id"]

    recruiter_h = {"Authorization": f"Bearer {recruiter}"}
    creator_h = {"Authorization": f"Bearer {creator}"}
    recruiter_message = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=recruiter_h,
        json={"body": "Could we discuss the brief?"},
    )
    assert recruiter_message.status_code == 201
    creator_notifications = (await client.get("/api/v1/notifications", headers=creator_h)).json()["items"]
    creator_message_notification = next(
        item for item in creator_notifications if item["type"] == "message_received"
    )
    assert creator_message_notification["action_url"] == (
        f"/applications?view=inbox&mode=talent&thread={interest_id}"
    )

    creator_reply = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=creator_h,
        json={"body": "Yes, send the details here."},
    )
    assert creator_reply.status_code == 201
    recruiter_notifications = (
        await client.get("/api/v1/notifications", headers=recruiter_h)
    ).json()["items"]
    recruiter_message_notification = next(
        item for item in recruiter_notifications if item["type"] == "message_received"
    )
    assert recruiter_message_notification["action_url"] == (
        f"/applications?view=inbox&mode=recruiter&thread={interest_id}"
    )


async def test_unrelated_user_cannot_read_or_send(client: AsyncClient) -> None:
    owner = await _register_verified_login(client, email="x_owner@example.com", username="x_owner")
    applicant = await _register_verified_login(client, email="x_applicant@example.com", username="x_applicant")
    stranger = await _register_verified_login(client, email="x_stranger@example.com", username="x_stranger")
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    convo = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation",
        headers={"Authorization": f"Bearer {applicant}"},
    )
    conversation_id = convo.json()["conversation"]["id"]

    stranger_h = {"Authorization": f"Bearer {stranger}"}
    assert (await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=stranger_h)).status_code == 403
    send = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=stranger_h,
        json={"body": "let me in"},
    )
    assert send.status_code == 403
    assert (
        await client.post(
            f"/api/v1/me/conversations/{conversation_id}/read", headers=stranger_h
        )
    ).status_code == 403
    # Stranger also can't reach the conversation via the application route.
    assert (
        await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=stranger_h)
    ).status_code == 403


async def test_messaging_requires_auth(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/me/conversations")).status_code == 401


async def test_empty_message_is_rejected(client: AsyncClient) -> None:
    owner = await _register_verified_login(client, email="e_owner@example.com", username="e_owner")
    applicant = await _register_verified_login(client, email="e_applicant@example.com", username="e_applicant")
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    applicant_h = {"Authorization": f"Bearer {applicant}"}
    convo = await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_h)
    conversation_id = convo.json()["conversation"]["id"]
    blank = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "   "},
    )
    assert blank.status_code == 422


async def test_multiline_urls_special_characters_and_length_limit_persist_safely(
    client: AsyncClient,
) -> None:
    owner = await _register_verified_login(
        client, email="content-owner@example.com", username="content_owner"
    )
    applicant = await _register_verified_login(
        client, email="content-applicant@example.com", username="content_applicant"
    )
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    applicant_h = {"Authorization": f"Bearer {applicant}"}
    owner_h = {"Authorization": f"Bearer {owner}"}
    conversation_id = (
        await client.get(
            f"/api/v1/me/applications/{application_id}/conversation",
            headers=applicant_h,
        )
    ).json()["conversation"]["id"]
    body = "Line one\nLine two: https://example.com/reel?a=1&b=2\nSymbols: ₹ & < > — done"

    sent = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": body},
    )
    assert sent.status_code == 201
    assert sent.json()["body"] == body
    detail = await client.get(
        f"/api/v1/me/conversations/{conversation_id}", headers=owner_h
    )
    assert detail.json()["messages"][-1]["body"] == body

    too_long = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "x" * 5001},
    )
    assert too_long.status_code == 422


async def test_lazy_conversation_for_preexisting_application(client: AsyncClient) -> None:
    # Simulates an application created before conversations existed: no eager row, but
    # opening the thread lazily creates exactly one stable conversation.
    owner = await _register_verified_login(client, email="l_owner@example.com", username="l_owner")
    applicant = await _register_verified_login(client, email="l_applicant@example.com", username="l_applicant")
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    applicant_h = {"Authorization": f"Bearer {applicant}"}

    first = await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_h)
    second = await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_h)
    assert first.json()["conversation"]["id"] == second.json()["conversation"]["id"]


async def test_status_update_is_server_generated_and_cannot_be_forged(client: AsyncClient) -> None:
    # A trusted pipeline event can only be generated after the owner actually
    # moves the source record into that stage.
    owner = await _register_verified_login(client, email="k_owner@example.com", username="k_owner")
    applicant = await _register_verified_login(client, email="k_applicant@example.com", username="k_applicant")
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    owner_h = {"Authorization": f"Bearer {owner}"}
    applicant_h = {"Authorization": f"Bearer {applicant}"}

    convo = await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=owner_h)
    conversation_id = convo.json()["conversation"]["id"]

    moved = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers=owner_h,
        json={"status": "shortlisted"},
    )
    assert moved.status_code == 200

    sent = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/status-update",
        headers=owner_h,
        json={
            "stage": "shortlisted",
            "expected_version": moved.json()["status_version"],
            "idempotency_key": str(uuid4()),
        },
    )
    assert sent.status_code == 201
    assert sent.json()["kind"] == "status_update"
    assert sent.json()["body"] == "Shortlisted for “Editor for finance channel”."

    # The other participant reads the same kind back.
    view = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=applicant_h)
    assert view.json()["messages"][-1]["kind"] == "status_update"

    # The applicant cannot generate a manager event, even for the real stage.
    forbidden = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/status-update",
        headers=applicant_h,
        json={
            "stage": "shortlisted",
            "expected_version": moved.json()["status_version"],
            "idempotency_key": str(uuid4()),
        },
    )
    assert forbidden.status_code == 403

    # A stale or invented stage cannot be presented as a trusted event.
    stale = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/status-update",
        headers=owner_h,
        json={
            "stage": "shortlisted",
            "expected_version": moved.json()["status_version"] + 1,
            "idempotency_key": str(uuid4()),
        },
    )
    assert stale.status_code == 409

    # Plain text stays kind-less; the public text endpoint rejects a forged kind.
    plain = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=owner_h,
        json={"body": "Looking forward to it."},
    )
    assert plain.status_code == 201
    assert plain.json()["kind"] is None

    invalid = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=owner_h,
        json={"body": "hello", "kind": "status_update"},
    )
    assert invalid.status_code == 422


async def test_two_way_ordering_sender_read_and_conversation_sorting(client: AsyncClient) -> None:
    owner = await _register_verified_login(client, email="o_owner@example.com", username="o_owner")
    applicant = await _register_verified_login(
        client, email="o_applicant@example.com", username="o_applicant"
    )
    second_applicant = await _register_verified_login(
        client, email="o_second@example.com", username="o_second"
    )
    job_id = await _published_job(client, owner)
    first_application_id = await _apply(client, applicant, job_id)
    second_application_id = await _apply(client, second_applicant, job_id)
    owner_h = {"Authorization": f"Bearer {owner}"}
    applicant_h = {"Authorization": f"Bearer {applicant}"}

    first_detail = await client.get(
        f"/api/v1/me/applications/{first_application_id}/conversation", headers=owner_h
    )
    first_conversation_id = first_detail.json()["conversation"]["id"]
    second_detail = await client.get(
        f"/api/v1/me/applications/{second_application_id}/conversation", headers=owner_h
    )
    second_conversation_id = second_detail.json()["conversation"]["id"]

    first = await client.post(
        f"/api/v1/me/conversations/{first_conversation_id}/messages",
        headers=applicant_h,
        json={"body": "First from applicant"},
    )
    assert first.status_code == 201
    reply = await client.post(
        f"/api/v1/me/conversations/{first_conversation_id}/messages",
        headers=owner_h,
        json={"body": "Reply from owner"},
    )
    assert reply.status_code == 201

    applicant_view = await client.get(
        f"/api/v1/me/conversations/{first_conversation_id}", headers=applicant_h
    )
    assert [message["body"] for message in applicant_view.json()["messages"]] == [
        "First from applicant",
        "Reply from owner",
    ]
    assert applicant_view.json()["conversation"]["unread_count"] == 1

    owner_view = await client.get(
        f"/api/v1/me/conversations/{first_conversation_id}", headers=owner_h
    )
    assert owner_view.json()["conversation"]["unread_count"] == 0

    conversations = await client.get("/api/v1/me/conversations", headers=owner_h)
    assert conversations.status_code == 200
    assert conversations.json()[0]["id"] == first_conversation_id
    assert {item["id"] for item in conversations.json()} >= {
        first_conversation_id,
        second_conversation_id,
    }


async def test_message_retry_is_idempotent_and_does_not_duplicate_notifications(
    client: AsyncClient,
) -> None:
    owner = await _register_verified_login(client, email="i_owner@example.com", username="i_owner")
    applicant = await _register_verified_login(
        client, email="i_applicant@example.com", username="i_applicant"
    )
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    applicant_h = {"Authorization": f"Bearer {applicant}"}
    owner_h = {"Authorization": f"Bearer {owner}"}
    conversation_id = (
        await client.get(
            f"/api/v1/me/applications/{application_id}/conversation",
            headers=applicant_h,
        )
    ).json()["conversation"]["id"]
    retry_key = str(uuid4())
    payload = {"body": "One persisted message", "client_message_id": retry_key}

    first = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json=payload,
    )
    retry = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json=payload,
    )
    assert first.status_code == 201
    assert retry.status_code == 201
    assert retry.json()["id"] == first.json()["id"]

    detail = await client.get(
        f"/api/v1/me/conversations/{conversation_id}", headers=owner_h
    )
    assert [message["body"] for message in detail.json()["messages"]].count(
        "One persisted message"
    ) == 1
    notifications = await client.get("/api/v1/notifications", headers=owner_h)
    matching = [
        item
        for item in notifications.json()["items"]
        if item["type"] == "message_received" and item["resource_id"] == conversation_id
    ]
    assert len(matching) == 1

    conflict = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "Different content", "client_message_id": retry_key},
    )
    assert conflict.status_code == 409


async def test_terminal_outcomes_close_chat_but_hired_work_stays_open(client: AsyncClient) -> None:
    owner = await _register_verified_login(client, email="c_owner@example.com", username="c_owner")
    hired_applicant = await _register_verified_login(
        client, email="c_hired@example.com", username="c_hired"
    )
    rejected_applicant = await _register_verified_login(
        client, email="c_rejected@example.com", username="c_rejected"
    )
    job_id = await _published_job(client, owner)
    hired_id = await _apply(client, hired_applicant, job_id)
    rejected_id = await _apply(client, rejected_applicant, job_id)
    owner_h = {"Authorization": f"Bearer {owner}"}

    hired_conversation = (
        await client.get(f"/api/v1/me/applications/{hired_id}/conversation", headers=owner_h)
    ).json()["conversation"]["id"]
    rejected_conversation = (
        await client.get(f"/api/v1/me/applications/{rejected_id}/conversation", headers=owner_h)
    ).json()["conversation"]["id"]

    assert (
        await client.patch(
            f"/api/v1/applications/{hired_id}/status",
            headers=owner_h,
            json={"status": "hired"},
        )
    ).status_code == 200
    still_open = await client.post(
        f"/api/v1/me/conversations/{hired_conversation}/messages",
        headers=owner_h,
        json={"body": "Let’s coordinate the first delivery here."},
    )
    assert still_open.status_code == 201

    rejected = await client.patch(
            f"/api/v1/applications/{rejected_id}/status",
            headers=owner_h,
            json={"status": "rejected"},
        )
    assert rejected.status_code == 200
    rejected_version = rejected.json()["status_version"]
    shared_rejection = await client.post(
        f"/api/v1/applications/{rejected_id}/status-communication",
        headers=owner_h,
        json={
            "status": "rejected",
            "expected_version": rejected_version,
            "idempotency_key": str(uuid4()),
        },
    )
    assert shared_rejection.status_code == 200
    detail = await client.get(
        f"/api/v1/me/conversations/{rejected_conversation}", headers=owner_h
    )
    final_events = [
        message
        for message in detail.json()["messages"]
        if message["kind"] == "status_update"
        and message["body"] == "Not moving forward for “Editor for finance channel”."
    ]
    assert len(final_events) == 1
    assert final_events[0]["body"] == "Not moving forward for “Editor for finance channel”."

    duplicate_event = await client.post(
        f"/api/v1/applications/{rejected_id}/status-communication",
        headers=owner_h,
        json={
            "status": "rejected",
            "expected_version": rejected_version,
            "idempotency_key": str(uuid4()),
        },
    )
    assert duplicate_event.status_code == 200
    assert duplicate_event.json()["outcome"] == "already_in_state"

    closed = await client.post(
        f"/api/v1/me/conversations/{rejected_conversation}/messages",
        headers=owner_h,
        json={"body": "This should not be accepted."},
    )
    assert closed.status_code == 409
    assert "closed" in closed.json()["error"]["message"].lower()


async def test_accepted_hiring_request_stays_open_and_decline_event_is_trusted(
    client: AsyncClient,
) -> None:
    creator = await _register_verified_login(
        client, email="tc_creator@example.com", username="tc_creator"
    )
    accepted_recruiter = await _register_verified_login(
        client, email="tc_accepted@example.com", username="tc_accepted"
    )
    declined_recruiter = await _register_verified_login(
        client, email="tc_declined@example.com", username="tc_declined"
    )
    creator_h = {"Authorization": f"Bearer {creator}"}
    listing = await client.post(
        "/api/v1/talent-listings",
        headers=creator_h,
        json={"title": "Editor open for creator teams", "roles": ["Video editor"], "status": "published"},
    )
    listing_id = listing.json()["id"]

    async def create_interest(recruiter: str, note: str) -> tuple[str, str]:
        recruiter_h = {"Authorization": f"Bearer {recruiter}"}
        interest = await client.post(
            f"/api/v1/talent-listings/{listing_id}/interest",
            headers=recruiter_h,
            json={"note": note},
        )
        interest_id = interest.json()["id"]
        detail = await client.get(
            f"/api/v1/me/talent-interests/{interest_id}/conversation",
            headers=creator_h,
        )
        return interest_id, detail.json()["conversation"]["id"]

    accepted_id, accepted_conversation = await create_interest(
        accepted_recruiter, "Can we discuss a project?"
    )
    declined_id, declined_conversation = await create_interest(
        declined_recruiter, "Is this still available?"
    )

    accepted_key = str(uuid4())
    accepted = await client.post(
        f"/api/v1/talent-interests/{accepted_id}/transition",
        headers=creator_h,
        json={"status": "accepted", "expected_version": 1, "idempotency_key": accepted_key},
    )
    assert accepted.status_code == 200
    accepted_detail = await client.get(
        f"/api/v1/me/conversations/{accepted_conversation}", headers=creator_h
    )
    accepted_events = [
        message
        for message in accepted_detail.json()["messages"]
        if message["kind"] == "status_update" and message["body"] == "Hiring request accepted."
    ]
    assert len(accepted_events) == 1
    assert accepted_events[0]["body"] == "Hiring request accepted."
    accepted_duplicate = await client.post(
        f"/api/v1/talent-interests/{accepted_id}/transition",
        headers=creator_h,
        json={"status": "accepted", "expected_version": 1, "idempotency_key": accepted_key},
    )
    assert accepted_duplicate.status_code == 200
    assert accepted_duplicate.json()["outcome"] == "already_in_state"
    assert (
        await client.post(
            f"/api/v1/me/conversations/{accepted_conversation}/messages",
            headers={"Authorization": f"Bearer {accepted_recruiter}"},
            json={"body": "Great — I’ll share the brief here."},
        )
    ).status_code == 201

    declined_key = str(uuid4())
    declined = await client.post(
        f"/api/v1/talent-interests/{declined_id}/transition",
        headers=creator_h,
        json={"status": "declined", "expected_version": 1, "idempotency_key": declined_key},
    )
    assert declined.status_code == 200
    declined_detail = await client.get(
        f"/api/v1/me/conversations/{declined_conversation}", headers=creator_h
    )
    declined_events = [
        message
        for message in declined_detail.json()["messages"]
        if message["kind"] == "status_update" and message["body"] == "Hiring request declined."
    ]
    assert len(declined_events) == 1
    assert declined_events[0]["body"] == "Hiring request declined."
    declined_duplicate = await client.post(
        f"/api/v1/talent-interests/{declined_id}/transition",
        headers=creator_h,
        json={"status": "declined", "expected_version": 1, "idempotency_key": declined_key},
    )
    assert declined_duplicate.status_code == 200
    assert declined_duplicate.json()["outcome"] == "already_in_state"
    assert (
        await client.post(
            f"/api/v1/me/conversations/{declined_conversation}/messages",
            headers={"Authorization": f"Bearer {declined_recruiter}"},
            json={"body": "This should be closed."},
        )
    ).status_code == 409


async def test_suspended_participant_closes_new_messages(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await _register_verified_login(
        client, email="suspended-owner@example.com", username="suspended_owner"
    )
    applicant = await _register_verified_login(
        client, email="active-applicant@example.com", username="active_applicant"
    )
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    applicant_h = {"Authorization": f"Bearer {applicant}"}
    owner_h = {"Authorization": f"Bearer {owner}"}
    conversation_id = (
        await client.get(
            f"/api/v1/me/applications/{application_id}/conversation",
            headers=applicant_h,
        )
    ).json()["conversation"]["id"]

    owner_row = (
        await db_session.execute(
            select(User).where(User.email == "suspended-owner@example.com")
        )
    ).scalar_one()
    owner_row.suspended_at = datetime.now(UTC)
    await db_session.commit()

    blocked = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "This must not be delivered to a suspended account."},
    )
    assert blocked.status_code == 409
    assert "closed" in blocked.json()["error"]["message"].lower()
    assert (
        await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=owner_h)
    ).status_code == 403


async def test_message_notification_thread_is_locatable_in_recipient_activity_summary(
    client: AsyncClient,
) -> None:
    """A "new message" notification must always point at a thread the recipient can
    find in their own inbox data (the activity summary), on the exact side the
    action URL's mode selects. This is the backend half of the "notifications say
    messages exist but the inbox looks empty" regression."""
    owner = await _register_verified_login(client, email="coh_owner@example.com", username="coh_owner")
    applicant = await _register_verified_login(client, email="coh_applicant@example.com", username="coh_applicant")
    owner_h = {"Authorization": f"Bearer {owner}"}
    applicant_h = {"Authorization": f"Bearer {applicant}"}

    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    conversation_id = (
        await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_h)
    ).json()["conversation"]["id"]

    # Applicant → owner: the owner's notification must resolve inside the owner's
    # recruiter-side inbox records.
    await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "Checking in on my application."},
    )
    owner_notification = next(
        item
        for item in (await client.get("/api/v1/notifications", headers=owner_h)).json()["items"]
        if item["type"] == "message_received"
    )
    assert "mode=recruiter" in owner_notification["action_url"]
    thread_id = owner_notification["action_url"].rsplit("thread=", 1)[-1]
    owner_summary = (await client.get("/api/v1/me/activity/summary", headers=owner_h)).json()
    assert thread_id in {row["id"] for row in owner_summary["received_applications"]}, (
        "owner notification thread missing from the recruiter-side inbox records"
    )

    # Owner → applicant: the applicant's notification must resolve inside the
    # applicant's talent-side inbox records.
    await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=owner_h,
        json={"body": "Thanks — reviewing now."},
    )
    applicant_notification = next(
        item
        for item in (await client.get("/api/v1/notifications", headers=applicant_h)).json()["items"]
        if item["type"] == "message_received"
    )
    assert "mode=talent" in applicant_notification["action_url"]
    applicant_thread = applicant_notification["action_url"].rsplit("thread=", 1)[-1]
    applicant_summary = (await client.get("/api/v1/me/activity/summary", headers=applicant_h)).json()
    assert applicant_thread in {row["id"] for row in applicant_summary["sent_applications"]}, (
        "applicant notification thread missing from the talent-side inbox records"
    )

    # Hiring-request context: talent recipient finds the thread among received
    # interests; the recruiter finds it among sent interests.
    creator = await _register_verified_login(client, email="coh_creator@example.com", username="coh_creator")
    recruiter = await _register_verified_login(client, email="coh_recruiter@example.com", username="coh_recruiter")
    creator_h = {"Authorization": f"Bearer {creator}"}
    recruiter_h = {"Authorization": f"Bearer {recruiter}"}
    listing = await client.post(
        "/api/v1/talent-listings",
        headers=creator_h,
        json={"title": "Editor open for work", "roles": ["Video editor"], "status": "published"},
    )
    interest = await client.post(
        f"/api/v1/talent-listings/{listing.json()['id']}/interest",
        headers=recruiter_h,
        json={"note": "Interested in working together."},
    )
    interest_id = interest.json()["id"]
    interest_conversation = (
        await client.get(f"/api/v1/me/talent-interests/{interest_id}/conversation", headers=recruiter_h)
    ).json()["conversation"]["id"]
    await client.post(
        f"/api/v1/me/conversations/{interest_conversation}/messages",
        headers=recruiter_h,
        json={"body": "Would love to discuss a retainer."},
    )
    creator_notification = next(
        item
        for item in (await client.get("/api/v1/notifications", headers=creator_h)).json()["items"]
        if item["type"] == "message_received"
    )
    assert "mode=talent" in creator_notification["action_url"]
    creator_thread = creator_notification["action_url"].rsplit("thread=", 1)[-1]
    creator_summary = (await client.get("/api/v1/me/activity/summary", headers=creator_h)).json()
    assert creator_thread in {row["id"] for row in creator_summary["received_interests"]}, (
        "creator notification thread missing from the talent-side interest records"
    )


async def test_composer_intent_is_recorded_and_freeform_stays_inert(client: AsyncClient) -> None:
    """An intent records that the sender asked for something; freeform does not."""
    owner = await _register_verified_login(client, email="mi_owner@example.com", username="mi_owner")
    applicant = await _register_verified_login(client, email="mi_appl@example.com", username="mi_appl")
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    owner_h = {"Authorization": f"Bearer {owner}"}
    applicant_h = {"Authorization": f"Bearer {applicant}"}
    conversation_id = (
        await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=owner_h)
    ).json()["conversation"]["id"]

    # A plain message carries no expectation at all.
    plain = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=owner_h,
        json={"body": "Just a note, nothing needed."},
    )
    assert plain.status_code == 201, plain.text
    assert plain.json()["intent"] is None
    assert plain.json()["response_expected"] is False

    # An explicit ask does, and the other participant can see it.
    asked = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=owner_h,
        json={"body": "Could you share a sample?", "intent": "request_portfolio"},
    )
    assert asked.status_code == 201, asked.text
    assert asked.json()["intent"] == "request_portfolio"
    assert asked.json()["response_expected"] is True

    counterparty = await client.get(
        f"/api/v1/me/conversations/{conversation_id}", headers=applicant_h
    )
    messages = counterparty.json()["messages"]
    assert [m.get("response_expected") for m in messages] == [False, True]

    # An intent must never move the relationship on its own.
    received = await client.get("/api/v1/me/applications/received", headers=owner_h)
    assert received.json()[0]["status"] == "new"
    assert received.json()[0]["participant_status"] == "new"


async def test_unknown_or_consequential_intents_are_rejected(client: AsyncClient) -> None:
    """Outcomes are never reachable through a message body."""
    owner = await _register_verified_login(client, email="mi2_owner@example.com", username="mi2_owner")
    applicant = await _register_verified_login(client, email="mi2_appl@example.com", username="mi2_appl")
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    owner_h = {"Authorization": f"Bearer {owner}"}
    conversation_id = (
        await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=owner_h)
    ).json()["conversation"]["id"]

    for forbidden in ("hire", "decline", "not_proceeding", "totally_made_up"):
        response = await client.post(
            f"/api/v1/me/conversations/{conversation_id}/messages",
            headers=owner_h,
            json={"body": "Attempting a shortcut.", "intent": forbidden},
        )
        assert response.status_code == 422, f"{forbidden} must not be sendable"
