from __future__ import annotations

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from conftest import TestSessionLocal, valid_published_job_payload
from httpx import AsyncClient
from sqlalchemy import select

from app.core.job_domain_taxonomy import AI_FIELD_CONFIRMATION_POLICY
from app.models import Job, Role

DOMAIN_COLUMNS = {
    "deliverables",
    "required_skill_keys",
    "preferred_skill_keys",
    "other_required_skills",
    "other_preferred_skills",
    "required_skills_note",
    "preferred_skills_note",
    "revision_policy",
    "revision_rounds",
    "revision_notes",
    "source_inputs",
    "source_inputs_notes",
    "creative_autonomy",
    "creative_autonomy_notes",
    "language_requirements",
    "trial_status",
    "trial_scope",
    "trial_effort_value",
    "trial_effort_unit",
    "trial_compensation_amount",
    "trial_compensation_currency",
    "trial_compensation_basis",
    "trial_work_usage",
    "trial_portfolio_permission",
    "trial_attribution",
    "unpaid_trial_confirmed",
    "trial_notes",
    "start_timing",
    "start_date",
    "duration_type",
    "duration_value",
    "duration_unit",
    "engagement_end_date",
    "hiring_process",
    "hiring_process_notes",
    "screening_questions",
    "employer_context_type",
}


async def _auth(client: AsyncClient, label: str) -> tuple[dict[str, str], UUID]:
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": f"{label}@example.com",
            "provider_account_id": f"google-{label}",
            "access_token": f"token-{label}",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, UUID(body["user"]["id"])


async def _role(name: str = "Video Editor") -> Role:
    async with TestSessionLocal() as session:
        role = (await session.execute(select(Role).where(Role.name == name))).scalar_one_or_none()
        if role is None:
            role = Role(name=name, category="Production", is_active=True)
            session.add(role)
            await session.commit()
            await session.refresh(role)
        return role


