"""Non-queuing resource admission and slot ownership through ASGI cleanup."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from pydantic import ValidationError
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.types import Message, Scope

from app.core.config import Settings, settings
from app.main import app as real_app
from app.middleware.http_admission import LOCAL_HTTP_CAPACITY, HttpAdmissionMiddleware
from app.middleware.operational_metrics import OperationalMetricsMiddleware
from app.middleware.request_body_limit import RequestBodyLimitMiddleware
from app.middleware.request_id import RequestIDMiddleware

pytestmark = pytest.mark.anyio


def _scope(path: str = "/work", method: str = "POST", kind: str = "http") -> Scope:
    return {"type": kind, "method": method, "path": path, "headers": []}


async def _unused_receive() -> Message:
    raise AssertionError("admission must not read the request body")


async def _invoke(middleware, scope: Scope | None = None) -> list[Message]:
    sent: list[Message] = []

    async def send(message: Message) -> None:
        sent.append(message)

    await middleware(scope or _scope(), _unused_receive, send)
    return sent


async def test_exact_capacity_under_contention_without_a_waiting_queue() -> None:
    entered = asyncio.Event()
    release = asyncio.Event()
    rejected = asyncio.Event()
    admitted_count = 0
    rejected_count = 0

    async def handler(scope, receive, send):
        nonlocal admitted_count
        admitted_count += 1
        if admitted_count == 7:
            entered.set()
        await release.wait()
        await JSONResponse({"ok": True})(scope, receive, send)

    middleware = HttpAdmissionMiddleware(handler, max_concurrent_requests=7)

    async def request():
        nonlocal rejected_count
        messages = await _invoke(middleware)
        if messages[0]["status"] == 503:
            rejected_count += 1
            if rejected_count == 93:
                rejected.set()
        return messages

    tasks = [asyncio.create_task(request()) for _ in range(100)]
    try:
        # Events, not sleeps: all rejected work must finish while the admitted
        # requests remain held, proving rejection does not queue behind them.
        await asyncio.wait_for(entered.wait(), 5)
        await asyncio.wait_for(rejected.wait(), 5)
        assert admitted_count == 7
    finally:
        release.set()
        results = await asyncio.gather(*tasks)

    assert sum(result[0]["status"] == 200 for result in results) == 7
    assert sum(result[0]["status"] == 503 for result in results) == 93
    assert (await _invoke(middleware))[0]["status"] == 200


async def test_cancellation_holds_capacity_until_handler_cleanup_finishes() -> None:
    entered = asyncio.Event()
    cleaning = asyncio.Event()
    cleanup_allowed = asyncio.Event()
    never = asyncio.Event()
    calls = 0

    async def handler(scope, receive, send):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            try:
                await never.wait()
            finally:
                cleaning.set()
                await cleanup_allowed.wait()
        await JSONResponse({"ok": True})(scope, receive, send)

    middleware = HttpAdmissionMiddleware(handler, max_concurrent_requests=1)
    task = asyncio.create_task(_invoke(middleware))
    try:
        await asyncio.wait_for(entered.wait(), 5)
        task.cancel()
        await asyncio.wait_for(cleaning.wait(), 5)
        assert (await _invoke(middleware))[0]["status"] == 503
        assert calls == 1
    finally:
        cleanup_allowed.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert (await _invoke(middleware))[0]["status"] == 200


@pytest.mark.parametrize("failure", [RuntimeError("handler failed"), asyncio.CancelledError()])
async def test_handler_failure_and_disconnect_cancellation_do_not_leak_slots(failure) -> None:
    calls = 0

    async def handler(scope, receive, send):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise failure
        await JSONResponse({"ok": True})(scope, receive, send)

    middleware = HttpAdmissionMiddleware(handler, max_concurrent_requests=1)
    with pytest.raises(type(failure)):
        await _invoke(middleware)
    assert (await _invoke(middleware))[0]["status"] == 200


async def test_response_transmission_and_send_errors_keep_correct_slot_ownership() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def handler(scope, receive, send):
        await JSONResponse({"ok": True})(scope, receive, send)

    async def blocked_send(message: Message) -> None:
        if message["type"] == "http.response.body":
            started.set()
            await release.wait()
            raise OSError("client disconnected")

    middleware = HttpAdmissionMiddleware(handler, max_concurrent_requests=1)
    task = asyncio.create_task(middleware(_scope(), _unused_receive, blocked_send))
    try:
        await asyncio.wait_for(started.wait(), 5)
        assert (await _invoke(middleware))[0]["status"] == 503
    finally:
        release.set()
        with pytest.raises(OSError, match="client disconnected"):
            await task
    assert (await _invoke(middleware))[0]["status"] == 200


async def test_reserved_liveness_slot_is_independent_exact_and_itself_bounded() -> None:
    ordinary_entered = asyncio.Event()
    health_entered = asyncio.Event()
    release = asyncio.Event()
    health_path = f"{settings.api_v1_prefix}/health"

    async def handler(scope, receive, send):
        (health_entered if scope["path"] == health_path else ordinary_entered).set()
        await release.wait()
        await JSONResponse({"ok": True})(scope, receive, send)

    middleware = HttpAdmissionMiddleware(handler, max_concurrent_requests=1)
    ordinary = asyncio.create_task(_invoke(middleware))
    health = asyncio.create_task(_invoke(middleware, _scope(health_path, "GET")))
    try:
        await asyncio.wait_for(ordinary_entered.wait(), 5)
        await asyncio.wait_for(health_entered.wait(), 5)
        # The reserved slot cannot become an unlimited bypass via a prefix,
        # method, readiness/feature probe, or even additional liveness traffic.
        for path, method in [
            (health_path, "GET"),
            (health_path, "POST"),
            (health_path + "/", "GET"),
            (health_path + "/ready", "GET"),
            (health_path + "/job-import", "GET"),
            (health_path + "x", "GET"),
            ("/work", "POST"),
        ]:
            assert (await _invoke(middleware, _scope(path, method)))[0]["status"] == 503
    finally:
        release.set()
        assert all(result[0]["status"] == 200 for result in await asyncio.gather(ordinary, health))
    assert (await _invoke(middleware, _scope(health_path, "GET")))[0]["status"] == 200


@pytest.mark.parametrize("kind", ["websocket", "lifespan"])
async def test_non_http_scopes_are_passed_through_without_changing_the_contract(kind) -> None:
    scope = _scope(kind=kind)
    observed = []

    async def handler(inner_scope, receive, send):
        observed.append((inner_scope, receive))

    middleware = HttpAdmissionMiddleware(handler, max_concurrent_requests=1)
    await _invoke(middleware, scope)
    assert observed == [(scope, _unused_receive)]


async def test_overload_retains_cors_correlation_privacy_and_no_store_headers() -> None:
    entered = asyncio.Event()
    release = asyncio.Event()

    async def handler(scope, receive, send):
        entered.set()
        await release.wait()
        await JSONResponse({"ok": True})(scope, receive, send)

    admitted = HttpAdmissionMiddleware(handler, max_concurrent_requests=1)
    wrapped = CORSMiddleware(
        RequestIDMiddleware(admitted),
        allow_origins=["https://creatorjobs.example"],
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=wrapped), base_url="http://test"
    ) as client:
        first = asyncio.create_task(client.get("/work"))
        try:
            await asyncio.wait_for(entered.wait(), 5)
            response = await client.post(
                "/secret-path?token=private",
                content=b"private-body",
                headers={
                    "Origin": "https://creatorjobs.example",
                    "X-Request-ID": "private-email@example.test",
                },
            )
            assert response.status_code == 503
            assert response.headers["access-control-allow-origin"] == "https://creatorjobs.example"
            assert response.headers["cache-control"] == "no-store"
            assert response.headers["retry-after"] == "1"
            assert response.headers["connection"] == "close"
            assert response.json()["error"]["code"] == "server_busy"
            assert response.json()["error"]["request_id"] == response.headers["x-request-id"]
            assert "private" not in response.text
            assert "secret-path" not in response.text
        finally:
            release.set()
            assert (await first).status_code == 200


async def test_installed_policy_precedes_body_parsing_and_remains_inside_metrics_and_cors() -> None:
    order = [middleware.cls for middleware in real_app.user_middleware]
    assert order.count(HttpAdmissionMiddleware) == 1
    assert order.index(HttpAdmissionMiddleware) < order.index(RequestBodyLimitMiddleware)
    assert order.index(OperationalMetricsMiddleware) < order.index(HttpAdmissionMiddleware)
    assert order.index(RequestIDMiddleware) < order.index(HttpAdmissionMiddleware)
    assert order.index(CORSMiddleware) < order.index(HttpAdmissionMiddleware)


@pytest.mark.parametrize("capacity", [0, -1, 10_001])
async def test_capacity_configuration_cannot_be_unbounded(capacity: int) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, MAX_CONCURRENT_HTTP_REQUESTS=capacity)


async def test_production_cannot_inherit_the_local_capacity(monkeypatch) -> None:
    async def handler(scope, receive, send):
        await JSONResponse({"ok": True})(scope, receive, send)

    monkeypatch.setattr(settings, "max_concurrent_http_requests", None)
    monkeypatch.setattr(settings, "app_env", "test")
    assert HttpAdmissionMiddleware(handler).capacity == LOCAL_HTTP_CAPACITY
    monkeypatch.setattr(settings, "app_env", "production")
    with pytest.raises(RuntimeError, match="MAX_CONCURRENT_HTTP_REQUESTS"):
        HttpAdmissionMiddleware(handler)
    monkeypatch.setattr(settings, "max_concurrent_http_requests", 3)
    assert HttpAdmissionMiddleware(handler).capacity == 3


async def test_rejection_does_not_leak_capacity_if_its_send_fails() -> None:
    entered = asyncio.Event()
    release = asyncio.Event()

    async def handler(scope, receive, send):
        entered.set()
        await release.wait()
        await JSONResponse({"ok": True})(scope, receive, send)

    async def failed_send(_message):
        raise OSError("disconnected before overload response")

    middleware = HttpAdmissionMiddleware(handler, max_concurrent_requests=1)
    task = asyncio.create_task(_invoke(middleware))
    try:
        await asyncio.wait_for(entered.wait(), 5)
        with pytest.raises(OSError):
            await middleware(_scope(), _unused_receive, failed_send)
        assert (await _invoke(middleware))[0]["status"] == 503
    finally:
        release.set()
        await task
    assert (await _invoke(middleware))[0]["status"] == 200
