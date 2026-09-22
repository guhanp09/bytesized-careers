from __future__ import annotations

import pytest
from conftest import TestSessionLocal
from httpx import AsyncClient

from app.core import config
from app.db import seed_data_personas
from app.models import HiringIdentity

PERSONAS_URL = "/api/v1/dev/personas"
STATUS_URL = "/api/v1/dev/status"
SEED_URL = "/api/v1/dev/seed"
RESET_URL = "/api/v1/dev/reset"


async def test_dev_routes_are_404_in_production(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.settings, "app_env", "production")
    # The ASGI middleware stack is built lazily on this first request. Supply
    # the independent production admission bound so this test reaches the dev
    # route gates it is meant to prove instead of failing during stack setup.
    monkeypatch.setattr(config.settings, "max_concurrent_http_requests", 20)

    assert (await client.get(PERSONAS_URL)).status_code == 404
    assert (await client.get(STATUS_URL)).status_code == 404
    assert (await client.post(SEED_URL, json={"scenario": "full_demo"})).status_code == 404
    assert (await client.post(RESET_URL, json={"confirm": True})).status_code == 404


async def test_personas_list_seeds_and_persona_can_log_in(client: AsyncClient) -> None:
    # The test suite runs with APP_ENV=test, so the dev routes are enabled.
    listing = await client.get(PERSONAS_URL)
    assert listing.status_code == 200
    body = listing.json()
    assert len(body["personas"]) == 8
    assert body["password"]
    keys = {persona["key"] for persona in body["personas"]}
    assert {"new-empty", "talent-complete", "recruiter-active", "admin", "notifications"} <= keys

    seeded = await client.post(SEED_URL, json={"scenario": "full_demo"})
    assert seeded.status_code == 200
    assert seeded.json()["scenario"] == "full_demo"

    # A seeded persona is a real, verified account that logs in with the dev password.
    talent_email = next(p["email"] for p in body["personas"] if p["key"] == "talent-complete")
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": talent_email, "password": body["password"]},
    )
    assert login.status_code == 200
    assert login.json()["access_token"]

    status = await client.get(STATUS_URL)
    assert status.status_code == 200
    status_body = status.json()
    assert status_body["env"] == "test"
    assert status_body["personaCount"] == 8


async def _login(client: AsyncClient, key: str) -> tuple[str, str]:
    body = (await client.get(PERSONAS_URL)).json()
    email = next(p["email"] for p in body["personas"] if p["key"] == key)
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": body["password"]})
    assert login.status_code == 200, login.text
    return email, login.json()["access_token"]


async def test_persona_relationship_data_serializes_through_read_schemas(client: AsyncClient) -> None:
    # Seed first, then read every persona surface that runs rows through a Pydantic
    # read model. This guards against seeded enum values (application/interest status)
    # that the model rejects — a failure only visible when the lists are fetched.
    assert (await client.post(SEED_URL, json={"scenario": "full_demo"})).status_code == 200

    recruiter_profile = await client.get("/api/v1/users/dev_recruiter/public-profile")
    assert recruiter_profile.status_code == 200, recruiter_profile.text
    assert recruiter_profile.json()["reviews_by_mode"]["hiring"]["summary"]["review_count"] == 1

    talent_profile = await client.get("/api/v1/users/dev_notify/public-profile")
    assert talent_profile.status_code == 200, talent_profile.text
    talent_reviews = talent_profile.json()["reviews_by_mode"]["talent"]
    assert talent_reviews["summary"]["review_count"] == 2
    assert "Former collaborator" in {item["reviewer_name"] for item in talent_reviews["items"]}

    _, recruiter_token = await _login(client, "recruiter-active")
    recruiter_headers = {"Authorization": f"Bearer {recruiter_token}"}
    received = await client.get("/api/v1/me/applications/received", headers=recruiter_headers)
    assert received.status_code == 200, received.text
    assert len(received.json()) >= 2
    assert {"new", "shortlisted", "rejected"} & {a["status"] for a in received.json()}
    assert (await client.get("/api/v1/me/talent-interests/sent", headers=recruiter_headers)).status_code == 200
    assert (await client.get("/api/v1/me/saved/summary", headers=recruiter_headers)).status_code == 200

    _, talent_token = await _login(client, "talent-complete")
    talent_headers = {"Authorization": f"Bearer {talent_token}"}
    assert (await client.get("/api/v1/me/applications/sent", headers=talent_headers)).status_code == 200
    received_interests = await client.get("/api/v1/me/talent-interests", headers=talent_headers)
    assert received_interests.status_code == 200, received_interests.text
    # recruiter-active → talent-complete is intentionally not seeded (the workflow
    # tester creates it fresh), so the seeded baseline is the both-sides request.
    assert len(received_interests.json()) >= 1
    # The aggregate activity summary touches applications + interests in one read.
    assert (await client.get("/api/v1/me/activity/summary", headers=talent_headers)).status_code == 200