async def _represented_identity(client: AsyncClient, headers: dict[str, str], label: str) -> str:
    response = await client.post(
        "/api/v1/me/hiring-identities",
        headers=headers,
        json={
            "type": "AGENCY_REPRESENTED_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": f"{label} channel",
            "handle": label,
            "managed_by_agency_name": f"{label} agency",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_full_domain_draft_round_trips_and_survives_unrelated_edit(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "v3-domain-roundtrip")
    future = (datetime.now(UTC) + timedelta(days=14)).date().isoformat()
    payload = {
        "title": "Structured creator role draft",
        "requirements": ["Legacy qualification remains visible"],
        "application_requirements": ["relevant_portfolio", "expected_rate"],
        "how_to_apply": "Share links that show retention-focused storytelling.",
        "deliverables": [
            {"type": "long_form_video", "quantity": 4, "frequency": "per_month"},
            {
                "type": "other",
                "custom_type": "Sponsor cutdown",
                "quantity": 2,
                "frequency": "per_video",
                "notes": "Under sixty seconds each",
            },
        ],
        "required_skill_keys": ["video_editing", "storytelling"],
        "preferred_skill_keys": ["motion_graphics"],
        "other_required_skills": ["Retention analysis"],
        "other_preferred_skills": ["Creator studio reporting"],
        "required_skills_note": "Show pacing decisions in your reel.",
        "preferred_skills_note": "Simple motion systems are a plus.",
        "revision_policy": "fixed",
        "revision_rounds": 2,
        "revision_notes": "Minor changes within the approved brief.",
        "source_inputs": [
            {"type": "raw_footage"},
            {"type": "account_access", "sensitive_access_confirmed": True},
        ],
        "source_inputs_notes": "Access is granted only after onboarding.",
        "creative_autonomy": "collaborative_direction",
        "creative_autonomy_notes": "Pitch alternate hooks during kickoff.",
        "language_requirements": [
            {
                "language": "Tamil",
                "priority": "required",
                "proficiency": "native_or_fluent",
                "purposes": ["content_understanding", "audience_fluency"],
            },
            {
                "language": "English",
                "priority": "preferred",
                "proficiency": "professional",
                "purposes": ["writing"],
            },
        ],
        "trial_status": "none",
        "start_timing": "specific_date",
        "start_date": future,
        "duration_type": "fixed_period",
        "duration_value": 3,
        "duration_unit": "months",
        "hiring_process": [
            {"stage": "application_review"},
            {"stage": "portfolio_review"},
            {"stage": "screening_call", "notes": "Thirty minutes"},
            {"stage": "offer"},
        ],
        "hiring_process_notes": "Most candidates hear back within one week.",
        "screening_questions": [
            {
                "prompt": "Which edit best demonstrates audience retention?",
                "required": True,
                "response_guidance": "Include one public link.",
            }
        ],
        "employer_context_type": "brand",
        "status": "draft",
    }
    created = await client.post("/api/v1/jobs", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["listing_schema_version"] == 3
    assert body["required_skill_keys"] == payload["required_skill_keys"]
    assert body["preferred_skill_keys"] == payload["preferred_skill_keys"]
    assert body["deliverables"][0]["quantity"] == 4
    assert body["deliverables"][1]["custom_type"] == "Sponsor cutdown"
    assert body["source_inputs"][1] == {
        "type": "account_access",
        "custom_label": None,
        "sensitive_access_confirmed": True,
    }
    assert body["language_requirements"][0]["purposes"] == [
        "content_understanding",
        "audience_fluency",
    ]
    assert [stage["stage"] for stage in body["hiring_process"]] == [
        "application_review",
        "portfolio_review",
        "screening_call",
        "offer",
    ]
    assert body["screening_questions"][0]["prompt"].startswith("Which edit")
    assert body["requirements"] == ["Legacy qualification remains visible"]
    assert body["trial_status"] == "none"
    assert body["employer_context_type"] == "brand"
    assert (await client.get(f"/api/v1/jobs/{body['id']}")).status_code == 404

    updated = await client.patch(
        f"/api/v1/jobs/{body['id']}",
        headers=headers,
        json={"title": "Updated structured creator role draft"},
    )
    assert updated.status_code == 200, updated.text
    updated_body = updated.json()
    for field in (
        "deliverables",
        "required_skill_keys",
        "preferred_skill_keys",
        "source_inputs",
        "language_requirements",
        "hiring_process",
        "screening_questions",
    ):
        assert updated_body[field] == body[field]

    owned = await client.get("/api/v1/me/jobs", headers=headers)
    assert owned.status_code == 200
    owned_body = next(item for item in owned.json() if item["id"] == body["id"])
    assert owned_body["deliverables"] == body["deliverables"]
    assert owned_body["screening_questions"] == body["screening_questions"]


async def test_legacy_text_is_not_reclassified_and_null_differs_from_confirmed_empty(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "v3-null-and-legacy")
    created = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Legacy compatibility draft",
            "requirements": ["Excellent editing and communication"],
            "languages": ["Tamil", "English"],
            "status": "draft",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["requirements"] == ["Excellent editing and communication"]
    assert body["languages"] == ["Tamil", "English"]
    assert body["required_skill_keys"] is None
    assert body["preferred_skill_keys"] is None
    assert body["language_requirements"] is None
    assert body["deliverables"] is None
    assert body["source_inputs"] is None

    confirmed_none = await client.patch(
        f"/api/v1/jobs/{body['id']}",
        headers=headers,
        json={
            "deliverables": [],
            "required_skill_keys": [],
            "preferred_skill_keys": [],
            "language_requirements": [],
            "source_inputs": [],
            "screening_questions": [],
        },
    )
    assert confirmed_none.status_code == 200, confirmed_none.text
    for field in (
        "deliverables",
        "required_skill_keys",
        "preferred_skill_keys",
        "language_requirements",
        "source_inputs",
        "screening_questions",
    ):
        assert confirmed_none.json()[field] == []
    assert confirmed_none.json()["requirements"] == ["Excellent editing and communication"]
    assert confirmed_none.json()["languages"] == ["Tamil", "English"]


async def test_represented_identity_preserves_explicit_employer_context_on_create_and_update(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "v3-employer-context-explicit")
    identity_id = await _represented_identity(client, headers, "explicit-context")

    created = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Represented brand draft",
            "hiring_identity_id": identity_id,
            "employer_context_type": "brand",
            "status": "draft",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["employer_context_type"] == "brand"

    job_id = created.json()["id"]
    updated = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers=headers,
        json={
            "hiring_identity_id": identity_id,
            "employer_context_type": "production_house",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["employer_context_type"] == "production_house"

    identity_refresh = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers=headers,
        json={"hiring_identity_id": identity_id},
    )
    assert identity_refresh.status_code == 200, identity_refresh.text
    assert identity_refresh.json()["employer_context_type"] == "production_house"


async def test_represented_identity_defaults_absent_employer_context_on_create_and_update(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "v3-employer-context-default")
    identity_id = await _represented_identity(client, headers, "default-context")

    created = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Represented agency draft",
            "hiring_identity_id": identity_id,
            "status": "draft",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["employer_context_type"] == "agency"

    without_identity = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={"title": "Draft awaiting hiring identity", "status": "draft"},
    )
    assert without_identity.status_code == 201, without_identity.text
    assert without_identity.json()["employer_context_type"] is None

    attached = await client.patch(
        f"/api/v1/jobs/{without_identity.json()['id']}",
        headers=headers,
        json={"hiring_identity_id": identity_id},
    )
    assert attached.status_code == 200, attached.text
    assert attached.json()["employer_context_type"] == "agency"


async def test_deliverable_skill_revision_input_and_autonomy_validation(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "v3-domain-structure")

    malformed = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Malformed domain draft",
            "deliverables": [{"type": "other", "quantity": 0, "frequency": "other"}],
            "source_inputs": [{"type": "analytics_access"}],
        },
    )
    assert malformed.status_code == 422

    overlap = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Overlapping skills draft",
            "required_skill_keys": ["video_editing"],
            "preferred_skill_keys": ["video_editing"],
            "other_required_skills": ["Retention Strategy"],
            "other_preferred_skills": ["retention strategy"],
        },
    )
    assert overlap.status_code == 422
    assert {
        "preferred_skill_keys",
        "other_preferred_skills",
    } <= set(overlap.json()["detail"]["field_errors"])

    invalid_rounds = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Invalid revision draft",
            "revision_policy": "unlimited",
            "revision_rounds": 2,
        },
    )
    assert invalid_rounds.status_code == 422
    assert "revision_rounds" in invalid_rounds.json()["detail"]["field_errors"]

    valid = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Valid domain structure draft",
            "deliverables": [
                {
                    "type": "other",
                    "custom_type": "Fortnightly podcast trailer",
                    "quantity": 1,
                    "frequency": "other",
                    "custom_frequency": "every fortnight",
                }
            ],
            "revision_policy": "negotiable",
            "source_inputs": [
                {"type": "analytics_access", "sensitive_access_confirmed": True}
            ],
            "creative_autonomy": "own_creative_approach",
        },
    )
    assert valid.status_code == 201, valid.text
    assert valid.json()["deliverables"][0]["custom_frequency"] == "every fortnight"
    assert valid.json()["source_inputs"][0]["sensitive_access_confirmed"] is True


