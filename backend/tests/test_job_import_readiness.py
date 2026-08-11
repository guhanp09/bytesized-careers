from __future__ import annotations

import asyncio
import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from conftest import TestSessionLocal
from httpx import AsyncClient
from job_import_response_fixtures import SCENARIOS, scenario
from pydantic import ValidationError
from sqlalchemy import select

from app.models import Job, JobImportDraft, JobImportField, JobImportSource, Role
from app.repositories.job_import_repository import JobImportRepository
from app.repositories.job_repository import JobRepository
from app.schemas.job_import import (
    MAX_EVIDENCE_SNIPPET_LENGTH,
    MAX_IMPORT_SOURCE_TEXT_LENGTH,
    JobImportApplyRequest,
    JobImportExtractionResponse,
    JobImportProviderMetadata,
    JobImportSourceCreate,
)
from app.services.job_import_service import JobImportError, JobImportService
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
    return (
        {"Authorization": f"Bearer {body['access_token']}"},
        UUID(body["user"]["id"]),
    )


async def _ensure_role() -> Role:
    async with TestSessionLocal() as session:
        role = (
            await session.execute(select(Role).where(Role.slug == "video-editor"))
        ).scalar_one_or_none()
        if role is None:
            role = Role(
                name="Video Editor",
                slug="video-editor",
                category="Production",
                is_active=True,
            )
            session.add(role)
            await session.commit()
            await session.refresh(role)
        elif not role.is_active:
            role.is_active = True
            await session.commit()
        return role


def _service(session) -> JobImportService:
    return JobImportService(
        JobImportRepository(session),
        JobService(JobRepository(session)),
    )


async def _source_and_draft(
    client: AsyncClient,
    headers: dict[str, str],
    label: str,
    *,
    source_payload: dict[str, object] | None = None,
    supersedes_draft_id: str | None = None,
) -> tuple[dict[str, object], dict[str, object]]:
    source_response = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json=source_payload
        or {
            "source_type": "pasted_text",
            "source_title": label,
            "original_text": f"Private source content for {label}.",
            "idempotency_key": f"source-{label}",
        },
    )
    assert source_response.status_code == 201, source_response.text
    source = source_response.json()
    draft_response = await client.post(
        f"/api/v1/job-imports/sources/{source['id']}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "supersedes_draft_id": supersedes_draft_id,
            "idempotency_key": f"draft-{label}",
        },
    )
    assert draft_response.status_code == 201, draft_response.text
    return source, draft_response.json()


async def _record(
    draft_id: str,
    owner_user_id: UUID,
    response_payload: dict[str, object],
    *,
    metadata: JobImportProviderMetadata | None = None,
) -> None:
    parsed = JobImportExtractionResponse.model_validate(response_payload)
    async with TestSessionLocal() as session:
        await _service(session).record_extraction_result(
            UUID(draft_id),
            parsed,
            owner_user_id=owner_user_id,
            provider_metadata=metadata,
        )


async def _accept_all_proposed(
    client: AsyncClient,
    headers: dict[str, str],
    draft_id: str,
) -> dict[str, object]:
    current = (await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)).json()
    for field in current["fields"]:
        if (
            field["provenance_state"] in {"missing", "conflicting_source_values"}
            or field["review_status"] != "pending"
            or field["validation_errors"]
        ):
            continue
        response = await client.patch(
            f"/api/v1/job-imports/drafts/{draft_id}/fields/{field['field_path']}",
            headers=headers,
            json={"action": "accept"},
        )
        assert response.status_code == 200, response.text
        current = response.json()
    return current


@pytest.mark.parametrize(
    ("source_type", "payload"),
    [
        ("pasted_text", {"original_text": "Pasted listing"}),
        ("rough_description", {"original_text": "Need an editor"}),
        ("external_listing_text", {"original_text": "Imported listing"}),
        ("public_url", {"source_url": "https://example.com/jobs/editor"}),
        (
            "screenshot",
            {
                "storage_references": ["private/imports/one.png"],
                "original_filename": "one.png",
                "content_type": "image/png",
            },
        ),
        (
            "screenshots",
            {
                "storage_references": [
                    "private/imports/one.png",
                    "private/imports/two.png",
                ],
                "original_filename": "screenshots.zip",
                "content_type": "application/zip",
            },
        ),
        (
            "document",
            {
                "storage_references": ["private/imports/job.docx"],
                "original_filename": "job.docx",
                "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
        ),
        (
            "pdf",
            {
                "storage_references": ["private/imports/job.pdf"],
                "original_filename": "job.pdf",
                "content_type": "application/pdf",
            },
        ),
        ("other", {"original_text": "Other normalized source"}),
    ],
)
def test_source_schema_supports_bounded_private_source_types(
    source_type: str,
    payload: dict[str, object],
) -> None:
    model = JobImportSourceCreate.model_validate({"source_type": source_type, **payload})
    assert model.source_type == source_type


def test_source_and_provider_schemas_reject_unsafe_or_oversized_input() -> None:
    with pytest.raises(ValidationError):
        JobImportSourceCreate.model_validate(
            {
                "source_type": "pasted_text",
                "original_text": "x" * (MAX_IMPORT_SOURCE_TEXT_LENGTH + 1),
            }
        )
    for unsafe_reference in (
        "../secret.pdf",
        "/absolute/secret.pdf",
        "https://public.example/secret.pdf",
        "private\\windows\\secret.pdf",
    ):
        with pytest.raises(ValidationError):
            JobImportSourceCreate.model_validate(
                {
                    "source_type": "pdf",
                    "storage_references": [unsafe_reference],
                    "original_filename": "secret.pdf",
                    "content_type": "application/pdf",
                }
            )
    with pytest.raises(ValidationError):
        JobImportSourceCreate.model_validate(
            {
                "source_type": "public_url",
                "source_url": "javascript:alert(1)",
            }
        )
    with pytest.raises(ValidationError):
        JobImportExtractionResponse.model_validate(scenario("malformed_provider_output"))
    too_large = scenario("complete_creator_job")
    too_large["fields"][0]["evidence"][0]["snippet"] = "x" * (MAX_EVIDENCE_SNIPPET_LENGTH + 1)
    with pytest.raises(ValidationError):
        JobImportExtractionResponse.model_validate(too_large)
    url_prefix = "https://example.com/"
    accepted_url = url_prefix + ("a" * (2048 - len(url_prefix)))
    assert (
        len(
            str(
                JobImportSourceCreate.model_validate(
                    {"source_type": "public_url", "source_url": accepted_url}
                ).source_url
            )
        )
        == 2048
    )
    with pytest.raises(ValidationError):
        JobImportSourceCreate.model_validate(
            {
                "source_type": "public_url",
                "source_url": accepted_url + "a",
            }
        )


def test_provider_contract_preserves_verbatim_evidence_and_rejects_invalid_nested_json() -> None:
    payload = scenario("screenshot_derived")
    payload["fields"][0]["evidence"][0]["snippet"] = (
        "<script>alert('private')</script> Video editor"
    )
    parsed = JobImportExtractionResponse.model_validate(payload)
    snippet = parsed.fields[0].evidence[0].snippet
    assert "<script>" in snippet
    assert parsed.fields[0].evidence[0].location.screenshot_index == 0

    invalid = scenario("complete_creator_job")
    invalid["fields"][0]["provenance"] = "provider_is_certain"
    with pytest.raises(ValidationError):
        JobImportExtractionResponse.model_validate(invalid)


def test_null_and_empty_field_semantics_remain_distinct() -> None:
    explicit_empty = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "required_tool_keys",
                    "value": [],
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "No tools are required."}],
                }
            ],
        }
    )
    assert explicit_empty.fields[0].value == []
    with pytest.raises(ValidationError):
        JobImportExtractionResponse.model_validate(
            {
                "extraction_schema_version": 1,
                "target_listing_schema_version": 3,
                "fields": [
                    {
                        "field_path": "required_tool_keys",
                        "value": None,
                        "provenance": "directly_supplied",
                        "evidence": [{"snippet": "Tools were not found."}],
                    }
                ],
            }
        )


