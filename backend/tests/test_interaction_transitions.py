from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

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
from conftest import create_valid_published_job


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
    job = await create_valid_published_job(
        client,
        owner,
        title="Finance editor transition fixture",
    )
    assert job.status_code == 201, job.text
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
            "status": "rejected",
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
    owner, talent, application_id = await _application(client)

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
    # The record sits in "reviewing"; communicating "rejected" therefore does not
    # describe its actual state and must be refused.
    moved = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "reviewing",
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
    owner, talent, application_id = await _application(client)
    application = await db_session.get(JobApplication, uuid.UUID(application_id))
    assert application is not None
    application.status = "archived"
    application.legacy_archive_resolution_required = True
    conversation = (
        await db_session.execute(
            select(Conversation).where(Conversation.application_id == application.id)
        )
    ).scalar_one()
    conversation.participant_b_archived_at = datetime.now(UTC)
    await db_session.commit()

    response = await client.post(
        f"/api/v1/applications/{application_id}/archive",
        headers={"Authorization": f"Bearer {owner}"},
        json={"archived": False},
    )
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "legacy_archive_resolution_required"
    assert error["message"] == "Choose the current pipeline stage to restore this record."
    assert set(error["details"]["allowed_statuses"]) == {
        "new", "reviewing", "shortlisted", "interviewing", "hired", "rejected"
    }

    sender = await client.get(
        "/api/v1/me/applications/sent",
        headers={"Authorization": f"Bearer {talent}"},
    )
    assert sender.status_code == 200
    assert sender.json()[0]["legacy_archive_resolution_required"] is False
    assert (
        await client.post(
            f"/api/v1/applications/{application_id}/archive",
            headers={"Authorization": f"Bearer {talent}"},
            json={"archived": True},
        )
    ).status_code == 200
    sender_unarchive = await client.post(
        f"/api/v1/applications/{application_id}/archive",
        headers={"Authorization": f"Bearer {talent}"},
        json={"archived": False},
    )
    assert sender_unarchive.status_code == 200

    resolved = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "reviewing",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["outcome"] == "transitioned"
    assert body["current_status"] == "reviewing"
    assert body["status_version"] == 2
    assert body["application"]["legacy_archive_resolution_required"] is False
    assert body["application"]["archived_at"] is None
    assert body["application"]["participant_status"] == "new"

    await db_session.refresh(application)
    await db_session.refresh(conversation)
    assert application.legacy_archive_resolution_required is False
    assert conversation.participant_b_archived_at is None
    event = (
        await db_session.execute(
            select(InteractionStatusEvent).where(
                InteractionStatusEvent.interaction_id == application.id,
                InteractionStatusEvent.event_kind == "legacy_archive_resolved",
            )
        )
    ).scalar_one()
    assert event.previous_status == "archived"
    assert event.new_status == "reviewing"
    assert event.metadata_json["legacy_previous_stage_unknown"] is True