@pytest.mark.parametrize(
    "autonomy",
    [
        "follow_established_style",
        "guided_by_references",
        "collaborative_direction",
        "own_creative_approach",
        "varies_by_assignment",
        "not_applicable",
    ],
)
async def test_all_autonomy_values_round_trip_on_drafts(
    client: AsyncClient, autonomy: str
) -> None:
    headers, _ = await _auth(client, f"v3-autonomy-{autonomy}")
    response = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={"title": "Autonomy value draft", "creative_autonomy": autonomy},
    )
    assert response.status_code == 201, response.text
    assert response.json()["creative_autonomy"] == autonomy


async def test_output_publication_and_patch_use_effective_deliverables(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "v3-deliverable-publication")
    missing_payload = await valid_published_job_payload(deliverables=[])
    missing = await client.post("/api/v1/jobs", headers=headers, json=missing_payload)
    assert missing.status_code == 422
    assert "deliverables" in missing.json()["detail"]["field_errors"]

    missing_rounds = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Fixed revisions without rounds", revision_policy="fixed"
        ),
    )
    assert missing_rounds.status_code == 422
    assert "revision_rounds" in missing_rounds.json()["detail"]["field_errors"]

    draft_payload = await valid_published_job_payload(status="draft", deliverables=None)
    draft = await client.post("/api/v1/jobs", headers=headers, json=draft_payload)
    assert draft.status_code == 201, draft.text
    invalid_publish = await client.patch(
        f"/api/v1/jobs/{draft.json()['id']}", headers=headers, json={"status": "published"}
    )
    assert invalid_publish.status_code == 422
    assert "deliverables" in invalid_publish.json()["detail"]["field_errors"]

    published = await client.patch(
        f"/api/v1/jobs/{draft.json()['id']}",
        headers=headers,
        json={
            "deliverables": [
                {"type": "long_form_video", "quantity": 4, "frequency": "per_month"},
                {"type": "thumbnail", "quantity": 3, "frequency": "per_video"},
            ],
            "status": "published",
        },
    )
    assert published.status_code == 200, published.text
    assert len(published.json()["deliverables"]) == 2