async def test_seeded_recruiter_identities_use_the_live_identity_contract(client: AsyncClient) -> None:
    assert (await client.post(SEED_URL, json={"scenario": "full_demo"})).status_code == 200

    _, direct_token = await _login(client, "recruiter-active")
    direct_response = await client.get(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {direct_token}"},
    )
    assert direct_response.status_code == 200, direct_response.text
    direct = direct_response.json()["items"]
    assert len(direct) == 1
    assert direct[0]["display_name"] == "Finance Simplified"
    assert direct[0]["type"] == "INDIVIDUAL_CHANNEL"
    assert direct[0]["platform"] == "YOUTUBE"
    assert direct[0]["verification_method"] == "MANUAL_ADMIN_REVIEW"
    assert direct[0]["verification_status"] == "VERIFIED"

    _, agency_token = await _login(client, "recruiter-drafts")
    agency_response = await client.get(
        "/api/v1/me/hiring-identities",
        headers={"Authorization": f"Bearer {agency_token}"},
    )
    assert agency_response.status_code == 200, agency_response.text
    agency = agency_response.json()["items"]
    assert {item["display_name"] for item in agency} == {
        "Science Daily",
        "Science Daily IG (agency)",
        "FitLab",
    }
    assert all(item["type"] == "AGENCY_REPRESENTED_CHANNEL" for item in agency)
    assert all(item["verification_method"] == "VERIFICATION_CODE" for item in agency)
    assert next(item for item in agency if item["display_name"] == "FitLab")["verification_status"] == "VERIFIED"

    public_response = await client.get("/api/v1/users/dev_brightlab/public-profile")
    assert public_response.status_code == 200, public_response.text
    assert [item["name"] for item in public_response.json()["represented_channels"]] == ["FitLab"]


async def test_reseeding_repairs_only_legacy_persona_identity_enums(client: AsyncClient) -> None:
    assert (await client.post(SEED_URL, json={"scenario": "full_demo"})).status_code == 200
    agency_identity_id = seed_data_personas.persona_uuid("identity:recruiter-drafts-verified")
    async with TestSessionLocal() as session:
        identity = await session.get(HiringIdentity, agency_identity_id)
        assert identity is not None
        original_status = identity.verification_status
        original_description = identity.description
        identity.type = "represented"
        identity.platform = "youtube"
        identity.verification_method = "CODE_IN_DESCRIPTION"
        identity.verification_status = "PENDING"
        identity.description = "Local edit preserved across reseeding"
        await session.commit()

    try:
        reseeded = await client.post(SEED_URL, json={"scenario": "full_demo"})
        assert reseeded.status_code == 200, reseeded.text
        assert reseeded.json()["result"]["personas"]["hiring_identities"]["updated"] == 1

        async with TestSessionLocal() as session:
            identity = await session.get(HiringIdentity, agency_identity_id)
            assert identity is not None
            assert identity.type == "AGENCY_REPRESENTED_CHANNEL"
            assert identity.platform == "YOUTUBE"
            assert identity.verification_method == "VERIFICATION_CODE"
            assert identity.verification_status == "PENDING"
            assert identity.description == "Local edit preserved across reseeding"

        _, agency_token = await _login(client, "recruiter-drafts")
        listed = await client.get(
            "/api/v1/me/hiring-identities",
            headers={"Authorization": f"Bearer {agency_token}"},
        )
        assert listed.status_code == 200, listed.text
        second = await client.post(SEED_URL, json={"scenario": "full_demo"})
        assert second.status_code == 200, second.text
        assert second.json()["result"]["personas"]["hiring_identities"]["updated"] == 0
    finally:
        async with TestSessionLocal() as session:
            identity = await session.get(HiringIdentity, agency_identity_id)
            assert identity is not None
            identity.type = "AGENCY_REPRESENTED_CHANNEL"
            identity.platform = "YOUTUBE"
            identity.verification_method = "VERIFICATION_CODE"
            identity.verification_status = original_status
            identity.description = original_description
            await session.commit()


async def test_persona_seed_includes_current_first_message_answers(client: AsyncClient) -> None:
    assert (await client.post(SEED_URL, json={"scenario": "full_demo"})).status_code == 200
    legacy_keys = {"portfolio_link", "rate_expectation"}

    _, recruiter_token = await _login(client, "recruiter-active")
    recruiter_headers = {"Authorization": f"Bearer {recruiter_token}"}
    received = await client.get("/api/v1/me/applications/received", headers=recruiter_headers)
    assert received.status_code == 200
    applications = received.json()
    structured_apps = [app for app in applications if app["first_message_answers"]]
    assert structured_apps
    for app in structured_apps:
        answers = app["first_message_answers"]
        assert not (legacy_keys & set(answers))
        assert any(key in answers for key in ("expected_rate", "relevant_portfolio", "turnaround"))

    _, talent_token = await _login(client, "talent-complete")
    talent_headers = {"Authorization": f"Bearer {talent_token}"}
    interests = await client.get("/api/v1/me/talent-interests", headers=talent_headers)
    assert interests.status_code == 200
    structured_interests = [interest for interest in interests.json() if interest["first_message_answers"]]
    assert structured_interests
    for interest in structured_interests:
        answers = interest["first_message_answers"]
        assert "project_budget" in answers
        assert "project_brief" in answers
        assert not (legacy_keys & set(answers))


async def test_seed_rejects_unknown_scenario(client: AsyncClient) -> None:
    response = await client.post(SEED_URL, json={"scenario": "does-not-exist"})
    assert response.status_code == 400


async def test_reset_requires_confirmation_and_recreates_baseline(client: AsyncClient) -> None:
    rejected = await client.post(RESET_URL, json={"confirm": False})
    assert rejected.status_code == 400

    confirmed = await client.post(RESET_URL, json={"confirm": True})
    assert confirmed.status_code == 200
    result = confirmed.json()["result"]
    assert result["status"] == "reset"
    # Baseline is recreated: switchable personas and non-switchable QA fixtures
    # exist again after the wipe.
    assert result["recreated"]["personas"]["users"]["inserted"] == len(
        seed_data_personas.build_persona_users()
    )

    # And a persona still logs in after a reset round-trip.
    personas = (await client.get(PERSONAS_URL)).json()
    recruiter_email = next(p["email"] for p in personas["personas"] if p["key"] == "recruiter-active")
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": recruiter_email, "password": personas["password"]},
    )
    assert login.status_code == 200
