from __future__ import annotations

from datetime import UTC, datetime

from conftest import google_id_token_for_test
from httpx import AsyncClient

from app.core import config


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


async def test_development_fixture_uses_owned_private_review_pipeline(
    client: AsyncClient,
) -> None:
    owner = await _auth(client, "dev-import-review-owner")
    other = await _auth(client, "dev-import-review-other")

    response = await client.post("/api/v1/dev/job-import-review", headers=owner)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] is True
    draft = body["draft"]
    assert draft["processing_status"] == "ready_to_apply"
    assert draft["can_publish_directly"] is False
    assert draft["target_job_id"] is None
    assert draft["provider_name"] == "development_fixture"

    fields = {item["field_path"]: item for item in draft["fields"]}
    assert fields["title"]["provenance_state"] == "extracted_from_source"
    assert fields["title"]["authority_state"] == "prefilled_by_import"
    assert fields["primary_role_key"]["provenance_state"] == "suggested_inference"
    assert fields["budget_amount"]["provenance_state"] == "conflicting_source_values"
    assert len(fields["budget_amount"]["conflicting_values"]) == 2
    assert fields["work_mode"]["provenance_state"] == "conflicting_source_values"
    assert fields["expected_weekly_hours_min"]["provenance_state"] == "missing"
    assert fields["application_mode"]["provenance_state"] == "missing"
    assert fields["deadline_at"]["provenance_state"] == "missing"

    resolved = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/budget_amount/resolve",
        headers=owner,
        json={"selected_value_index": 0},
    )
    assert resolved.status_code == 200, resolved.text
    current = resolved.json()
    for field in current["fields"]:
        if (
            field["provenance_state"] not in {"missing", "conflicting_source_values"}
            and field["review_status"] == "pending"
        ):
            reviewed = await client.patch(
                (f"/api/v1/job-imports/drafts/{draft['id']}/fields/{field['field_path']}"),
                headers=owner,
                json={"action": "accept"},
            )
            assert reviewed.status_code == 200, reviewed.text
            current = reviewed.json()
    assert current["can_apply_to_native_draft"] is True

    applied = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=owner,
        json={"mode": "create_new"},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["job"]["status"] == "draft"
    assert applied.json()["created"] is True

    applied_again = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/apply",
        headers=owner,
        json={"mode": "create_new"},
    )
    assert applied_again.status_code == 200
    assert applied_again.json()["created"] is False
    assert applied_again.json()["job"]["id"] == applied.json()["job"]["id"]

    resolved_after_apply = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/fields/work_mode/resolve",
        headers=owner,
        json={"selected_value_index": 0},
    )
    assert resolved_after_apply.status_code == 200, resolved_after_apply.text
    resolved_work_mode = next(
        field
        for field in resolved_after_apply.json()["fields"]
        if field["field_path"] == "work_mode"
    )
    assert resolved_work_mode["effective_value"] == "remote"
    assert resolved_work_mode["review_status"] == "confirmed"

    duplicate = await client.post("/api/v1/dev/job-import-review", headers=owner)
    assert duplicate.status_code == 200
    assert duplicate.json()["created"] is False
    assert duplicate.json()["draft"]["id"] == draft["id"]

    cross_account = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=other,
    )
    assert cross_account.status_code == 404

    public_jobs = await client.get("/api/v1/jobs")
    assert public_jobs.status_code == 200
    serialized = public_jobs.text
    assert draft["id"] not in serialized
    assert "development_fixture" not in serialized


async def test_development_fixture_is_unavailable_in_production(
    client: AsyncClient,
    monkeypatch,
) -> None:
    owner = await _auth(client, "dev-import-production-gate")
    monkeypatch.setattr(config.settings, "app_env", "production")
    response = await client.post("/api/v1/dev/job-import-review", headers=owner)
    assert response.status_code == 404


async def test_development_guidance_scenarios_are_provider_free_and_role_varied(
    client: AsyncClient,
) -> None:
    thumbnail_owner = await _auth(client, "dev-import-thumbnail-owner")
    thumbnail = await client.post(
        "/api/v1/dev/job-import-review?scenario=thumbnail-designer",
        headers=thumbnail_owner,
    )
    assert thumbnail.status_code == 200, thumbnail.text
    thumbnail_body = thumbnail.json()
    thumbnail_fields = {
        item["field_path"]: item for item in thumbnail_body["draft"]["fields"]
    }
    assert thumbnail_fields["title"]["effective_value"].startswith("Thumbnail designer")
    assert thumbnail_fields["primary_role_key"]["proposed_value"] == "thumbnail-designer"
    assert thumbnail_fields["deliverables"]["effective_value"] == [
        {"type": "thumbnail", "quantity": 3, "frequency": "per_week"}
    ]
    assert thumbnail_fields["source_inputs"]["review_status"] == "confirmed"
    assert thumbnail_fields["revision_policy"]["provenance_state"] == "missing"
    assert thumbnail_fields["reference_videos"]["provenance_state"] == "missing"
    assert thumbnail_body["draft"]["provider_name"] == "development_fixture"
    assert thumbnail_body["draft"]["provider_metadata"]["scenario"] == "thumbnail-designer"

    clean_owner = await _auth(client, "dev-import-clean-owner")
    clean = await client.post(
        "/api/v1/dev/job-import-review?scenario=clean-import",
        headers=clean_owner,
    )
    assert clean.status_code == 200, clean.text
    clean_body = clean.json()
    clean_fields = {item["field_path"]: item for item in clean_body["draft"]["fields"]}
    assert clean_fields["primary_role_key"]["effective_value"] == "content-strategist"
    assert clean_fields["creative_autonomy"]["effective_value"] == "own_creative_approach"
    assert clean_fields["source_inputs"]["review_status"] == "confirmed"
    assert clean_fields["source_inputs"]["effective_value"] == [
        {"type": "creative_brief"}
    ]
    assert clean_fields["trial_status"]["effective_value"] == "none"
    assert clean_body["draft"]["processing_status"] == "ready_to_apply"
    assert clean_body["draft"]["provider_metadata"]["scenario"] == "clean-import"

    fresh = await client.post(
        "/api/v1/dev/job-import-review?scenario=strong-decisions&fresh=true",
        headers=clean_owner,
    )
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["created"] is True


async def test_development_processing_failure_is_separate_from_normal_uncertainty(
    client: AsyncClient,
) -> None:
    owner = await _auth(client, "dev-import-failure-owner")
    response = await client.post(
        "/api/v1/dev/job-import-review?scenario=processing-failure",
        headers=owner,
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "JOB_IMPORT_PROCESSING_FAILED"


async def test_unknown_development_import_scenario_is_rejected(
    client: AsyncClient,
) -> None:
    owner = await _auth(client, "dev-import-unknown-owner")
    response = await client.post(
        "/api/v1/dev/job-import-review?scenario=unknown",
        headers=owner,
    )
    assert response.status_code == 400