def test_all_provider_neutral_simulation_fixtures_have_expected_schema_behavior() -> None:
    assert set(SCENARIOS) == {
        "complete_creator_job",
        "complete_reviewed_conversion",
        "concurrent_duplicate_conversion",
        "vague_one_line",
        "screenshot_derived",
        "conflicting_compensation",
        "custom_taxonomy_values",
        "duplicate_field_path",
        "missing_workload",
        "multiple_roles",
        "paid_trial",
        "unpaid_trial",
        "trial_status_conflict",
        "sensitive_account_access",
        "internal_application",
        "external_application_url",
        "past_application_deadline",
        "invalid_controlled_taxonomy",
        "malformed_provider_output",
        "unsupported_fields",
        "provider_verification_claim",
        "historical_language_field",
        "reprocessed_source",
        "incomplete_reviewed_conversion",
        "redacted_source_audit",
    }
    for name in SCENARIOS:
        if name in {"malformed_provider_output", "duplicate_field_path"}:
            with pytest.raises(ValidationError):
                JobImportExtractionResponse.model_validate(scenario(name))
        else:
            parsed = JobImportExtractionResponse.model_validate(scenario(name))
            assert parsed.extraction_schema_version == 1
            assert parsed.target_listing_schema_version == 3


async def test_private_api_ownership_allowlists_idempotency_and_status_tampering(
    client: AsyncClient,
) -> None:
    owner_headers, _owner_id = await _auth(client, "import-private-owner")
    other_headers, _other_id = await _auth(client, "import-private-other")
    source, draft = await _source_and_draft(
        client,
        owner_headers,
        "private-ownership",
    )

    duplicate_source = await client.post(
        "/api/v1/job-imports/sources",
        headers=owner_headers,
        json={
            "source_type": "pasted_text",
            "source_title": "private-ownership",
            "original_text": "Private source content for private-ownership.",
            "idempotency_key": "source-private-ownership",
        },
    )
    assert duplicate_source.status_code == 201
    assert duplicate_source.json()["id"] == source["id"]
    conflict = await client.post(
        "/api/v1/job-imports/sources",
        headers=owner_headers,
        json={
            "source_type": "pasted_text",
            "original_text": "Different content",
            "idempotency_key": "source-private-ownership",
        },
    )
    assert conflict.status_code == 409

    for path in (
        f"/api/v1/job-imports/sources/{source['id']}",
        f"/api/v1/job-imports/drafts/{draft['id']}",
    ):
        assert (await client.get(path)).status_code == 401
        assert (await client.get(path, headers=other_headers)).status_code == 404

    spoof_source = await client.post(
        "/api/v1/job-imports/sources",
        headers=owner_headers,
        json={
            "source_type": "pasted_text",
            "original_text": "Spoof",
            "provider_name": "untrusted-client",
        },
    )
    assert spoof_source.status_code == 422
    spoof_draft = await client.post(
        f"/api/v1/job-imports/sources/{source['id']}/drafts",
        headers=owner_headers,
        json={"processing_status": "ready_to_apply"},
    )
    assert spoof_draft.status_code == 422
    spoof_apply = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=owner_headers,
        json={"mode": "create_new", "target_job_id": str(uuid4())},
    )
    assert spoof_apply.status_code == 422
    other_delete = await client.delete(
        f"/api/v1/job-imports/sources/{source['id']}",
        headers=other_headers,
    )
    assert other_delete.status_code == 404
    other_initialize = await client.post(
        f"/api/v1/job-imports/sources/{source['id']}/drafts",
        headers=other_headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": "draft-cross-account-source",
        },
    )
    assert other_initialize.status_code == 404


async def test_concurrent_source_and_draft_idempotency_returns_one_record(
    client: AsyncClient,
) -> None:
    headers, _owner_id = await _auth(client, "import-concurrent-idempotency")
    source_payload = {
        "source_type": "rough_description",
        "source_title": "Concurrent import",
        "original_text": "Need a retention editor for a weekly creator series.",
        "idempotency_key": "source-concurrent-idempotency",
    }
    source_one, source_two = await asyncio.gather(
        client.post(
            "/api/v1/job-imports/sources",
            headers=headers,
            json=source_payload,
        ),
        client.post(
            "/api/v1/job-imports/sources",
            headers=headers,
            json=source_payload,
        ),
    )
    assert source_one.status_code == source_two.status_code == 201
    assert source_one.json()["id"] == source_two.json()["id"]

    source_id = source_one.json()["id"]
    draft_payload = {
        "extraction_schema_version": 1,
        "target_listing_schema_version": 3,
        "idempotency_key": "draft-concurrent-idempotency",
    }
    draft_one, draft_two = await asyncio.gather(
        client.post(
            f"/api/v1/job-imports/sources/{source_id}/drafts",
            headers=headers,
            json=draft_payload,
        ),
        client.post(
            f"/api/v1/job-imports/sources/{source_id}/drafts",
            headers=headers,
            json=draft_payload,
        ),
    )
    assert draft_one.status_code == draft_two.status_code == 201
    assert draft_one.json()["id"] == draft_two.json()["id"]


async def test_internal_processing_contract_and_failure_transition_are_provider_neutral(
    client: AsyncClient,
) -> None:
    await _ensure_role()
    headers, owner_id = await _auth(client, "import-internal-processing")
    source, draft = await _source_and_draft(
        client,
        headers,
        "internal-processing",
    )
    async with TestSessionLocal() as session:
        service = _service(session)
        request = await service.build_extraction_request(
            UUID(draft["id"]),
            owner_user_id=owner_id,
        )
        assert request.source.original_text == source["original_text"]
        assert "video-editor" in request.allowed_taxonomies["roles"]
        assert "per video" in request.allowed_taxonomies["compensation_units"]
        assert "Education" in request.allowed_taxonomies["content_niches"]
        assert "1\u20133 years" in request.allowed_taxonomies["experience_levels"]
        assert "primary_role_key" in {
            definition.field_path for definition in request.field_definitions
        }
        restrictions = " ".join(request.inference_restrictions).lower()
        assert "openai" not in restrictions
        assert "anthropic" not in restrictions

        processing = await service.begin_processing(
            UUID(draft["id"]),
            owner_user_id=owner_id,
        )
        assert processing.processing_status == "processing"
        failed = await service.mark_processing_failed(
            UUID(draft["id"]),
            owner_user_id=owner_id,
            error_code="adapter_unavailable",
            message="Future adapter unavailable " + ("x" * 1_000),
        )
        assert failed.processing_status == "processing_failed"
        assert len(failed.validation_errors["processing"]["message"]) == 500

    await _record(draft["id"], owner_id, scenario("redacted_source_audit"))
    async with TestSessionLocal() as session:
        with pytest.raises(JobImportError) as caught:
            await _service(session).begin_processing(
                UUID(draft["id"]),
                owner_user_id=owner_id,
            )
        assert caught.value.code == "JOB_IMPORT_INVALID_TRANSITION"

    openapi = (await client.get("/api/v1/openapi.json")).json()
    import_paths = {
        path: methods for path, methods in openapi["paths"].items() if "/job-imports/" in path
    }
    assert import_paths
    process_operation = import_paths["/api/v1/job-imports/drafts/{draft_id}/process"]["post"]
    request_schema = process_operation["requestBody"]["content"]["application/json"]["schema"]
    assert request_schema == {"$ref": "#/components/schemas/JobImportProcessRequest"}
    assert (
        openapi["components"]["schemas"]["JobImportProcessRequest"].get("additionalProperties")
        is False
    )


