from __future__ import annotations

from datetime import UTC, datetime, timedelta

from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import func, select

from app.models import EmailVerificationToken, PasswordResetToken, User
from app.services import auth_service
from app.services.email_service import EmailDeliveryError
from app.services.youtube_service import YouTubeChannelResult


async def _load_latest_verification_token() -> str:
    async with TestSessionLocal() as session:
        stmt = select(EmailVerificationToken).order_by(EmailVerificationToken.created_at.desc()).limit(1)
        token_row = (await session.execute(stmt)).scalar_one()
        return token_row.token


async def _load_latest_verification_token_row_for_email(email: str) -> EmailVerificationToken:
    async with TestSessionLocal() as session:
        user_stmt = select(User).where(User.email == email)
        user = (await session.execute(user_stmt)).scalar_one()

        stmt = (
            select(EmailVerificationToken)
            .where(EmailVerificationToken.user_id == user.id)
            .order_by(EmailVerificationToken.created_at.desc())
            .limit(1)
        )
        return (await session.execute(stmt)).scalar_one()


async def _count_verification_tokens_for_email(email: str) -> int:
    async with TestSessionLocal() as session:
        user_stmt = select(User).where(User.email == email)
        user = (await session.execute(user_stmt)).scalar_one()
        count_stmt = select(func.count()).select_from(EmailVerificationToken).where(
            EmailVerificationToken.user_id == user.id
        )
        return int((await session.execute(count_stmt)).scalar_one())


async def _load_active_verification_token_row_for_email(email: str) -> EmailVerificationToken:
    async with TestSessionLocal() as session:
        user_stmt = select(User).where(User.email == email)
        user = (await session.execute(user_stmt)).scalar_one()

        stmt = (
            select(EmailVerificationToken)
            .where(
                EmailVerificationToken.user_id == user.id,
                EmailVerificationToken.used_at.is_(None),
            )
            .order_by(EmailVerificationToken.created_at.desc())
            .limit(1)
        )
        return (await session.execute(stmt)).scalar_one()


async def _load_latest_password_reset_token_row_for_email(email: str) -> PasswordResetToken:
    async with TestSessionLocal() as session:
        user_stmt = select(User).where(User.email == email)
        user = (await session.execute(user_stmt)).scalar_one()

        stmt = (
            select(PasswordResetToken)
            .where(PasswordResetToken.user_id == user.id)
            .order_by(PasswordResetToken.created_at.desc())
            .limit(1)
        )
        return (await session.execute(stmt)).scalar_one()


async def test_register_verify_and_login(client: AsyncClient) -> None:
    email = "auth-user@example.com"
    password = "supersecure123"

    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "username": "auth_user"},
    )
    assert register.status_code == 200
    register_data = register.json()
    assert register_data["status"] == "ok"
    assert register_data["message"] == "Account created. Verify your email before logging in."
    assert register_data["verification_url"].startswith("http://localhost:3000/auth/verify?token=")

    token = (await _load_latest_verification_token_row_for_email(email)).token
    assert isinstance(token, str)
    assert len(token) >= 16

    verify = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verify.status_code == 200

    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    data = login.json()
    assert data["access_token"]
    assert data["token_type"] == "bearer"
    assert data["refresh_token"]
    assert data["access_token_expires_at"]
    assert data["refresh_token_expires_at"]
    assert data["user"]["email"] == email
    assert data["user"]["account_type"] == "TALENT"
    assert data["user"]["onboarding_intent"] == "DECIDE_LATER"

    refresh_token_as_bearer = await client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {data['refresh_token']}"},
    )
    assert refresh_token_as_bearer.status_code == 401

    refresh = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": data["refresh_token"]},
    )
    assert refresh.status_code == 200
    refresh_data = refresh.json()
    assert refresh_data["access_token"]
    assert refresh_data["refresh_token"]
    assert refresh_data["access_token_expires_at"]
    assert refresh_data["refresh_token_expires_at"]
    assert refresh_data["user"]["email"] == email

    me = await client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {refresh_data['access_token']}"},
    )
    assert me.status_code == 200


async def test_backend_refresh_rejects_invalid_refresh_token(client: AsyncClient) -> None:
    refresh = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": "not-a-real-refresh-token"},
    )
    assert refresh.status_code == 401


