"""Development fixtures for the draft assistant.

These exist so the whole experience can be inspected without spending provider
credits. The tests below check two things: that each scenario really produces
the state it advertises, and that the fixture route stays development-only.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from conftest import google_id_token_for_test
from httpx import AsyncClient

from app.db.seed_data_job_import import (
    DEVELOPMENT_IMPORT_SCENARIOS,
    IN_FLIGHT_IMPORT_SCENARIOS,
    processed_review_fixture,
)


async def _auth(client: AsyncClient, label: str) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "id_token": google_id_token_for_test(
                email=f"{label}@example.com", subject=f"google-{label}"
            ),
            "access_token": f"token-{label}",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _fixture(client: AsyncClient, headers: dict[str, str], scenario: str):
    return await client.post(
        f"/api/v1/dev/job-import-review?scenario={scenario}&fresh=true",
        headers=headers,
    )


def test_every_advertised_scenario_is_either_processed_in_flight_or_failure() -> None:
    """The scenario list and its handling must not drift apart."""

    processed = {
        scenario
        for scenario in DEVELOPMENT_IMPORT_SCENARIOS
        if scenario not in IN_FLIGHT_IMPORT_SCENARIOS and scenario != "processing-failure"
    }
    assert processed == {
        "strong-decisions",
        "thumbnail-designer",
        "scriptwriter",
        "clean-import",
        "shine-school-editor",
        "multi-craft",
        "labelled-pay-conflict",
        "ceiling-only-pay",
        "brand-discovery",
        "checkpoint-currency",
        "checkpoint-trial",
        "checkpoint-experience",
    }
    # Every processed scenario must actually have extraction output behind it.
    for scenario in processed:
        response = processed_review_fixture(scenario)
        assert response.fields, f"{scenario} must produce fields"


def test_the_scriptwriter_fixture_leaves_the_gaps_a_writer_cares_about() -> None:
    response = processed_review_fixture("scriptwriter")
    missing = {item.field_path for item in response.missing_fields}
    # Research ownership and script length are the writer-specific gaps; they are
    # what makes this scenario different from the editor and designer fixtures.
    assert "source_inputs" in missing
    assert "deliverables" in missing
    assert "revision_policy" in missing

    roles = {
        item.field_path: item.value
        for item in response.fields
        if item.field_path == "primary_role_key"
    }
    assert roles["primary_role_key"] == "scriptwriter"


def test_the_precedence_fixture_contradicts_the_answer_the_scenario_saves() -> None:
    """Scenario H is only meaningful if the machine really disagrees."""

    response = processed_review_fixture("answer-precedence")
    proposed = {
        item.field_path: item.value
        for item in response.fields
        if item.field_path == "application_mode"
    }
    # The scenario saves "external" first; this must be the opposite.
    assert proposed["application_mode"] == "internal"


@pytest.mark.anyio
async def test_processed_scenarios_produce_a_reviewable_draft(
    client: AsyncClient,
) -> None:
    headers = await _auth(client, "fixture-processed")
    for scenario in (
        "strong-decisions",
        "thumbnail-designer",
        "scriptwriter",
        "clean-import",
        "shine-school-editor",
        "multi-craft",
        "checkpoint-currency",
        "checkpoint-trial",
        "checkpoint-experience",
    ):
        response = await _fixture(client, headers, scenario)
        assert response.status_code == 200, f"{scenario}: {response.text}"
        draft = response.json()["draft"]
        assert draft["processing_status"] in {
            "awaiting_recruiter_review",
            "partially_reviewed",
            "ready_to_apply",
        }
        assert draft["fields"], f"{scenario} should have review fields"


@pytest.mark.anyio
async def test_shine_school_editor_fixture_preserves_url_context_without_provider(
    client: AsyncClient,
) -> None:
    headers = await _auth(client, "fixture-shine-school-editor")
    response = await _fixture(client, headers, "shine-school-editor")
    assert response.status_code == 200, response.text
    draft = response.json()["draft"]
    fields = {field["field_path"]: field for field in draft["fields"]}
    assert fields["location"]["effective_value"] == "Chennai"
    assert fields["primary_role_key"]["effective_value"] == "video-editor"
    assert fields["primary_role_key"]["decision_confidence"] == "high"
    assert fields["primary_role_key"]["needs_review"] is False
    assert fields["content_niches"]["effective_value"] == ["Education"]
    assert fields["content_niches"]["decision_confidence"] == "high"
    assert fields["content_niches"]["needs_review"] is False
    assert fields["experience_level"]["effective_value"] == "1\u20137 years"

    source_id = draft["source_id"]
    source = await client.get(f"/api/v1/job-imports/sources/{source_id}", headers=headers)
    assert source.status_code == 200, source.text
    source_body = source.json()
    assert source_body["source_type"] == "public_url"
    assert source_body["retrieval_metadata"]["structured_context"]["industry"] == (
        "Education / Training"
    )
    assert source_body["retrieval_metadata"]["structured_context"]["job_title"] == ("Video Editor")
    assert source_body["retrieval_metadata"]["structured_context"]["responsibilities"] == [
        "Edit learning videos for a school-based education channel"
    ]
    assert source_body["retrieval_metadata"]["structured_context"]["qualifications"] == [
        "Minimum of 1-7 years of experience in video editing",
        "Proficiency in video editing software and tools",
    ]
    assert "Structured job title: Video Editor" in source_body["original_text"]
    assert "Structured skills: Video Editing" in source_body["original_text"]

    converted = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=headers,
        json={"mode": "create_new"},
    )
    assert converted.status_code == 200, converted.text
    native = converted.json()["job"]
    assert native["primary_role_name_snapshot"] == "Video Editor"
    assert native["content_niches"] == ["Education"]


@pytest.mark.anyio
async def test_in_flight_scenarios_stay_genuinely_mid_processing(
    client: AsyncClient,
) -> None:
    """The staged surface is only worth inspecting against the real state."""

    headers = await _auth(client, "fixture-inflight")
    for scenario in sorted(IN_FLIGHT_IMPORT_SCENARIOS):
        response = await _fixture(client, headers, scenario)
        assert response.status_code == 200, f"{scenario}: {response.text}"
        draft = response.json()["draft"]
        assert draft["processing_status"] == "processing", scenario
        # No machine output yet, so the assistant has nothing to review and asks
        # nothing until source processing completes.
        assert draft["fields"] == [], scenario
        assert draft["early_question_fields"] == [], scenario
        assert draft["recruiter_prefill"] == {}, scenario


@pytest.mark.anyio
async def test_the_resume_scenario_stays_source_first_while_processing(
    client: AsyncClient,
) -> None:
    headers = await _auth(client, "fixture-resume")
    response = await _fixture(client, headers, "refresh-resume")
    assert response.status_code == 200, response.text
    draft = response.json()["draft"]

    # Refresh restores the processing state without manufacturing a recruiter
    # answer or showing a question before the source has been read.
    assert draft["recruiter_prefill"] == {}
    assert draft["early_question_fields"] == []
    assert draft["processing_status"] == "processing"


@pytest.mark.anyio
async def test_the_failure_scenario_returns_a_real_error_not_a_stalled_draft(
    client: AsyncClient,
) -> None:
    headers = await _auth(client, "fixture-failure")
    response = await _fixture(client, headers, "processing-failure")
    assert response.status_code == 503
    # A genuine failure, so the UI's failure surface is exercised rather than a
    # progress bar that quietly stops advancing.
    assert "JOB_IMPORT_PROCESSING_FAILED" in response.text


@pytest.mark.anyio
async def test_unknown_scenarios_are_refused(client: AsyncClient) -> None:
    headers = await _auth(client, "fixture-unknown")
    response = await _fixture(client, headers, "not-a-real-scenario")
    assert response.status_code == 400


@pytest.mark.anyio
async def test_the_fixture_route_requires_authentication(client: AsyncClient) -> None:
    response = await client.post("/api/v1/dev/job-import-review?scenario=clean-import&fresh=true")
    assert response.status_code in {401, 403}


@pytest.mark.anyio
async def test_fixtures_are_owner_private(client: AsyncClient) -> None:
    owner_headers = await _auth(client, "fixture-owner")
    created = await _fixture(client, owner_headers, "clean-import")
    draft_id = UUID(created.json()["draft"]["id"])

    intruder_headers = await _auth(client, "fixture-intruder")
    response = await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=intruder_headers)
    assert response.status_code == 404


@pytest.mark.anyio
async def test_clean_import_hands_off_without_blank_optional_questions(
    client: AsyncClient,
) -> None:
    headers = await _auth(client, "fixture-clean-conversation")
    created = await _fixture(client, headers, "clean-import")
    assert created.status_code == 200, created.text
    draft_id = created.json()["draft"]["id"]

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text
    assert begun.json()["ready_for_draft"] is True
    assert begun.json()["active_question"] is None
    assert begun.json()["phase"] == "complete"


@pytest.mark.anyio
async def test_checkpoint_fixtures_stop_on_a_question(client: AsyncClient) -> None:
    """The checkpoint scenarios exist to be seen paused, so they must pause."""

    headers = await _auth(client, "fixture-checkpoint")
    for scenario in (
        "checkpoint-currency",
        "checkpoint-trial",
        "checkpoint-experience",
    ):
        created = await _fixture(client, headers, scenario)
        assert created.status_code == 200, created.text
        draft_id = created.json()["draft"]["id"]

        begun = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
        assert begun.status_code == 200, begun.text
        body = begun.json()
        assert body["waiting"] is True, scenario
        assert body["active_question"] is not None, scenario
        # Exactly one question, never a list.
        assert isinstance(body["active_question"], dict), scenario
