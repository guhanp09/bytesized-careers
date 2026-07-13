from __future__ import annotations

import logging
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Conversation,
    EmailOutbox,
    Engagement,
    InteractionStatusEvent,
    InteractionTransitionRequest,
    JobApplication,
    Message,
    Notification,
    TalentInterest,
)
from app.notifications import email as notification_email
from app.services.email_service import EmailDeliveryError


async def _login(client: AsyncClient, stem: str) -> str:
    stem = f"u_{uuid.uuid4().hex[:12]}"
    email = f"{stem}@example.com"
    password = "Password123!"
    register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "username": stem,
            "display_name": stem.replace("_", " ").title(),
        },
    )
    assert register.status_code in {200, 201}, register.text
    token = register.json()["verification_url"].rsplit("token=", 1)[-1]
    assert (await client.post("/api/v1/auth/verify-email", json={"token": token})).status_code == 200
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return login.json()["access_token"]


async def _application(client: AsyncClient) -> tuple[str, str, str]:
    owner = await _login(client, f"transition_owner_{uuid.uuid4().hex[:6]}")
    talent = await _login(client, f"transition_talent_{uuid.uuid4().hex[:6]}")
    job = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "title": "Finance editor transition fixture",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
    )
    application = await client.post(
        f"/api/v1/jobs/{job.json()['id']}/applications",
        headers={"Authorization": f"Bearer {talent}"},
        json={"cover_note": "I can help."},
    )
    assert application.status_code == 201
    return owner, talent, application.json()["id"]


async def _interest(client: AsyncClient) -> tuple[str, str, str]:
    talent = await _login(client, f"interest_talent_{uuid.uuid4().hex[:6]}")
    recruiter = await _login(client, f"interest_recruiter_{uuid.uuid4().hex[:6]}")
    listing = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {talent}"},
        json={
            "title": "Editor available for creator teams",
            "primary_role": "Video editor",
            "roles": ["Video editor"],
            "work_mode": "remote",
            "status": "published",
        },
    )
    interest = await client.post(
        f"/api/v1/talent-listings/{listing.json()['id']}/interest",
        headers={"Authorization": f"Bearer {recruiter}"},
        json={"note": "We would like to work together."},
    )
    assert interest.status_code == 201
    return talent, recruiter, interest.json()["id"]


async def _count(session: AsyncSession, model, *criteria) -> int:
    return int(
        (
            await session.execute(
                select(func.count()).select_from(model).where(*criteria)
            )
        ).scalar_one()
    )


async def test_hired_is_atomic_visible_and_idempotent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, talent, application_id = await _application(client)
    key = str(uuid.uuid4())
    payload = {"status": "hired", "expected_version": 1, "idempotency_key": key}

    hired = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json=payload,
    )
    assert hired.status_code == 200, hired.text
    assert hired.json()["outcome"] == "transitioned"
    assert hired.json()["current_status"] == "hired"
    assert hired.json()["status_version"] == 2
    assert hired.json()["application"]["participant_status"] == "hired"
    assert hired.json()["application"]["engagement"] is not None

    sender = await client.get(
        "/api/v1/me/applications/sent",
        headers={"Authorization": f"Bearer {talent}"},
    )
    assert sender.json()[0]["status"] == "hired"

    repeated = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json=payload,
    )
    assert repeated.status_code == 200
    assert repeated.json()["outcome"] == "already_in_state"

    second_key = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={"status": "hired", "expected_version": 2, "idempotency_key": str(uuid.uuid4())},
    )
    assert second_key.status_code == 200
    assert second_key.json()["outcome"] == "already_in_state"

    assert await _count(
        db_session, Engagement, Engagement.application_id == uuid.UUID(application_id)
    ) == 1
    assert await _count(
        db_session,
        InteractionStatusEvent,
        InteractionStatusEvent.interaction_id == uuid.UUID(application_id),
        InteractionStatusEvent.event_kind == "transition",
    ) == 1
    assert await _count(
        db_session,
        InteractionTransitionRequest,
        InteractionTransitionRequest.interaction_id == uuid.UUID(application_id),
    ) == 2
    assert await _count(
        db_session,
        Notification,
        Notification.resource_id == application_id,
        Notification.type == "application_status_changed",
    ) == 1
    assert await _count(
        db_session,
        EmailOutbox,
        EmailOutbox.event_key == "application_status_changed",
        EmailOutbox.metadata_json["status"].as_string() == "hired",
        EmailOutbox.dedupe_key.like(f"application:{application_id}:%"),
    ) == 1
    conversation_id = (
        await db_session.execute(
            select(Conversation.id).where(
                Conversation.application_id == uuid.UUID(application_id)
            )
        )
    ).scalar_one()
    assert await _count(
        db_session,
        Message,
        Message.conversation_id == conversation_id,
        Message.metadata_json["stage"].as_string() == "hired",
    ) == 1

    conflict = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={"status": "rejected", "expected_version": 2, "idempotency_key": key},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"


