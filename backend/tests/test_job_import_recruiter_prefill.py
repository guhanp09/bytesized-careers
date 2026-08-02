"""Recruiter answers given while extraction is still running.

The assistant asks a small number of recruiter-owned questions before machine
output exists. These tests pin the two rules that make that safe: the answer is
durable without a browser tab, and a later provider result can never overwrite it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from conftest import TestSessionLocal
from httpx import AsyncClient
from job_import_response_fixtures import scenario
from sqlalchemy import select

from app.core.job_import_policy import (
    EARLY_RECRUITER_QUESTION_FIELDS,
    JOB_IMPORT_FIELD_POLICIES,
    is_early_recruiter_question,
)
from app.models import JobImportField
from app.repositories.job_import_repository import JobImportRepository
from app.repositories.job_repository import JobRepository
from app.schemas.job_import import JobImportExtractionResponse
from app.services.job_import_service import JobImportService
from app.services.job_service import JobService


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


async def _source_and_draft(
    client: AsyncClient, headers: dict[str, str], label: str
) -> dict[str, object]:
    source = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": label,
            "original_text": f"Private source content for {label}.",
            "idempotency_key": f"source-{label}",
        },
    )
    assert source.status_code == 201, source.text
    draft = await client.post(
        f"/api/v1/job-imports/sources/{source.json()['id']}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": f"draft-{label}",
        },
    )
    assert draft.status_code == 201, draft.text
    return draft.json()


async def _record(draft_id: str, owner_user_id: UUID, payload: dict[str, object]) -> None:
    parsed = JobImportExtractionResponse.model_validate(payload)
    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            UUID(draft_id), parsed, owner_user_id=owner_user_id
        )


async def _field(draft_id: str, field_path: str) -> JobImportField | None:
    async with TestSessionLocal() as session:
        return (
            await session.execute(
                select(JobImportField).where(
                    JobImportField.draft_id == UUID(draft_id),
                    JobImportField.field_path == field_path,
                )
            )
        ).scalar_one_or_none()


def test_early_question_allowlist_is_narrow_and_policy_derived() -> None:
    """Only recruiter-authority, non-conditional fields may be asked early."""

    # application_mode was removed: applications always run through CreatorJobs,
    # so there is no routing decision left for a recruiter to make.
    assert EARLY_RECRUITER_QUESTION_FIELDS == {"employer_context_type"}
    for field_path in EARLY_RECRUITER_QUESTION_FIELDS:
        policy = JOB_IMPORT_FIELD_POLICIES[field_path]
        # Always recruiter-confirmed, so an early answer can never be wasted work.
        assert policy.confirmation_policy == "explicit_recruiter_confirmation_required"
        # Not conditional, so no controlling answer has to be known first.
        assert policy.missing_requirement != "conditionally_required"

    # Facts the source normally states stay out, even though they are also
    # recruiter-confirmed: asking early would create work extraction removes.
    for field_path in ("budget_amount", "compensation_mode", "trial_status", "title"):
        assert not is_early_recruiter_question(field_path)
    assert not is_early_recruiter_question("application_mode")


@pytest.mark.anyio
async def test_prefill_persists_on_the_draft_and_survives_reload(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "prefill-persist")
    draft = await _source_and_draft(client, headers, "prefill-persist")

    response = await client.put(
        f"/api/v1/job-imports/drafts/{draft['id']}/prefill/employer_context_type",
        headers=headers,
        json={"value": "creator"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["recruiter_prefill"] == {"employer_context_type": "creator"}
    # The client is told which questions it may ask; it must not infer the set.
    assert body["early_question_fields"] == sorted(EARLY_RECRUITER_QUESTION_FIELDS)

    # A fresh read is what a refreshed tab sees. No browser state involved.
    reread = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
    )
    assert reread.status_code == 200
    assert reread.json()["recruiter_prefill"] == {"employer_context_type": "creator"}


@pytest.mark.anyio
async def test_prefill_rejects_fields_that_are_not_early_answerable(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "prefill-scope")
    draft = await _source_and_draft(client, headers, "prefill-scope")

    response = await client.put(
        f"/api/v1/job-imports/drafts/{draft['id']}/prefill/budget_amount",
        headers=headers,
        json={"value": 1200},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "JOB_IMPORT_FIELD_NOT_EARLY_ANSWERABLE"


@pytest.mark.anyio
async def test_prefill_validates_the_value_before_storing_it(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "prefill-invalid")
    draft = await _source_and_draft(client, headers, "prefill-invalid")

    response = await client.put(
        f"/api/v1/job-imports/drafts/{draft['id']}/prefill/employer_context_type",
        headers=headers,
        json={"value": "not-a-real-employer-type"},
    )
    # 422 is the service-wide default for an invalid field value, matching the
    # ordinary review path rather than inventing a second convention.
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "JOB_IMPORT_FIELD_INVALID"

    reread = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
    )
    assert reread.json()["recruiter_prefill"] == {}


@pytest.mark.anyio
async def test_provider_output_never_overwrites_an_early_recruiter_answer(
    client: AsyncClient,
) -> None:
    """The central merge rule: the recruiter already decided, so the machine loses."""

    headers, owner_id = await _auth(client, "prefill-precedence")
    draft = await _source_and_draft(client, headers, "prefill-precedence")

    # The recruiter answers while extraction is still running.
    answered = await client.put(
        f"/api/v1/job-imports/drafts/{draft['id']}/prefill/employer_context_type",
        headers=headers,
        json={"value": "agency"},
    )
    assert answered.status_code == 200

    # The provider later returns a different value for the same field.
    payload = scenario("complete_creator_job")
    # The fixture does not mention who is hiring, so the recruiter's answer is
    # the only source for it and must survive the merge untouched.
    assert not [
        item
        for item in payload["fields"]
        if item["field_path"] == "employer_context_type"
    ]
    await _record(draft["id"], owner_id, payload)

    field = await _field(draft["id"], "employer_context_type")
    assert field is not None
    assert field.review_status == "edited"
    assert field.edited_value == "agency"
    assert field.validation_errors == []
    assert field.requires_confirmation is False


@pytest.mark.anyio
async def test_early_answer_for_a_field_the_provider_never_returns_is_kept(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "prefill-unreturned")
    draft = await _source_and_draft(client, headers, "prefill-unreturned")

    await client.put(
        f"/api/v1/job-imports/drafts/{draft['id']}/prefill/employer_context_type",
        headers=headers,
        json={"value": "agency"},
    )

    payload = scenario("complete_creator_job")
    assert not [
        item
        for item in payload["fields"]
        if item["field_path"] == "employer_context_type"
    ]
    await _record(draft["id"], owner_id, payload)

    field = await _field(draft["id"], "employer_context_type")
    assert field is not None
    assert field.review_status == "edited"
    assert field.edited_value == "agency"
    assert field.provenance_state == "directly_supplied"


@pytest.mark.anyio
async def test_prefill_window_closes_once_the_draft_is_prepared(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "prefill-window")
    draft = await _source_and_draft(client, headers, "prefill-window")
    await _record(draft["id"], owner_id, scenario("complete_creator_job"))

    response = await client.put(
        f"/api/v1/job-imports/drafts/{draft['id']}/prefill/employer_context_type",
        headers=headers,
        json={"value": "brand"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "JOB_IMPORT_PREFILL_WINDOW_CLOSED"


@pytest.mark.anyio
async def test_repeated_early_answers_keep_the_latest_decision(
    client: AsyncClient,
) -> None:
    headers, _ = await _auth(client, "prefill-repeat")
    draft = await _source_and_draft(client, headers, "prefill-repeat")

    for value in ("creator", "brand", "agency"):
        response = await client.put(
            f"/api/v1/job-imports/drafts/{draft['id']}/prefill/employer_context_type",
            headers=headers,
            json={"value": value},
        )
        assert response.status_code == 200

    reread = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
    )
    assert reread.json()["recruiter_prefill"] == {"employer_context_type": "agency"}


@pytest.mark.anyio
async def test_prefill_is_owner_private(client: AsyncClient) -> None:
    owner_headers, _ = await _auth(client, "prefill-owner")
    draft = await _source_and_draft(client, owner_headers, "prefill-owner")
    intruder_headers, _ = await _auth(client, "prefill-intruder")

    response = await client.put(
        f"/api/v1/job-imports/drafts/{draft['id']}/prefill/employer_context_type",
        headers=intruder_headers,
        json={"value": "creator"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "JOB_IMPORT_DRAFT_NOT_FOUND"

    unknown = await client.put(
        f"/api/v1/job-imports/drafts/{uuid4()}/prefill/employer_context_type",
        headers=owner_headers,
        json={"value": "creator"},
    )
    assert unknown.status_code == 404