@pytest.mark.parametrize(
    "fixture_name",
    [
        "vague_one_line",
        "screenshot_derived",
        "conflicting_compensation",
        "missing_workload",
        "multiple_roles",
        "paid_trial",
        "unpaid_trial",
        "trial_status_conflict",
        "sensitive_account_access",
        "internal_application",
        "external_application_url",
        "past_application_deadline",
        "invalid_controlled_taxonomy",
        "custom_taxonomy_values",
        "reprocessed_source",
        "complete_reviewed_conversion",
        "incomplete_reviewed_conversion",
        "concurrent_duplicate_conversion",
        "redacted_source_audit",
    ],
)
async def test_valid_simulation_outputs_are_stored_with_provenance(
    client: AsyncClient,
    fixture_name: str,
) -> None:
    await _ensure_role()
    headers, owner_id = await _auth(client, f"import-fixture-{fixture_name}")
    _source, draft = await _source_and_draft(
        client,
        headers,
        f"fixture-{fixture_name}",
        source_payload=(
            {
                "source_type": "screenshots",
                "storage_references": [
                    f"private/imports/{fixture_name}-one.png",
                    f"private/imports/{fixture_name}-two.png",
                ],
                "original_filename": f"{fixture_name}.zip",
                "content_type": "application/zip",
                "idempotency_key": f"source-fixture-{fixture_name}",
            }
            if fixture_name == "screenshot_derived"
            else None
        ),
    )
    await _record(draft["id"], owner_id, scenario(fixture_name))
    response = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert response.status_code == 200
    stored = response.json()
    assert stored["processing_status"] == "ready_to_apply"
    assert stored["fields"]
    paths = {field["field_path"] for field in stored["fields"]}
    assert "title" in paths
    title = next(field for field in stored["fields"] if field["field_path"] == "title")
    assert title["authority_state"] == "prefilled_by_import"
    assert title["decision_origin"] == "explicit"
    if fixture_name == "screenshot_derived":
        title = next(field for field in stored["fields"] if field["field_path"] == "title")
        assert title["evidence"][0]["location"]["screenshot_index"] == 0
    if fixture_name == "invalid_controlled_taxonomy":
        budget_unit = next(
            field for field in stored["fields"] if field["field_path"] == "budget_unit"
        )
        assert budget_unit["validation_errors"]


async def test_review_transitions_conflict_resolution_and_confirmation_bypass(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-review-transitions")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "review-transitions",
    )
    await _record(draft["id"], owner_id, scenario("conflicting_compensation"))

    before_review = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert before_review.status_code == 200
    assert before_review.json()["can_apply_to_native_draft"] is True
    direct_authority = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
        headers=headers,
        json={"action": "accept", "confirmed_value": "spoofed"},
    )
    assert direct_authority.status_code == 422

    accepted = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
        headers=headers,
        json={"action": "accept"},
    )
    assert accepted.status_code == 200
    title = next(field for field in accepted.json()["fields"] if field["field_path"] == "title")
    assert title["authority_state"] == "confirmed_by_recruiter"
    assert title["confirmed_value"] == "Creator video editor"

    reset = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
        headers=headers,
        json={"action": "reset"},
    )
    assert reset.status_code == 200
    title = next(field for field in reset.json()["fields"] if field["field_path"] == "title")
    assert title["review_status"] == "pending"
    assert title["confirmed_value"] is None

    edited = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
        headers=headers,
        json={"action": "edit", "edited_value": "Recruiter-edited creator role"},
    )
    assert edited.status_code == 200
    title = next(field for field in edited.json()["fields"] if field["field_path"] == "title")
    assert title["authority_state"] == "edited_by_recruiter"
    assert title["effective_value"] == "Recruiter-edited creator role"

    cannot_accept_conflict = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/budget_amount",
        headers=headers,
        json={"action": "accept"},
    )
    assert cannot_accept_conflict.status_code == 409
    resolved = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/budget_amount/resolve",
        headers=headers,
        json={"selected_value_index": 1},
    )
    assert resolved.status_code == 200
    compensation = next(
        field for field in resolved.json()["fields"] if field["field_path"] == "budget_amount"
    )
    assert compensation["confirmed_value"] == "40000"
    assert compensation["selected_conflict_index"] == 1
    assert len(compensation["conflicting_values"]) == 2

    rejected = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
        headers=headers,
        json={"action": "reject"},
    )
    assert rejected.status_code == 200
    title = next(field for field in rejected.json()["fields"] if field["field_path"] == "title")
    assert title["authority_state"] == "rejected_by_recruiter"


async def test_explicit_prefill_and_unsupported_suggestions_have_distinct_authority(
    client: AsyncClient,
) -> None:
    await _ensure_role()
    headers, owner_id = await _auth(client, "import-provenance-states")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "provenance-states",
    )
    await _record(draft["id"], owner_id, scenario("complete_creator_job"))
    stored = (
        await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}",
            headers=headers,
        )
    ).json()
    fields = {field["field_path"]: field for field in stored["fields"]}
    assert fields["title"]["provenance_state"] == "extracted_from_source"
    assert fields["title"]["provider_confidence"]["score"] == 1.0
    assert fields["title"]["authority_state"] == "prefilled_by_import"
    assert fields["title"]["decision_origin"] == "explicit"
    assert fields["primary_role_key"]["provenance_state"] == "suggested_inference"
    assert fields["primary_role_key"]["authority_state"] == "unconfirmed"

    vague_source, vague = await _source_and_draft(
        client,
        headers,
        "provenance-directly-supplied",
    )
    del vague_source
    await _record(vague["id"], owner_id, scenario("vague_one_line"))
    vague_read = (
        await client.get(
            f"/api/v1/job-imports/drafts/{vague['id']}",
            headers=headers,
        )
    ).json()
    title = next(field for field in vague_read["fields"] if field["field_path"] == "title")
    assert title["provenance_state"] == "directly_supplied"
    assert title["authority_state"] == "prefilled_by_import"

    inferred_title = scenario("vague_one_line")
    inferred_title["fields"][0] = {
        "field_path": "title",
        "value": "Inferred title",
        "provenance": "suggested_inference",
        "explanation": "Generated from context rather than explicit wording.",
    }
    _source, invalid_draft = await _source_and_draft(
        client,
        headers,
        "provenance-invalid-inference",
    )
    await _record(invalid_draft["id"], owner_id, inferred_title)
    invalid_read = (
        await client.get(
            f"/api/v1/job-imports/drafts/{invalid_draft['id']}",
            headers=headers,
        )
    ).json()
    invalid_title = next(
        field for field in invalid_read["fields"] if field["field_path"] == "title"
    )
    assert invalid_title["validation_errors"] == [
        "This field may only be extracted from explicit source wording."
    ]


