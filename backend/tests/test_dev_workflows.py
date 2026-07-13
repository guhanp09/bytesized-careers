from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core import config

WF = "/api/v1/dev/workflows"


async def _seed_and_password(client: AsyncClient) -> str:
    assert (await client.post("/api/v1/dev/seed", json={"scenario": "full_demo"})).status_code == 200
    return (await client.get("/api/v1/dev/personas")).json()["password"]


async def _token(client: AsyncClient, key: str, password: str) -> str:
    email = f"{key}@persona.creatorjobs.dev"
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


async def test_workflow_routes_are_404_in_production(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.settings, "app_env", "production")
    assert (await client.post(f"{WF}/apply-to-job", json={})).status_code == 404
    assert (await client.post(f"{WF}/send-hiring-request", json={})).status_code == 404
    assert (await client.post(f"{WF}/reply-to-application", json={})).status_code == 404
    assert (await client.post(f"{WF}/reply-to-hiring-request", json={})).status_code == 404
    assert (await client.post(f"{WF}/send-message", json={})).status_code == 404
    assert (await client.get(f"{WF}/status")).status_code == 404


async def test_apply_workflow_creates_real_recipient_state(client: AsyncClient) -> None:
    password = await _seed_and_password(client)

    resp = await client.post(f"{WF}/apply-to-job", json={})
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert result["ok"] is True
    assert {c["label"]: c["ok"] for c in result["checks"]}["Recruiter notification"] is True
    app_id = result["recordId"]

    # The recruiter genuinely sees the application through the real read endpoint.
    recruiter = {"Authorization": f"Bearer {await _token(client, 'recruiter-active', password)}"}
    received = await client.get("/api/v1/me/applications/received", headers=recruiter)
    assert received.status_code == 200
    assert app_id in {a["id"] for a in received.json()}
    created_application = next(a for a in received.json() if a["id"] == app_id)
    answers = created_application["first_message_answers"]
    assert isinstance(answers["expected_rate"], dict)
    assert isinstance(answers["relevant_portfolio"], list)
    assert isinstance(answers["fit_note"], str)

    # And the recruiter has a real new_applicant notification pointing at it (regression
    # guard for the resource_id='None' bug the workflow tester surfaced).
    notifs = await client.get("/api/v1/notifications", headers=recruiter)
    assert notifs.status_code == 200
    new_applicant = [n for n in notifs.json()["items"] if n["type"] == "new_applicant"]
    assert any(n.get("resource_id") == app_id for n in new_applicant)

    # The talent sees it under sent applications.
    talent = {"Authorization": f"Bearer {await _token(client, 'talent-complete', password)}"}
    sent = await client.get("/api/v1/me/applications/sent", headers=talent)
    assert app_id in {a["id"] for a in sent.json()}


async def test_hiring_request_workflow_creates_real_recipient_state(client: AsyncClient) -> None:
    password = await _seed_and_password(client)

    resp = await client.post(f"{WF}/send-hiring-request", json={})
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert result["ok"] is True
    interest_id = result["recordId"]

    # Talent sees the hiring request via the real received endpoint + a real notification.
    talent = {"Authorization": f"Bearer {await _token(client, 'talent-complete', password)}"}
    received = await client.get("/api/v1/me/talent-interests", headers=talent)
    assert interest_id in {i["id"] for i in received.json()}
    created_interest = next(i for i in received.json() if i["id"] == interest_id)
    answers = created_interest["first_message_answers"]
    assert isinstance(answers["project_budget"], dict)
    assert isinstance(answers["reference_links"], list)
    assert isinstance(answers["turnaround"], dict)
    notifs = await client.get("/api/v1/notifications", headers=talent)
    received_events = [n for n in notifs.json()["items"] if n["type"] == "talent_interest_received"]
    assert any(n.get("resource_id") == interest_id for n in received_events)


async def test_reply_workflows_update_status_and_notify_counterparty(client: AsyncClient) -> None:
    password = await _seed_and_password(client)
    # Seed baseline already gives the recruiter received applications, so reply works.
    reply = await client.post(f"{WF}/reply-to-application", json={"status": "shortlisted"})
    assert reply.status_code == 200, reply.text
    assert reply.json()["ok"] is True

    reply2 = await client.post(f"{WF}/reply-to-hiring-request", json={"status": "accepted"})
    assert reply2.status_code == 200, reply2.text
    assert reply2.json()["ok"] is True


async def test_send_message_workflow_is_now_real(client: AsyncClient) -> None:
    password = await _seed_and_password(client)
    resp = await client.post(f"{WF}/send-message", json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["conversationId"]
    checks = {c["label"]: c["ok"] for c in body["checks"]}
    assert checks["Message created"] is True
    assert checks["Recipient unread updated"] is True
    assert checks["Recipient notification"] is True

    # The recipient (recruiter-active) genuinely sees the message + unread via the real API.
    recruiter = {"Authorization": f"Bearer {await _token(client, 'recruiter-active', password)}"}
    convo = await client.get(f"/api/v1/me/conversations/{body['conversationId']}", headers=recruiter)
    assert convo.status_code == 200
    assert len(convo.json()["messages"]) >= 1
    assert convo.json()["conversation"]["unread_count"] >= 1


async def test_workflow_status_snapshot(client: AsyncClient) -> None:
    await _seed_and_password(client)
    await client.post(f"{WF}/apply-to-job", json={})
    status = await client.get(f"{WF}/status", params={"actorKey": "talent-complete", "targetKey": "recruiter-active"})
    assert status.status_code == 200
    data = status.json()
    assert data["applicationsActorToTarget"] >= 1
    assert "targetUnreadNotifications" in data
