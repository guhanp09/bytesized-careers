"""How much of a request this service is willing to hold in memory.

There was no answer to that question before this existed. The nearest thing was
a 5 MiB check on decoded avatar bytes in `profile_service`, and it is honest
about its intent but runs far too late to protect anything: by the time
`len(image_bytes)` is evaluated the body has been received, buffered, parsed as
JSON, and base64-decoded. Every one of those steps allocates. A caller sending a
few hundred megabytes of JSON got all of it into memory before anything objected.

So this sits at the ASGI boundary, ahead of parsing, and enforces two rules:

* a declared `Content-Length` over the ceiling is refused immediately, without
  reading a byte of the body;
* bytes are counted as they actually arrive, so a request that omits
  `Content-Length` and streams cannot walk past the ceiling either.

The second rule is the one that matters. `Content-Length` is a claim made by the
caller — treating it as the whole defence means anyone willing to omit the header
faces no limit at all.

This deliberately does not buffer. A limiter that reads the body to measure it
has moved the unbounded allocation rather than prevented it, so the counting
happens inside a `receive` wrapper that passes each chunk straight through and
keeps only a running total.

It is not a replacement for the decoded-size checks in the services. Those
protect product meaning — what a profile picture is allowed to be — while this
protects the process. Both are needed, and they are not interchangeable: the
outer one cannot know that 9 MiB of base64 decodes to something too big to be an
avatar, and the inner one cannot run before the allocation it is trying to bound.
"""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.middleware.request_id import get_request_id


class _BodyTooLarge(Exception):
    """Raised from inside the receive wrapper once the ceiling is crossed."""


def _limit_for(path: str) -> int:
    """The ceiling for one request path.

    Matching is exact rather than by prefix or substring. A limiter that decides
    policy with `in` or `startswith` is a limiter that can be talked into the
    larger allowance by a crafted path, and the whole point of this module is
    that the caller does not get to choose.

    Only the two media endpoints need the larger ceiling; everything else gets
    the default, and anything unrecognized fails toward the smaller number.
    """

    prefix = settings.api_v1_prefix.rstrip("/")
    if path in (f"{prefix}/me/avatar", f"{prefix}/me/banner"):
        return settings.max_media_request_body_bytes
    return settings.max_request_body_bytes


def _declared_length(scope: Scope) -> int | None:
    """The `Content-Length` the caller claims, when it is a usable number.

    A malformed or negative value returns `None` rather than an error: the
    request is then bounded by the counting path like any other, which is both
    safer and avoids turning a bad header into a 500.
    """

    for name, value in scope.get("headers") or ():
        if name != b"content-length":
            continue
        try:
            declared = int(value.decode("latin-1").strip())
        except (ValueError, UnicodeDecodeError):
            return None
        return declared if declared >= 0 else None
    return None


async def _send_too_large(send: Send, limit: int) -> None:
    payload = {
        "error": {
            "code": "request_body_too_large",
            "message": (
                "This request is too large. "
                f"The most this endpoint accepts is {limit} bytes."
            ),
            "request_id": get_request_id(),
        }
    }
    body = json.dumps(payload).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                # The caller cannot fix this by retrying the same request, and
                # saying so keeps a client from looping on it.
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class RequestBodyLimitMiddleware:
    """Pure ASGI, deliberately.

    `BaseHTTPMiddleware` would give a friendlier API and take away the thing
    this needs: direct control of `receive`, so chunks can be counted as they
    arrive and refused without the body ever being assembled.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # WebSocket and lifespan carry no HTTP request body. Realtime messaging
        # depends on the socket path staying untouched.
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        limit = _limit_for(scope.get("path", ""))

        declared = _declared_length(scope)
        if declared is not None and declared > limit:
            # Refused without reading anything at all.
            await _send_too_large(send, limit)
            return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge
            return message

        async def counting_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, counting_send)
        except _BodyTooLarge:
            if response_started:
                # The handler already began answering, so the status is spent.
                # Dropping the connection is the only honest option left; it is
                # also unreachable for any endpoint that reads its body before
                # replying, which is all of them that accept one.
                raise
            await _send_too_large(send, limit)
