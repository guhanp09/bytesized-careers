from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from conftest import TestSessionLocal, google_id_token_for_test
from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import SESSION_ID_CLAIM, decode_access_token, hash_password
from app.core.totp import totp_code_at
from app.models import (
    AdminAuditLog,
    AuthSession,
    StrongAuthRecoveryCode,
    StrongAuthTotpCredential,
    User,
)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _configure_strong_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    key = base64.urlsafe_b64encode(bytes([71]) * 32).decode("ascii").rstrip("=")
    monkeypatch.setattr(settings, "auth_session_mode", "persistent")
    monkeypatch.setattr(settings, "admin_strong_auth_required", True)
    monkeypatch.setattr(settings, "admin_strong_auth_max_age_minutes", 15)
    monkeypatch.setattr(
        settings,
        "strong_auth_secret_keys",
        SecretStr(json.dumps({"test_key": key})),
    )
    monkeypatch.setattr(
        settings,
        "strong_auth_secret_active_key_id",
        "test_key",
    )


async def _create_user_and_login(
    client: AsyncClient,
    *,
    account_type: str = "ADMIN",
) -> tuple[dict[str, object], str, str]:
    unique = uuid.uuid4().hex
    email = f"strong-auth-{unique}@example.com"
    password = "strong-auth-test-password"
    async with TestSessionLocal() as session:
        session.add(
            User(
                id=uuid.uuid4(),
                email=email,
                username=f"mfa_{unique[:12]}",
                password_hash=hash_password(password),
                email_verified_at=datetime.now(UTC),
                account_type=account_type,
            )
        )
        await session.commit()
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json(), email, password


async def _login_again(
    client: AsyncClient,
    *,
    email: str,
    password: str,
) -> dict[str, object]:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _enroll_and_confirm(
    client: AsyncClient,
    *,
    access_token: str,
    password: str,
) -> tuple[str, list[str]]:
    enrollment = await client.post(
        "/api/v1/auth/strong-auth/totp/enroll",
        headers=_auth(access_token),
        json={"primary": {"password": password}},
    )
    assert enrollment.status_code == 200, enrollment.text
    secret = enrollment.json()["secret"]
    confirmation = await client.post(
        "/api/v1/auth/strong-auth/totp/confirm",
        headers=_auth(access_token),
        json={"code": totp_code_at(secret)},
    )
    assert confirmation.status_code == 200, confirmation.text
    return secret, confirmation.json()["recovery_codes"]


async def _clear_assurance(access_token: str) -> UUID:
    session_id = UUID(decode_access_token(access_token)[SESSION_ID_CLAIM])
    async with TestSessionLocal() as session:
        auth_session = await session.get(AuthSession, session_id)
        assert auth_session is not None
        auth_session.strong_auth_method = None
        auth_session.strong_auth_verified_at = None
        auth_session.strong_auth_expires_at = None
        await session.commit()
    return session_id


