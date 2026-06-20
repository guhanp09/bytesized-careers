from __future__ import annotations

from httpx import AsyncClient

from app.notifications import EVENT_REGISTRY, get_event, missing_payload_fields
from app.notifications.email import real_delivery_enabled
from app.notifications.registry import CHANNEL_EMAIL, CHANNEL_IN_APP


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
    token = register.json()["verification_url"].rsplit("token=", 1)[-1]
    verify = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verify.status_code == 200
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return login.json()["access_token"]


async def _post_published_job(client: AsyncClient, owner_token: str, title: str) -> str:
    response = await client.post(
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
    assert response.status_code == 201
    return response.json()["id"]


async def _outbox_for(client: AsyncClient, to_email: str) -> list[dict]:
    response = await client.get("/api/v1/dev/emails/outbox")
    assert response.status_code == 200
    return [row for row in response.json()["items"] if row["to_email"] == to_email]


# ---- Registry (pure) ----

def test_event_registry_is_valid() -> None:
    assert EVENT_REGISTRY, "registry should not be empty"
    for key, event in EVENT_REGISTRY.items():
        assert event.key == key
        assert event.category in {"transactional", "lifecycle", "digest"}
        assert event.priority in {"high", "normal", "low"}
        # default channels must be a subset of allowed channels
        assert set(event.default_channels).issubset(set(event.channels))
        assert set(event.channels).issubset({CHANNEL_IN_APP, CHANNEL_EMAIL})

    # Core transactional events exist.
    for key in (
        "application_submitted",
        "new_applicant",
        "application_status_changed",
        "talent_interest_received",
        "job_posted_successfully",
    ):
        assert key in EVENT_REGISTRY

    # Messaging is declared but intentionally not wired (no backend yet).
    assert get_event("message_received") is not None
    assert get_event("message_received").wired is False


def test_missing_payload_fields() -> None:
    assert missing_payload_fields("new_applicant", {"job_title": "Editor"}) == []
    assert missing_payload_fields("new_applicant", {}) == ["job_title"]
    assert missing_payload_fields("application_status_changed", {"status": "shortlisted"}) == []
    assert missing_payload_fields("application_status_changed", {}) == ["status"]
    # Unknown events never block.
    assert missing_payload_fields("does_not_exist", {}) == []


# ---- Dispatch via real flows ----

async def test_apply_notifies_recruiter_in_app_and_queues_mock_email(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="n_owner@example.com", username="n_owner")
    applicant_token = await _register_verified_login(client, email="n_applicant@example.com", username="n_applicant")
    job_id = await _post_published_job(client, owner_token, "Retention editor for finance channel")

    apply = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "I can help.", "portfolio_item_ids": []},
    )
    assert apply.status_code == 201

    # Recruiter gets an in-app notification of type new_applicant.
    owner_notifs = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {owner_token}"})
    assert owner_notifs.status_code == 200
    assert owner_notifs.json()["unread_count"] >= 1
    assert any(item["type"] == "new_applicant" for item in owner_notifs.json()["items"])

    # new_applicant has email enabled -> a mocked outbox row for the recruiter, never sent.
    owner_outbox = await _outbox_for(client, "n_owner@example.com")
    new_applicant_rows = [row for row in owner_outbox if row["event_key"] == "new_applicant"]
    assert len(new_applicant_rows) == 1
    assert new_applicant_rows[0]["status"] == "mocked"  # queued + mocked, NOT "sent"

    # The applicant's own self-confirmation is in-app only (no email noise).
    applicant_notifs = await client.get(
        "/api/v1/notifications", headers={"Authorization": f"Bearer {applicant_token}"}
    )
    assert any(item["type"] == "application_submitted" for item in applicant_notifs.json()["items"])
    applicant_outbox = await _outbox_for(client, "n_applicant@example.com")
    assert [row for row in applicant_outbox if row["event_key"] == "application_submitted"] == []


async def test_status_change_notifies_applicant_with_mock_email(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="s_owner@example.com", username="s_owner")
    applicant_token = await _register_verified_login(client, email="s_applicant@example.com", username="s_applicant")
    job_id = await _post_published_job(client, owner_token, "Shorts editor for daily channel")

    apply = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "Available now."},
    )
    application_id = apply.json()["id"]

    status_update = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"status": "shortlisted"},
    )
    assert status_update.status_code == 200

    applicant_notifs = await client.get(
        "/api/v1/notifications", headers={"Authorization": f"Bearer {applicant_token}"}
    )
    assert any(item["type"] == "application_status_changed" for item in applicant_notifs.json()["items"])

    applicant_outbox = await _outbox_for(client, "s_applicant@example.com")
    status_rows = [row for row in applicant_outbox if row["event_key"] == "application_status_changed"]
    assert len(status_rows) == 1
    assert status_rows[0]["status"] == "mocked"


