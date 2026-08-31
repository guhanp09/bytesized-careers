from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from conftest import (
    TestSessionLocal,
    google_id_token_for_test,
    google_oauth_exchange_headers,
)
from httpx import AsyncClient, Response
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import settings
from app.core.oauth_scopes import GOOGLE_YOUTUBE_READONLY_SCOPE
from app.models import (
    OAuthAccount,
    OAuthConnectionEvent,
    User,
    UserYouTubeChannel,
    YouTubeChannel,
)
from app.services import auth_service, me_service
from app.services.google_oauth_refresh import (
    GoogleOAuthRefreshRejectedError,
    GoogleOAuthRefreshResult,
    GoogleOAuthRefreshUnavailableError,
)
from app.services.google_oauth_revocation import GoogleOAuthRevocationResult
from app.services.youtube_service import (
    YouTubeAPIError,
    YouTubeChannelResult,
    YouTubeReauthRequiredError,
)


def _identity(prefix: str) -> tuple[str, str]:
    unique = uuid.uuid4().hex
    return f"{prefix}-{unique}@example.com", f"google-{prefix}-{unique}"


async def _exchange(
    client: AsyncClient,
    *,
    email: str,
    subject: str,
    access_token: str | None,
    refresh_token: str | None,
    scope: str,
) -> Response:
    return await client.post(
        "/api/v1/auth/oauth/google",
        headers=(
            google_oauth_exchange_headers()
            if GOOGLE_YOUTUBE_READONLY_SCOPE in scope.split()
            else None
        ),
        json={
            "id_token": google_id_token_for_test(
                email=email,
                subject=subject,
                access_token=access_token,
            ),
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": scope,
        },
    )


@pytest.mark.parametrize(
    "scope",
    [
        "openid email profile",
        "openid email profile https://example.com/youtube.readonly.evil",
    ],
)
async def test_identity_only_google_login_stores_binding_but_no_provider_credentials(
    client: AsyncClient,
    scope: str,
) -> None:
    email, subject = _identity("identity-only")
    exchange = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="identity-access-must-not-persist",
        refresh_token="identity-refresh-must-not-persist",
        scope=scope,
    )
    assert exchange.status_code == 200, exchange.text

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(
                    OAuthAccount.provider_account_id == subject
                )
            )
        ).scalar_one()
        assert row.access_token is None
        assert row.refresh_token is None
        assert row.access_token_ciphertext is None
        assert row.refresh_token_ciphertext is None
        assert row.expires_at is None
        assert row.scope is None


async def test_basic_login_cannot_clobber_existing_youtube_grant(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return []

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", fake_channels)
    email, subject = _identity("preserve-youtube")
    first = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="youtube-access-original",
        refresh_token="youtube-refresh-original",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert first.status_code == 200, first.text

    second = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="basic-access-must-not-overwrite",
        refresh_token=None,
        scope="openid email profile",
    )
    assert second.status_code == 200, second.text
    assert second.json()["user"]["id"] == first.json()["user"]["id"]

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(
                    OAuthAccount.provider_account_id == subject
                )
            )
        ).scalar_one()
        assert row.access_token == "youtube-access-original"
        assert row.refresh_token == "youtube-refresh-original"
        assert row.scope is not None and GOOGLE_YOUTUBE_READONLY_SCOPE in row.scope
        event_count = (
            await session.execute(
                select(func.count())
                .select_from(OAuthConnectionEvent)
                .where(OAuthConnectionEvent.oauth_account_id == row.id)
            )
        ).scalar_one()
        assert event_count == 1