async def test_invalid_taxonomy_must_be_edited_and_consequential_fields_are_gated(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-taxonomy-gating")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "taxonomy-gating",
    )
    await _record(draft["id"], owner_id, scenario("invalid_controlled_taxonomy"))

    invalid_accept = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/budget_unit",
        headers=headers,
        json={"action": "accept"},
    )
    assert invalid_accept.status_code == 409
    corrected = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/budget_unit",
        headers=headers,
        json={"action": "edit", "edited_value": "per video"},
    )
    assert corrected.status_code == 200
    field = next(item for item in corrected.json()["fields"] if item["field_path"] == "budget_unit")
    assert field["authority_state"] == "edited_by_recruiter"
    assert field["validation_errors"] == []

    sensitive_paths = {
        "budget_unit",
        "expected_weekly_hours_min",
        "deadline_at",
        "trial_status",
        "trial_work_usage",
        "trial_portfolio_permission",
        "unpaid_trial_confirmed",
    }
    request = None
    async with TestSessionLocal() as session:
        request = await _service(session).build_extraction_request(
            UUID(draft["id"]),
            owner_user_id=owner_id,
        )
    policies = {item.field_path: item.confirmation_policy for item in request.field_definitions}
    assert all(
        policies[path] == "explicit_recruiter_confirmation_required" for path in sensitive_paths
    )
    assert "status" not in policies
    assert "hiring_verification_status_snapshot" not in policies
    assert "languages" not in policies
    assert "language_requirements" not in policies
    assert policies["screening_questions"] == "extract_when_explicit"
    assert all(not key.startswith("language_") for key in request.allowed_taxonomies)
    assert request.allowed_taxonomies["platforms"] == ["youtube", "instagram"]
    assert "Long-form video" in request.allowed_taxonomies["formats"]
    source_inputs = next(
        item for item in request.field_definitions if item.field_path == "source_inputs"
    )
    assert (
        source_inputs.nested_confirmation_policies["source_inputs.sensitive_access_confirmed"]
        == "explicit_recruiter_confirmation_required"
    )
    assert source_inputs.requires_recruiter_review is True
    assert "suggested_inference" in source_inputs.allowed_provenance


async def test_evidence_grounded_decisions_prefill_only_policy_safe_values(
    client: AsyncClient,
) -> None:
    await _ensure_role()
    headers, owner_id = await _auth(client, "import-prefill-decisions")
    source_text = (
        "Video editor needed. Turn podcast episodes into vertical clips for YouTube. "
        "Please answer: Which podcast clip are you most proud of?"
    )
    _source, draft = await _source_and_draft(
        client,
        headers,
        "prefill-decisions",
        source_payload={
            "source_type": "pasted_text",
            "source_title": "Podcast clips role",
            "original_text": source_text,
            "idempotency_key": "source-prefill-decisions",
        },
    )
    await _record(
        draft["id"],
        owner_id,
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "title",
                    "value": "Video editor needed",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Video editor needed."}],
                },
                {
                    "field_path": "primary_role_key",
                    "value": "video-editor",
                    "provenance": "suggested_inference",
                    "evidence": [
                        {"snippet": ("Turn podcast episodes into vertical clips for YouTube.")}
                    ],
                    "explanation": "The responsibilities describe video editing.",
                    "provider_confidence": {"score": 0.96, "label": "high"},
                },
                {
                    "field_path": "platforms",
                    "value": ["youtube"],
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "vertical clips for YouTube."}],
                    "explanation": "YouTube is the named destination platform.",
                    "provider_confidence": {"score": 0.98, "label": "high"},
                },
                {
                    "field_path": "experience_level",
                    "value": "Senior",
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "Video editor needed."}],
                    "explanation": "The scope may suggest senior ownership.",
                    "provider_confidence": {"score": 0.91, "label": "high"},
                },
                {
                    "field_path": "budget_amount",
                    "value": 3000,
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "Video editor needed."}],
                    "explanation": "A market-rate guess that must not be used.",
                    "provider_confidence": {"score": 0.99, "label": "high"},
                },
                {
                    "field_path": "screening_questions",
                    "value": [
                        {
                            "prompt": "Which podcast clip are you most proud of?",
                            "required": True,
                        }
                    ],
                    "provenance": "extracted_from_source",
                    "evidence": [
                        {"snippet": ("Please answer: Which podcast clip are you most proud of?")}
                    ],
                },
            ],
        },
    )

    response = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    fields = {field["field_path"]: field for field in body["fields"]}

    assert fields["title"]["authority_state"] == "prefilled_by_import"
    assert fields["title"]["decision_origin"] == "explicit"
    assert fields["primary_role_key"]["effective_value"] == "video-editor"
    assert fields["primary_role_key"]["decision_origin"] == "semantic_inference"
    assert fields["primary_role_key"]["needs_review"] is False
    assert fields["platforms"]["effective_value"] == ["youtube"]
    assert fields["experience_level"]["effective_value"] is None
    assert fields["experience_level"]["needs_review"] is True
    assert fields["budget_amount"]["effective_value"] is None
    assert fields["budget_amount"]["validation_errors"] == [
        "This field may only be extracted from explicit source wording."
    ]
    assert fields["screening_questions"]["effective_value"] == [
        {
            "prompt": "Which podcast clip are you most proud of?",
            "required": False,
        }
    ]
    assert body["can_apply_to_native_draft"] is True

    applied = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=headers,
        json={"mode": "create_new"},
    )
    assert applied.status_code == 200, applied.text
    job = applied.json()["job"]
    assert job["title"] == "Video editor needed"
    assert job["primary_role_id"] is not None
    assert job["platforms"] == ["youtube"]
    assert job["experience_level"] is None
    assert job["budget_amount"] is None
    assert job["screening_questions"][0]["required"] is False


async def test_semantic_inference_without_evidence_remains_a_suggestion(
    client: AsyncClient,
) -> None:
    await _ensure_role()
    headers, owner_id = await _auth(client, "import-inference-no-evidence")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "inference-no-evidence",
    )
    await _record(
        draft["id"],
        owner_id,
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "title",
                    "value": "Creator editor",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Creator editor"}],
                },
                {
                    "field_path": "primary_role_key",
                    "value": "video-editor",
                    "provenance": "suggested_inference",
                    "evidence": [],
                    "explanation": "A possible role without source support.",
                    "provider_confidence": {"score": 0.99, "label": "high"},
                },
            ],
        },
    )
    body = (
        await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}",
            headers=headers,
        )
    ).json()
    role = next(field for field in body["fields"] if field["field_path"] == "primary_role_key")
    assert role["review_status"] == "pending"
    assert role["effective_value"] is None
    assert role["needs_review"] is True


