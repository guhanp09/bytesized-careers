from __future__ import annotations

import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from conftest import TestSessionLocal, google_id_token_for_test
from httpx import AsyncClient
from sqlalchemy import select

from app.core.security import (
    SESSION_ID_CLAIM,
    SESSION_TOKEN_VERSION_CLAIM,
    TOKEN_ID_CLAIM,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    hash_password,
    hash_refresh_token,
)
from app.models import AuthRefreshCredential, AuthSession, User
from app.services import auth_service

PASSWORD = "session-security-password"


def test_auth_repository_is_importable_before_the_services_package() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from app.repositories.auth_repository import AuthRepository; "
                "from app.services.auth_service import AuthService"
            ),
        ],
        cwd=backend_root,
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr


async def _create_verified_user(*, suspended: bool = False) -> User:
    unique = uuid4().hex
    async with TestSessionLocal() as session:
        user = User(
            email=f"auth-session-{unique}@example.com",
            username=f"sess_{unique[:12]}",
            password_hash=hash_password(PASSWORD),
            email_verified_at=datetime.now(UTC),
            suspended_at=datetime.now(UTC) if suspended else None,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def _login(client: AsyncClient, user: User):
    return await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": PASSWORD},
    )


async def _load_session_and_credential(
    refresh_token: str,
) -> tuple[AuthSession, AuthRefreshCredential]:
    token_hash = hash_refresh_token(refresh_token)
    async with TestSessionLocal() as session:
        credential = (
            await session.execute(
                select(AuthRefreshCredential).where(
                    AuthRefreshCredential.token_hash == token_hash
                )
            )
        ).scalar_one()
        auth_session = (
            await session.execute(
                select(AuthSession).where(AuthSession.id == credential.session_id)
            )
        ).scalar_one()
        return auth_session, credential


async def test_persistent_login_stores_only_refresh_digest_and_binds_tokens(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    user = await _create_verified_user()

    response = await _login(client, user)

    assert response.status_code == 200
    body = response.json()
    refresh_token = body["refresh_token"]
    refresh_claims = decode_refresh_token(refresh_token)
    access_claims = decode_access_token(body["access_token"])
    auth_session, credential = await _load_session_and_credential(refresh_token)

    assert refresh_claims[SESSION_TOKEN_VERSION_CLAIM] == 1
    assert UUID(refresh_claims[SESSION_ID_CLAIM]) == auth_session.id
    assert UUID(refresh_claims[TOKEN_ID_CLAIM]) == credential.id
    assert access_claims[SESSION_ID_CLAIM] == refresh_claims[SESSION_ID_CLAIM]
    assert auth_session.user_id == user.id
    assert auth_session.authentication_method == "password"
    assert auth_session.revoked_at is None
    assert credential.token_hash == hash_refresh_token(refresh_token)
    assert credential.token_hash != refresh_token
    assert len(credential.token_hash) == 64
    assert credential.used_at is None


async def test_persistent_google_login_uses_the_same_session_contract(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    unique = uuid4().hex

    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "id_token": google_id_token_for_test(
                email=f"persistent-google-{unique}@example.com",
                subject=f"persistent-google-subject-{unique}",
            )
        },
    )

    assert response.status_code == 200
    refresh_token = response.json()["refresh_token"]
    auth_session, credential = await _load_session_and_credential(refresh_token)
    assert auth_session.authentication_method == "google"
    assert credential.token_hash == hash_refresh_token(refresh_token)


async def test_persistent_refresh_rotates_once_and_tolerates_only_immediate_race(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    monkeypatch.setattr(auth_service.settings, "refresh_reuse_grace_seconds", 30)
    user = await _create_verified_user()
    original = (await _login(client, user)).json()["refresh_token"]

    rotated = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": original},
    )
    immediate_replay = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": original},
    )

    assert rotated.status_code == 200
    replacement = rotated.json()["refresh_token"]
    assert replacement != original
    assert immediate_replay.status_code == 401

    auth_session, original_row = await _load_session_and_credential(original)
    _, replacement_row = await _load_session_and_credential(replacement)
    assert original_row.used_at is not None
    assert original_row.replaced_by_id == replacement_row.id
    assert auth_session.revoked_at is None
    assert auth_session.compromise_detected_at is None

    next_rotation = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": replacement},
    )
    assert next_rotation.status_code == 200
    assert next_rotation.json()["refresh_token"] != replacement


