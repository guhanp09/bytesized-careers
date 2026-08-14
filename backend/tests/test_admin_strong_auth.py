from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import select

from app.core.auth_assurance import has_fresh_strong_auth
from app.core.security import SESSION_ID_CLAIM, create_access_token, decode_access_token
from app.models import AuthSession
from app.services import auth_service


async def _seeded_admin_login(client: AsyncClient) -> dict[str, object]:
    await client.post("/api/v1/dev/seed", json={"scenario": "personas"})
    personas = (await client.get("/api/v1/dev/personas")).json()
    email = next(
        item["email"] for item in personas["personas"] if item["key"] == "admin"
    )
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": personas["password"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_strong_auth_assurance_is_supported_current_and_policy_bounded() -> None:
    now = datetime(2026, 8, 14, 12, 0, tzinfo=UTC)
    verified_at = now - timedelta(minutes=5)
    expires_at = now + timedelta(minutes=5)

    for method in ("totp", "webauthn", "recovery_code"):
        assert has_fresh_strong_auth(
            method=method,
            verified_at=verified_at,
            expires_at=expires_at,
            max_age_minutes=15,
            now=now,
        )

    assert not has_fresh_strong_auth(
        method="jwt_claim",
        verified_at=verified_at,
        expires_at=expires_at,
        max_age_minutes=15,
        now=now,
    )
    assert not has_fresh_strong_auth(
        method="totp",
        verified_at=None,
        expires_at=expires_at,
        max_age_minutes=15,
        now=now,
    )
    assert not has_fresh_strong_auth(
        method="totp",
        verified_at=now + timedelta(seconds=1),
        expires_at=now + timedelta(minutes=5),
        max_age_minutes=15,
        now=now,
    )
    assert not has_fresh_strong_auth(
        method="totp",
        verified_at=now - timedelta(minutes=16),
        expires_at=now + timedelta(hours=1),
        max_age_minutes=15,
        now=now,
    )


async def test_admin_gate_ignores_claims_and_requires_fresh_database_assurance(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    monkeypatch.setattr(auth_service.settings, "admin_strong_auth_required", True)
    monkeypatch.setattr(
        auth_service.settings,
        "admin_strong_auth_max_age_minutes",
        15,
    )
    login = await _seeded_admin_login(client)
    access_token = str(login["access_token"])
    claims = decode_access_token(access_token)
    session_id = UUID(claims[SESSION_ID_CLAIM])
    user_id = str(login["user"]["id"])

    denied = await client.get("/api/v1/admin/overview", headers=_auth(access_token))
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "http_403"
    assert (
        denied.json()["error"]["message"]
        == "Administrator strong authentication required"
    )
    assert "insufficient_user_authentication" in denied.headers["www-authenticate"]
    assert (await client.get("/api/v1/me", headers=_auth(access_token))).status_code == 403

    forged_claim = create_access_token(
        user_id,
        additional_claims={
            SESSION_ID_CLAIM: str(session_id),
            "amr": ["mfa"],
            "acr": "urn:creatorjobs:strong",
        },
    )
    assert (
        await client.get("/api/v1/admin/overview", headers=_auth(forged_claim))
    ).status_code == 403

    now = datetime.now(UTC)
    async with TestSessionLocal() as session:
        auth_session = await session.get(AuthSession, session_id)
        assert auth_session is not None
        auth_session.strong_auth_method = "totp"
        auth_session.strong_auth_verified_at = now
        auth_session.strong_auth_expires_at = now + timedelta(minutes=30)
        await session.commit()

    allowed = await client.get("/api/v1/admin/overview", headers=_auth(access_token))
    assert allowed.status_code == 200, allowed.text
    assert (await client.get("/api/v1/me", headers=_auth(access_token))).status_code == 200

    async with TestSessionLocal() as session:
        auth_session = await session.get(AuthSession, session_id)
        assert auth_session is not None
        auth_session.strong_auth_verified_at = now - timedelta(minutes=16)
        auth_session.strong_auth_expires_at = now + timedelta(hours=1)
        await session.commit()

    policy_expired = await client.get(
        "/api/v1/admin/overview",
        headers=_auth(access_token),
    )
    assert policy_expired.status_code == 403


async def test_admin_base_auth_can_still_revoke_all_sessions(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    monkeypatch.setattr(auth_service.settings, "admin_strong_auth_required", True)
    login = await _seeded_admin_login(client)
    access_token = str(login["access_token"])
    user_id = UUID(str(login["user"]["id"]))

    async with TestSessionLocal() as session:
        active_sessions = list(
            (
                await session.scalars(
                    select(AuthSession).where(
                        AuthSession.user_id == user_id,
                        AuthSession.revoked_at.is_(None),
                    )
                )
            ).all()
        )
    assert active_sessions

    response = await client.post(
        "/api/v1/auth/logout-all",
        headers=_auth(access_token),
    )

    assert response.status_code == 200, response.text
    assert response.json()["revoked_sessions"] == len(active_sessions)
    assert (await client.get("/api/v1/me", headers=_auth(access_token))).status_code == 401


async def test_non_admin_sessions_do_not_require_administrator_assurance(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    monkeypatch.setattr(auth_service.settings, "admin_strong_auth_required", True)
    email = "ordinary-assurance-user@example.com"
    password = "ordinary-password"
    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "username": "ordinary_assure",
        },
    )
    assert registered.status_code == 200
    verification_token = registered.json()["verification_url"].rsplit("token=", 1)[-1]
    assert (
        await client.post(
            "/api/v1/auth/verify-email",
            json={"token": verification_token},
        )
    ).status_code == 200
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login.status_code == 200

    access_token = login.json()["access_token"]
    assert (await client.get("/api/v1/me", headers=_auth(access_token))).status_code == 200
    assert (
        await client.get("/api/v1/admin/overview", headers=_auth(access_token))
    ).status_code == 403