async def test_partial_import_can_attach_to_an_owned_canonical_draft_for_recovery(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-partial-attach")
    _source, draft = await _source_and_draft(client, headers, "partial-attach")
    await _record(
        draft["id"],
        owner_id,
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "about_channel",
                    "value": "A creator channel with an incomplete hiring brief.",
                    "provenance": "extracted_from_source",
                    "evidence": [
                        {"snippet": "A creator channel with an incomplete hiring brief."}
                    ],
                }
            ],
        },
    )
    partial = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert partial.status_code == 200
    assert partial.json()["can_apply_to_native_draft"] is False

    created = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={"title": "Completed manually", "status": "draft"},
    )
    assert created.status_code == 201, created.text
    job = created.json()

    attached = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/attach",
        headers=headers,
        json={"target_job_id": job["id"]},
    )
    assert attached.status_code == 200, attached.text
    assert attached.json()["linked"] is True
    assert attached.json()["draft"]["target_job_id"] == job["id"]
    assert attached.json()["draft"]["processing_status"] == "applied_to_native_draft"
    assert attached.json()["job"]["title"] == "Completed manually"
    assert attached.json()["job"]["status"] == "draft"

    repeated = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/attach",
        headers=headers,
        json={"target_job_id": job["id"]},
    )
    assert repeated.status_code == 200
    assert repeated.json()["linked"] is False

    context = await client.get(
        f"/api/v1/job-imports/native-jobs/{job['id']}/context",
        headers=headers,
    )
    assert context.status_code == 200
    assert context.json()["draft"]["id"] == draft["id"]

    reset = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/about_channel",
        headers=headers,
        json={"action": "reset"},
    )
    assert reset.status_code == 200
    assert reset.json()["processing_status"] == "applied_to_native_draft"
    accepted = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/about_channel",
        headers=headers,
        json={"action": "accept"},
    )
    assert accepted.status_code == 200
    accepted_field = next(
        field
        for field in accepted.json()["fields"]
        if field["field_path"] == "about_channel"
    )
    assert accepted_field["authority_state"] == "confirmed_by_recruiter"

    other_headers, _other_id = await _auth(client, "import-partial-attach-other")
    forbidden = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/attach",
        headers=other_headers,
        json={"target_job_id": job["id"]},
    )
    assert forbidden.status_code == 404


async def test_explicit_currency_wins_over_context_and_conflict_is_visible(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-currency-conflict")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "currency-conflict",
        source_payload={
            "source_type": "pasted_text",
            "source_title": "Currency conflict",
            "original_text": "Creator editor in the United States. Budget INR 3000.",
            "idempotency_key": "source-currency-conflict",
        },
    )
    await _record(
        draft["id"],
        owner_id,
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "title",
                    "value": "Creator editor",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Creator editor"}],
                },
                {
                    "field_path": "location",
                    "value": "United States",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "United States"}],
                },
                {
                    "field_path": "budget_amount",
                    "value": 3000,
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "3000"}],
                },
                {
                    "field_path": "budget_currency",
                    "value": "INR",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "INR"}],
                },
            ],
        },
    )
    body = (
        await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}",
            headers=headers,
        )
    ).json()
    currency = next(field for field in body["fields"] if field["field_path"] == "budget_currency")
    assert currency["proposed_value"] == "INR"
    assert currency["effective_value"] is None
    assert currency["decision_origin"] == "explicit"
    assert currency["needs_review"] is True
    assert body["processing_warnings"] == [
        {
            "code": "currency_location_conflict",
            "message": (
                "The stated currency conflicts with the role location. "
                "The stated currency was preserved."
            ),
            "field_path": "budget_currency",
            "evidence": [
                {"snippet": "INR", "location": None},
                {"snippet": "United States", "location": None},
            ],
        }
    ]