async def test_job_posted_notifies_poster(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="j_owner@example.com", username="j_owner")
    await _post_published_job(client, owner_token, "Thumbnail designer for tech channel")

    owner_notifs = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {owner_token}"})
    assert any(item["type"] == "job_posted_successfully" for item in owner_notifs.json()["items"])
    owner_outbox = await _outbox_for(client, "j_owner@example.com")
    assert any(row["event_key"] == "job_posted_successfully" for row in owner_outbox)


async def test_mark_all_read_clears_unread(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="r_owner@example.com", username="r_owner")
    applicant_token = await _register_verified_login(client, email="r_applicant@example.com", username="r_applicant")
    job_id = await _post_published_job(client, owner_token, "Channel manager (part-time)")
    await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "Hi"},
    )

    before = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {owner_token}"})
    assert before.json()["unread_count"] >= 1

    mark_all = await client.post(
        "/api/v1/notifications/mark-all-read", headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert mark_all.status_code == 200

    after = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {owner_token}"})
    assert after.json()["unread_count"] == 0


async def test_email_delivery_disabled_never_sends_real_email(client: AsyncClient, monkeypatch) -> None:
    # The master switch is off in tests, so the real SMTP path must never run.
    assert real_delivery_enabled() is False

    sent: list[dict] = []

    def _spy_send(**kwargs):
        sent.append(kwargs)
        raise AssertionError("real email must not be sent while EMAIL_DELIVERY_ENABLED is false")

    monkeypatch.setattr("app.notifications.email.send_auth_email", _spy_send)

    owner_token = await _register_verified_login(client, email="nosend_owner@example.com", username="nosend_owner")
    await _post_published_job(client, owner_token, "Editor for travel channel")

    # job_posted_successfully has email enabled, but delivery is mocked, not sent.
    assert sent == []
    outbox = await _outbox_for(client, "nosend_owner@example.com")
    job_rows = [row for row in outbox if row["event_key"] == "job_posted_successfully"]
    assert job_rows and all(row["status"] == "mocked" for row in job_rows)

    # The gate flips on only when BOTH the flag is on and EMAIL_MODE is smtp.
    monkeypatch.setattr("app.notifications.email.settings.email_delivery_enabled", True)
    monkeypatch.setattr("app.notifications.email.settings.email_mode", "smtp")
    assert real_delivery_enabled() is True


async def test_notification_failure_does_not_break_action(client: AsyncClient, monkeypatch) -> None:
    # Simulate the email/outbox layer failing. The user's action must still succeed,
    # and the in-app notification must still be delivered (email is decoupled).
    def _boom(*args, **kwargs):
        raise RuntimeError("simulated outbox failure")

    monkeypatch.setattr("app.notifications.service.queue_notification_email", _boom)

    owner_token = await _register_verified_login(client, email="fail_owner@example.com", username="fail_owner")
    applicant_token = await _register_verified_login(client, email="fail_applicant@example.com", username="fail_applicant")
    job_id = await _post_published_job(client, owner_token, "Editor for gaming channel")

    apply = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "Ready to start."},
    )
    # The application still succeeds despite the notification email blowing up.
    assert apply.status_code == 201

    # The recruiter still receives the in-app notification.
    owner_notifs = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {owner_token}"})
    assert any(item["type"] == "new_applicant" for item in owner_notifs.json()["items"])

    # The email was never queued (it failed), confirming the two channels are isolated.
    owner_outbox = await _outbox_for(client, "fail_owner@example.com")
    assert [row for row in owner_outbox if row["event_key"] == "new_applicant"] == []


async def test_mark_one_read_decrements_unread(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="m1_owner@example.com", username="m1_owner")
    applicant_token = await _register_verified_login(client, email="m1_applicant@example.com", username="m1_applicant")
    job_id = await _post_published_job(client, owner_token, "Editor for cooking channel")
    await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "Hi"},
    )

    before = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {owner_token}"})
    before_unread = before.json()["unread_count"]
    assert before_unread >= 1
    target = next(item for item in before.json()["items"] if item["read_at"] is None)

    mark = await client.patch(
        f"/api/v1/notifications/{target['id']}/read",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert mark.status_code == 200
    assert mark.json()["read_at"] is not None

    after = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {owner_token}"})
    assert after.json()["unread_count"] == before_unread - 1