async def test_accepted_is_canonical_atomic_and_idempotent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    talent, recruiter, interest_id = await _interest(client)
    key = str(uuid.uuid4())
    payload = {"status": "accepted", "expected_version": 1, "idempotency_key": key}
    accepted = await client.post(
        f"/api/v1/talent-interests/{interest_id}/transition",
        headers={"Authorization": f"Bearer {talent}"},
        json=payload,
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["current_status"] == "accepted"
    assert accepted.json()["interest"]["participant_status"] == "accepted"
    assert accepted.json()["interest"]["engagement"] is not None

    repeated = await client.post(
        f"/api/v1/talent-interests/{interest_id}/transition",
        headers={"Authorization": f"Bearer {talent}"},
        json=payload,
    )
    assert repeated.status_code == 200
    assert repeated.json()["outcome"] == "already_in_state"

    sender = await client.get(
        "/api/v1/me/talent-interests/sent",
        headers={"Authorization": f"Bearer {recruiter}"},
    )
    assert sender.json()[0]["status"] == "accepted"
    assert await _count(
        db_session, Engagement, Engagement.talent_interest_id == uuid.UUID(interest_id)
    ) == 1
    assert await _count(
        db_session,
        Notification,
        Notification.resource_id == interest_id,
        Notification.type == "talent_interest_status_changed",
    ) == 1


async def test_legacy_contacted_input_is_normalized_to_accepted(client: AsyncClient) -> None:
    talent, _, interest_id = await _interest(client)
    response = await client.post(
        f"/api/v1/talent-interests/{interest_id}/transition",
        headers={"Authorization": f"Bearer {talent}"},
        json={
            "status": "contacted",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["current_status"] == "accepted"
    assert response.json()["interest"]["status"] == "accepted"
    assert response.json()["interest"]["participant_status"] == "accepted"


async def test_idempotency_key_is_bound_to_actor_record_and_version(client: AsyncClient) -> None:
    owner, _, first_application_id = await _application(client)
    second_owner, _, second_application_id = await _application(client)
    key = str(uuid.uuid4())
    original = await client.post(
        f"/api/v1/applications/{first_application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={"status": "hired", "expected_version": 1, "idempotency_key": key},
    )
    assert original.status_code == 200

    different_record = await client.post(
        f"/api/v1/applications/{second_application_id}/transition",
        headers={"Authorization": f"Bearer {second_owner}"},
        json={"status": "hired", "expected_version": 1, "idempotency_key": key},
    )
    assert different_record.status_code == 409
    assert different_record.json()["error"]["code"] == "idempotency_conflict"

    different_actor = await client.post(
        f"/api/v1/applications/{first_application_id}/transition",
        headers={"Authorization": f"Bearer {second_owner}"},
        json={"status": "hired", "expected_version": 1, "idempotency_key": key},
    )
    assert different_actor.status_code == 409
    assert different_actor.json()["error"]["code"] == "idempotency_conflict"

    different_version = await client.post(
        f"/api/v1/applications/{first_application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={"status": "hired", "expected_version": 2, "idempotency_key": key},
    )
    assert different_version.status_code == 409
    assert different_version.json()["error"]["code"] == "idempotency_conflict"


async def test_stale_and_unauthorized_transitions_are_explicit(client: AsyncClient) -> None:
    owner, talent, application_id = await _application(client)
    outsider = await _login(client, f"transition_outsider_{uuid.uuid4().hex[:6]}")
    request = {
        "status": "reviewing",
        "expected_version": 1,
        "idempotency_key": str(uuid.uuid4()),
    }
    forbidden = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {outsider}"},
        json=request,
    )
    assert forbidden.status_code == 403

    moved = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json=request,
    )
    assert moved.status_code == 200
    stale = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "shortlisted",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["details"] == {
        "code": "stale_status",
        "message": "Changed elsewhere — latest status loaded.",
        "current_status": "reviewing",
        "current_version": 2,
    }


async def test_consequential_outcomes_are_rejected_from_bulk(client: AsyncClient) -> None:
    owner, talent, application_id = await _application(client)
    hired = await client.post(
        "/api/v1/applications/bulk-status",
        headers={"Authorization": f"Bearer {owner}"},
        json={"ids": [application_id], "status": "hired"},
    )
    assert hired.status_code == 422

    talent, _, interest_id = await _interest(client)
    accepted = await client.post(
        "/api/v1/talent-interests/bulk-status",
        headers={"Authorization": f"Bearer {talent}"},
        json={"ids": [interest_id], "status": "accepted"},
    )
    assert accepted.status_code == 422


async def test_shared_side_effect_failure_rolls_back_everything(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    owner, _, application_id = await _application(client)

    async def _fail_notification(*args, **kwargs):
        raise RuntimeError("synthetic outbox failure")

    monkeypatch.setattr(
        "app.services.interaction_transition_service.dispatch_notification",
        _fail_notification,
    )
    with pytest.raises(RuntimeError, match="synthetic outbox failure"):
        await client.post(
            f"/api/v1/applications/{application_id}/transition",
            headers={"Authorization": f"Bearer {owner}"},
            json={
                "status": "hired",
                "expected_version": 1,
                "idempotency_key": str(uuid.uuid4()),
            },
        )
    db_session.expire_all()
    application = await db_session.get(JobApplication, uuid.UUID(application_id))
    assert application is not None
    assert application.status == "new"
    assert application.participant_status == "new"
    assert application.status_version == 1
    assert await _count(
        db_session, Engagement, Engagement.application_id == uuid.UUID(application_id)
    ) == 0
    assert await _count(
        db_session,
        InteractionStatusEvent,
        InteractionStatusEvent.interaction_id == uuid.UUID(application_id),
    ) == 0


async def test_private_rejection_can_be_shared_later_once(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, talent, application_id = await _application(client)
    moved = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "rejected",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert moved.status_code == 200
    assert moved.json()["application"]["participant_status"] == "new"
    manager_view = await client.get(
        "/api/v1/me/applications/received",
        headers={"Authorization": f"Bearer {owner}"},
    )
    assert [event["new_status"] for event in manager_view.json()[0]["status_history"]] == [
        "rejected"
    ]

    # The private rejection must not leak through the applicant-facing read.
    sender_before_share = await client.get(
        "/api/v1/me/applications/sent",
        headers={"Authorization": f"Bearer {talent}"},
    )
    assert sender_before_share.json()[0]["status_history"] == []

    key = str(uuid.uuid4())
    shared = await client.post(
        f"/api/v1/applications/{application_id}/status-communication",
        headers={"Authorization": f"Bearer {owner}"},
        json={"status": "rejected", "expected_version": 2, "idempotency_key": key},
    )
    assert shared.status_code == 200, shared.text
    assert shared.json()["application"]["participant_status"] == "rejected"
    assert shared.json()["status_version"] == 3
    repeated = await client.post(
        f"/api/v1/applications/{application_id}/status-communication",
        headers={"Authorization": f"Bearer {owner}"},
        json={"status": "rejected", "expected_version": 2, "idempotency_key": key},
    )
    assert repeated.status_code == 200
    assert repeated.json()["outcome"] == "already_in_state"
    sender_after_share = await client.get(
        "/api/v1/me/applications/sent",
        headers={"Authorization": f"Bearer {talent}"},
    )
    assert [event["event_kind"] for event in sender_after_share.json()[0]["status_history"]] == [
        "communicated"
    ]
    assert await _count(
        db_session,
        Notification,
        Notification.resource_id == application_id,
        Notification.type == "application_status_changed",
    ) == 1


async def test_status_communication_rejects_a_mismatched_requested_status(
    client: AsyncClient,
) -> None:
    owner, _, application_id = await _application(client)
    moved = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "shortlisted",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert moved.status_code == 200
    response = await client.post(
        f"/api/v1/applications/{application_id}/status-communication",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "rejected",
            "expected_version": 2,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "stale_status"


async def test_shared_rejection_cannot_be_overwritten_by_a_lower_private_stage(
    client: AsyncClient,
) -> None:
    owner, _, application_id = await _application(client)
    moved = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "rejected",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert moved.status_code == 200
    shared = await client.post(
        f"/api/v1/applications/{application_id}/status-communication",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "rejected",
            "expected_version": 2,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert shared.status_code == 200
    reopen = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "reviewing",
            "expected_version": 3,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert reopen.status_code == 409
    assert "shared lifecycle outcome" in reopen.json()["error"]["message"]


async def test_transition_log_is_structured_and_excludes_sensitive_content(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _, application_id = await _application(client)
    caplog.set_level(logging.INFO, logger="app.services.interaction_transition_service")
    response = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "hired",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 200
    record = next(
        entry for entry in caplog.records if entry.getMessage() == "interaction_transition_committed"
    )
    structured = record.transition
    assert structured["interaction_id"] == application_id
    assert structured["new_status"] == "hired"
    assert structured["status_version"] == 2
    assert structured["engagement_outcome"] == "created"
    assert structured["notification_outcome"] == "created"
    assert structured["trusted_message_outcome"] == "created"
    assert not {"message", "private_note", "access_token", "password"}.intersection(structured)


async def test_external_delivery_failure_after_commit_does_not_rollback_hire(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    owner, _, application_id = await _application(client)
    response = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "hired",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 200
    outbox = (
        await db_session.execute(
            select(EmailOutbox).where(
                EmailOutbox.event_key == "application_status_changed",
                EmailOutbox.metadata_json["status"].as_string() == "hired",
                EmailOutbox.dedupe_key.like(f"application:{application_id}:%"),
            )
        )
    ).scalar_one()

    monkeypatch.setattr(notification_email, "real_delivery_enabled", lambda: True)

    def _fail_delivery(**kwargs):
        raise EmailDeliveryError("synthetic provider outage")

    monkeypatch.setattr(notification_email, "send_auth_email", _fail_delivery)
    notification_email._process_outbox_row(outbox)
    await db_session.commit()

    application = await db_session.get(JobApplication, uuid.UUID(application_id))
    assert application is not None
    assert (application.status, application.participant_status) == ("hired", "hired")
    assert outbox.status == "failed"


async def test_realtime_failure_after_commit_still_returns_authoritative_success(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    owner, _, application_id = await _application(client)

    async def _fail_realtime(*args, **kwargs):
        raise RuntimeError("synthetic websocket outage")

    monkeypatch.setattr(
        "app.api.v1.routers.marketplace.realtime_events.emit_message_created",
        _fail_realtime,
    )
    response = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "hired",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 200
    assert response.json()["current_status"] == "hired"
    application = await db_session.get(JobApplication, uuid.UUID(application_id))
    assert application is not None
    assert (application.status, application.participant_status) == ("hired", "hired")


async def test_archive_is_per_viewer_and_does_not_change_lifecycle(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, talent, application_id = await _application(client)
    archived = await client.post(
        f"/api/v1/applications/{application_id}/archive",
        headers={"Authorization": f"Bearer {owner}"},
        json={"archived": True},
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived_at"] is not None
    assert archived.json()["status"] == "new"
    assert archived.json()["status_version"] == 1

    sent = await client.get(
        "/api/v1/me/applications/sent",
        headers={"Authorization": f"Bearer {talent}"},
    )
    assert sent.status_code == 200
    assert sent.json()[0]["archived_at"] is None

    detail = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation",
        headers={"Authorization": f"Bearer {owner}"},
    )
    conversation_id = detail.json()["conversation"]["id"]
    sent_message = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers={"Authorization": f"Bearer {owner}"},
        json={"body": "Archive should not close this conversation."},
    )
    assert sent_message.status_code == 201, sent_message.text

    restored = await client.post(
        f"/api/v1/applications/{application_id}/archive",
        headers={"Authorization": f"Bearer {owner}"},
        json={"archived": False},
    )
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None

    application = await db_session.get(JobApplication, uuid.UUID(application_id))
    assert application is not None
    assert (application.status, application.participant_status, application.status_version) == (
        "new",
        "new",
        1,
    )
    conversation = (
        await db_session.execute(
            select(Conversation).where(Conversation.application_id == uuid.UUID(application_id))
        )
    ).scalar_one()
    assert conversation.participant_a_archived_at is None
    assert conversation.participant_b_archived_at is None


async def test_unknown_legacy_archive_requires_deliberate_resolution(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _, application_id = await _application(client)
    application = await db_session.get(JobApplication, uuid.UUID(application_id))
    assert application is not None
    application.status = "archived"
    application.legacy_archive_resolution_required = True
    await db_session.commit()

    response = await client.post(
        f"/api/v1/applications/{application_id}/archive",
        headers={"Authorization": f"Bearer {owner}"},
        json={"archived": False},
    )
    assert response.status_code == 409
    assert "no reliable previous stage" in response.json()["error"]["message"]