async def test_basic_login_clears_legacy_credentials_without_youtube_scope(
    client: AsyncClient,
) -> None:
    email, subject = _identity("legacy-identity-credentials")
    first = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token=None,
        refresh_token=None,
        scope="openid email profile",
    )
    assert first.status_code == 200, first.text

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        # Simulate a pre-scope-minimization row. These tokens have no supported
        # feature authority and should not survive the next verified login.
        row.access_token = "legacy-identity-access"
        row.refresh_token = "legacy-identity-refresh"
        row.expires_at = int(datetime.now(UTC).timestamp()) + 3600
        row.scope = "openid email profile"
        await session.commit()

    second = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="new-identity-access-must-not-persist",
        refresh_token="new-identity-refresh-must-not-persist",
        scope="openid email profile",
    )
    assert second.status_code == 200, second.text

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        assert row.access_token is None and row.refresh_token is None
        assert row.access_token_ciphertext is None
        assert row.refresh_token_ciphertext is None
        assert row.scope is None and row.expires_at is None
        cleanup = (
            await session.execute(
                select(OAuthConnectionEvent).where(
                    OAuthConnectionEvent.oauth_account_id == row.id,
                    OAuthConnectionEvent.action
                    == "google_non_feature_credentials_cleared",
                )
            )
        ).scalar_one()
        assert cleanup.provider == "google"


async def test_reauthorization_reconciles_removed_youtube_channel_links(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current_channel = "UC_OLD_AUTHORITY"

    async def provider_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return [
            YouTubeChannelResult(
                channel_id=current_channel,
                title=current_channel,
                thumbnail_url=None,
            )
        ]

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", provider_channels)
    email, subject = _identity("reconcile-reauthorization")
    first = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="first-authorized-access",
        refresh_token="first-authorized-refresh",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert first.status_code == 200, first.text

    current_channel = "UC_NEW_AUTHORITY"
    second = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="second-authorized-access",
        refresh_token="second-authorized-refresh",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert second.status_code == 200, second.text

    me = await client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {second.json()['access_token']}"},
    )
    assert me.status_code == 200
    assert [
        item["channel_id"] for item in me.json()["verified_youtube_channels"]
    ] == ["UC_NEW_AUTHORITY"]


async def test_youtube_access_token_must_match_signed_google_identity_response(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fetch_called = False

    async def should_not_fetch(_access_token: str) -> list[YouTubeChannelResult]:
        nonlocal fetch_called
        fetch_called = True
        return []

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", should_not_fetch)
    email, subject = _identity("token-binding")
    response = await client.post(
        "/api/v1/auth/oauth/google",
        headers=google_oauth_exchange_headers(),
        json={
            "id_token": google_id_token_for_test(
                email=email,
                subject=subject,
                access_token="identity-bound-access-token",
            ),
            "access_token": "different-or-stolen-access-token",
            "refresh_token": "untrusted-refresh-token",
            "scope": f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
        },
    )
    assert response.status_code == 401
    body = response.json()
    message = body.get("detail") or body.get("error", {}).get("message")
    assert message == "Google authorization could not be verified"
    assert fetch_called is False

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(
                    OAuthAccount.provider_account_id == subject
                )
            )
        ).scalar_one_or_none()
        assert row is None


