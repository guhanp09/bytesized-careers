from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest

from app.services.google_oauth_revocation import (
    GOOGLE_OAUTH_REVOCATION_URL,
    revoke_google_oauth_token,
)


@pytest.mark.parametrize(
    ("status_code", "body", "expected"),
    [
        (200, b"", "confirmed"),
        (400, b'{"error":"invalid_token"}', "already_invalid"),
        (400, b'{"error":"invalid_request"}', "rejected"),
        (403, b"", "rejected"),
        (503, b"", "unavailable"),
    ],
)
async def test_google_revocation_uses_fixed_bounded_post_contract(
    status_code: int,
    body: bytes,
    expected: str,
) -> None:
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return httpx.Response(status_code, content=body, request=request)

    secret = "provider-refresh-secret"
    result = await revoke_google_oauth_token(
        secret,
        transport=httpx.MockTransport(handler),
    )

    assert result.status == expected
    assert secret not in repr(result)
    assert len(observed) == 1
    request = observed[0]
    assert request.method == "POST"
    assert str(request.url) == GOOGLE_OAUTH_REVOCATION_URL
    assert request.headers["content-type"].startswith(
        "application/x-www-form-urlencoded"
    )
    assert parse_qs(request.content.decode()) == {"token": [secret]}


async def test_google_revocation_fails_closed_on_network_and_oversized_error() -> None:
    def unavailable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("provider unavailable", request=request)

    network_result = await revoke_google_oauth_token(
        "network-secret",
        transport=httpx.MockTransport(unavailable),
    )
    assert network_result.status == "unavailable"

    def oversized(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, content=b"x" * 5000, request=request)

    oversized_result = await revoke_google_oauth_token(
        "oversized-secret",
        transport=httpx.MockTransport(oversized),
    )
    assert oversized_result.status == "rejected"
