from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import parse_qs

import httpx
import pytest

from app.core.oauth_scopes import GOOGLE_YOUTUBE_READONLY_SCOPE
from app.services.google_oauth_refresh import (
    GOOGLE_OAUTH_TOKEN_URL,
    GoogleOAuthRefreshRejectedError,
    GoogleOAuthRefreshUnavailableError,
    refresh_google_oauth_token,
)
from app.services.youtube_service import (
    YouTubeAPIError,
    YouTubeReauthRequiredError,
    fetch_user_youtube_channels,
)


async def test_google_refresh_uses_fixed_server_owned_exchange_and_redacts_secrets() -> None:
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return httpx.Response(
            200,
            json={
                "access_token": "rotated-access-secret",
                "refresh_token": "rotated-refresh-secret",
                "expires_in": 3600,
                "scope": GOOGLE_YOUTUBE_READONLY_SCOPE,
                "token_type": "Bearer",
            },
            request=request,
        )

    issued_at = datetime(2026, 8, 14, 12, 0, tzinfo=UTC)
    result = await refresh_google_oauth_token(
        "stored-refresh-secret",
        client_id="server-client-id",
        client_secret="server-client-secret",
        transport=httpx.MockTransport(handler),
        now=issued_at,
    )

    assert result.access_token == "rotated-access-secret"
    assert result.refresh_token == "rotated-refresh-secret"
    assert result.expires_at == int(issued_at.timestamp()) + 3600
    assert result.scope == GOOGLE_YOUTUBE_READONLY_SCOPE
    assert "secret" not in repr(result)
    assert len(observed) == 1
    request = observed[0]
    assert request.method == "POST"
    assert str(request.url) == GOOGLE_OAUTH_TOKEN_URL
    assert request.headers["content-type"].startswith(
        "application/x-www-form-urlencoded"
    )
    assert parse_qs(request.content.decode()) == {
        "client_id": ["server-client-id"],
        "client_secret": ["server-client-secret"],
        "refresh_token": ["stored-refresh-secret"],
        "grant_type": ["refresh_token"],
    }


async def test_google_refresh_accepts_unchanged_grant_without_rotated_refresh_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        # OAuth permits scope to be omitted when it is unchanged. The caller
        # already requires the stored grant to contain youtube.readonly and
        # confirms the refreshed access token against YouTube before mutation.
        return httpx.Response(
            200,
            json={
                "access_token": "new-access",
                "expires_in": 1800,
                "token_type": "bearer",
            },
            request=request,
        )

    result = await refresh_google_oauth_token(
        "existing-refresh",
        client_id="client-id",
        client_secret="client-secret",
        transport=httpx.MockTransport(handler),
    )

    assert result.refresh_token is None
    assert result.scope == GOOGLE_YOUTUBE_READONLY_SCOPE


@pytest.mark.parametrize(
    ("status_code", "error_code", "expected_error"),
    [
        (400, "invalid_grant", GoogleOAuthRefreshRejectedError),
        (400, "invalid_client", GoogleOAuthRefreshUnavailableError),
        (401, "invalid_client", GoogleOAuthRefreshUnavailableError),
        (429, "rate_limit_exceeded", GoogleOAuthRefreshUnavailableError),
        (503, "temporarily_unavailable", GoogleOAuthRefreshUnavailableError),
        (302, "redirect", GoogleOAuthRefreshUnavailableError),
    ],
)
async def test_only_invalid_grant_destructively_rejects_stored_refresh_credential(
    status_code: int,
    error_code: str,
    expected_error: type[Exception],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code,
            json={"error": error_code},
            request=request,
        )

    with pytest.raises(expected_error) as exc_info:
        await refresh_google_oauth_token(
            "stored-refresh-secret",
            client_id="client-id",
            client_secret="client-secret",
            transport=httpx.MockTransport(handler),
        )

    assert "stored-refresh-secret" not in str(exc_info.value)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"access_token": "", "expires_in": 3600},
        {"access_token": "access", "expires_in": True},
        {"access_token": "access", "expires_in": 0},
        {
            "access_token": "access",
            "expires_in": 3600,
            "scope": GOOGLE_YOUTUBE_READONLY_SCOPE,
            "token_type": "MAC",
        },
    ],
)
async def test_google_refresh_rejects_malformed_success_without_exposing_payload(
    payload: dict[str, object],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload, request=request)

    with pytest.raises(GoogleOAuthRefreshUnavailableError) as exc_info:
        await refresh_google_oauth_token(
            "stored-refresh-secret",
            client_id="client-id",
            client_secret="client-secret",
            transport=httpx.MockTransport(handler),
        )

    assert "stored-refresh-secret" not in str(exc_info.value)
    assert "access" not in str(exc_info.value)


async def test_explicit_refreshed_scope_without_youtube_requires_reauthorization() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "access_token": "access-secret",
                "expires_in": 3600,
                "scope": "openid email profile",
                "token_type": "Bearer",
            },
            request=request,
        )

    with pytest.raises(GoogleOAuthRefreshRejectedError) as exc_info:
        await refresh_google_oauth_token(
            "refresh-secret",
            client_id="client-id",
            client_secret="client-secret",
            transport=httpx.MockTransport(handler),
        )

    assert "access-secret" not in str(exc_info.value)
    assert "refresh-secret" not in str(exc_info.value)


async def test_google_refresh_fails_closed_on_network_invalid_json_and_oversized_body() -> None:
    def network_error(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("provider unavailable", request=request)

    def invalid_json(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json", request=request)

    def oversized(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 20_000, request=request)

    for handler in (network_error, invalid_json, oversized):
        with pytest.raises(GoogleOAuthRefreshUnavailableError):
            await refresh_google_oauth_token(
                "stored-refresh-secret",
                client_id="client-id",
                client_secret="client-secret",
                transport=httpx.MockTransport(handler),
            )


@pytest.mark.parametrize("status_code", [302, 403, 429, 503])
async def test_youtube_provider_failures_do_not_masquerade_as_revoked_user_grants(
    status_code: int,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"error": "provider"}, request=request)

    with pytest.raises(YouTubeAPIError):
        await fetch_user_youtube_channels(
            "access-secret",
            transport=httpx.MockTransport(handler),
        )


async def test_youtube_401_is_reauth_and_network_or_invalid_json_is_temporary() -> None:
    def unauthorized(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid_token"}, request=request)

    def network_error(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("provider unavailable", request=request)

    def invalid_json(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json", request=request)

    with pytest.raises(YouTubeReauthRequiredError):
        await fetch_user_youtube_channels(
            "access-secret",
            transport=httpx.MockTransport(unauthorized),
        )
    for handler in (network_error, invalid_json):
        with pytest.raises(YouTubeAPIError):
            await fetch_user_youtube_channels(
                "access-secret",
                transport=httpx.MockTransport(handler),
            )


async def test_youtube_explicit_insufficient_permission_requires_reauthorization() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "error": {
                    "errors": [
                        {
                            "domain": "global",
                            "reason": "insufficientPermissions",
                            "message": "Insufficient Permission",
                        }
                    ]
                }
            },
            request=request,
        )

    with pytest.raises(YouTubeReauthRequiredError):
        await fetch_user_youtube_channels(
            "access-secret",
            transport=httpx.MockTransport(handler),
        )