async def test_youtube_credential_exchange_requires_server_only_boundary_secret(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fetch_called = False

    async def should_not_fetch(_access_token: str) -> list[YouTubeChannelResult]:
        nonlocal fetch_called
        fetch_called = True
        return []

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", should_not_fetch)
    email, subject = _identity("internal-boundary")
    access_token = "boundary-access-token"
    payload = {
        "id_token": google_id_token_for_test(
            email=email,
            subject=subject,
            access_token=access_token,
        ),
        "access_token": access_token,
        "refresh_token": "boundary-refresh-token",
        "scope": f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    }

    missing = await client.post("/api/v1/auth/oauth/google", json=payload)
    wrong = await client.post(
        "/api/v1/auth/oauth/google",
        headers={"X-CreatorJobs-OAuth-Exchange": "wrong" * 20},
        json=payload,
    )
    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert fetch_called is False

    # Planned rotation is deployable without a credential-authority outage:
    # backend accepts old+new, frontend moves to new, then old is removed.
    old_secret = google_oauth_exchange_headers()["X-CreatorJobs-OAuth-Exchange"]
    new_secret = "creatorjobs-new-google-oauth-exchange-secret"
    monkeypatch.setattr(
        settings,
        "google_oauth_exchange_secret",
        SecretStr(new_secret),
    )
    monkeypatch.setattr(
        settings,
        "google_oauth_exchange_previous_secret",
        SecretStr(old_secret),
    )
    overlap = await client.post(
        "/api/v1/auth/oauth/google",
        headers={"X-CreatorJobs-OAuth-Exchange": old_secret},
        json=payload,
    )
    assert overlap.status_code == 200
    assert fetch_called is True

    current = await client.post(
        "/api/v1/auth/oauth/google",
        headers={"X-CreatorJobs-OAuth-Exchange": new_secret},
        json=payload,
    )
    assert current.status_code == 200

    fetch_called = False
    monkeypatch.setattr(settings, "google_oauth_exchange_previous_secret", None)
    retired = await client.post(
        "/api/v1/auth/oauth/google",
        headers={"X-CreatorJobs-OAuth-Exchange": old_secret},
        json=payload,
    )
    assert retired.status_code == 401
    assert fetch_called is False

    monkeypatch.setattr(settings, "google_oauth_exchange_secret", None)
    unavailable = await client.post(
        "/api/v1/auth/oauth/google",
        headers=google_oauth_exchange_headers(),
        json=payload,
    )
    assert unavailable.status_code == 503
    assert fetch_called is False


@pytest.mark.parametrize(
    ("provider_error", "expected_status"),
    [
        (YouTubeReauthRequiredError("youtube_reauth_required"), 401),
        (YouTubeAPIError("YouTube API error (503)"), 503),
    ],
)
async def test_youtube_grant_is_not_stored_until_google_confirms_api_authority(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    provider_error: Exception,
    expected_status: int,
) -> None:
    async def rejected(_access_token: str) -> list[YouTubeChannelResult]:
        raise provider_error

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", rejected)
    email, subject = _identity("grant-confirmation")
    response = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="matching-access-token",
        refresh_token="matching-refresh-token",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert response.status_code == expected_status

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(
                    OAuthAccount.provider_account_id == subject
                )
            )
        ).scalar_one_or_none()
        assert row is None


async def test_youtube_disconnect_revokes_and_clears_without_unlinking_google_identity(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return [
            YouTubeChannelResult(
                channel_id="UC_DISCONNECT_TEST",
                title="Disconnect test channel",
                thumbnail_url=None,
            )
        ]

    revoked_tokens: list[str] = []

    async def fake_revoke(token: str) -> GoogleOAuthRevocationResult:
        revoked_tokens.append(token)
        return GoogleOAuthRevocationResult(status="confirmed")

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", fake_channels)
    monkeypatch.setattr(me_service, "revoke_google_oauth_token", fake_revoke)

    email, subject = _identity("disconnect")
    exchange = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="disconnect-access-secret",
        refresh_token="disconnect-refresh-secret",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert exchange.status_code == 200, exchange.text
    bearer = exchange.json()["access_token"]
    user_id = exchange.json()["user"]["id"]

    async with TestSessionLocal() as session:
        user = (
            await session.execute(select(User).where(User.id == uuid.UUID(user_id)))
        ).scalar_one()
        user.avatar_mode = "youtube_channel"
        user.avatar_youtube_channel_id = "UC_DISCONNECT_TEST"
        await session.commit()

    disconnect = await client.post(
        "/api/v1/me/youtube/disconnect",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert disconnect.status_code == 200, disconnect.text
    assert disconnect.json() == {
        "status": "ok",
        "disconnected": True,
        "provider_revocation": "confirmed",
        "channel_links_removed": 1,
    }
    assert revoked_tokens == ["disconnect-refresh-secret"]
    assert "disconnect-access-secret" not in disconnect.text
    assert "disconnect-refresh-secret" not in disconnect.text

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(
                    OAuthAccount.provider_account_id == subject
                )
            )
        ).scalar_one()
        assert str(row.user_id) == user_id
        assert row.provider_account_id == subject
        assert row.access_token is None
        assert row.refresh_token is None
        assert row.access_token_ciphertext is None
        assert row.refresh_token_ciphertext is None
        assert row.scope is None
        assert row.expires_at is None
        user = (
            await session.execute(select(User).where(User.id == uuid.UUID(user_id)))
        ).scalar_one()
        assert user.avatar_mode == "generic"
        assert user.avatar_youtube_channel_id is None
        link_count = (
            await session.execute(
                select(func.count())
                .select_from(UserYouTubeChannel)
                .where(UserYouTubeChannel.user_id == user.id)
            )
        ).scalar_one()
        assert link_count == 0
        events = list(
            (
                await session.execute(
                    select(OAuthConnectionEvent)
                    .where(OAuthConnectionEvent.oauth_account_id == row.id)
                    .order_by(OAuthConnectionEvent.created_at, OAuthConnectionEvent.id)
                )
            ).scalars()
        )
        assert {event.action for event in events} == {
            "youtube_authorized",
            "youtube_disconnected",
        }
        disconnected_event = next(
            event for event in events if event.action == "youtube_disconnected"
        )
        assert disconnected_event.provider_revocation_status == "confirmed"
        assert disconnected_event.channel_links_removed == 1
        assert "secret" not in json.dumps(
            {
                "provider": disconnected_event.provider,
                "action": disconnected_event.action,
                "status": disconnected_event.provider_revocation_status,
            }
        )

    relogin = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="later-identity-token",
        refresh_token=None,
        scope="openid email profile",
    )
    assert relogin.status_code == 200, relogin.text
    assert relogin.json()["user"]["id"] == user_id
    refresh = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {relogin.json()['access_token']}"},
    )
    assert refresh.status_code == 401

    removed_unsafe_upsert = await client.post(
        "/api/v1/me/oauth/google/upsert",
        headers={"Authorization": f"Bearer {relogin.json()['access_token']}"},
        json={"access_token": "unverified-provider-token"},
    )
    assert removed_unsafe_upsert.status_code == 404