async def test_nested_policy_evidence_and_canonical_normalization_are_enforced(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-nested-policy")
    _source, sensitive_draft = await _source_and_draft(
        client,
        headers,
        "nested-policy-sensitive",
    )
    await _record(
        sensitive_draft["id"],
        owner_id,
        scenario("sensitive_account_access"),
    )
    sensitive = (
        await client.get(
            f"/api/v1/job-imports/drafts/{sensitive_draft['id']}",
            headers=headers,
        )
    ).json()
    source_inputs = next(
        field for field in sensitive["fields"] if field["field_path"] == "source_inputs"
    )
    # The explicit source fact remains reviewable rather than disappearing as
    # invalid, but provider output can never manufacture recruiter consent.
    assert source_inputs["validation_errors"] == []
    assert source_inputs["review_status"] == "pending"
    assert source_inputs["requires_confirmation"] is True
    assert source_inputs["proposed_value"][0]["sensitive_access_confirmed"] is False
    assert (
        source_inputs["provider_confidence"][
            "sensitive_access_confirmation_required"
        ]
        is True
    )
    assert (
        await client.patch(
            f"/api/v1/job-imports/drafts/{sensitive_draft['id']}/fields/source_inputs",
            headers=headers,
            json={"action": "accept"},
        )
    ).status_code == 409
    edited = await client.patch(
        f"/api/v1/job-imports/drafts/{sensitive_draft['id']}/fields/source_inputs",
        headers=headers,
        json={
            "action": "edit",
            "edited_value": [
                {
                    "type": "account_access",
                    "sensitive_access_confirmed": True,
                }
            ],
        },
    )
    assert edited.status_code == 200
    edited_field = next(
        field for field in edited.json()["fields"] if field["field_path"] == "source_inputs"
    )
    assert edited_field["authority_state"] == "edited_by_recruiter"

    _source, nested_draft = await _source_and_draft(
        client,
        headers,
        "nested-policy-unknown",
    )
    nested_injection = {
        "extraction_schema_version": 1,
        "target_listing_schema_version": 3,
        "fields": [
            {
                "field_path": "deliverables",
                "value": [
                    {
                        "type": "short",
                        "quantity": 2,
                        "frequency": "per_week",
                        "verification": "provider-owned",
                    }
                ],
                "provenance": "extracted_from_source",
                "evidence": [{"snippet": "Two shorts each week."}],
            }
        ],
    }
    with pytest.raises(JobImportError) as nested_error:
        await _record(nested_draft["id"], owner_id, nested_injection)
    assert nested_error.value.code == "JOB_IMPORT_UNSUPPORTED_NESTED_FIELD"

    _source, normalized_draft = await _source_and_draft(
        client,
        headers,
        "canonical-normalization",
    )
    normalized_payload = {
        "extraction_schema_version": 1,
        "target_listing_schema_version": 3,
        "fields": [
            {
                "field_path": "title",
                "value": "  Creator   editor  ",
                "provenance": "extracted_from_source",
                "evidence": [{"snippet": "Creator editor"}],
            },
            {
                "field_path": "budget_currency",
                "value": "usd",
                "provenance": "extracted_from_source",
                "evidence": [{"snippet": "USD"}],
            },
            {
                "field_path": "platforms",
                "value": ["youtube", "youtube"],
                "provenance": "extracted_from_source",
                "evidence": [{"snippet": "YouTube"}],
            },
        ],
    }
    await _record(normalized_draft["id"], owner_id, normalized_payload)
    normalized = (
        await client.get(
            f"/api/v1/job-imports/drafts/{normalized_draft['id']}",
            headers=headers,
        )
    ).json()
    fields = {field["field_path"]: field for field in normalized["fields"]}
    assert fields["title"]["proposed_value"] == "Creator editor"
    assert fields["budget_currency"]["proposed_value"] == "USD"
    assert fields["platforms"]["proposed_value"] == ["youtube"]


async def test_invalid_rejected_value_no_longer_blocks_native_draft(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-reject-invalid")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "reject-invalid",
    )
    await _record(draft["id"], owner_id, scenario("invalid_controlled_taxonomy"))
    assert (
        await client.patch(
            f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
            headers=headers,
            json={"action": "accept"},
        )
    ).status_code == 200
    rejected = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/budget_unit",
        headers=headers,
        json={"action": "reject"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["can_apply_to_native_draft"] is True
    converted = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=headers,
        json={"mode": "create_new"},
    )
    assert converted.status_code == 200
    assert converted.json()["job"]["budget_unit"] is None


async def test_evidence_must_reference_the_owned_source(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-evidence-owner")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "evidence-owner",
        source_payload={
            "source_type": "pasted_text",
            "original_text": "Short source.",
            "idempotency_key": "source-evidence-owner",
        },
    )
    invalid_reference = {
        "extraction_schema_version": 1,
        "target_listing_schema_version": 3,
        "fields": [
            {
                "field_path": "title",
                "value": "Creator editor",
                "provenance": "extracted_from_source",
                "evidence": [
                    {
                        "snippet": "Creator editor",
                        "location": {"char_start": 0, "char_end": 99},
                    }
                ],
            }
        ],
    }
    with pytest.raises(JobImportError) as evidence_error:
        await _record(draft["id"], owner_id, invalid_reference)
    assert evidence_error.value.code == "JOB_IMPORT_EVIDENCE_REFERENCE_INVALID"
    assert "Short source." not in str(evidence_error.value.details)

    mismatched_reference = invalid_reference.copy()
    mismatched_reference["fields"] = [
        {
            **invalid_reference["fields"][0],
            "evidence": [
                {
                    "snippet": "Wrong",
                    "location": {"char_start": 0, "char_end": 5},
                }
            ],
        }
    ]
    with pytest.raises(JobImportError) as mismatch_error:
        await _record(draft["id"], owner_id, mismatched_reference)
    assert mismatch_error.value.code == "JOB_IMPORT_EVIDENCE_REFERENCE_INVALID"
    assert "Short source." not in str(mismatch_error.value.details)


async def test_concurrent_apply_and_discard_have_one_transactional_winner(
    client: AsyncClient,
) -> None:
    await _ensure_role()
    headers, owner_id = await _auth(client, "import-concurrent-apply")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "concurrent-apply",
    )
    await _record(
        draft["id"],
        owner_id,
        scenario("concurrent_duplicate_conversion"),
    )
    await _accept_all_proposed(client, headers, draft["id"])

    first_apply, second_apply = await asyncio.gather(
        client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/apply",
            headers=headers,
            json={"mode": "create_new"},
        ),
        client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/apply",
            headers=headers,
            json={"mode": "create_new"},
        ),
    )
    assert first_apply.status_code == second_apply.status_code == 200
    assert sorted([first_apply.json()["created"], second_apply.json()["created"]]) == [False, True]
    assert first_apply.json()["job"]["id"] == second_apply.json()["job"]["id"]

    _source, race_draft = await _source_and_draft(
        client,
        headers,
        "concurrent-discard",
    )
    await _record(
        race_draft["id"],
        owner_id,
        scenario("complete_reviewed_conversion"),
    )
    await _accept_all_proposed(client, headers, race_draft["id"])
    apply_response, discard_response = await asyncio.gather(
        client.post(
            f"/api/v1/job-imports/drafts/{race_draft['id']}/apply",
            headers=headers,
            json={"mode": "create_new"},
        ),
        client.post(
            f"/api/v1/job-imports/drafts/{race_draft['id']}/discard",
            headers=headers,
        ),
    )
    assert sorted([apply_response.status_code, discard_response.status_code]) == [
        200,
        409,
    ]
    final = (
        await client.get(
            f"/api/v1/job-imports/drafts/{race_draft['id']}",
            headers=headers,
        )
    ).json()
    assert final["processing_status"] in {
        "applied_to_native_draft",
        "discarded",
    }
    assert (final["target_job_id"] is not None) == (
        final["processing_status"] == "applied_to_native_draft"
    )


async def test_complete_reviewed_import_creates_one_private_native_draft(
    client: AsyncClient,
) -> None:
    await _ensure_role()
    headers, owner_id = await _auth(client, "import-complete-conversion")
    source, draft = await _source_and_draft(
        client,
        headers,
        "complete-conversion",
    )
    await _record(
        draft["id"],
        owner_id,
        scenario("complete_creator_job"),
        metadata=JobImportProviderMetadata(
            provider_name="future-adapter",
            model_name="future-model",
            model_version="test-version",
            instruction_version="job-import-v1",
            metadata={"request_id": "provider-audit-only"},
        ),
    )
    reviewed = await _accept_all_proposed(client, headers, draft["id"])
    assert reviewed["processing_status"] == "ready_to_apply"
    assert reviewed["confirmation_state"] == "confirmed"
    assert reviewed["can_apply_to_native_draft"] is True
    assert reviewed["can_publish_directly"] is False

    converted = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=headers,
        json={"mode": "create_new"},
    )
    assert converted.status_code == 200, converted.text
    result = converted.json()
    assert result["created"] is True
    job = result["job"]
    assert job["status"] == "draft"
    assert job["posted_by_user_id"] == str(owner_id)
    assert job["listing_schema_version"] == 3
    assert job["required_tool_keys"] == ["premiere-pro"]
    assert job["other_required_tools"] == ["Creator Review Rig"]
    assert job["required_skill_keys"] == ["video_editing", "storytelling"]
    assert job["other_required_skills"] == ["YouTube retention sense"]
    assert job["content_niches"] == ["Personal finance"]
    assert job["deliverables"][0]["type"] == "long_form_video"
    assert job["deliverables"][1]["custom_type"] == "Sponsor integration cut"
    assert result["draft"]["source_id"] == source["id"]
    assert result["draft"]["target_job_id"] == job["id"]
    assert result["draft"]["provider_name"] == "future-adapter"

    repeated = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=headers,
        json={"mode": "create_new"},
    )
    assert repeated.status_code == 200
    assert repeated.json()["created"] is False
    assert repeated.json()["job"]["id"] == job["id"]

    assert (await client.get(f"/api/v1/jobs/{job['id']}")).status_code == 404
    public_list = await client.get("/api/v1/jobs?q=Retention-focused")
    assert public_list.status_code == 200
    assert job["id"] not in {item["id"] for item in public_list.json()["items"]}
    assert "Private source content" not in public_list.text
    owner_jobs = await client.get("/api/v1/me/jobs", headers=headers)
    assert owner_jobs.status_code == 200
    native = next(item for item in owner_jobs.json() if item["id"] == job["id"])
    assert "source_id" not in native
    assert "provider_name" not in native
    assert "original_text" not in native

    async with TestSessionLocal() as session:
        stored_draft = await session.get(JobImportDraft, UUID(draft["id"]))
        stored_job = await session.get(Job, UUID(job["id"]))
        assert stored_draft is not None
        assert stored_job is not None
        assert stored_draft.target_job_id == stored_job.id
        assert stored_draft.machine_output is not None


