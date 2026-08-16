"""Where an oversized request stops.

The point of this middleware is not that a huge request eventually fails — it
already did, with a 400 from `profile_service` after the body had been received,
buffered, JSON-parsed and base64-decoded. The point is that it fails *before* any
of that allocates. So most of these tests are about ordering and arithmetic, not
about status codes.

`Content-Length` gets its own tests and so does the streaming path, because they
are different defences. A limiter that trusts only the declared length is
defeated by omitting the header, which is a one-line change for an attacker and
no change at all for an honest client.
"""

from __future__ import annotations

import json

import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.testclient import TestClient

from app.core.config import settings
from app.middleware.request_body_limit import RequestBodyLimitMiddleware

LIMIT = settings.max_request_body_bytes
MEDIA_LIMIT = settings.max_media_request_body_bytes


class _Spy:
    """Records whether the request ever reached the handler."""

    def __init__(self) -> None:
        self.calls = 0
        self.bytes_seen = 0


@pytest.fixture
def spy() -> _Spy:
    return _Spy()


@pytest.fixture
def client(spy: _Spy) -> TestClient:
    """A minimal app carrying only the middleware under test."""

    async def echo(request):
        spy.calls += 1
        body = await request.body()
        spy.bytes_seen += len(body)
        return JSONResponse({"received": len(body)})

    async def socket(websocket):
        await websocket.accept()
        await websocket.send_text("open")
        await websocket.close()

    app = Starlette(
        routes=[
            Route("/echo", echo, methods=["POST", "GET", "PUT"]),
            # Exactly the paths the policy singles out, under the real prefix.
            Route(f"{settings.api_v1_prefix}/me/avatar", echo, methods=["POST"]),
            Route(f"{settings.api_v1_prefix}/me/banner", echo, methods=["POST"]),
            Route(f"{settings.api_v1_prefix}/me/avatarx", echo, methods=["POST"]),
            WebSocketRoute("/ws", socket),
        ]
    )
    app.add_middleware(RequestBodyLimitMiddleware)
    return TestClient(app)


class TestTheOrdinaryCases:
    def test_an_empty_body_is_fine(self, client: TestClient, spy: _Spy) -> None:
        assert client.post("/echo", content=b"").status_code == 200
        assert spy.calls == 1

    def test_a_small_body_is_fine(self, client: TestClient, spy: _Spy) -> None:
        response = client.post("/echo", content=b"x" * 1024)
        assert response.status_code == 200
        assert response.json()["received"] == 1024

    def test_a_body_exactly_at_the_limit_is_accepted(self, client: TestClient, spy: _Spy) -> None:
        # The boundary belongs to the caller, not to the limiter.
        response = client.post("/echo", content=b"x" * LIMIT)
        assert response.status_code == 200
        assert spy.calls == 1

    def test_one_byte_over_the_limit_is_refused(self, client: TestClient, spy: _Spy) -> None:
        response = client.post("/echo", content=b"x" * (LIMIT + 1))
        assert response.status_code == 413
        assert spy.calls == 0

    def test_a_request_with_no_body_at_all_is_untouched(self, client: TestClient) -> None:
        assert client.get("/echo").status_code == 200


class TestTheRefusalIsEarly:
    """The whole reason this exists."""

    def test_an_oversized_request_never_reaches_the_handler(
        self, client: TestClient, spy: _Spy
    ) -> None:
        client.post("/echo", content=b"x" * (LIMIT * 3))

        assert spy.calls == 0, "the handler ran, so the body was already parsed"
        assert spy.bytes_seen == 0

    def test_the_refusal_uses_the_application_error_envelope(self, client: TestClient) -> None:
        response = client.post("/echo", content=b"x" * (LIMIT + 1))

        assert response.status_code == 413
        body = response.json()
        assert "error" in body, f"envelope changed shape: {list(body)}"
        assert body["error"]["code"] == "request_body_too_large"
        assert {"code", "message", "request_id"} <= set(body["error"])

    def test_the_refusal_does_not_echo_the_body_back(self, client: TestClient) -> None:
        # A limiter that quotes the offending payload into its own error has
        # reintroduced the allocation it exists to prevent, and logged it too.
        secret = b"s3cr3t-marker-" + b"x" * (LIMIT + 1)
        response = client.post("/echo", content=secret)

        assert b"s3cr3t-marker" not in response.content