async def test_disconnect_clears_locally_when_google_is_unavailable_and_is_idempotent(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return []

    revoke_calls = 0

    async def unavailable_revoke(_token: str) -> GoogleOAuthRevocationResult:
        nonlocal revoke_calls
        revoke_calls += 1
        return GoogleOAuthRevocationResult(status="unavailable")

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", fake_channels)
    monkeypatch.setattr(me_service, "revoke_google_oauth_token", unavailable_revoke)
    email, subject = _identity("disconnect-unavailable")
    exchange = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="unavailable-access",
        refresh_token="unavailable-refresh",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert exchange.status_code == 200, exchange.text
    headers = {"Authorization": f"Bearer {exchange.json()['access_token']}"}

    first = await client.post("/api/v1/me/youtube/disconnect", headers=headers)
    second = await client.post("/api/v1/me/youtube/disconnect", headers=headers)
    assert first.status_code == 200
    assert first.json()["provider_revocation"] == "unavailable"
    assert second.status_code == 200
    assert second.json()["provider_revocation"] == "not_applicable"
    assert revoke_calls == 1

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(
                    OAuthAccount.provider_account_id == subject
                )
            )
        ).scalar_one()
        assert row.access_token is None and row.refresh_token is None


async def test_expired_youtube_grant_refreshes_and_reconciles_channels(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def initial_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return [
            YouTubeChannelResult(
                channel_id="UC_BEFORE_REFRESH",
                title="Before refresh",
                thumbnail_url=None,
            )
        ]

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", initial_channels)
    email, subject = _identity("refresh-success")
    exchange = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="expired-access-secret",
        refresh_token="stored-refresh-secret",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert exchange.status_code == 200, exchange.text
    user_id = uuid.UUID(exchange.json()["user"]["id"])

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        row.expires_at = int(datetime.now(UTC).timestamp()) - 1
        await session.commit()

    refresh_calls: list[str] = []

    async def refresh_google(refresh_token: str) -> GoogleOAuthRefreshResult:
        refresh_calls.append(refresh_token)
        return GoogleOAuthRefreshResult(
            access_token="rotated-access-secret",
            refresh_token="rotated-refresh-secret",
            expires_at=int(datetime.now(UTC).timestamp()) + 3600,
        )

    observed_access: list[str] = []

    async def refreshed_channels(access_token: str) -> list[YouTubeChannelResult]:
        observed_access.append(access_token)
        return [
            YouTubeChannelResult(
                channel_id="UC_AFTER_REFRESH",
                title="After refresh",
                thumbnail_url=None,
            )
        ]

    monkeypatch.setattr(me_service, "_refresh_google_token_from_settings", refresh_google)
    monkeypatch.setattr(me_service, "fetch_user_youtube_channels", refreshed_channels)
    response = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {exchange.json()['access_token']}"},
    )

    assert response.status_code == 200, response.text
    assert refresh_calls == ["stored-refresh-secret"]
    assert observed_access == ["rotated-access-secret"]
    assert [channel["channel_id"] for channel in response.json()["channels"]] == [
        "UC_AFTER_REFRESH"
    ]

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        assert row.access_token == "rotated-access-secret"
        assert row.refresh_token == "rotated-refresh-secret"
        linked_channels = list(
            (
                await session.execute(
                    select(YouTubeChannel.channel_id)
                    .join(
                        UserYouTubeChannel,
                        UserYouTubeChannel.youtube_channel_id == YouTubeChannel.id,
                    )
                    .where(UserYouTubeChannel.user_id == user_id)
                )
            ).scalars()
        )
        assert linked_channels == ["UC_AFTER_REFRESH"]


