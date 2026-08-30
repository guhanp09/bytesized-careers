"""ASGI request metrics without reading bodies or customer-controlled paths."""

from __future__ import annotations

import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.operational_metrics import record_http_request


class OperationalMetricsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status_code = 500

        async def observe_send(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, observe_send)
        except BaseException:
            record_http_request(
                scope,
                status_code=status_code,
                elapsed_seconds=time.perf_counter() - started,
                raised=True,
            )
            raise
        else:
            record_http_request(
                scope,
                status_code=status_code,
                elapsed_seconds=time.perf_counter() - started,
            )
