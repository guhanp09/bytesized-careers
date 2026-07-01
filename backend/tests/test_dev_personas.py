from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core import config

PERSONAS_URL = "/api/v1/dev/personas"
STATUS_URL = "/api/v1/dev/status"
SEED_URL = "/api/v1/dev/seed"
RESET_URL = "/api/v1/dev/reset"


async def test_dev_routes_are_404_in_production(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.settings, "app_env", "production")

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
    # Baseline is recreated: all 8 personas exist again after the wipe.
    assert result["recreated"]["personas"]["users"]["inserted"] == 8

    # And a persona still logs in after a reset round-trip.
    personas = (await client.get(PERSONAS_URL)).json()
    recruiter_email = next(p["email"] for p in personas["personas"] if p["key"] == "recruiter-active")
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": recruiter_email, "password": personas["password"]},
    )
    assert login.status_code == 200