async def test_public_job_exposes_application_language_revision_and_employer_context(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "v3-candidate-visible-contract")
    response = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Candidate-visible creator contract",
            application_requirements=[
                "relevant_portfolio",
                "expected_rate",
                "start_availability",
            ],
            screening_questions=[
                {
                    "prompt": "Which portfolio piece is closest to this channel style?",
                    "required": True,
                    "response_guidance": "Include one link and a short explanation.",
                }
            ],
            how_to_apply="Answer the questions and attach the most relevant public portfolio link.",
            language_requirements=[
                {
                    "language": "Tamil",
                    "priority": "required",
                    "proficiency": "native_or_fluent",
                    "purposes": ["content_understanding"],
                }
            ],
            revision_policy="fixed",
            revision_rounds=2,
            source_inputs=[],
            employer_context_type="production_house",
        ),
    )
    assert response.status_code == 201, response.text
    job_id = response.json()["id"]
    public = await client.get(f"/api/v1/jobs/{job_id}")
    assert public.status_code == 200, public.text
    body = public.json()
    assert body["application_requirements"] == [
        "relevant_portfolio",
        "expected_rate",
        "start_availability",
    ]
    # Screening questions are private hiring configuration — never public listing content.
    assert body["screening_questions"] is None
    assert body["how_to_apply"].startswith("Answer the questions")
    assert body["language_requirements"][0]["priority"] == "required"
    assert body["revision_policy"] == "fixed"
    assert body["revision_rounds"] == 2
    assert body["source_inputs"] == []
    assert body["employer_context_type"] == "production_house"


