from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

from app.core.oauth_scopes import (
    GOOGLE_YOUTUBE_READONLY_SCOPE,
    has_google_youtube_read_scope,
)

GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
MAX_TOKEN_RESPONSE_BYTES = 16 * 1024


class GoogleOAuthRefreshRejectedError(Exception):
    """The provider rejected a refresh credential permanently."""


class GoogleOAuthRefreshUnavailableError(Exception):
    """The provider could not complete refresh safely right now."""


@dataclass(frozen=True, slots=True, repr=False)
class GoogleOAuthRefreshResult:
    access_token: str
    refresh_token: str | None
    expires_at: int
    scope: str = GOOGLE_YOUTUBE_READONLY_SCOPE

    def __repr__(self) -> str:
        return (
            "GoogleOAuthRefreshResult("
            "access_token=<redacted>, "
            f"refresh_token={'<redacted>' if self.refresh_token else None}, "
            f"expires_at={self.expires_at}, scope={self.scope!r})"
        )


async def _read_bounded_response(response: httpx.Response) -> bytes:
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body.extend(chunk)
        if len(body) > MAX_TOKEN_RESPONSE_BYTES:
            raise GoogleOAuthRefreshUnavailableError(
                "Google token response exceeded the configured limit"
            )
    return bytes(body)


async def refresh_google_oauth_token(
    refresh_token: str,
    *,
    client_id: str,
    client_secret: str,
    transport: httpx.AsyncBaseTransport | None = None,
    now: datetime | None = None,
) -> GoogleOAuthRefreshResult:
    """Exchange a trusted Google refresh token through a fixed provider endpoint."""

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(8.0, connect=3.0),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        ) as client:
            async with client.stream(
                "POST",
                GOOGLE_OAUTH_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            ) as response:
                body = await _read_bounded_response(response)
    except GoogleOAuthRefreshRejectedError:
        raise
    except GoogleOAuthRefreshUnavailableError:
        raise
    except httpx.HTTPError as exc:
        raise GoogleOAuthRefreshUnavailableError(
            "Google token refresh is temporarily unavailable"
        ) from exc

    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise GoogleOAuthRefreshUnavailableError(
            "Google returned an invalid token response"
        ) from exc
    if not isinstance(payload, dict):
        raise GoogleOAuthRefreshUnavailableError(
            "Google returned an invalid token response"
        )

    if response.status_code != 200:
        # Only invalid_grant proves that the user's stored refresh credential is
        # no longer usable. Configuration errors, throttling, redirects, and
        # provider outages must not destructively unlink an otherwise valid
        # authorization.
        if response.status_code == 400 and payload.get("error") == "invalid_grant":
            raise GoogleOAuthRefreshRejectedError(
                "Google rejected the stored refresh credential"
            )
        raise GoogleOAuthRefreshUnavailableError(
            "Google token refresh is temporarily unavailable"
        )

    access_token = payload.get("access_token")
    rotated_refresh_token = payload.get("refresh_token")
    expires_in = payload.get("expires_in")
    scope = payload.get("scope")
    token_type = payload.get("token_type")
    if isinstance(scope, str) and not has_google_youtube_read_scope(scope):
        # Unlike an omitted scope (which OAuth defines as unchanged), an
        # explicit scope set without youtube.readonly proves that the refreshed
        # grant no longer authorizes this feature.
        raise GoogleOAuthRefreshRejectedError(
            "Google refresh no longer includes YouTube authorization"
        )
    if (
        not isinstance(access_token, str)
        or not access_token
        or len(access_token) > 16_384
        or (
            rotated_refresh_token is not None
            and (
                not isinstance(rotated_refresh_token, str)
                or not rotated_refresh_token
                or len(rotated_refresh_token) > 16_384
            )
        )
        or isinstance(expires_in, bool)
        or not isinstance(expires_in, int)
        or expires_in < 1
        or expires_in > 86_400
        or (scope is not None and not isinstance(scope, str))
        or (isinstance(scope, str) and len(scope) > 4096)
        or (
            token_type is not None
            and (
                not isinstance(token_type, str)
                or token_type.casefold() != "bearer"
            )
        )
    ):
        raise GoogleOAuthRefreshUnavailableError(
            "Google returned an invalid token response"
        )

    issued_at = now or datetime.now(UTC)
    return GoogleOAuthRefreshResult(
        access_token=access_token,
        refresh_token=rotated_refresh_token,
        expires_at=int(issued_at.timestamp()) + expires_in,
    )


__all__ = [
    "GOOGLE_OAUTH_TOKEN_URL",
    "GoogleOAuthRefreshRejectedError",
    "GoogleOAuthRefreshResult",
    "GoogleOAuthRefreshUnavailableError",
    "refresh_google_oauth_token",
]