async def test_delayed_refresh_reuse_revokes_the_whole_session_family(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    monkeypatch.setattr(auth_service.settings, "refresh_reuse_grace_seconds", 1)
    user = await _create_verified_user()
    original = (await _login(client, user)).json()["refresh_token"]
    rotated = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": original},
    )
    assert rotated.status_code == 200
    replacement = rotated.json()["refresh_token"]

    async with TestSessionLocal() as session:
        original_row = (
            await session.execute(
                select(AuthRefreshCredential).where(
                    AuthRefreshCredential.token_hash == hash_refresh_token(original)
                )
            )
        ).scalar_one()
        original_row.used_at = datetime.now(UTC) - timedelta(seconds=2)
        await session.commit()

    replay = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": original},
    )
    successor = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": replacement},
    )

    assert replay.status_code == 401
    assert successor.status_code == 401
    auth_session, original_row = await _load_session_and_credential(original)
    _, replacement_row = await _load_session_and_credential(replacement)
    assert auth_session.revoked_at is not None
    assert auth_session.revocation_reason == "refresh_reuse"
    assert auth_session.compromise_detected_at is not None
    assert original_row.revoked_at is not None
    assert replacement_row.revoked_at is not None


async def test_database_expiry_revokes_session_even_when_jwt_is_still_signed(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    user = await _create_verified_user()
    refresh_token = (await _login(client, user)).json()["refresh_token"]
    claims = decode_refresh_token(refresh_token)

    async with TestSessionLocal() as session:
        auth_session = await session.get(AuthSession, UUID(claims[SESSION_ID_CLAIM]))
        assert auth_session is not None
        auth_session.absolute_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()

    response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )

    assert response.status_code == 401
    auth_session, credential = await _load_session_and_credential(refresh_token)
    assert auth_session.revocation_reason == "expired"
    assert auth_session.revoked_at is not None
    assert credential.revoked_at is not None


async def test_migration_mode_exchanges_a_legacy_refresh_for_persistent_state(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _create_verified_user()
    legacy_refresh = create_refresh_token(str(user.id))
    assert SESSION_ID_CLAIM not in decode_refresh_token(legacy_refresh)
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "migration")

    response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": legacy_refresh},
    )

    assert response.status_code == 200
    replacement = response.json()["refresh_token"]
    claims = decode_refresh_token(replacement)
    auth_session, credential = await _load_session_and_credential(replacement)
    assert claims[SESSION_TOKEN_VERSION_CLAIM] == 1
    assert auth_session.authentication_method == "legacy_refresh_migration"
    assert credential.id == UUID(claims[TOKEN_ID_CLAIM])


async def test_persistent_mode_rejects_legacy_refresh_without_creating_state(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _create_verified_user()
    legacy_refresh = create_refresh_token(str(user.id))
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")

    response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": legacy_refresh},
    )

    assert response.status_code == 401
    async with TestSessionLocal() as session:
        rows = (
            await session.execute(select(AuthSession).where(AuthSession.user_id == user.id))
        ).scalars().all()
    assert rows == []


async def test_suspension_blocks_new_login_and_revokes_refresh_family(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    user = await _create_verified_user()
    refresh_token = (await _login(client, user)).json()["refresh_token"]

    async with TestSessionLocal() as session:
        stored_user = await session.get(User, user.id)
        assert stored_user is not None
        stored_user.suspended_at = datetime.now(UTC)
        await session.commit()

    login = await _login(client, user)
    refresh = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )

    assert login.status_code == 403
    assert refresh.status_code == 403
    auth_session, credential = await _load_session_and_credential(refresh_token)
    assert auth_session.revocation_reason == "account_suspended"
    assert auth_session.revoked_at is not None
    assert credential.revoked_at is not None
