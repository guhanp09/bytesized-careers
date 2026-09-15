"""Bound in-flight HTTP work per ASGI worker without queuing more work.

This protects process resources, not account allowances: user quotas still
belong to the shared Redis limiter. Admission happens before parsing, auth,
database checkout and provider work. One separately bounded slot keeps the
dependency-free liveness probe available when ordinary work is saturated.

The slot lasts until the application unwinds, including response transmission
and cancellation cleanup. We never detach work or report a committed mutation
as rolled back; whole-handler deadlines are a separate transaction contract.
"""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings
from app.middleware.request_id import get_request_id

# Development/test only; accommodates the existing 100-caller local exercise.
# Production must supply capacity for its actual process count and memory/DB plan.
LOCAL_HTTP_CAPACITY = 100


class HttpAdmissionMiddleware:
    def __init__(self, app: ASGIApp, *, max_concurrent_requests: int | None = None) -> None:
        self.app = app
        configured = (
            settings.max_concurrent_http_requests
            if max_concurrent_requests is None
            else max_concurrent_requests
        )
        if configured is None:
            if settings.app_env == "production":
                raise RuntimeError("MAX_CONCURRENT_HTTP_REQUESTS is required in production")
            configured = LOCAL_HTTP_CAPACITY
        if isinstance(configured, bool) or not isinstance(configured, int) or configured < 1:
            raise ValueError("HTTP admission capacity must be a positive integer")
        self.capacity = configured
        self._active = 0
        self._active_liveness = 0
        self._liveness_path = f"{settings.api_v1_prefix.rstrip('/')}/health"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        liveness = scope.get("method") == "GET" and scope.get("path") == self._liveness_path
        active = self._active_liveness if liveness else self._active
        limit = 1 if liveness else self.capacity
        if active >= limit:
            await self._reject(send)
            return

        # No await between the capacity check and increment: one event loop is
        # the linearization boundary. Each ASGI worker owns its own instance.
        if liveness:
            self._active_liveness += 1
        else:
            self._active += 1
        try:
            await self.app(scope, receive, send)
        finally:
            # Includes CancelledError, disconnect, handler/send errors, and
            # cleanup after a response. A completed request never leaks a slot.
            if liveness:
                self._active_liveness -= 1
            else:
                self._active -= 1

    @staticmethod
    async def _reject(send: Send) -> None:
        body = json.dumps(
            {
                "error": {
                    "code": "server_busy",
                    "message": "The server is busy. This request was not started. Try again shortly.",
                    "request_id": get_request_id(),
                },
            }
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 503,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"cache-control", b"no-store"),
                    (b"retry-after", b"1"),
                    (b"connection", b"close"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
