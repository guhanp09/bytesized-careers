from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import create_access_token, decode_access_token, hash_password
from app.db import seed
from app.db import seed_data_personas as personas
from app.middleware import qa_audit
from app.models import (
    AdminAuditLog,
    EmailOutbox,
    Engagement,
    EngagementReview,
    InteractionStatusEvent,
    InteractionTransitionRequest,
    Job,
    JobApplication,
    TalentInterest,
    TalentListing,
    User,
    UserBlock,
)
from conftest import TestSessionLocal


CONTROLLER_ID = uuid.uuid5(uuid.NAMESPACE_DNS, "qa-controller.tests.creatorjobs")
CONTROLLER_EMAIL = "qa-controller@example.com"


@pytest.fixture(autouse=True)
def enable_qa(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "app_env", "test")
    monkeypatch.setattr(settings, "enable_qa_persona_switcher", True)
    monkeypatch.setattr(settings, "qa_persona_controller_emails", CONTROLLER_EMAIL)
    monkeypatch.setattr(settings, "qa_persona_access_token_minutes", 30)


async def _prepare() -> str:
    async with TestSessionLocal() as session:
        controller = await session.get(User, CONTROLLER_ID)
        if controller is None:
            controller = User(
                id=CONTROLLER_ID,
                email=CONTROLLER_EMAIL,
                username="qa_controller",
                display_name="QA Controller",
                account_type="BOTH",
                password_hash=hash_password("LocalQaController123!"),
                email_verified_at=datetime.now(UTC),
            )
            session.add(controller)
            await session.commit()
        await seed.seed_full_demo(session)
    return create_access_token(str(CONTROLLER_ID))


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_qa_routes_are_hidden_when_disabled_or_in_production(client, monkeypatch):
    token = await _prepare()
    monkeypatch.setattr(settings, "enable_qa_persona_switcher", False)
    assert (await client.get("/api/v1/qa/personas", headers=_auth(token))).status_code == 404

    monkeypatch.setattr(settings, "enable_qa_persona_switcher", True)
    monkeypatch.setattr(settings, "app_env", "production")
    assert (await client.get("/api/v1/qa/personas", headers=_auth(token))).status_code == 404


@pytest.mark.asyncio
async def test_only_allowlisted_controller_can_list_registered_personas(client, monkeypatch):
    token = await _prepare()
    response = await client.get("/api/v1/qa/personas", headers=_auth(token))
    assert response.status_code == 200
    payload = response.json()
    assert payload["controller"]["email"] == CONTROLLER_EMAIL
    assert [item["key"] for item in payload["personas"]] == personas.PERSONA_KEYS
    assert all("password" not in item and "email" not in item for item in payload["personas"])

    monkeypatch.setattr(settings, "qa_persona_controller_emails", "someone-else@example.com")
    assert (await client.get("/api/v1/qa/personas", headers=_auth(token))).status_code == 404


@pytest.mark.asyncio
async def test_status_reports_actual_fixture_health(client):
    token = await _prepare()
    ready = await client.get("/api/v1/qa/status", headers=_auth(token))
    assert ready.status_code == 200
    assert ready.json()["fixturesHealthy"] is True

    async with TestSessionLocal() as session:
        await session.execute(
            TalentListing.__table__.delete().where(
                TalentListing.id == personas.persona_uuid("listing:notifications")
            )
        )
        await session.commit()

    unhealthy = await client.get("/api/v1/qa/status", headers=_auth(token))
    assert unhealthy.status_code == 200
    assert unhealthy.json()["fixturesHealthy"] is False