async def test_refresh_invalid_grant_clears_local_authority_and_records_event(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def initial_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return [
            YouTubeChannelResult(
                channel_id="UC_INVALID_GRANT",
                title="Invalid grant",
                thumbnail_url=None,
            )
        ]

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", initial_channels)
    email, subject = _identity("refresh-invalid-grant")
    exchange = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="invalid-grant-access",
        refresh_token="invalid-grant-refresh",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert exchange.status_code == 200, exchange.text
    user_id = uuid.UUID(exchange.json()["user"]["id"])

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        row.expires_at = int(datetime.now(UTC).timestamp()) - 1
        user = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one()
        user.avatar_mode = "youtube_channel"
        user.avatar_youtube_channel_id = "UC_INVALID_GRANT"
        await session.commit()

    async def rejected_refresh(_refresh_token: str) -> GoogleOAuthRefreshResult:
        raise GoogleOAuthRefreshRejectedError("invalid_grant")

    monkeypatch.setattr(
        me_service,
        "_refresh_google_token_from_settings",
        rejected_refresh,
    )
    response = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {exchange.json()['access_token']}"},
    )
    assert response.status_code == 401

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        assert row.access_token is None and row.refresh_token is None
        assert row.scope is None and row.expires_at is None
        assert (
            await session.execute(
                select(func.count())
                .select_from(UserYouTubeChannel)
                .where(UserYouTubeChannel.user_id == user_id)
            )
        ).scalar_one() == 0
        user = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one()
        assert user.avatar_mode == "generic"
        assert user.avatar_youtube_channel_id is None
        invalidation = (
            await session.execute(
                select(OAuthConnectionEvent).where(
                    OAuthConnectionEvent.oauth_account_id == row.id,
                    OAuthConnectionEvent.action == "youtube_credentials_invalidated",
                )
            )
        ).scalar_one()
        assert invalidation.provider_revocation_status == "already_invalid"
        assert invalidation.channel_links_removed == 1


async def test_refresh_provider_unavailable_retains_existing_authority(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def initial_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return [
            YouTubeChannelResult(
                channel_id="UC_PROVIDER_UNAVAILABLE",
                title="Provider unavailable",
                thumbnail_url=None,
            )
        ]

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", initial_channels)
    email, subject = _identity("refresh-unavailable")
    exchange = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="unavailable-old-access",
        refresh_token="unavailable-old-refresh",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert exchange.status_code == 200, exchange.text
    user_id = uuid.UUID(exchange.json()["user"]["id"])

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        row.expires_at = int(datetime.now(UTC).timestamp()) - 1
        await session.commit()

    async def unavailable_refresh(_refresh_token: str) -> GoogleOAuthRefreshResult:
        raise GoogleOAuthRefreshUnavailableError("provider unavailable")

    monkeypatch.setattr(
        me_service,
        "_refresh_google_token_from_settings",
        unavailable_refresh,
    )
    response = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {exchange.json()['access_token']}"},
    )
    assert response.status_code == 502

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        assert row.access_token == "unavailable-old-access"
        assert row.refresh_token == "unavailable-old-refresh"
        assert row.scope == GOOGLE_YOUTUBE_READONLY_SCOPE
        assert (
            await session.execute(
                select(func.count())
                .select_from(UserYouTubeChannel)
                .where(UserYouTubeChannel.user_id == user_id)
            )
        ).scalar_one() == 1