async def test_paid_unpaid_none_and_undecided_trial_rules(client: AsyncClient) -> None:
    headers, _ = await _auth(client, "v3-trials")

    for status in ("none", "undecided"):
        response = await client.post(
            "/api/v1/jobs",
            headers=headers,
            json=await valid_published_job_payload(
                title=f"Published job with {status} trial", trial_status=status
            ),
        )
        assert response.status_code == 201, response.text

    paid_incomplete = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(trial_status="paid"),
    )
    assert paid_incomplete.status_code == 422
    assert {
        "trial_scope",
        "trial_effort_value",
        "trial_compensation_amount",
        "trial_work_usage",
        "trial_portfolio_permission",
        "trial_attribution",
    } <= set(paid_incomplete.json()["detail"]["field_errors"])

    paid = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Published job with paid trial",
            trial_status="paid",
            trial_scope="Edit a sixty-second excerpt from supplied footage.",
            trial_effort_value=2,
            trial_effort_unit="hours",
            trial_compensation_amount=100,
            trial_compensation_currency="usd",
            trial_compensation_basis="flat",
            trial_work_usage="evaluation_only",
            trial_portfolio_permission="allowed",
            trial_attribution="not_applicable",
            hiring_process=[{"stage": "application_review"}, {"stage": "paid_trial"}],
        ),
    )
    assert paid.status_code == 201, paid.text
    assert paid.json()["trial_compensation_currency"] == "USD"

    unpaid_incomplete = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Ambiguous unpaid trial",
            trial_status="unpaid",
            trial_scope="Create one thumbnail concept.",
        ),
    )
    assert unpaid_incomplete.status_code == 422
    assert {
        "trial_effort_value",
        "trial_work_usage",
        "unpaid_trial_confirmed",
    } <= set(unpaid_incomplete.json()["detail"]["field_errors"])

    unpaid = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Explicit unpaid trial",
            trial_status="unpaid",
            trial_scope="Create one thumbnail concept from a supplied brief.",
            trial_effort_value=1,
            trial_effort_unit="deliverables",
            trial_work_usage="evaluation_only",
            trial_portfolio_permission="with_permission",
            trial_attribution="to_be_agreed",
            unpaid_trial_confirmed=True,
            hiring_process=[{"stage": "unpaid_trial"}, {"stage": "offer"}],
        ),
    )
    assert unpaid.status_code == 201, unpaid.text

    invalid_combination = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Invalid unpaid trial draft",
            "trial_status": "unpaid",
            "trial_compensation_amount": 50,
            "trial_compensation_currency": "USD",
            "trial_compensation_basis": "flat",
        },
    )
    assert invalid_combination.status_code == 422
    assert "trial_compensation_amount" in invalid_combination.json()["detail"]["field_errors"]


async def test_start_duration_deadline_process_and_screening_validation(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "v3-timing-process")
    today = datetime.now(UTC).date()
    future = today + timedelta(days=20)

    missing_date = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(start_timing="specific_date"),
    )
    assert missing_date.status_code == 422
    assert "start_date" in missing_date.json()["detail"]["field_errors"]

    past_start = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Past start date listing",
            start_timing="specific_date",
            start_date=(today - timedelta(days=1)).isoformat(),
        ),
    )
    assert past_start.status_code == 422
    assert "start_date" in past_start.json()["detail"]["field_errors"]

    fixed_term = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Fixed-term creator engagement",
            engagement_type="fixed_term",
            expected_weekly_hours_min=20,
            start_timing="specific_date",
            start_date=future.isoformat(),
            duration_type="fixed_period",
            duration_value=3,
            duration_unit="months",
            deadline_at=(datetime.now(UTC) + timedelta(days=5)).isoformat(),
            hiring_process=[
                {"stage": "application_review"},
                {"stage": "assessment"},
                {"stage": "final_discussion"},
                {"stage": "offer"},
            ],
            screening_questions=[
                {"prompt": "What is your earliest available start date?", "required": True}
            ],
        ),
    )
    assert fixed_term.status_code == 201, fixed_term.text
    assert [stage["stage"] for stage in fixed_term.json()["hiring_process"]] == [
        "application_review",
        "assessment",
        "final_discussion",
        "offer",
    ]
    assert fixed_term.json()["start_timeframe"] == "ASAP"
    assert fixed_term.json()["start_timing"] == "specific_date"

    invalid_fixed_term = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Fixed-term without duration",
            engagement_type="fixed_term",
            expected_weekly_hours_min=20,
        ),
    )
    assert invalid_fixed_term.status_code == 422
    assert "duration_type" in invalid_fixed_term.json()["detail"]["field_errors"]

    past_deadline = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Past deadline domain listing",
            deadline_at=(datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
        ),
    )
    assert past_deadline.status_code == 422
    assert "deadline_at" in past_deadline.json()["detail"]["field_errors"]

    mismatched_stage = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=await valid_published_job_payload(
            title="Mismatched trial stage",
            trial_status="none",
            hiring_process=[{"stage": "paid_trial"}],
        ),
    )
    assert mismatched_stage.status_code == 422
    assert "hiring_process" in mismatched_stage.json()["detail"]["field_errors"]


