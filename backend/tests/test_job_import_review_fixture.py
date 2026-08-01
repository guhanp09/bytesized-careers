from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient

from app.core import config


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