async def test_stale_legacy_flag_can_be_cleared_by_same_status_selection(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _, application_id = await _application(client)
    application = await db_session.get(JobApplication, uuid.UUID(application_id))
    assert application is not None
    application.status = "reviewing"
    application.status_version = 4
    application.legacy_archive_resolution_required = True
    await db_session.commit()

    resolved = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "reviewing",
            "expected_version": 4,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["outcome"] == "transitioned"
    assert resolved.json()["status_version"] == 5
    assert resolved.json()["application"]["legacy_archive_resolution_required"] is False
    assert await _count(
        db_session,
        InteractionStatusEvent,
        InteractionStatusEvent.interaction_id == application.id,
        InteractionStatusEvent.event_kind == "legacy_archive_resolved",
    ) == 1


async def test_legacy_hiring_request_can_resolve_to_accepted_atomically(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    talent, recruiter, interest_id = await _interest(client)
    interest = await db_session.get(TalentInterest, uuid.UUID(interest_id))
    assert interest is not None
    interest.status = "archived"
    interest.legacy_archive_resolution_required = True
    conversation = (
        await db_session.execute(
            select(Conversation).where(Conversation.talent_interest_id == interest.id)
        )
    ).scalar_one()
    conversation.participant_b_archived_at = datetime.now(UTC)
    await db_session.commit()

    resolved = await client.post(
        f"/api/v1/talent-interests/{interest_id}/transition",
        headers={"Authorization": f"Bearer {talent}"},
        json={
            "status": "accepted",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["current_status"] == "accepted"
    assert body["interest"]["participant_status"] == "accepted"
    assert body["interest"]["legacy_archive_resolution_required"] is False
    assert body["interest"]["archived_at"] is None
    assert body["interest"]["engagement"] is not None

    sender = await client.get(
        "/api/v1/me/talent-interests/sent",
        headers={"Authorization": f"Bearer {recruiter}"},
    )
    assert sender.status_code == 200
    assert sender.json()[0]["legacy_archive_resolution_required"] is False
    assert sender.json()[0]["status"] == "accepted"

    assert await _count(
        db_session, Engagement, Engagement.talent_interest_id == interest.id
    ) == 1
    assert await _count(
        db_session,
        InteractionStatusEvent,
        InteractionStatusEvent.interaction_id == interest.id,
        InteractionStatusEvent.event_kind == "legacy_archive_resolved",
    ) == 1
    assert await _count(
        db_session,
        Notification,
        Notification.resource_id == interest_id,
        Notification.type == "talent_interest_status_changed",
    ) == 1
    assert await _count(
        db_session,
        Message,
        Message.conversation_id == conversation.id,
        Message.metadata_json["stage"].as_string() == "accepted",
    ) == 1


async def _interest_conversation_id(db_session: AsyncSession, interest_id: str) -> uuid.UUID:
    return (
        await db_session.execute(
            select(Conversation.id).where(
                Conversation.talent_interest_id == uuid.UUID(interest_id)
            )
        )
    ).scalar_one()


async def _application_conversation_id(db_session: AsyncSession, application_id: str) -> uuid.UUID:
    return (
        await db_session.execute(
            select(Conversation.id).where(
                Conversation.application_id == uuid.UUID(application_id)
            )
        )
    ).scalar_one()


async def _note_bodies(db_session: AsyncSession, conversation_id: uuid.UUID) -> list[str]:
    return list(
        (
            await db_session.execute(
                select(Message.body).where(
                    Message.conversation_id == conversation_id,
                    Message.metadata_json["status_note"].as_boolean().is_(True),
                )
            )
        )
        .scalars()
        .all()
    )


async def test_declining_a_hiring_request_delivers_the_note_atomically(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A decline shares immediately, so the explanation must land with it."""
    talent, recruiter, interest_id = await _interest(client)
    key = str(uuid.uuid4())
    payload = {
        "status": "declined",
        "expected_version": 1,
        "idempotency_key": key,
        "note": "Booked through November — happy to revisit in Q1.",
    }
    declined = await client.post(
        f"/api/v1/talent-interests/{interest_id}/transition",
        headers={"Authorization": f"Bearer {talent}"},
        json=payload,
    )
    assert declined.status_code == 200, declined.text
    assert declined.json()["current_status"] == "declined"
    assert declined.json()["interest"]["participant_status"] == "declined"

    conversation_id = await _interest_conversation_id(db_session, interest_id)
    # The decision and the explanation are two distinct messages: the platform's
    # trusted wording stays canonical, the note stays the sender's own words.
    assert await _count(
        db_session,
        Message,
        Message.conversation_id == conversation_id,
        Message.metadata_json["stage"].as_string() == "declined",
    ) == 2
    assert await _note_bodies(db_session, conversation_id) == [
        "Booked through November — happy to revisit in Q1."
    ]
    assert await _count(
        db_session,
        Notification,
        Notification.resource_id == interest_id,
        Notification.type == "talent_interest_status_changed",
    ) == 1

    # The recruiter is the counterparty here and must actually receive it.
    recruiter_view = await client.get(
        f"/api/v1/me/conversations/{conversation_id}",
        headers={"Authorization": f"Bearer {recruiter}"},
    )
    assert recruiter_view.status_code == 200, recruiter_view.text
    bodies = [item["body"] for item in recruiter_view.json()["messages"]]
    assert "Booked through November — happy to revisit in Q1." in bodies

    # Replaying the identical request must not duplicate the note.
    repeated = await client.post(
        f"/api/v1/talent-interests/{interest_id}/transition",
        headers={"Authorization": f"Bearer {talent}"},
        json=payload,
    )
    assert repeated.status_code == 200
    assert await _note_bodies(db_session, conversation_id) == [
        "Booked through November — happy to revisit in Q1."
    ]
    assert await _count(
        db_session,
        Notification,
        Notification.resource_id == interest_id,
        Notification.type == "talent_interest_status_changed",
    ) == 1


async def test_private_rejection_stores_no_note_and_shares_it_only_when_told(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A private stage tells nobody, so it must carry no note to anyone."""
    owner, talent, application_id = await _application(client)
    rejected = await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers={"Authorization": f"Bearer {owner}"},
        json={
            "status": "rejected",
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
            "note": "This note must never be delivered by a private stage.",
        },
    )
    assert rejected.status_code == 200, rejected.text

    conversation_id = await _application_conversation_id(db_session, application_id)
    assert await _note_bodies(db_session, conversation_id) == []
    # Private "not proceeding" is not shared, so the applicant still sees the
    # earlier state and messaging stays open.
    applicant_view = await client.get(
        "/api/v1/me/applications/sent",
        headers={"Authorization": f"Bearer {talent}"},
    )
    assert applicant_view.json()[0]["status"] != "rejected"
    still_open = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers={"Authorization": f"Bearer {talent}"},
        json={"body": "Any update?", "client_message_id": str(uuid.uuid4())},
    )
    assert still_open.status_code == 201, still_open.text

    # Now the recruiter chooses to tell them, and attaches the explanation.
    share_key = str(uuid.uuid4())
    share_payload = {
        "status": "rejected",
        "expected_version": 2,
        "idempotency_key": share_key,
        "note": "We went with someone stronger on motion graphics.",
    }
    shared = await client.post(
        f"/api/v1/applications/{application_id}/status-communication",
        headers={"Authorization": f"Bearer {owner}"},
        json=share_payload,
    )
    assert shared.status_code == 200, shared.text

    assert await _note_bodies(db_session, conversation_id) == [
        "We went with someone stronger on motion graphics."
    ]
    applicant_after = await client.get(
        "/api/v1/me/applications/sent",
        headers={"Authorization": f"Bearer {talent}"},
    )
    assert applicant_after.json()[0]["status"] == "rejected"

    # Repeating the share must not produce a second note, event or notification.
    repeated = await client.post(
        f"/api/v1/applications/{application_id}/status-communication",
        headers={"Authorization": f"Bearer {owner}"},
        json=share_payload,
    )
    assert repeated.status_code == 200
    assert await _note_bodies(db_session, conversation_id) == [
        "We went with someone stronger on motion graphics."
    ]
    assert await _count(
        db_session,
        Notification,
        Notification.resource_id == application_id,
        Notification.type == "application_status_changed",
    ) == 1


async def test_note_is_rolled_back_when_a_required_side_effect_fails(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    """Nothing may be partially sent: no note without the decision, or vice versa."""
    talent, _, interest_id = await _interest(client)
    conversation_id = await _interest_conversation_id(db_session, interest_id)

    async def _fail_notification(*args, **kwargs):
        raise RuntimeError("synthetic outbox failure")

    monkeypatch.setattr(
        "app.services.interaction_transition_service.dispatch_notification",
        _fail_notification,
    )
    with pytest.raises(RuntimeError, match="synthetic outbox failure"):
        await client.post(
            f"/api/v1/talent-interests/{interest_id}/transition",
            headers={"Authorization": f"Bearer {talent}"},
            json={
                "status": "declined",
                "expected_version": 1,
                "idempotency_key": str(uuid.uuid4()),
                "note": "This must not survive the rollback.",
            },
        )

    db_session.expire_all()
    interest = await db_session.get(TalentInterest, uuid.UUID(interest_id))
    assert interest is not None
    assert interest.status != "declined"
    assert interest.participant_status != "declined"
    # The decision rolled back, so the explanation for it must be gone too.
    assert await _note_bodies(db_session, conversation_id) == []
    assert await _count(
        db_session,
        InteractionStatusEvent,
        InteractionStatusEvent.interaction_id == uuid.UUID(interest_id),
    ) == 0


async def test_deliberate_open_privately_starts_review(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Reading is reviewing — privately, and only for the manager."""
    owner, talent, application_id = await _application(client)
    owner_h = {"Authorization": f"Bearer {owner}"}
    talent_h = {"Authorization": f"Bearer {talent}"}

    conversation_id_before = await _application_conversation_id(db_session, application_id)
    messages_before = await _count(
        db_session, Message, Message.conversation_id == conversation_id_before
    )

    first = await client.post(
        f"/api/v1/applications/{application_id}/review-started", headers=owner_h
    )
    assert first.status_code == 200, first.text
    assert first.json()["changed"] is True
    assert first.json()["current_status"] == "reviewing"

    # The applicant is told nothing: no participant change, and no message or
    # notification beyond whatever their own application already created.
    applicant_view = await client.get("/api/v1/me/applications/sent", headers=talent_h)
    assert applicant_view.json()[0]["status"] == "new"
    conversation_id = await _application_conversation_id(db_session, application_id)
    messages_after = await _count(
        db_session, Message, Message.conversation_id == conversation_id
    )
    assert messages_after == messages_before, "review-started must not post a message"
    assert await _count(
        db_session,
        Notification,
        Notification.resource_id == application_id,
        Notification.type == "application_status_changed",
    ) == 0

    # Idempotent: a second open changes nothing.
    second = await client.post(
        f"/api/v1/applications/{application_id}/review-started", headers=owner_h
    )
    assert second.status_code == 200
    assert second.json()["changed"] is False
    assert second.json()["status_version"] == first.json()["status_version"]


async def test_only_the_manager_can_start_a_review(client: AsyncClient) -> None:
    _, talent, application_id = await _application(client)
    denied = await client.post(
        f"/api/v1/applications/{application_id}/review-started",
        headers={"Authorization": f"Bearer {talent}"},
    )
    assert denied.status_code == 403


async def test_review_start_never_overwrites_a_later_stage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A record already moved on keeps the stage its manager chose."""
    owner, _, application_id = await _application(client)
    owner_h = {"Authorization": f"Bearer {owner}"}
    await client.post(
        f"/api/v1/applications/{application_id}/transition",
        headers=owner_h,
        json={"status": "interviewing", "expected_version": 1, "idempotency_key": str(uuid.uuid4())},
    )

    response = await client.post(
        f"/api/v1/applications/{application_id}/review-started", headers=owner_h
    )
    assert response.status_code == 200
    assert response.json()["current_status"] == "interviewing"

    # The durable "was opened" fact is still recorded even though the stage held.
    application = await db_session.get(JobApplication, uuid.UUID(application_id))
    await db_session.refresh(application)
    assert application.review_started_at is not None


async def test_review_history_survives_a_stage_revert(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Undo may restore the visible stage, but not a 'never opened' history."""
    owner, _, application_id = await _application(client)
    owner_h = {"Authorization": f"Bearer {owner}"}
    await client.post(f"/api/v1/applications/{application_id}/review-started", headers=owner_h)

    application = await db_session.get(JobApplication, uuid.UUID(application_id))
    await db_session.refresh(application)
    opened_at = application.review_started_at
    assert opened_at is not None

    # Simulate an Undo returning the visible stage to its prior value.
    application.status = "new"
    await db_session.commit()

    # Re-opening does not move the durable timestamp.
    await client.post(f"/api/v1/applications/{application_id}/review-started", headers=owner_h)
    await db_session.refresh(application)
    assert application.review_started_at == opened_at