async def test_refresh_retries_one_unauthorized_access_token_then_succeeds(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def initial_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return []

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", initial_channels)
    email, subject = _identity("refresh-retry")
    exchange = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="unauthorized-old-access",
        refresh_token="retry-refresh-token",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert exchange.status_code == 200, exchange.text

    async def refresh_google(refresh_token: str) -> GoogleOAuthRefreshResult:
        assert refresh_token == "retry-refresh-token"
        return GoogleOAuthRefreshResult(
            access_token="retry-new-access",
            refresh_token=None,
            expires_at=int(datetime.now(UTC).timestamp()) + 3600,
        )

    observed_access: list[str] = []

    async def retry_channels(access_token: str) -> list[YouTubeChannelResult]:
        observed_access.append(access_token)
        if access_token == "unauthorized-old-access":
            raise YouTubeReauthRequiredError("youtube_reauth_required")
        return []

    monkeypatch.setattr(me_service, "_refresh_google_token_from_settings", refresh_google)
    monkeypatch.setattr(me_service, "fetch_user_youtube_channels", retry_channels)
    response = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {exchange.json()['access_token']}"},
    )
    assert response.status_code == 200, response.text
    assert observed_access == ["unauthorized-old-access", "retry-new-access"]

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        assert row.access_token == "retry-new-access"
        assert row.refresh_token == "retry-refresh-token"


async def test_rotated_refresh_token_survives_temporary_youtube_api_failure(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def initial_channels(_access_token: str) -> list[YouTubeChannelResult]:
        return [
            YouTubeChannelResult(
                channel_id="UC_TRANSIENT_FAILURE",
                title="Transient failure",
                thumbnail_url=None,
            )
        ]

    monkeypatch.setattr(auth_service, "fetch_user_youtube_channels", initial_channels)
    email, subject = _identity("refresh-rotated-outage")
    exchange = await _exchange(
        client,
        email=email,
        subject=subject,
        access_token="pre-outage-access",
        refresh_token="pre-outage-refresh",
        scope=f"openid email profile {GOOGLE_YOUTUBE_READONLY_SCOPE}",
    )
    assert exchange.status_code == 200, exchange.text
    user_id = uuid.UUID(exchange.json()["user"]["id"])

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        row.expires_at = int(datetime.now(UTC).timestamp()) - 1
        await session.commit()

    async def rotated_refresh(_refresh_token: str) -> GoogleOAuthRefreshResult:
        return GoogleOAuthRefreshResult(
            access_token="post-outage-access",
            refresh_token="post-outage-refresh",
            expires_at=int(datetime.now(UTC).timestamp()) + 3600,
        )

    async def youtube_unavailable(_access_token: str) -> list[YouTubeChannelResult]:
        raise YouTubeAPIError("YouTube API error (503)")

    monkeypatch.setattr(me_service, "_refresh_google_token_from_settings", rotated_refresh)
    monkeypatch.setattr(me_service, "fetch_user_youtube_channels", youtube_unavailable)
    response = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {exchange.json()['access_token']}"},
    )
    assert response.status_code == 502

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(OAuthAccount.provider_account_id == subject)
            )
        ).scalar_one()
        assert row.access_token == "post-outage-access"
        assert row.refresh_token == "post-outage-refresh"
        assert (
            await session.execute(
                select(func.count())
                .select_from(UserYouTubeChannel)
                .where(UserYouTubeChannel.user_id == user_id)
            )
        ).scalar_one() == 1


async def test_youtube_disconnect_requires_authentication(client: AsyncClient) -> None:
    response = await client.post("/api/v1/me/youtube/disconnect")
    assert response.status_code == 401