async def test_native_creation_failure_rolls_back_job_and_import_claim(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, owner_id = await _auth(client, "import-native-rollback")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "native-rollback",
    )
    await _record(draft["id"], owner_id, scenario("vague_one_line"))
    accepted = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
        headers=headers,
        json={"action": "accept"},
    )
    assert accepted.status_code == 200
    assert accepted.json()["processing_status"] == "ready_to_apply"

    async with TestSessionLocal() as session:
        before = int((await session.execute(select(sa.func.count()).select_from(Job))).scalar_one())
        service = _service(session)

        async def create_then_fail(
            payload,
            *,
            actor_user_id: UUID,
            commit_transaction: bool = True,
        ):
            del commit_transaction
            session.add(
                Job(
                    title=payload.title,
                    posted_by_user_id=actor_user_id,
                    listing_schema_version=3,
                    status="draft",
                )
            )
            await session.flush()
            raise RuntimeError("simulated native persistence failure")

        monkeypatch.setattr(service.job_service, "create_job", create_then_fail)
        with pytest.raises(RuntimeError, match="simulated native persistence failure"):
            await service.apply_to_native_draft(
                UUID(draft["id"]),
                JobImportApplyRequest(mode="create_new"),
                owner_user_id=owner_id,
            )

    async with TestSessionLocal() as session:
        after = int((await session.execute(select(sa.func.count()).select_from(Job))).scalar_one())
        stored = await session.get(JobImportDraft, UUID(draft["id"]))
        assert after == before
        assert stored is not None
        assert stored.processing_status == "ready_to_apply"
        assert stored.target_job_id is None
        assert stored.mutation_claim_token is None


async def test_applied_draft_replay_rejects_deleted_or_cross_owner_target(
    client: AsyncClient,
) -> None:
    owner_headers, owner_id = await _auth(client, "import-target-owner")
    _other_headers, other_id = await _auth(client, "import-target-other")
    _source, draft = await _source_and_draft(
        client,
        owner_headers,
        "target-integrity",
    )
    await _record(draft["id"], owner_id, scenario("vague_one_line"))
    assert (
        await client.patch(
            f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
            headers=owner_headers,
            json={"action": "accept"},
        )
    ).status_code == 200
    converted = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=owner_headers,
        json={"mode": "create_new"},
    )
    assert converted.status_code == 200
    job_id = UUID(converted.json()["job"]["id"])

    async with TestSessionLocal() as session:
        job = await session.get(Job, job_id)
        assert job is not None
        job.posted_by_user_id = other_id
        await session.commit()
    mismatched = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=owner_headers,
        json={"mode": "create_new"},
    )
    assert mismatched.status_code == 409
    assert mismatched.json()["error"]["code"] == "JOB_IMPORT_TARGET_OWNERSHIP_MISMATCH"

    async with TestSessionLocal() as session:
        job = await session.get(Job, job_id)
        assert job is not None
        job.posted_by_user_id = owner_id
        job.deleted_at = datetime.now(UTC)
        await session.commit()
    deleted = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=owner_headers,
        json={"mode": "create_new"},
    )
    assert deleted.status_code == 409
    assert deleted.json()["error"]["code"] == "JOB_IMPORT_TARGET_JOB_NOT_FOUND"


async def test_incomplete_reviewed_import_creates_incomplete_native_draft_only(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-incomplete-conversion")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "incomplete-conversion",
    )
    await _record(draft["id"], owner_id, scenario("vague_one_line"))
    title_review = await client.patch(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
        headers=headers,
        json={"action": "accept"},
    )
    assert title_review.status_code == 200, title_review.text
    reviewed = title_review.json()
    assert reviewed["can_apply_to_native_draft"] is True
    assert reviewed["can_publish_directly"] is False
    missing = {item["field_path"] for item in reviewed["missing_fields"]}
    assert {"primary_role_key", "compensation_mode"} <= missing

    converted = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=headers,
        json={"mode": "create_new"},
    )
    assert converted.status_code == 200, converted.text
    job = converted.json()["job"]
    assert job["status"] == "draft"
    assert job["primary_role_id"] is None
    assert job["compensation_mode"] is None
    publish_attempt = await client.patch(
        f"/api/v1/jobs/{job['id']}",
        headers=headers,
        json={"status": "published"},
    )
    assert publish_attempt.status_code == 422


@pytest.mark.parametrize(
    ("fixture_name", "detail_key", "expected_field"),
    [
        ("unsupported_fields", "server_owned_fields", "status"),
        (
            "provider_verification_claim",
            "server_owned_fields",
            "hiring_verification_status_snapshot",
        ),
        (
            "historical_language_field",
            "legacy_compatibility_fields",
            "language_requirements",
        ),
    ],
)
async def test_unsupported_output_is_rejected_without_partial_storage(
    client: AsyncClient,
    fixture_name: str,
    detail_key: str,
    expected_field: str,
) -> None:
    headers, owner_id = await _auth(client, f"import-unsupported-{fixture_name}")
    _source, draft = await _source_and_draft(
        client,
        headers,
        f"unsupported-{fixture_name}",
    )
    with pytest.raises(JobImportError) as caught:
        await _record(draft["id"], owner_id, scenario(fixture_name))
    assert caught.value.code == "JOB_IMPORT_UNSUPPORTED_FIELD"
    assert caught.value.details[detail_key] == [expected_field]
    async with TestSessionLocal() as session:
        fields = (
            (
                await session.execute(
                    select(JobImportField).where(JobImportField.draft_id == UUID(draft["id"]))
                )
            )
            .scalars()
            .all()
        )
        assert fields == []


async def test_superseding_preserves_old_machine_output_and_old_draft_is_immutable(
    client: AsyncClient,
) -> None:
    await _ensure_role()
    headers, owner_id = await _auth(client, "import-superseding")
    source, first = await _source_and_draft(
        client,
        headers,
        "superseding-first",
    )
    await _record(first["id"], owner_id, scenario("redacted_source_audit"))
    second_response = await client.post(
        f"/api/v1/job-imports/sources/{source['id']}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "supersedes_draft_id": first["id"],
            "idempotency_key": "draft-superseding-second",
        },
    )
    assert second_response.status_code == 201
    second = second_response.json()
    assert (
        await client.get(
            f"/api/v1/job-imports/drafts/{first['id']}",
            headers=headers,
        )
    ).json()["processing_status"] == "superseded"
    await _record(second["id"], owner_id, scenario("reprocessed_source"))
    with pytest.raises(JobImportError) as caught:
        await _record(first["id"], owner_id, scenario("reprocessed_source"))
    assert caught.value.code == "JOB_IMPORT_MACHINE_OUTPUT_IMMUTABLE"

    async with TestSessionLocal() as session:
        first_row = await session.get(JobImportDraft, UUID(first["id"]))
        second_row = await session.get(JobImportDraft, UUID(second["id"]))
        assert first_row is not None and first_row.machine_output is not None
        assert second_row is not None and second_row.machine_output is not None
        assert second_row.supersedes_draft_id == first_row.id
        assert first_row.machine_output != second_row.machine_output