async def test_register_persists_onboarding_intent_and_me_can_update_it(
    client: AsyncClient,
) -> None:
    email = "hiring-intent@example.com"
    password = "supersecure123"

    register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "username": "hiring_intent",
            "onboarding_intent": "HIRING_CREATOR_TALENT",
        },
    )
    assert register.status_code == 200

    token = (await _load_latest_verification_token_row_for_email(email)).token
    verify = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verify.status_code == 200

    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    login_data = login.json()
    assert login_data["user"]["account_type"] == "TALENT"
    assert login_data["user"]["account_type_selected_at"] is None
    assert login_data["user"]["onboarding_intent"] == "HIRING_CREATOR_TALENT"
    assert login_data["user"]["onboarding_intent_selected_at"] is not None
    bearer = login_data["access_token"]

    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {bearer}"})
    assert me.status_code == 200
    me_data = me.json()
    assert me_data["account_type"] == "TALENT"
    assert me_data["onboarding_intent"] == "HIRING_CREATOR_TALENT"
    assert me_data["profile_capabilities"]["hasPublicProfile"] is True
    assert me_data["profile_capabilities"]["canApplyToJobs"] is False
    assert me_data["profile_capabilities"]["canPostJobs"] is False

    profile = await client.get("/api/v1/me/profile", headers={"Authorization": f"Bearer {bearer}"})
    assert profile.status_code == 200
    assert profile.json()["onboarding_intent"] == "HIRING_CREATOR_TALENT"
    assert profile.json()["profile_capabilities"]["hasPublicProfile"] is True

    update = await client.patch(
        "/api/v1/me/onboarding-intent",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"onboarding_intent": "BOTH"},
    )
    assert update.status_code == 200
    assert update.json()["account_type"] == "TALENT"
    assert update.json()["onboarding_intent"] == "BOTH"
    assert update.json()["onboarding_intent_selected_at"] is not None

    legacy_update = await client.patch(
        "/api/v1/me/account-type",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"account_type": "EMPLOYER"},
    )
    assert legacy_update.status_code == 200
    assert legacy_update.json()["account_type"] == "TALENT"
    assert legacy_update.json()["onboarding_intent"] == "HIRING_CREATOR_TALENT"


async def test_public_signup_and_account_type_update_cannot_select_admin(
    client: AsyncClient,
) -> None:
    register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "admin-public-signup@example.com",
            "password": "supersecure123",
            "username": "admin_public",
            "account_type": "ADMIN",
        },
    )
    assert register.status_code == 422

    user_register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "admin-update@example.com",
            "password": "supersecure123",
            "username": "admin_update",
        },
    )
    assert user_register.status_code == 200
    token = (await _load_latest_verification_token_row_for_email("admin-update@example.com")).token
    verify = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verify.status_code == 200
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin-update@example.com", "password": "supersecure123"},
    )
    assert login.status_code == 200

    update = await client.patch(
        "/api/v1/me/account-type",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        json={"account_type": "ADMIN"},
    )
    assert update.status_code == 422

    intent_update = await client.patch(
        "/api/v1/me/onboarding-intent",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        json={"onboarding_intent": "ADMIN"},
    )
    assert intent_update.status_code == 422


async def test_resend_verification_non_existent_email_returns_generic_success(
    client: AsyncClient,
) -> None:
    response = await client.post(
        "/api/v1/auth/resend-verification",
        json={"email": "nobody@example.com"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "message": "If an account exists for this email, we sent a verification link.",
    }


async def test_resend_verification_verified_user_does_not_rotate_token(
    client: AsyncClient,
) -> None:
    email = "verified-resend@example.com"
    password = "supersecure123"

    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "username": "verified_resend"},
    )
    assert register.status_code == 200
    original_token = (await _load_latest_verification_token_row_for_email(email)).token

    verify = await client.post("/api/v1/auth/verify-email", json={"token": original_token})
    assert verify.status_code == 200

    before_count = await _count_verification_tokens_for_email(email)
    before_latest = await _load_latest_verification_token_row_for_email(email)

    resend = await client.post("/api/v1/auth/resend-verification", json={"email": email})
    assert resend.status_code == 200
    assert resend.json()["ok"] is True

    after_count = await _count_verification_tokens_for_email(email)
    after_latest = await _load_latest_verification_token_row_for_email(email)

    assert after_count == before_count
    assert after_latest.id == before_latest.id
    assert after_latest.token == before_latest.token


async def test_resend_verification_unverified_rotates_token_and_new_token_verifies(
    client: AsyncClient,
) -> None:
    email = "unverified-resend@example.com"
    password = "supersecure123"

    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "username": "unverified_resend"},
    )
    assert register.status_code == 200
    original_row = await _load_latest_verification_token_row_for_email(email)

    resend = await client.post("/api/v1/auth/resend-verification", json={"email": email})
    assert resend.status_code == 200
    assert resend.json() == {
        "ok": True,
        "message": "If an account exists for this email, we sent a verification link.",
    }

    latest_row = await _load_active_verification_token_row_for_email(email)
    assert latest_row.token != original_row.token
    assert latest_row.expires_at >= original_row.expires_at

    verify_old = await client.post("/api/v1/auth/verify-email", json={"token": original_row.token})
    assert verify_old.status_code == 400

    verify_new = await client.post("/api/v1/auth/verify-email", json={"token": latest_row.token})
    assert verify_new.status_code == 200


