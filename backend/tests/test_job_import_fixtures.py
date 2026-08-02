"""Development fixtures for the draft assistant.

These exist so the whole experience can be inspected without spending provider
credits. The tests below check two things: that each scenario really produces
the state it advertises, and that the fixture route stays development-only.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
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
            "email": f"{label}@example.com",
            "provider_account_id": f"google-{label}",
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
        if scenario not in IN_FLIGHT_IMPORT_SCENARIOS
        and scenario != "processing-failure"
    }
    assert processed == {
        "strong-decisions",
        "thumbnail-designer",
        "scriptwriter",
        "clean-import",
        "checkpoint-currency",
        "checkpoint-trial",
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
        "checkpoint-currency",
        "checkpoint-trial",
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
        # No machine output yet, so the assistant has nothing to review — which
        # is exactly the state an early question is supposed to fill.
        assert draft["fields"] == [], scenario
        assert draft["early_question_fields"], scenario


@pytest.mark.anyio
async def test_the_resume_scenario_ships_with_an_answer_already_saved(
    client: AsyncClient,
) -> None:
    headers = await _auth(client, "fixture-resume")
    response = await _fixture(client, headers, "refresh-resume")
    assert response.status_code == 200, response.text
    draft = response.json()["draft"]

    # A refresh has something to restore, and it came from the server.
    assert draft["recruiter_prefill"] == {"employer_context_type": "agency"}
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
    response = await client.post(
        "/api/v1/dev/job-import-review?scenario=clean-import&fresh=true"
    )
    assert response.status_code in {401, 403}


@pytest.mark.anyio
async def test_fixtures_are_owner_private(client: AsyncClient) -> None:
    owner_headers = await _auth(client, "fixture-owner")
    created = await _fixture(client, owner_headers, "clean-import")
    draft_id = UUID(created.json()["draft"]["id"])

    intruder_headers = await _auth(client, "fixture-intruder")
    response = await client.get(
        f"/api/v1/job-imports/drafts/{draft_id}", headers=intruder_headers
    )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_checkpoint_fixtures_stop_on_a_question(client: AsyncClient) -> None:
    """The checkpoint scenarios exist to be seen paused, so they must pause."""

    headers = await _auth(client, "fixture-checkpoint")
    for scenario in ("checkpoint-currency", "checkpoint-trial"):
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