async def test_source_redaction_removes_content_references_and_evidence_but_keeps_audit(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-redaction")
    source, draft = await _source_and_draft(
        client,
        headers,
        "redaction",
        source_payload={
            "source_type": "pdf",
            "source_title": "Private imported PDF",
            "original_filename": "private-job.pdf",
            "content_type": "application/pdf",
            "storage_references": ["private/imports/private-job.pdf"],
            "idempotency_key": "source-redaction",
        },
    )
    redaction_payload = scenario("redacted_source_audit")
    redaction_payload["warnings"] = [
        {
            "code": "private.source.note",
            "message": "Private processing context.",
        }
    ]
    await _record(
        draft["id"],
        owner_id,
        redaction_payload,
        metadata=JobImportProviderMetadata(
            provider_name="future-adapter",
            metadata={"private_trace": "redact-me"},
        ),
    )
    deleted = await client.delete(
        f"/api/v1/job-imports/sources/{source['id']}",
        headers=headers,
    )
    assert deleted.status_code == 204
    repeated_delete = await client.delete(
        f"/api/v1/job-imports/sources/{source['id']}",
        headers=headers,
    )
    assert repeated_delete.status_code == 204
    assert (
        await client.get(
            f"/api/v1/job-imports/sources/{source['id']}",
            headers=headers,
        )
    ).status_code == 404
    retained_draft = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert retained_draft.status_code == 200
    assert all(field["evidence"] == [] for field in retained_draft.json()["fields"])
    assert retained_draft.json()["processing_status"] == "discarded"
    assert retained_draft.json()["can_apply_to_native_draft"] is False

    async with TestSessionLocal() as session:
        stored_source = await session.get(JobImportSource, UUID(source["id"]))
        stored_draft = await session.get(JobImportDraft, UUID(draft["id"]))
        assert stored_source is not None
        assert stored_source.original_text is None
        assert stored_source.source_title is None
        assert stored_source.source_url is None
        assert stored_source.original_filename is None
        assert stored_source.storage_references == []
        assert stored_source.content_fingerprint == "0" * 64
        assert stored_source.client_request_id is None
        assert stored_source.processing_state == "deleted"
        assert stored_source.deleted_at is not None
        assert stored_draft is not None
        assert stored_draft.machine_output is None
        assert stored_draft.provider_metadata is None
        assert stored_draft.processing_warnings == []
        assert stored_draft.validation_errors == {}


async def test_simultaneous_redaction_and_review_end_in_a_redacted_safe_state(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-redaction-review-race")
    source, draft = await _source_and_draft(
        client,
        headers,
        "redaction-review-race",
    )
    await _record(draft["id"], owner_id, scenario("redacted_source_audit"))

    redaction, review = await asyncio.gather(
        client.delete(
            f"/api/v1/job-imports/sources/{source['id']}",
            headers=headers,
        ),
        client.patch(
            f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
            headers=headers,
            json={"action": "accept"},
        ),
    )
    assert redaction.status_code == 204
    assert review.status_code in {200, 409}
    assert (
        await client.get(
            f"/api/v1/job-imports/sources/{source['id']}",
            headers=headers,
        )
    ).status_code == 404
    retained = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert retained.status_code == 200
    assert retained.json()["processing_status"] == "discarded"
    assert retained.json()["can_apply_to_native_draft"] is False
    assert all(field["evidence"] == [] for field in retained.json()["fields"])


async def test_cross_account_cannot_review_apply_discard_or_delete_draft(
    client: AsyncClient,
) -> None:
    owner_headers, owner_id = await _auth(client, "import-action-owner")
    other_headers, _other_id = await _auth(client, "import-action-other")
    _source, draft = await _source_and_draft(
        client,
        owner_headers,
        "cross-account-actions",
    )
    await _record(draft["id"], owner_id, scenario("vague_one_line"))
    attempts = [
        (
            "PATCH",
            f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
            {"action": "accept"},
        ),
        (
            "POST",
            f"/api/v1/job-imports/drafts/{draft['id']}/fields/title/resolve",
            {"selected_value_index": 0},
        ),
        (
            "POST",
            f"/api/v1/job-imports/drafts/{draft['id']}/apply",
            {"mode": "create_new"},
        ),
        (
            "POST",
            f"/api/v1/job-imports/drafts/{draft['id']}/discard",
            None,
        ),
        (
            "DELETE",
            f"/api/v1/job-imports/drafts/{draft['id']}",
            None,
        ),
    ]
    for method, path, payload in attempts:
        response = await client.request(
            method,
            path,
            headers=other_headers,
            json=payload,
        )
        assert response.status_code == 404, (method, path, response.text)


async def test_owned_draft_deletion_redacts_machine_history_and_hides_record(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "import-draft-deletion")
    _source, draft = await _source_and_draft(
        client,
        headers,
        "draft-deletion",
    )
    await _record(draft["id"], owner_id, scenario("redacted_source_audit"))
    deleted = await client.delete(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert deleted.status_code == 204
    repeated_delete = await client.delete(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert repeated_delete.status_code == 204
    assert (
        await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}",
            headers=headers,
        )
    ).status_code == 404
    async with TestSessionLocal() as session:
        stored = await session.get(JobImportDraft, UUID(draft["id"]))
        assert stored is not None
        assert stored.deleted_at is not None
        assert stored.machine_output is None
        assert stored.provider_metadata is None
        fields = (
            (
                await session.execute(
                    select(JobImportField).where(JobImportField.draft_id == UUID(draft["id"]))
                )
            )
            .scalars()
            .all()
        )
        assert fields == []


def _load_migration(filename: str):
    path = Path(__file__).parents[1] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_job_import_migration_is_additive_reversible_and_preserves_rows(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "job-import-readiness.db"
    engine = sa.create_engine(f"sqlite:///{database_path}")
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
    )
    jobs = sa.Table(
        "jobs",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("listing_schema_version", sa.SmallInteger(), nullable=False),
    )
    metadata.create_all(engine)
    user_id, job_id = uuid4(), uuid4()
    with engine.begin() as connection:
        connection.execute(users.insert().values(id=user_id, email="preserved@example.com"))
        connection.execute(
            jobs.insert().values(
                id=job_id,
                title="Preserved existing listing",
                listing_schema_version=3,
            )
        )

    migration = _load_migration("0043_job_import_readiness.py")
    audit_migration = _load_migration("0044_job_import_mutation_claim.py")
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        migration.op = operations
        migration.upgrade()
        audit_migration.op = operations
        audit_migration.upgrade()
    inspector = sa.inspect(engine)
    assert {
        "job_import_sources",
        "job_import_drafts",
        "job_import_fields",
    } <= set(inspector.get_table_names())
    assert {
        "ck_job_import_source_processing_state",
        "ck_job_import_source_type",
        "ck_job_import_source_retention_policy",
    } <= {
        constraint["name"] for constraint in inspector.get_check_constraints("job_import_sources")
    }
    assert migration.down_revision == "0042_creator_job_domain_contract"
    assert audit_migration.down_revision == "0043_job_import_readiness"
    assert "mutation_claim_token" in {
        column["name"] for column in inspector.get_columns("job_import_drafts")
    }
    with engine.connect() as connection:
        assert connection.execute(sa.select(sa.func.count()).select_from(users)).scalar_one() == 1
        assert connection.execute(sa.select(sa.func.count()).select_from(jobs)).scalar_one() == 1
        assert (
            connection.execute(sa.text("SELECT COUNT(*) FROM job_import_sources")).scalar_one() == 0
        )

    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        audit_migration.op = operations
        audit_migration.downgrade()
        migration.op = operations
        migration.downgrade()
    inspector = sa.inspect(engine)
    assert "job_import_sources" not in inspector.get_table_names()
    with engine.connect() as connection:
        preserved = connection.execute(sa.select(jobs.c.title, jobs.c.listing_schema_version)).one()
    assert preserved == ("Preserved existing listing", 3)
