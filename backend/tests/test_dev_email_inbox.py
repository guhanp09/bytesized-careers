from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from httpx import AsyncClient

from app.core.config import settings


def _token_from_frontend_link(link: str) -> str:
    parsed = urlparse(link)
    token = parse_qs(parsed.query).get("token", [""])[0]
    assert token
    return token


async def test_dev_email_inbox_captures_verification_and_password_reset(client: AsyncClient) -> None:
    await client.delete("/api/v1/dev/emails")

    email = "dev-inbox@example.com"
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "supersecure123", "username": "dev_inbox_user"},
    )
    assert register.status_code == 200

    inbox = await client.get("/api/v1/dev/emails")
    assert inbox.status_code == 200
    emails = inbox.json()["items"]
    verification_email = emails[0]
    assert verification_email["to"] == email
    assert verification_email["type"] == "verification"
    assert verification_email["subject"] == "Verify your CreatorJobs email"
    assert verification_email["actionUrl"].startswith("http://localhost:3000/auth/verify?token=")
    assert "Verify your CreatorJobs account" in verification_email["preview"]

    cleared_after_signup = await client.delete("/api/v1/dev/emails")
    assert cleared_after_signup.status_code == 200

    resend = await client.post("/api/v1/auth/resend-verification", json={"email": email})
    assert resend.status_code == 200

    resend_inbox = await client.get("/api/v1/dev/emails")
    assert resend_inbox.status_code == 200
    resend_email = resend_inbox.json()["items"][0]
    assert resend_email["to"] == email
    assert resend_email["type"] == "verification"
    assert resend_email["actionUrl"].startswith("http://localhost:3000/auth/verify?token=")

    verify = await client.post(
        "/api/v1/auth/verify-email",
        json={"token": _token_from_frontend_link(resend_email["actionUrl"])},
    )
    assert verify.status_code == 200

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "supersecure123"},
    )
    assert login.status_code == 200
    assert login.json()["access_token"]

    reset = await client.post("/api/v1/auth/password-reset/request", json={"email": email})
    assert reset.status_code == 200

    updated_inbox = await client.get("/api/v1/dev/emails")
    assert updated_inbox.status_code == 200
    reset_email = updated_inbox.json()["items"][0]
    assert reset_email["to"] == email
    assert reset_email["type"] == "password_reset"
    assert reset_email["subject"] == "Reset your CreatorJobs password"
    assert reset_email["actionUrl"].startswith("http://localhost:3000/auth/reset?token=")
    assert "Reset your CreatorJobs password" in reset_email["preview"]

    cleared = await client.delete("/api/v1/dev/emails")
    assert cleared.status_code == 200
    assert cleared.json() == {"ok": True}
    empty = await client.get("/api/v1/dev/emails")
    assert empty.json()["items"] == []


async def test_dev_email_inbox_is_not_available_in_production(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")

    response = await client.get("/api/v1/dev/emails")

    assert response.status_code == 404