async def test_v3_publication_accepts_canonical_start_timing_without_legacy_timeframe(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "v3-canonical-start-only")
    payload = await valid_published_job_payload(start_timing="immediate")
    payload.pop("start_timeframe")

    published = await client.post("/api/v1/jobs", headers=headers, json=payload)
    assert published.status_code == 201, published.text
    assert published.json()["start_timing"] == "immediate"
    assert published.json()["start_timeframe"] is None

    missing_payload = await valid_published_job_payload()
    missing_payload.pop("start_timeframe")
    missing = await client.post("/api/v1/jobs", headers=headers, json=missing_payload)
    assert missing.status_code == 422, missing.text
    assert "start_timeframe" in missing.json()["detail"]["field_errors"]


async def test_version_two_live_jobs_are_grandfathered_but_republication_upgrades_to_v3(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "v3-version-two")
    job_id = uuid4()
    async with TestSessionLocal() as session:
        session.add(
            Job(
                id=job_id,
                title="Continuously published version two job",
                category="Editing",
                listing_schema_version=2,
                requirements=["Legacy requirement"],
                languages=["Tamil"],
                posted_by_user_id=owner_id,
                status="published",
            )
        )
        await session.commit()

    public = await client.get(f"/api/v1/jobs/{job_id}")
    assert public.status_code == 200, public.text
    assert public.json()["listing_schema_version"] == 2
    assert public.json()["deliverables"] is None
    assert public.json()["language_requirements"] is None

    ordinary = await client.patch(
        f"/api/v1/jobs/{job_id}", headers=headers, json={"title": "Edited live version two job"}
    )
    assert ordinary.status_code == 200, ordinary.text
    assert ordinary.json()["listing_schema_version"] == 2
    assert ordinary.json()["requirements"] == ["Legacy requirement"]
    assert ordinary.json()["required_skill_keys"] is None

    paused = await client.patch(
        f"/api/v1/jobs/{job_id}", headers=headers, json={"status": "paused"}
    )
    assert paused.status_code == 200
    assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 404
    invalid_republish = await client.patch(
        f"/api/v1/jobs/{job_id}", headers=headers, json={"status": "published"}
    )
    assert invalid_republish.status_code == 422

    republish_payload = await valid_published_job_payload(title="Republished version two job")
    republished = await client.patch(
        f"/api/v1/jobs/{job_id}", headers=headers, json=republish_payload
    )
    assert republished.status_code == 200, republished.text
    assert republished.json()["listing_schema_version"] == 3
    assert republished.json()["category"] == "Editing"
    assert republished.json()["languages"] == ["Tamil"]
    assert republished.json()["language_requirements"] is None