class TestContentLengthIsNotTheOnlyDefence:
    def test_a_declared_oversized_length_is_refused_without_reading(
        self, client: TestClient, spy: _Spy
    ) -> None:
        response = client.post(
            "/echo",
            content=b"x" * 16,
            headers={"content-length": str(LIMIT * 10)},
        )

        assert response.status_code == 413
        assert spy.calls == 0

    def test_a_streamed_body_with_no_declared_length_is_still_bounded(
        self, client: TestClient, spy: _Spy
    ) -> None:
        # This is the case a Content-Length-only limiter misses entirely: the
        # caller simply omits the header and streams as much as it likes.
        def chunks():
            for _ in range((LIMIT // 8192) + 4):
                yield b"x" * 8192

        response = client.post("/echo", content=chunks())

        assert response.status_code == 413, "a chunked body walked past the limit"
        # The handler is *entered* here, unlike the declared-length path, and
        # that is inherent to ASGI: the application is called when the request
        # starts, and the body arrives afterwards. What matters is that it never
        # finishes reading — the limit fires mid-stream and unwinds it, so no
        # complete body is ever assembled.
        assert spy.bytes_seen == 0, "the handler received a body it should never have completed"

    def test_many_small_chunks_cannot_accumulate_past_the_limit(
        self, client: TestClient, spy: _Spy
    ) -> None:
        # Each chunk is trivially small; only the running total is over.
        def chunks():
            for _ in range((LIMIT // 64) + 32):
                yield b"x" * 64

        assert client.post("/echo", content=chunks()).status_code == 413
        assert spy.bytes_seen == 0, "small chunks accumulated into a delivered body"

    def test_a_streamed_body_under_the_limit_still_arrives_whole(
        self, client: TestClient, spy: _Spy
    ) -> None:
        # Counting must not corrupt or truncate what the handler receives.
        total = 8192 * 4

        def chunks():
            for _ in range(4):
                yield b"y" * 8192

        response = client.post("/echo", content=chunks())

        assert response.status_code == 200
        assert response.json()["received"] == total
        assert spy.bytes_seen == total

    @pytest.mark.parametrize("declared", ["-1", "abc", "", "9999999999999999999999"])
    def test_a_malformed_declared_length_does_not_become_a_server_error(
        self, client: TestClient, declared: str
    ) -> None:
        # An unusable header must fall through to the counting path rather than
        # raising. Whatever the outcome, it is never a 500.
        response = client.post(
            "/echo", content=b"x" * 32, headers={"content-length": declared}
        )

        assert response.status_code < 500, f"content-length {declared!r} caused {response.status_code}"


class TestTheMediaAllowance:
    def test_a_banner_sized_payload_is_accepted_on_the_media_path(
        self, client: TestClient, spy: _Spy
    ) -> None:
        # 8 MiB decoded becomes about 10.7 MiB once base64, the data-URL prefix
        # and JSON quoting are counted. If this fails, the ceiling is too low and
        # real uploads break.
        encoded = int(8 * 1024 * 1024 * 4 / 3) + 512
        assert encoded < MEDIA_LIMIT, "the media ceiling cannot fit a legitimate banner"

        response = client.post(
            f"{settings.api_v1_prefix}/me/banner", content=b"x" * encoded
        )

        assert response.status_code == 200
        assert spy.calls == 1

    def test_the_media_allowance_still_has_a_ceiling(self, client: TestClient, spy: _Spy) -> None:
        response = client.post(
            f"{settings.api_v1_prefix}/me/avatar", content=b"x" * (MEDIA_LIMIT + 1)
        )

        assert response.status_code == 413
        assert spy.calls == 0

    def test_the_larger_allowance_does_not_leak_to_ordinary_endpoints(
        self, client: TestClient, spy: _Spy
    ) -> None:
        response = client.post("/echo", content=b"x" * (LIMIT + 1))

        assert response.status_code == 413
        assert spy.calls == 0

    def test_a_path_that_merely_starts_with_a_media_path_gets_the_default(
        self, client: TestClient, spy: _Spy
    ) -> None:
        # Substring or prefix matching here would let any caller claim the larger
        # ceiling by appending to a media path. Matching is exact.
        response = client.post(
            f"{settings.api_v1_prefix}/me/avatarx", content=b"x" * (LIMIT + 1)
        )

        assert response.status_code == 413
        assert spy.calls == 0


class TestOtherProtocolsAreUntouched:
    def test_websockets_still_connect(self, client: TestClient) -> None:
        # The realtime socket carries no HTTP body and must not pass through the
        # body path at all.
        with client.websocket_connect("/ws") as socket:
            assert socket.receive_text() == "open"

    def test_a_get_is_unaffected(self, client: TestClient, spy: _Spy) -> None:
        assert client.get("/echo").status_code == 200
        assert spy.calls == 1


class TestTheConfiguredCeilings:
    def test_the_defaults_are_sane_relative_to_each_other(self) -> None:
        assert LIMIT < MEDIA_LIMIT
        # Job-import source text is capped at 100,000 characters; the default has
        # to clear that comfortably even after JSON escaping.
        assert LIMIT > 512 * 1024

    def test_a_ceiling_cannot_be_configured_absurdly_low(self) -> None:
        from pydantic import ValidationError

        from app.core import config

        with pytest.raises(ValidationError):
            config.Settings(MAX_REQUEST_BODY_BYTES=1)


def test_the_error_body_is_valid_json_for_a_client(client: TestClient) -> None:
    response = client.post("/echo", content=b"x" * (LIMIT + 1))

    assert response.headers["content-type"].startswith("application/json")
    json.loads(response.content)