@pytest.mark.asyncio
async def test_switch_issues_short_lived_access_only_persona_session(client):
    token = await _prepare()
    response = await client.post(
        "/api/v1/qa/session/switch",
        headers=_auth(token),
        json={"persona_key": "talent-complete"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert "refresh_token" not in payload
    claims = decode_access_token(payload["access_token"])
    assert claims["qa"] is True
    assert claims["act"] == str(CONTROLLER_ID)
    assert claims["sub"] == str(personas.persona_user_id("talent-complete"))
    assert claims["qa_persona_key"] == "talent-complete"
    assert claims["exp"] - int(datetime.now(UTC).timestamp()) <= 30 * 60 + 5

    me = await client.get("/api/v1/me", headers=_auth(payload["access_token"]))
    assert me.status_code == 200
    assert me.json()["username"] == "dev_talent_pro"


@pytest.mark.asyncio
async def test_unknown_or_non_catalogue_persona_cannot_be_selected(client):
    token = await _prepare()
    response = await client.post(
        "/api/v1/qa/session/switch",
        headers=_auth(token),
        json={"persona_key": "suspended-fixture"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_persona_session_refresh_preserves_session_and_exit_is_audited(client):
    token = await _prepare()
    switched = (
        await client.post(
            "/api/v1/qa/session/switch",
            headers=_auth(token),
            json={"persona_key": "recruiter-active"},
        )
    ).json()
    refreshed_response = await client.post(
        "/api/v1/qa/session/refresh",
        headers=_auth(token),
        json={
            "persona_key": "recruiter-active",
            "qa_session_id": switched["qa_session_id"],
        },
    )
    assert refreshed_response.status_code == 200
    refreshed = refreshed_response.json()
    assert refreshed["qa_session_id"] == switched["qa_session_id"]

    exit_response = await client.post(
        "/api/v1/qa/session/exit",
        headers=_auth(refreshed["access_token"]),
        json={
            "persona_key": "recruiter-active",
            "qa_session_id": switched["qa_session_id"],
        },
    )
    assert exit_response.status_code == 200
    assert (await client.get("/api/v1/me", headers=_auth(refreshed["access_token"]))).status_code == 401
    assert (
        await client.post(
            "/api/v1/qa/session/refresh",
            headers=_auth(token),
            json={
                "persona_key": "recruiter-active",
                "qa_session_id": switched["qa_session_id"],
            },
        )
    ).status_code == 404

    async with TestSessionLocal() as session:
        actions = list(
            (
                await session.execute(
                    select(AdminAuditLog.action).where(
                        AdminAuditLog.actor_user_id == CONTROLLER_ID,
                        AdminAuditLog.action.in_(
                            ["qa.persona.switch", "qa.persona.refresh", "qa.persona.exit"]
                        ),
                    )
                )
            ).scalars()
        )
    assert {"qa.persona.switch", "qa.persona.refresh", "qa.persona.exit"}.issubset(actions)


@pytest.mark.asyncio
async def test_active_persona_is_revoked_when_feature_or_allowlist_changes(client, monkeypatch):
    token = await _prepare()
    switched = (
        await client.post(
            "/api/v1/qa/session/switch",
            headers=_auth(token),
            json={"persona_key": "both-sides"},
        )
    ).json()
    persona_token = switched["access_token"]
    assert (await client.get("/api/v1/me", headers=_auth(persona_token))).status_code == 200

    monkeypatch.setattr(settings, "qa_persona_controller_emails", "removed@example.com")
    assert (await client.get("/api/v1/me", headers=_auth(persona_token))).status_code == 401


@pytest.mark.asyncio
async def test_expired_persona_token_and_suspended_controller_are_rejected(client):
    await _prepare()
    expired = create_access_token(
        str(personas.persona_user_id("talent-complete")),
        expires_delta=timedelta(seconds=-1),
        additional_claims={
            "qa": True,
            "act": str(CONTROLLER_ID),
            "qa_session_id": str(uuid.uuid4()),
            "qa_persona_key": "talent-complete",
        },
    )
    assert (await client.get("/api/v1/me", headers=_auth(expired))).status_code == 401

    controller_token = create_access_token(str(CONTROLLER_ID))
    switched = (
        await client.post(
            "/api/v1/qa/session/switch",
            headers=_auth(controller_token),
            json={"persona_key": "talent-complete"},
        )
    ).json()
    async with TestSessionLocal() as session:
        controller = await session.get(User, CONTROLLER_ID)
        assert controller is not None
        controller.suspended_at = datetime.now(UTC)
        await session.commit()
    assert (await client.get("/api/v1/me", headers=_auth(switched["access_token"]))).status_code == 401
    async with TestSessionLocal() as session:
        controller = await session.get(User, CONTROLLER_ID)
        assert controller is not None
        controller.suspended_at = None
        await session.commit()


@pytest.mark.asyncio
async def test_successful_persona_write_is_attributed_to_controller_without_body(
    client, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(qa_audit, "SessionLocal", TestSessionLocal)
    token = await _prepare()
    switched = (
        await client.post(
            "/api/v1/qa/session/switch",
            headers=_auth(token),
            json={"persona_key": "talent-incomplete"},
        )
    ).json()
    response = await client.patch(
        "/api/v1/me/profile",
        headers=_auth(switched["access_token"]),
        json={"bio": "Temporary QA write used to verify controller attribution."},
    )
    assert response.status_code == 200, response.text

    async with TestSessionLocal() as session:
        entry = (
            await session.execute(
                select(AdminAuditLog)
                .where(
                    AdminAuditLog.actor_user_id == CONTROLLER_ID,
                    AdminAuditLog.action == "qa.persona.write",
                    AdminAuditLog.target_id == switched["qa_session_id"],
                )
                .order_by(AdminAuditLog.created_at.desc())
            )
        ).scalars().first()
        assert entry is not None
        assert entry.after_json == {
            "method": "PATCH",
            "path": "/api/v1/me/profile",
            "status_code": 200,
            "persona_user_id": str(personas.persona_user_id("talent-incomplete")),
        }
        assert "Temporary QA write" not in str(entry.after_json)


@pytest.mark.asyncio
async def test_targeted_restore_is_confirmed_idempotent_and_preserves_ordinary_users(client):
    token = await _prepare()
    ordinary_id = uuid.uuid4()
    ordinary_application_id = uuid.uuid4()
    transient_application_id = uuid.uuid4()
    transient_interest_id = uuid.uuid4()
    async with TestSessionLocal() as session:
        session.add(
            User(
                id=ordinary_id,
                email=f"ordinary-{ordinary_id}@example.com",
                username=f"ordinary_{str(ordinary_id)[:8]}",
                display_name="Ordinary staging user",
                account_type="TALENT",
                email_verified_at=datetime.now(UTC),
            )
        )
        session.add(
            JobApplication(
                id=ordinary_application_id,
                job_id=personas.persona_uuid("job:recruiter-active-1"),
                applicant_user_id=ordinary_id,
                job_owner_user_id=personas.persona_user_id("recruiter-active"),
                cover_note="Ordinary user interaction must survive deterministic QA restores.",
                portfolio_item_ids=[],
                first_message_answers={},
                applicant_snapshot={"display_name": "Ordinary staging user"},
                status="new",
            )
        )
        # These records model a real QA Apply/Hire/Block exercise. They use
        # non-deterministic row ids but only deterministic persona actors and
        # listings, so the restore pack must remove them without touching the
        # ordinary application above.
        session.add(
            JobApplication(
                id=transient_application_id,
                job_id=personas.persona_uuid("job:hidden-moderation"),
                applicant_user_id=personas.persona_user_id("new-empty"),
                job_owner_user_id=personas.persona_user_id("recruiter-active"),
                cover_note="Transient QA application to clear on restore.",
                portfolio_item_ids=[],
                first_message_answers={},
                applicant_snapshot={"display_name": "New QA User"},
                status="new",
            )
        )
        session.add(
            TalentInterest(
                id=transient_interest_id,
                talent_listing_id=personas.persona_uuid("listing:talent-complete"),
                recruiter_user_id=personas.persona_user_id("recruiter-drafts"),
                owner_user_id=personas.persona_user_id("talent-complete"),
                note="Transient QA hiring request to clear on restore.",
                first_message_answers={},
                status="new",
            )
        )
        session.add(
            UserBlock(
                blocker_user_id=personas.persona_user_id("recruiter-active"),
                blocked_user_id=personas.persona_user_id("talent-complete"),
            )
        )
        await session.execute(
            TalentListing.__table__.delete().where(
                TalentListing.id == personas.persona_uuid("listing:notifications")
            )
        )
        await session.commit()

    wrong = await client.post(
        "/api/v1/qa/scenarios/listings-drafts/restore",
        headers=_auth(token),
        json={"confirmation": "wrong"},
    )
    assert wrong.status_code == 400

    for _ in range(2):
        restored = await client.post(
            "/api/v1/qa/scenarios/listings-drafts/restore",
            headers=_auth(token),
            json={"confirmation": "RESTORE LISTINGS"},
        )
        assert restored.status_code == 200, restored.text

    async with TestSessionLocal() as session:
        assert await session.get(User, ordinary_id) is not None
        assert await session.get(JobApplication, ordinary_application_id) is not None
        assert await session.get(JobApplication, transient_application_id) is None
        assert await session.get(TalentInterest, transient_interest_id) is None
        assert (
            await session.execute(
                select(UserBlock).where(
                    UserBlock.blocker_user_id == personas.persona_user_id("recruiter-active"),
                    UserBlock.blocked_user_id == personas.persona_user_id("talent-complete"),
                )
            )
        ).scalar_one_or_none() is None
        assert await session.get(TalentListing, personas.persona_uuid("listing:notifications")) is not None
        duplicate_pairs = int(
            (
                await session.execute(
                    select(func.count()).select_from(JobApplication).where(
                        JobApplication.id.in_(personas.all_persona_application_ids())
                    )
                )
            ).scalar_one()
        )
        assert duplicate_pairs == len(personas.all_persona_application_ids())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("scenario", "confirmation"),
    [
        ("profiles-empty", "RESTORE PROFILES"),
        ("applications", "RESTORE APPLICATIONS"),
        ("hiring-requests", "RESTORE REQUESTS"),
        ("inbox-pipeline", "RESTORE INBOX"),
        ("engagements-reviews", "RESTORE REVIEWS"),
        ("saved-notifications", "RESTORE SAVED"),
        ("verification-moderation", "RESTORE MODERATION"),
    ],
)
async def test_each_targeted_restore_pack_is_repeatable(client, scenario, confirmation):
    token = await _prepare()
    for _ in range(2):
        response = await client.post(
            f"/api/v1/qa/scenarios/{scenario}/restore",
            headers=_auth(token),
            json={"confirmation": confirmation},
        )
        assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_inbox_restore_includes_deliberate_legacy_archive_resolution_fixtures(client):
    token = await _prepare()
    restored = await client.post(
        "/api/v1/qa/scenarios/inbox-pipeline/restore",
        headers=_auth(token),
        json={"confirmation": "RESTORE INBOX"},
    )
    assert restored.status_code == 200, restored.text

    async with TestSessionLocal() as session:
        application = await session.get(
            JobApplication,
            personas.persona_uuid("application:new-empty:both-sides-1"),
        )
        interest = await session.get(
            TalentInterest,
            personas.persona_uuid("interest:recruiter-drafts:both-sides"),
        )
        assert application is not None
        assert application.status == "archived"
        assert application.legacy_archive_resolution_required is True
        assert interest is not None
        assert interest.status == "archived"
        assert interest.legacy_archive_resolution_required is True


@pytest.mark.asyncio
async def test_inbox_restore_clears_real_transition_side_effects_before_reuse(client):
    controller_token = await _prepare()
    recruiter_session = await client.post(
        "/api/v1/qa/session/switch",
        headers=_auth(controller_token),
        json={"persona_key": "recruiter-active"},
    )
    assert recruiter_session.status_code == 200
    recruiter_token = recruiter_session.json()["access_token"]
    application_id = personas.persona_uuid(
        "application:talent-complete:recruiter-active-1"
    )

    async def hire() -> None:
        response = await client.post(
            f"/api/v1/applications/{application_id}/transition",
            headers=_auth(recruiter_token),
            json={
                "status": "hired",
                "expected_version": 1,
                "idempotency_key": str(uuid.uuid4()),
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["outcome"] == "transitioned"

    await hire()
    restored = await client.post(
        "/api/v1/qa/scenarios/inbox-pipeline/restore",
        headers=_auth(controller_token),
        json={"confirmation": "RESTORE INBOX"},
    )
    assert restored.status_code == 200, restored.text

    async with TestSessionLocal() as session:
        application = await session.get(JobApplication, application_id)
        assert application is not None
        assert application.status == "shortlisted"
        assert application.participant_status == "new"
        assert application.status_version == 1
        assert (
            await session.execute(
                select(InteractionStatusEvent).where(
                    InteractionStatusEvent.interaction_type == "application",
                    InteractionStatusEvent.interaction_id == application_id,
                )
            )
        ).scalar_one_or_none() is None
        assert (
            await session.execute(
                select(InteractionTransitionRequest).where(
                    InteractionTransitionRequest.interaction_type == "application",
                    InteractionTransitionRequest.interaction_id == application_id,
                )
            )
        ).scalar_one_or_none() is None
        assert (
            await session.execute(
                select(Engagement).where(Engagement.application_id == application_id)
            )
        ).scalar_one_or_none() is None
        assert (
            await session.execute(
                select(EmailOutbox).where(
                    EmailOutbox.dedupe_key.like(f"application:{application_id}:%")
                )
            )
        ).scalar_one_or_none() is None

    await hire()


@pytest.mark.asyncio
async def test_moderation_fixtures_include_hidden_listing_review_and_former_collaborator(client):
    await _prepare()
    async with TestSessionLocal() as session:
        hidden_job = await session.get(Job, personas.persona_uuid("job:hidden-moderation"))
        assert hidden_job is not None and hidden_job.deleted_at is not None

        hidden_review = await session.get(
            EngagementReview,
            personas.persona_uuid("engagement-review:moderated-review:talent_to_recruiter"),
        )
        assert hidden_review is not None
        assert hidden_review.status == "hidden"
        assert hidden_review.hidden_by_user_id == personas.persona_user_id("admin")

        former_collaborator = await session.get(
            EngagementReview,
            personas.persona_uuid("engagement-review:moderated-review:recruiter_to_talent"),
        )
        assert former_collaborator is not None
        assert former_collaborator.status == "published"
        assert former_collaborator.reviewer_user_id is None


@pytest.mark.asyncio
async def test_full_baseline_restore_is_repeatable_and_keeps_audit_history(client):
    token = await _prepare()
    ordinary_id = uuid.uuid4()
    ordinary_application_id = uuid.uuid4()
    async with TestSessionLocal() as session:
        session.add(
            User(
                id=ordinary_id,
                email=f"ordinary-full-{ordinary_id}@example.com",
                username=f"ordinary_full_{str(ordinary_id)[:8]}",
                display_name="Ordinary full-restore user",
                account_type="TALENT",
                email_verified_at=datetime.now(UTC),
            )
        )
        session.add(
            JobApplication(
                id=ordinary_application_id,
                job_id=personas.persona_uuid("job:recruiter-active-2"),
                applicant_user_id=ordinary_id,
                job_owner_user_id=personas.persona_user_id("recruiter-active"),
                cover_note="This non-QA application must survive the full baseline restore.",
                portfolio_item_ids=[],
                first_message_answers={},
                applicant_snapshot={"display_name": "Ordinary full-restore user"},
                status="new",
            )
        )
        await session.commit()
    switched = await client.post(
        "/api/v1/qa/session/switch",
        headers=_auth(token),
        json={"persona_key": "both-sides"},
    )
    assert switched.status_code == 200

    for _ in range(2):
        restored = await client.post(
            "/api/v1/qa/scenarios/full-baseline/restore",
            headers=_auth(token),
            json={"confirmation": "RESTORE ALL QA DATA"},
        )
        assert restored.status_code == 200, restored.text

    async with TestSessionLocal() as session:
        assert await session.get(User, ordinary_id) is not None
        assert await session.get(JobApplication, ordinary_application_id) is not None
        switch_audit = int(
            (
                await session.execute(
                    select(func.count())
                    .select_from(AdminAuditLog)
                    .where(
                        AdminAuditLog.actor_user_id == CONTROLLER_ID,
                        AdminAuditLog.action == "qa.persona.switch",
                    )
                )
            ).scalar_one()
        )
        restore_audits = int(
            (
                await session.execute(
                    select(func.count())
                    .select_from(AdminAuditLog)
                    .where(
                        AdminAuditLog.actor_user_id == CONTROLLER_ID,
                        AdminAuditLog.action == "qa.scenario.restore",
                    )
                )
            ).scalar_one()
        )
        assert switch_audit >= 1
        assert restore_audits >= 2


@pytest.mark.asyncio
async def test_full_restore_refuses_production(client, monkeypatch):
    token = await _prepare()
    monkeypatch.setattr(settings, "app_env", "production")
    response = await client.post(
        "/api/v1/qa/scenarios/full-baseline/restore",
        headers=_auth(token),
        json={"confirmation": "RESTORE ALL QA DATA"},
    )
    assert response.status_code == 404