def _load_migration(filename: str):
    path = Path(__file__).parents[1] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_v3_migration_preserves_v1_and_v2_rows_and_is_reversible(tmp_path: Path) -> None:
    database_path = tmp_path / "domain-v3.db"
    engine = sa.create_engine(f"sqlite:///{database_path}")
    metadata = sa.MetaData()
    jobs = sa.Table(
        "jobs",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("category", sa.String(64), nullable=True),
        sa.Column("listing_schema_version", sa.SmallInteger(), nullable=False, server_default="2"),
        sa.Column("requirements", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("languages", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("weekly_hours", sa.String(64), nullable=True),
    )
    metadata.create_all(engine)
    v1_id, v2_id = str(uuid4()), str(uuid4())
    with engine.begin() as connection:
        connection.execute(
            jobs.insert(),
            [
                {
                    "id": v1_id,
                    "title": "Legacy version one",
                    "category": "Writing",
                    "listing_schema_version": 1,
                    "requirements": ["Legacy writing"],
                    "languages": ["Tamil"],
                    "weekly_hours": "Five-day turnaround",
                },
                {
                    "id": v2_id,
                    "title": "Existing version two",
                    "category": "Editing",
                    "listing_schema_version": 2,
                    "requirements": ["Legacy editing"],
                    "languages": ["English"],
                    "weekly_hours": "Ten hours weekly",
                },
            ],
        )

    migration = _load_migration("0042_creator_job_domain_contract.py")
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        migration.op = operations
        migration.upgrade()

    inspector = sa.inspect(engine)
    columns = {column["name"]: column for column in inspector.get_columns("jobs")}
    assert columns["listing_schema_version"]["default"] in {"'3'", "3"}
    assert DOMAIN_COLUMNS <= set(columns)
    assert {constraint["name"] for constraint in inspector.get_check_constraints("jobs")} >= {
        "ck_jobs_revision_rounds_positive",
        "ck_jobs_trial_effort_positive",
        "ck_jobs_trial_compensation_positive",
        "ck_jobs_duration_value_positive",
    }
    assert "ix_jobs_employer_context_type" in {
        index["name"] for index in inspector.get_indexes("jobs")
    }
    reflected = sa.Table("jobs", sa.MetaData(), autoload_with=engine)
    with engine.connect() as connection:
        rows = connection.execute(sa.select(reflected).order_by(reflected.c.title)).mappings().all()
    by_id = {row["id"]: row for row in rows}
    assert by_id[v1_id]["listing_schema_version"] == 1
    assert by_id[v2_id]["listing_schema_version"] == 2
    assert by_id[v1_id]["title"] == "Legacy version one"
    assert by_id[v1_id]["category"] == "Writing"
    assert by_id[v1_id]["requirements"] == ["Legacy writing"]
    assert by_id[v1_id]["languages"] == ["Tamil"]
    assert by_id[v2_id]["requirements"] == ["Legacy editing"]
    assert by_id[v2_id]["languages"] == ["English"]
    assert by_id[v2_id]["weekly_hours"] == "Ten hours weekly"
    for row in by_id.values():
        assert all(row[column] is None for column in DOMAIN_COLUMNS)

    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        migration.op = operations
        migration.downgrade()
    downgraded_columns = {column["name"]: column for column in sa.inspect(engine).get_columns("jobs")}
    assert "deliverables" not in downgraded_columns
    assert downgraded_columns["listing_schema_version"]["default"] in {"'2'", "2"}
    with engine.connect() as connection:
        preserved = connection.execute(
            sa.text(
                "SELECT id, category, listing_schema_version, weekly_hours FROM jobs ORDER BY id"
            )
        ).mappings().all()
    assert {row["id"]: row["listing_schema_version"] for row in preserved} == {
        v1_id: 1,
        v2_id: 2,
    }


def test_future_ai_confirmation_policy_keeps_sensitive_fields_confirmation_gated() -> None:
    assert DOMAIN_COLUMNS <= set(AI_FIELD_CONFIRMATION_POLICY)
    explicit_fields = {
        "source_inputs.type.account_access",
        "source_inputs.type.analytics_access",
        "source_inputs.sensitive_access_confirmed",
        "trial_status",
        "trial_compensation_amount",
        "trial_work_usage",
        "trial_portfolio_permission",
        "unpaid_trial_confirmed",
        "start_date",
        "engagement_end_date",
        "deadline_at",
        "budget_amount",
        "expected_weekly_hours_min",
        "expected_weekly_hours_max",
        "employer_context_type",
    }
    assert all(
        AI_FIELD_CONFIRMATION_POLICY[field] == "explicit_recruiter_confirmation_required"
        for field in explicit_fields
    )
    assert (
        AI_FIELD_CONFIRMATION_POLICY["hiring_verification_status_snapshot"]
        == "server_owned_never_infer"
    )
