from __future__ import annotations

import inspect
import json
import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import delete

from app.core import operational_metrics
from app.core.logging import JsonFormatter
from app.core.operational_metrics import MetricName, MetricOutcome
from app.core.rate_limit import RateLimitRule, RedisRateLimitBackend
from app.health import service as health_service
from app.middleware.request_id import get_request_id, safe_request_id
from app.models import EmailOutbox
from app.notifications.provider import MockEmailProvider
from app.notifications.worker import process_outbox_once
from app.realtime.bus import RealtimeEvent
from app.realtime.manager import ConversationRealtimeManager
from app.services import job_import_processing_service as processing_module
from app.services.job_import_processing_service import JobImportProcessingService


def _capture_events(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    captured: list[dict[str, object]] = []

    def capture(_message: str, *, extra: dict[str, object]) -> None:
        captured.append(extra["metric_event"])

    monkeypatch.setattr(operational_metrics.logger, "info", capture)
    return captured


def test_metric_schema_drops_customer_content_and_rejects_unknown_labels() -> None:
    record = logging.LogRecord(
        name="creatorjobs.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="metric_event",
        args=(),
        exc_info=None,
    )
    record.metric_event = {
        "name": "http.request",
        "subsystem": "auth",
        "outcome": "client_error",
        "count": 1,
        "duration_ms": 12,
        "method": "POST",
        "route": "/api/v1/auth/login",
        "status_code": 401,
        "email": "private-customer@example.com",
        "url": "https://creatorjobs.example/u/private-customer?token=secret",
        "message": "private message text",
    }

    rendered = JsonFormatter().format(record)
    payload = json.loads(rendered)

    assert payload["metric_event"] == {
        "name": "http.request",
        "subsystem": "auth",
        "outcome": "client_error",
        "count": 1,
        "duration_ms": 12,
        "method": "POST",
        "route": "/api/v1/auth/login",
        "status_code": 401,
    }
    for forbidden in ("private-customer", "token=secret", "private message"):
        assert forbidden not in rendered

    record.metric_event = {
        "name": "customer-chosen-metric",
        "subsystem": "auth",
        "outcome": "success",
    }
    assert "metric_event" not in json.loads(JsonFormatter().format(record))


def test_every_schema_metric_has_a_narrow_producer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _capture_events(monkeypatch)
    scope = {
        "method": "POST",
        "route": SimpleNamespace(path="/api/v1/auth/login"),
    }

    operational_metrics.record_http_request(
        scope,
        status_code=401,
        elapsed_seconds=0.012,
    )
    operational_metrics.record_database_probe(healthy=True, elapsed_seconds=0.002)
    operational_metrics.record_redis_rate_limit(allowed=False, elapsed_seconds=0.003)
    operational_metrics.record_email_worker_pass(
        succeeded=True,
        claimed=3,
        elapsed_seconds=0.004,
    )
    operational_metrics.record_email_deliveries(
        sent=1,
        retrying=1,
        failed=1,
        suppressed=1,
    )
    operational_metrics.record_realtime_publish(succeeded=True, elapsed_seconds=0.001)
    operational_metrics.record_ai_provider_call(
        outcome=MetricOutcome.SUCCESS,
        elapsed_seconds=0.02,
    )

    assert {event["name"] for event in events} == {
        metric_name.value for metric_name in MetricName
    }
    assert all(set(event) <= {
        "name",
        "subsystem",
        "outcome",
        "count",
        "duration_ms",
        "method",
        "route",
        "status_code",
    } for event in events)


async def test_http_metrics_use_route_templates_and_classify_customer_boundaries(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _capture_events(monkeypatch)

    responses = (
        await client.post("/api/v1/auth/login", json={}),
        await client.post("/api/v1/me/avatar", json={}),
        await client.post(
            f"/api/v1/job-imports/drafts/{uuid4()}/process",
            json={},
        ),
        await client.get(
            "/private-customer%40example.com",
            params={"token": "top-secret"},
        ),
    )

    assert all(response.status_code >= 400 for response in responses)
    http_events = [event for event in events if event["name"] == "http.request"]
    by_route = {event["route"]: event for event in http_events}
    # FastAPI's included-router template is relative to the API prefix. That is
    # still the matched finite template (and never the raw request path).
    assert by_route["/auth/login"]["subsystem"] == "auth"
    assert by_route["/me/avatar"]["subsystem"] == "media"
    assert (
        by_route["/job-imports/drafts/{draft_id}/process"]["subsystem"]
        == "ai_import"
    )
    unmatched = by_route["unmatched"]
    assert unmatched["subsystem"] == "http"
    serialized = json.dumps(http_events)
    assert "private-customer" not in serialized
    assert "top-secret" not in serialized


async def test_http_metric_uses_the_response_request_id_as_optional_trace_correlation(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed_request_ids: list[str] = []
    correlation = "0f8fad5b-d9cb-469f-a165-70867728950e"

    def capture(_message: str, *, extra: dict[str, object]) -> None:
        assert extra["metric_event"]["name"] == "http.request"  # type: ignore[index]
        observed_request_ids.append(get_request_id())

    monkeypatch.setattr(operational_metrics.logger, "info", capture)

    response = await client.get(
        "/api/v1/health",
        headers={"X-Request-ID": correlation},
    )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == correlation
    assert observed_request_ids == [correlation]


def test_request_id_refuses_customer_content_and_normalizes_a_uuid() -> None:
    for hostile in (
        "private-customer@example.com",
        "Bearer private-token",
        "https://creatorjobs.example/u/private-customer",
        "a" * 10_000,
        "operator-chosen-label",
    ):
        generated = safe_request_id(hostile)
        assert generated != hostile
        assert len(generated) == 36 and generated.count("-") == 4

    assert (
        safe_request_id("0F8FAD5B-D9CB-469F-A165-70867728950E")
        == "0f8fad5b-d9cb-469f-a165-70867728950e"
    )


async def test_request_middleware_replaces_a_customer_content_request_id(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hostile = "private-customer@example.com"
    observed: list[str] = []

    def capture(_message: str, *, extra: dict[str, object]) -> None:
        observed.append(get_request_id())

    monkeypatch.setattr(operational_metrics.logger, "info", capture)

    response = await client.get(
        "/api/v1/health",
        headers={"X-Request-ID": hostile},
    )

    generated = response.headers["X-Request-ID"]
    assert response.status_code == 200
    assert generated != hostile
    assert len(generated) == 36 and generated.count("-") == 4
    assert observed == [generated]


async def test_metric_sink_failure_never_replaces_the_customer_response(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unavailable(*_args: object, **_kwargs: object) -> None:
        raise OSError("log drain unavailable with private-customer@example.com")

    monkeypatch.setattr(operational_metrics.logger, "info", unavailable)

    response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


class _DatabaseResult:
    def __init__(self, value: int) -> None:
        self.value = value

    def scalar_one(self) -> int:
        return self.value


class _DatabaseSession:
    def __init__(self, value: int = 1, error: Exception | None = None) -> None:
        self.value = value
        self.error = error

    async def execute(self, _statement: object) -> _DatabaseResult:
        if self.error is not None:
            raise self.error
        return _DatabaseResult(self.value)


async def test_database_probe_records_success_and_unavailability_without_detail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _capture_events(monkeypatch)

    assert await health_service.check_db(_DatabaseSession()) is True  # type: ignore[arg-type]
    with pytest.raises(RuntimeError, match="private database detail"):
        await health_service.check_db(  # type: ignore[arg-type]
            _DatabaseSession(error=RuntimeError("private database detail"))
        )

    assert [event["outcome"] for event in events] == ["success", "unavailable"]
    assert "private database detail" not in json.dumps(events)


class _RedisClient:
    def __init__(self, count: int, error: Exception | None = None) -> None:
        self.count = count
        self.error = error

    async def eval(self, *_args: object) -> list[int]:
        if self.error is not None:
            raise self.error
        if self.count >= 2:
            return [0, 60]
        return [1, 0]


def _redis_backend(client: _RedisClient) -> RedisRateLimitBackend:
    backend = object.__new__(RedisRateLimitBackend)
    backend._client = client  # type: ignore[attr-defined]
    return backend


async def test_redis_metrics_distinguish_allowed_rejected_and_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _capture_events(monkeypatch)
    rule = RateLimitRule("test", limit=2, window_seconds=60)

    assert await _redis_backend(_RedisClient(0)).hit(key="private-key", rule=rule) == (
        True,
        0,
    )
    rejected, retry_after = await _redis_backend(_RedisClient(2)).hit(
        key="private-key",
        rule=rule,
    )
    assert rejected is False
    assert retry_after >= 1
    with pytest.raises(RuntimeError, match="redis password"):
        await _redis_backend(
            _RedisClient(0, RuntimeError("redis password private-secret"))
        ).hit(key="private-key", rule=rule)

    assert [event["outcome"] for event in events] == [
        "allowed",
        "rejected",
        "unavailable",
    ]
    serialized = json.dumps(events)
    assert "private-key" not in serialized
    assert "private-secret" not in serialized


async def test_email_pass_emits_counts_without_recipient_or_template_labels(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _capture_events(monkeypatch)
    # Other email suites deliberately commit durable rows. Isolate this direct
    # session test transactionally, then the fixture rollback restores whatever
    # preceded it and removes this test's row.
    await db_session.execute(delete(EmailOutbox))
    db_session.add(
        EmailOutbox(
            to_email="private-customer@example.com",
            event_key="test_event",
            template_key="private-template",
            subject="Private subject",
            status="queued",
        )
    )
    await db_session.flush()

    run = await process_outbox_once(db_session, provider=MockEmailProvider())

    assert run.claimed == 1 and run.sent == 1
    assert [(event["name"], event["outcome"], event["count"]) for event in events] == [
        ("email.worker_pass", "success", 1),
        ("email.delivery", "success", 1),
    ]
    serialized = json.dumps(events)
    assert "private-customer" not in serialized
    assert "private-template" not in serialized
    assert "Private subject" not in serialized


async def test_realtime_publish_records_transport_outcome_without_event_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _capture_events(monkeypatch)

    class GoodBus:
        def set_local_delivery(self, _deliver: object) -> None:
            return None

        async def publish(self, _event: RealtimeEvent) -> None:
            return None

    class BrokenBus(GoodBus):
        async def publish(self, _event: RealtimeEvent) -> None:
            raise RuntimeError("private message body")

    user_id = uuid4()
    payload = {
        "type": "message.created",
        "event_id": "private-event-id",
        "body": "private message body",
    }
    await ConversationRealtimeManager(bus=GoodBus()).publish_to_user(user_id, payload)
    await ConversationRealtimeManager(bus=BrokenBus()).publish_to_user(user_id, payload)

    assert [event["outcome"] for event in events] == ["success", "failed"]
    serialized = json.dumps(events)
    assert str(user_id) not in serialized
    assert "private-event-id" not in serialized
    assert "private message body" not in serialized


async def test_ai_processing_records_provider_success_without_source_or_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _capture_events(monkeypatch)
    owner_id = uuid4()
    draft_id = uuid4()
    initial = SimpleNamespace(
        processing_status="ready_for_processing",
        processing_attempts=0,
    )
    completed = SimpleNamespace(processing_status="awaiting_recruiter_review")
    request = SimpleNamespace(
        source=SimpleNamespace(
            source_type="pasted_text",
            original_text="private source text for private-customer@example.com",
        )
    )
    import_service = SimpleNamespace(
        repository=SimpleNamespace(session=object()),
        get_draft=AsyncMock(return_value=initial),
        build_extraction_request=AsyncMock(return_value=request),
        begin_processing=AsyncMock(),
        record_extraction_result=AsyncMock(return_value=completed),
    )
    provider = SimpleNamespace(
        extract=AsyncMock(
            return_value=SimpleNamespace(
                extraction=object(),
                metadata=object(),
            )
        )
    )
    service = JobImportProcessingService(import_service, provider)
    service._release_lease = AsyncMock()  # type: ignore[method-assign]
    monkeypatch.setattr(
        processing_module,
        "consume_import_quota",
        AsyncMock(return_value=SimpleNamespace(allowed=True)),
    )
    monkeypatch.setattr(
        processing_module,
        "claim_draft_for_processing",
        AsyncMock(return_value=initial),
    )

    result = await service.process(draft_id, owner_user_id=owner_id)

    assert result.outcome == "processed"
    assert [(event["name"], event["outcome"]) for event in events] == [
        ("ai.provider_call", "success")
    ]
    serialized = json.dumps(events)
    assert str(owner_id) not in serialized
    assert str(draft_id) not in serialized
    assert "private source text" not in serialized
    assert "private-customer" not in serialized


def test_every_metric_schema_entry_has_a_real_seam_and_one_formatter_consumer() -> None:
    backend = Path(__file__).resolve().parents[1]
    producers = {
        "record_http_request": "app/middleware/operational_metrics.py",
        "record_database_probe": "app/health/service.py",
        "record_redis_rate_limit": "app/core/rate_limit.py",
        "record_email_worker_pass": "app/notifications/worker.py",
        "record_email_deliveries": "app/notifications/worker.py",
        "record_realtime_publish": "app/realtime/manager.py",
        "record_ai_provider_call": "app/services/job_import_processing_service.py",
    }
    for function_name, relative_path in producers.items():
        source = (backend / relative_path).read_text()
        assert function_name in source, f"{function_name} has no production producer"

    formatter_source = inspect.getsource(JsonFormatter.format)
    assert formatter_source.count("safe_metric_event") == 1
    assert formatter_source.count('payload["metric_event"]') == 1

    direct_producers = []
    for path in (backend / "app").rglob("*.py"):
        if path.name == "operational_metrics.py":
            continue
        if 'extra={"metric_event"' in path.read_text():
            direct_producers.append(str(path.relative_to(backend)))
    assert direct_producers == [], (
        "metric labels bypassed the narrow producer functions: "
        f"{direct_producers}"
    )


def test_metrics_middleware_stays_inside_request_id_and_outside_body_limit() -> None:
    from app import main

    source = inspect.getsource(main)
    body = source.index("app.add_middleware(RequestBodyLimitMiddleware)")
    metrics = source.index("app.add_middleware(OperationalMetricsMiddleware)")
    request_id = source.index("app.add_middleware(RequestIDMiddleware)")

    # Starlette's later add_middleware calls wrap earlier ones. This ordering
    # gives metric logs the request-id context while still observing the body
    # limiter's 413 response.
    assert body < metrics < request_id