async def test_password_reset_unknown_email_returns_generic_success(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/password-reset/request",
        json={"email": "missing-reset-user@example.com"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["message"] == "If an account exists for this email, we sent a password reset link."
    assert data["reset_url"] is None


async def test_password_reset_updates_password_and_rejects_reuse(client: AsyncClient) -> None:
    email = "reset-user@example.com"
    old_password = "supersecure123"
    new_password = "newsecure123"

    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": old_password, "username": "reset_user"},
    )
    assert register.status_code == 200
    verification_token = (await _load_latest_verification_token_row_for_email(email)).token
    verify = await client.post("/api/v1/auth/verify-email", json={"token": verification_token})
    assert verify.status_code == 200

    request = await client.post("/api/v1/auth/password-reset/request", json={"email": email})
    assert request.status_code == 200
    request_data = request.json()
    assert request_data["ok"] is True
    assert request_data["reset_url"].startswith("http://localhost:3000/auth/reset?token=")

    reset_token = (await _load_latest_password_reset_token_row_for_email(email)).token
    confirm = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": reset_token, "password": new_password},
    )
    assert confirm.status_code == 200
    assert confirm.json() == {"ok": True, "message": "Password updated. You can log in now.", "reset_url": None}

    old_login = await client.post("/api/v1/auth/login", json={"email": email, "password": old_password})
    assert old_login.status_code == 401

    new_login = await client.post("/api/v1/auth/login", json={"email": email, "password": new_password})
    assert new_login.status_code == 200

    reuse = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": reset_token, "password": "anothersecure123"},
    )
    assert reuse.status_code == 400


async def test_password_reset_expired_token_is_rejected(client: AsyncClient) -> None:
    email = "expired-reset-user@example.com"
    password = "supersecure123"

    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "username": "expired_reset_user"},
    )
    assert register.status_code == 200

    request = await client.post("/api/v1/auth/password-reset/request", json={"email": email})
    assert request.status_code == 200
    reset_token = (await _load_latest_password_reset_token_row_for_email(email)).token

    async with TestSessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        row = (
            await session.execute(
                select(PasswordResetToken)
                .where(PasswordResetToken.user_id == user.id)
                .order_by(PasswordResetToken.created_at.desc())
                .limit(1)
            )
        ).scalar_one()
        row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    confirm = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": reset_token, "password": "newsecure123"},
    )
    assert confirm.status_code == 400


async def test_password_reset_email_failure_returns_safe_error(
    client: AsyncClient,
    monkeypatch,
) -> None:
    email = "reset-email-failure@example.com"
    password = "supersecure123"

    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "username": "reset_email_failure"},
    )
    assert register.status_code == 200

    def fail_send_auth_email(**_kwargs) -> None:
        raise EmailDeliveryError("SMTP unavailable")

    monkeypatch.setattr(auth_service.settings, "email_mode", "smtp")
    monkeypatch.setattr(auth_service, "send_auth_email", fail_send_auth_email)

    request = await client.post("/api/v1/auth/password-reset/request", json={"email": email})
    assert request.status_code == 503
    assert (
        request.json()["error"]["message"]
        == "Email delivery is temporarily unavailable. Please try again shortly."
    )


async def test_google_oauth_upsert_and_refresh_channels(
    client: AsyncClient, monkeypatch
) -> None:
    async def fake_fetch_user_youtube_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return [
            YouTubeChannelResult(
                channel_id="UC_TEST_123",
                title="Test Channel",
                thumbnail_url="https://example.com/channel.jpg",
            )
        ]

    monkeypatch.setattr(
        "app.services.me_service.fetch_user_youtube_channels",
        fake_fetch_user_youtube_channels,
    )
    monkeypatch.setattr(
        "app.services.auth_service.fetch_user_youtube_channels",
        fake_fetch_user_youtube_channels,
    )

    exchange = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": "oauth-user@example.com",
            "provider_account_id": "google-account-123",
            "access_token": "token-abc",
            "refresh_token": "refresh-abc",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile https://www.googleapis.com/auth/youtube.readonly",
        },
    )
    assert exchange.status_code == 200
    bearer = exchange.json()["access_token"]

    # OAuth login path should already persist channel linkage.
    me_after_exchange = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {bearer}"})
    assert me_after_exchange.status_code == 200
    me_after_exchange_data = me_after_exchange.json()
    assert len(me_after_exchange_data["verified_youtube_channels"]) == 1
    assert me_after_exchange_data["verified_youtube_channels"][0]["channel_id"] == "UC_TEST_123"

    upsert = await client.post(
        "/api/v1/me/oauth/google/upsert",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "provider_account_id": "google-account-123",
            "access_token": "token-abc",
            "refresh_token": "refresh-abc",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile https://www.googleapis.com/auth/youtube.readonly",
        },
    )
    assert upsert.status_code == 200

    refresh = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert refresh.status_code == 200
    refresh_data = refresh.json()
    assert refresh_data["status"] == "ok"
    assert len(refresh_data["channels"]) == 1
    assert refresh_data["channels"][0]["channel_id"] == "UC_TEST_123"

    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {bearer}"})
    assert me.status_code == 200
    me_data = me.json()
    assert me_data["email_verified"] is True
    assert len(me_data["verified_youtube_channels"]) == 1


