from __future__ import annotations

from httpx import AsyncClient


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
    resp = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"title": "Editor for finance channel", "category": "Editing", "status": "published", "platforms": ["youtube"]},
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
    assert f"thread={application_id}" in (message_notifs[0]["action_url"] or "")

    # Owner reads → unread clears.
    await client.post(f"/api/v1/me/conversations/{conversation_id}/read", headers=owner_h)
    after = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=owner_h)
    assert after.json()["conversation"]["unread_count"] == 0


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


async def test_status_update_kind_round_trips_and_rejects_arbitrary_kinds(client: AsyncClient) -> None:
    # A pipeline stage notification is a normal message with kind="status_update",
    # so both sides can render it apart from user-written text.
    owner = await _register_verified_login(client, email="k_owner@example.com", username="k_owner")
    applicant = await _register_verified_login(client, email="k_applicant@example.com", username="k_applicant")
    job_id = await _published_job(client, owner)
    application_id = await _apply(client, applicant, job_id)
    owner_h = {"Authorization": f"Bearer {owner}"}
    applicant_h = {"Authorization": f"Bearer {applicant}"}

    convo = await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=owner_h)
    conversation_id = convo.json()["conversation"]["id"]

    sent = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=owner_h,
        json={"body": "Shortlisted for “Editor for finance channel”.", "kind": "status_update"},
    )
    assert sent.status_code == 201
    assert sent.json()["kind"] == "status_update"

    # The other participant reads the same kind back.
    view = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=applicant_h)
    assert view.json()["messages"][-1]["kind"] == "status_update"

    # Plain text stays kind-less; arbitrary kinds are rejected.
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
        json={"body": "hello", "kind": "system"},
    )
    assert invalid.status_code == 422
