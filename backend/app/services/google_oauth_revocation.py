from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

import httpx

GOOGLE_OAUTH_REVOCATION_URL = "https://oauth2.googleapis.com/revoke"
MAX_REVOCATION_RESPONSE_BYTES = 4096

GoogleOAuthRevocationStatus = Literal[
    "confirmed",
    "already_invalid",
    "rejected",
    "unavailable",
    "not_applicable",
]


@dataclass(frozen=True, slots=True)
class GoogleOAuthRevocationResult:
    status: GoogleOAuthRevocationStatus


async def _read_bounded_response(response: httpx.Response) -> bytes | None:
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body.extend(chunk)
        if len(body) > MAX_REVOCATION_RESPONSE_BYTES:
            return None
    return bytes(body)


async def revoke_google_oauth_token(
    token: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> GoogleOAuthRevocationResult:
    """Revoke one Google grant without following redirects or environment proxies.

    Google documents that revoking either an access or refresh token removes the
    grant's scopes. The caller therefore serializes this request against a new
    authorization and clears every local credential regardless of the remote
    outcome.
    """

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(5.0, connect=3.0),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        ) as client:
            async with client.stream(
                "POST",
                GOOGLE_OAUTH_REVOCATION_URL,
                data={"token": token},
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            ) as response:
                if response.status_code == 200:
                    return GoogleOAuthRevocationResult(status="confirmed")
                body = await _read_bounded_response(response)
                if body is None:
                    return GoogleOAuthRevocationResult(status="rejected")
                error_code: str | None = None
                if body:
                    try:
                        payload = json.loads(body)
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        payload = None
                    if isinstance(payload, dict) and isinstance(payload.get("error"), str):
                        error_code = payload["error"]
                if response.status_code == 400 and error_code == "invalid_token":
                    return GoogleOAuthRevocationResult(status="already_invalid")
                if response.status_code < 500:
                    return GoogleOAuthRevocationResult(status="rejected")
                return GoogleOAuthRevocationResult(status="unavailable")
    except httpx.HTTPError:
        return GoogleOAuthRevocationResult(status="unavailable")


__all__ = [
    "GOOGLE_OAUTH_REVOCATION_URL",
    "GoogleOAuthRevocationResult",
    "GoogleOAuthRevocationStatus",
    "revoke_google_oauth_token",
]