async def test_password_enrollment_is_encrypted_confirmed_and_audited(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_strong_auth(monkeypatch)
    login, email, password = await _create_user_and_login(client)
    access_token = str(login["access_token"])
    user_id = UUID(str(login["user"]["id"]))

    assert (await client.get("/api/v1/me", headers=_auth(access_token))).status_code == 403
    status_before = await client.get(
        "/api/v1/auth/strong-auth/status",
        headers=_auth(access_token),
    )
    assert status_before.status_code == 200
    assert status_before.headers["cache-control"] == "no-store"
    assert status_before.json() == {
        "enrolled": False,
        "enrollment_pending": False,
        "enrollment_expires_at": None,
        "recovery_codes_remaining": 0,
        "strong_auth_satisfied": False,
        "strong_auth_method": None,
        "strong_auth_expires_at": None,
        "available_methods": [],
    }

    wrong_primary = await client.post(
        "/api/v1/auth/strong-auth/totp/enroll",
        headers=_auth(access_token),
        json={"primary": {"password": "wrong-primary-password"}},
    )
    assert wrong_primary.status_code == 403
    assert wrong_primary.json()["error"]["message"] == "Strong authentication failed"

    enrollment = await client.post(
        "/api/v1/auth/strong-auth/totp/enroll",
        headers=_auth(access_token),
        json={"primary": {"password": password}},
    )
    assert enrollment.status_code == 200, enrollment.text
    assert enrollment.headers["cache-control"] == "no-store"
    body = enrollment.json()
    secret = body["secret"]
    assert body["provisioning_uri"].startswith("otpauth://totp/")
    assert secret in body["provisioning_uri"]
    assert "test_key" not in body["provisioning_uri"]

    async with TestSessionLocal() as session:
        credential = (
            await session.execute(
                select(StrongAuthTotpCredential).where(
                    StrongAuthTotpCredential.user_id == user_id
                )
            )
        ).scalar_one()
        assert credential.secret_ciphertext.startswith("cj.strong-auth.v1.test_key.")
        assert secret not in credential.secret_ciphertext
        audit_entries = list(
            (
                await session.scalars(
                    select(AdminAuditLog).where(
                        AdminAuditLog.actor_user_id == user_id
                    )
                )
            ).all()
        )
        assert secret not in json.dumps(
            [entry.after_json for entry in audit_entries],
            sort_keys=True,
        )

    sibling = await _login_again(client, email=email, password=password)
    sibling_access = str(sibling["access_token"])
    confirmation = await client.post(
        "/api/v1/auth/strong-auth/totp/confirm",
        headers=_auth(access_token),
        json={"code": totp_code_at(secret)},
    )
    assert confirmation.status_code == 200, confirmation.text
    assert confirmation.headers["cache-control"] == "no-store"
    recovery_codes = confirmation.json()["recovery_codes"]
    assert len(recovery_codes) == 10
    assert len(set(recovery_codes)) == 10
    assert confirmation.json()["recovery_codes_remaining"] == 10
    assert (await client.get("/api/v1/me", headers=_auth(access_token))).status_code == 200
    assert (await client.get("/api/v1/me", headers=_auth(sibling_access))).status_code == 401
    assert (
        await client.get("/api/v1/admin/overview", headers=_auth(access_token))
    ).status_code == 200

    async with TestSessionLocal() as session:
        credential = (
            await session.execute(
                select(StrongAuthTotpCredential).where(
                    StrongAuthTotpCredential.user_id == user_id
                )
            )
        ).scalar_one()
        stored_hashes = set(
            (
                await session.scalars(
                    select(StrongAuthRecoveryCode.code_hash).where(
                        StrongAuthRecoveryCode.credential_id == credential.id
                    )
                )
            ).all()
        )
        assert credential.confirmed_at is not None
        assert credential.enrollment_expires_at is None
        assert len(stored_hashes) == 10
        serialized_hashes = json.dumps(sorted(stored_hashes))
        assert all(code not in serialized_hashes for code in recovery_codes)

    status_after = await client.get(
        "/api/v1/auth/strong-auth/status",
        headers=_auth(access_token),
    )
    assert status_after.status_code == 200
    assert status_after.json()["enrolled"] is True
    assert status_after.json()["strong_auth_satisfied"] is True
    assert status_after.json()["available_methods"] == ["totp", "recovery_code"]

    repeated = await client.post(
        "/api/v1/auth/strong-auth/totp/enroll",
        headers=_auth(access_token),
        json={"primary": {"password": password}},
    )
    assert repeated.status_code == 409


async def test_expired_pending_enrollment_cannot_be_confirmed(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_strong_auth(monkeypatch)
    login, _email, password = await _create_user_and_login(client)
    access_token = str(login["access_token"])
    user_id = UUID(str(login["user"]["id"]))
    enrollment = await client.post(
        "/api/v1/auth/strong-auth/totp/enroll",
        headers=_auth(access_token),
        json={"primary": {"password": password}},
    )
    assert enrollment.status_code == 200, enrollment.text

    async with TestSessionLocal() as session:
        credential = (
            await session.execute(
                select(StrongAuthTotpCredential).where(
                    StrongAuthTotpCredential.user_id == user_id
                )
            )
        ).scalar_one()
        credential.enrollment_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()

    expired = await client.post(
        "/api/v1/auth/strong-auth/totp/confirm",
        headers=_auth(access_token),
        json={"code": totp_code_at(enrollment.json()["secret"])},
    )
    assert expired.status_code == 410
    async with TestSessionLocal() as session:
        credential = (
            await session.execute(
                select(StrongAuthTotpCredential).where(
                    StrongAuthTotpCredential.user_id == user_id
                )
            )
        ).scalar_one()
        assert credential.confirmed_at is None


async def test_totp_replay_is_rejected_and_failures_lock_durably(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_strong_auth(monkeypatch)
    login, _email, password = await _create_user_and_login(client)
    access_token = str(login["access_token"])
    secret, _recovery_codes = await _enroll_and_confirm(
        client,
        access_token=access_token,
        password=password,
    )
    await _clear_assurance(access_token)

    replayed = await client.post(
        "/api/v1/auth/strong-auth/challenge",
        headers=_auth(access_token),
        json={"method": "totp", "code": totp_code_at(secret)},
    )
    assert replayed.status_code == 403
    assert "insufficient_user_authentication" in replayed.headers["www-authenticate"]

    valid_now = totp_code_at(secret, datetime.now(UTC) + timedelta(seconds=30))
    wrong_code = "000000" if valid_now != "000000" else "000001"
    for _attempt in range(3):
        failed = await client.post(
            "/api/v1/auth/strong-auth/challenge",
            headers=_auth(access_token),
            json={"method": "totp", "code": wrong_code},
        )
        assert failed.status_code == 403
    locked = await client.post(
        "/api/v1/auth/strong-auth/challenge",
        headers=_auth(access_token),
        json={"method": "totp", "code": wrong_code},
    )
    # The replay above was the first failure; four more failures reach the cap.
    assert locked.status_code == 429
    assert int(locked.headers["retry-after"]) > 0
    still_locked = await client.post(
        "/api/v1/auth/strong-auth/challenge",
        headers=_auth(access_token),
        json={"method": "totp", "code": valid_now},
    )
    assert still_locked.status_code == 429

    user_id = UUID(str(login["user"]["id"]))
    async with TestSessionLocal() as session:
        credential = (
            await session.execute(
                select(StrongAuthTotpCredential).where(
                    StrongAuthTotpCredential.user_id == user_id
                )
            )
        ).scalar_one()
        failures = (
            await session.execute(
                select(func.count(AdminAuditLog.id)).where(
                    AdminAuditLog.actor_user_id == user_id,
                    AdminAuditLog.action == "auth.strong_auth.challenge_failed",
                )
            )
        ).scalar_one()
        assert credential.failed_attempt_count == 5
        assert credential.locked_until is not None
        assert int(failures) == 5


async def test_recovery_code_is_one_time_and_revokes_sibling_sessions(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_strong_auth(monkeypatch)
    first, email, password = await _create_user_and_login(client)
    first_access = str(first["access_token"])
    _secret, recovery_codes = await _enroll_and_confirm(
        client,
        access_token=first_access,
        password=password,
    )
    sibling = await _login_again(client, email=email, password=password)
    sibling_access = str(sibling["access_token"])

    recovered = await client.post(
        "/api/v1/auth/strong-auth/challenge",
        headers=_auth(first_access),
        json={"method": "recovery_code", "code": recovery_codes[0].lower()},
    )
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["method"] == "recovery_code"
    assert recovered.json()["recovery_codes_remaining"] == 9
    assert (await client.get("/api/v1/me", headers=_auth(first_access))).status_code == 200
    assert (await client.get("/api/v1/me", headers=_auth(sibling_access))).status_code == 401

    replayed = await client.post(
        "/api/v1/auth/strong-auth/challenge",
        headers=_auth(first_access),
        json={"method": "recovery_code", "code": recovery_codes[0]},
    )
    assert replayed.status_code == 403


async def test_recovery_regeneration_replaces_codes_and_revokes_siblings(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_strong_auth(monkeypatch)
    first, email, password = await _create_user_and_login(client)
    first_access = str(first["access_token"])
    secret, old_codes = await _enroll_and_confirm(
        client,
        access_token=first_access,
        password=password,
    )
    sibling = await _login_again(client, email=email, password=password)
    sibling_access = str(sibling["access_token"])

    regenerated = await client.post(
        "/api/v1/auth/strong-auth/recovery-codes/regenerate",
        headers=_auth(first_access),
        json={"code": totp_code_at(secret, datetime.now(UTC) + timedelta(seconds=30))},
    )
    assert regenerated.status_code == 200, regenerated.text
    new_codes = regenerated.json()["recovery_codes"]
    assert len(new_codes) == 10
    assert set(new_codes).isdisjoint(old_codes)
    assert (await client.get("/api/v1/me", headers=_auth(sibling_access))).status_code == 401

    old_code = await client.post(
        "/api/v1/auth/strong-auth/challenge",
        headers=_auth(first_access),
        json={"method": "recovery_code", "code": old_codes[0]},
    )
    assert old_code.status_code == 403


async def test_disable_requires_both_factors_deletes_material_and_revokes_all_sessions(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_strong_auth(monkeypatch)
    first, email, password = await _create_user_and_login(client)
    first_access = str(first["access_token"])
    user_id = UUID(str(first["user"]["id"]))
    secret, _codes = await _enroll_and_confirm(
        client,
        access_token=first_access,
        password=password,
    )
    async with TestSessionLocal() as session:
        credential_id = (
            await session.execute(
                select(StrongAuthTotpCredential.id).where(
                    StrongAuthTotpCredential.user_id == user_id
                )
            )
        ).scalar_one()
    sibling = await _login_again(client, email=email, password=password)
    sibling_access = str(sibling["access_token"])

    wrong_primary = await client.post(
        "/api/v1/auth/strong-auth/disable",
        headers=_auth(first_access),
        json={
            "method": "totp",
            "code": totp_code_at(secret, datetime.now(UTC) + timedelta(seconds=30)),
            "primary": {"password": "wrong-primary-password"},
        },
    )
    assert wrong_primary.status_code == 403

    disabled = await client.post(
        "/api/v1/auth/strong-auth/disable",
        headers=_auth(first_access),
        json={
            "method": "totp",
            "code": totp_code_at(secret, datetime.now(UTC) + timedelta(seconds=30)),
            "primary": {"password": password},
        },
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["revoked_sessions"] >= 2
    assert (await client.get("/api/v1/me", headers=_auth(first_access))).status_code == 401
    assert (await client.get("/api/v1/me", headers=_auth(sibling_access))).status_code == 401

    async with TestSessionLocal() as session:
        credential = (
            await session.execute(
                select(StrongAuthTotpCredential).where(
                    StrongAuthTotpCredential.user_id == user_id
                )
            )
        ).scalar_one_or_none()
        recovery_count = (
            await session.execute(
                select(func.count(StrongAuthRecoveryCode.id)).where(
                    StrongAuthRecoveryCode.credential_id == credential_id
                )
            )
        ).scalar_one()
        disabled_audit = (
            await session.execute(
                select(AdminAuditLog).where(
                    AdminAuditLog.actor_user_id == user_id,
                    AdminAuditLog.action == "auth.strong_auth.disabled",
                )
            )
        ).scalar_one()
        assert credential is None
        assert int(recovery_count) == 0
        assert disabled_audit.after_json["revoked_sessions"] >= 2


async def test_google_reauthentication_is_bound_to_the_linked_subject(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_strong_auth(monkeypatch)
    unique = uuid.uuid4().hex
    email = f"google-strong-auth-{unique}@example.com"
    subject = f"google-subject-{unique}"
    id_token = google_id_token_for_test(email=email, subject=subject)
    login = await client.post(
        "/api/v1/auth/oauth/google",
        json={"id_token": id_token},
    )
    assert login.status_code == 200, login.text
    user_id = UUID(login.json()["user"]["id"])
    async with TestSessionLocal() as session:
        user = await session.get(User, user_id)
        assert user is not None
        user.account_type = "ADMIN"
        await session.commit()
    access_token = login.json()["access_token"]

    wrong_subject = await client.post(
        "/api/v1/auth/strong-auth/totp/enroll",
        headers=_auth(access_token),
        json={
            "primary": {
                "google_id_token": google_id_token_for_test(
                    email=email,
                    subject=f"different-{subject}",
                )
            }
        },
    )
    assert wrong_subject.status_code == 403

    accepted = await client.post(
        "/api/v1/auth/strong-auth/totp/enroll",
        headers=_auth(access_token),
        json={"primary": {"google_id_token": id_token}},
    )
    assert accepted.status_code == 200, accepted.text


async def test_non_admin_and_unconfigured_enrollment_fail_closed(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_strong_auth(monkeypatch)
    ordinary, _ordinary_email, password = await _create_user_and_login(
        client,
        account_type="TALENT",
    )
    ordinary_access = str(ordinary["access_token"])
    assert (
        await client.get(
            "/api/v1/auth/strong-auth/status",
            headers=_auth(ordinary_access),
        )
    ).status_code == 403

    admin, _email, admin_password = await _create_user_and_login(client)
    admin_access = str(admin["access_token"])
    monkeypatch.setattr(settings, "strong_auth_secret_keys", None)
    monkeypatch.setattr(settings, "strong_auth_secret_active_key_id", None)
    status_response = await client.get(
        "/api/v1/auth/strong-auth/status",
        headers=_auth(admin_access),
    )
    assert status_response.status_code == 200
    unavailable = await client.post(
        "/api/v1/auth/strong-auth/totp/enroll",
        headers=_auth(admin_access),
        json={"primary": {"password": admin_password}},
    )
    assert unavailable.status_code == 503

    invalid_primary_shape = await client.post(
        "/api/v1/auth/strong-auth/totp/enroll",
        headers=_auth(admin_access),
        json={"primary": {"password": password, "google_id_token": "x" * 64}},
    )
    assert invalid_primary_shape.status_code == 422