async def test_google_oauth_auto_generates_username_and_display_name(client: AsyncClient) -> None:
    first = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": "oauth-auto-name-1@example.com",
            "provider_account_id": "google-auto-name-1",
            "display_name": "Creator Studio",
            "access_token": "token-one",
            "refresh_token": "refresh-one",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert first.status_code == 200
    first_data = first.json()
    assert first_data["user"]["display_name"] == "Creator Studio"
    assert first_data["user"]["username"] == "creator_studio"
    assert first_data["user"]["account_type"] == "TALENT"
    assert first_data["user"]["onboarding_intent"] == "DECIDE_LATER"

    second = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": "oauth-auto-name-2@example.com",
            "provider_account_id": "google-auto-name-2",
            "display_name": "Creator Studio",
            "access_token": "token-two",
            "refresh_token": "refresh-two",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert second.status_code == 200
    second_data = second.json()
    assert second_data["user"]["username"] == "creator_studio_2"


async def test_youtube_refresh_requires_reauth_when_token_missing(client: AsyncClient) -> None:
    exchange = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": "reauth-user@example.com",
            "provider_account_id": "google-account-reauth",
            "access_token": None,
            "refresh_token": None,
            "expires_at": None,
            "scope": "openid email profile",
        },
    )
    assert exchange.status_code == 200
    bearer = exchange.json()["access_token"]

    refresh = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert refresh.status_code == 401
    body = refresh.json()
    message = body.get("detail")
    if not isinstance(message, str):
        message = body.get("error", {}).get("message", "")
    assert "youtube_reauth_required" in message


async def test_youtube_job_create_requires_linked_channel(
    client: AsyncClient, monkeypatch
) -> None:
    async def fake_fetch_user_youtube_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return [
            YouTubeChannelResult(
                channel_id="UC_LINKED_1",
                title="Linked Posting Channel",
                thumbnail_url=None,
            )
        ]

    monkeypatch.setattr(
        "app.services.me_service.fetch_user_youtube_channels",
        fake_fetch_user_youtube_channels,
    )
    monkeypatch.setattr(
        "app.services.auth_service.fetch_user_youtube_channels",
        fake_fetch_user_youtube_channels,
    )

    exchange = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": "poster-user@example.com",
            "provider_account_id": "google-poster-account",
            "access_token": "token-post",
            "refresh_token": "refresh-post",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile https://www.googleapis.com/auth/youtube.readonly",
        },
    )
    assert exchange.status_code == 200
    bearer = exchange.json()["access_token"]

    refresh = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert refresh.status_code == 200

    create_payload = {
        "title": "YouTube Editor Needed",
        "category": "Editing",
        "location": "Remote",
        "platforms": ["youtube"],
        "posted_platform": "youtube",
        "posted_youtube_channel_id": "UC_LINKED_1",
        "channel_name": "Linked Posting Channel",
        "status": "published",
    }

    ok_create = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {bearer}"},
        json=create_payload,
    )
    assert ok_create.status_code == 201
    assert ok_create.json()["posted_youtube_channel_id"] == "UC_LINKED_1"

    forbidden_create = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {bearer}"},
        json={**create_payload, "posted_youtube_channel_id": "UC_NOT_LINKED"},
    )
    assert forbidden_create.status_code == 403

    frictionless_create = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {bearer}"},
        json={**create_payload, "posted_youtube_channel_id": None, "channel_name": "Manual Channel"},
    )
    assert frictionless_create.status_code == 201
    assert frictionless_create.json()["posted_youtube_channel_id"] is None
    assert frictionless_create.json()["posted_by_user_id"] is not None

    unauthenticated_create = await client.post("/api/v1/jobs", json=create_payload)
    assert unauthenticated_create.status_code == 401
