from __future__ import annotations

import json
import logging
import sys
from types import SimpleNamespace

from httpx import AsyncClient
from starlette.requests import Request

from app.core import error_reporting
from app.core.errors import unhandled_exception_handler
from app.core.logging import JsonFormatter
from app.core.rate_limit import CLIENT_ERROR_LIMIT


def _record_with_exception() -> logging.LogRecord:
    try:
        raise RuntimeError(
            "customer@example.com Bearer abc.def.ghi "
            "postgresql://operator:password@db.example/creatorjobs"
        )
    except RuntimeError:
        return logging.LogRecord(
            name="creatorjobs.test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="provider failed for %s with token=%s",
            args=("customer@example.com", "top-secret-token"),
            exc_info=sys.exc_info(),
        )


def test_json_logging_never_formats_arguments_or_exception_messages() -> None:
    rendered = JsonFormatter().format(_record_with_exception())
    payload = json.loads(rendered)

    assert payload["message"] == "provider failed for %s with token=[redacted]"
    assert payload["exception"]["type"] == "RuntimeError"
    assert payload["exception"]["frames"]
    assert payload["exception"]["frames"][-1]["file"] == "test_error_reporting.py"
    for forbidden in (
        "customer@example.com",
        "top-secret-token",
        "operator:password",
        "postgresql://",
        "Bearer abc",
    ):
        assert forbidden not in rendered


def test_json_logging_redacts_an_already_interpolated_label() -> None:
    record = logging.LogRecord(
        name="creatorjobs.test",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=(
            "failed customer@example.com Authorization: super-secret "
            "https://creatorjobs.example/private?token=secret"
        ),
        args=(),
        exc_info=None,
    )

    rendered = JsonFormatter().format(record)

    assert "customer@example.com" not in rendered
    assert "super-secret" not in rendered
    assert "creatorjobs.example" not in rendered
    assert "[redacted-email]" in rendered
    assert "[redacted-url]" in rendered


async def test_client_error_ingestion_is_bounded_and_contains_no_customer_content(
    client: AsyncClient,
    monkeypatch,
) -> None:
    captured: list[dict[str, object]] = []

    def capture(_message: str, *, extra: dict[str, object]) -> None:
        captured.append(extra["error_event"])

    monkeypatch.setattr(error_reporting.logger, "error", capture)
    response = await client.post(
        "/api/v1/telemetry/client-errors",
        json={
            "boundary": "route",
            "name": "TypeError",
            "digest": "abc_123456",
            "release": "0123456789abcdef",
            "frames": [
                {
                    "file": "/_next/static/chunks/app/jobs/page-a1b2c3.js",
                    "line": 12,
                    "column": 34,
                    "function": "renderJob",
                }
            ],
        },
    )

    assert response.status_code == 202
    assert response.content == b""
    assert captured == [
        {
            "source": "browser",
            "kind": "client_exception",
            "exception_type": "TypeError",
            "boundary": "route",
            "digest": "abc_123456",
            "release": "0123456789abcdef",
            "frames": [
                {
                    "file": "/_next/static/chunks/app/jobs/page-a1b2c3.js",
                    "line": 12,
                    "column": 34,
                    "function": "renderJob",
                }
            ],
        }
    ]
    assert CLIENT_ERROR_LIMIT.limit == 30
    assert CLIENT_ERROR_LIMIT.window_seconds == 300


async def test_client_error_ingestion_rejects_messages_urls_and_extra_fields(
    client: AsyncClient,
) -> None:
    response = await client.post(
        "/api/v1/telemetry/client-errors",
        json={
            "boundary": "route",
            "name": "Error",
            "message": "Private message from customer@example.com",
            "url": "https://creatorjobs.example/u/private-customer",
            "frames": [],
        },
    )

    assert response.status_code == 422


async def test_error_ingestion_failure_never_replaces_the_safe_500(monkeypatch) -> None:
    def unavailable(*_args, **_kwargs) -> None:
        raise OSError("stdout drain unavailable for customer@example.com")

    monkeypatch.setattr(error_reporting.logger, "error", unavailable)
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/users/private-slug",
        "headers": [],
        "route": SimpleNamespace(path="/users/{username}"),
        "state": {"request_id": "server-owned-request-id"},
    }
    request = Request(scope)
    try:
        raise ValueError("customer@example.com secret-token")
    except ValueError as exc:
        response = await unhandled_exception_handler(request, exc)

    assert response.status_code == 500
    body = json.loads(response.body)
    assert body == {
        "error": {
            "code": "internal_server_error",
            "message": "Internal server error",
            "request_id": "server-owned-request-id",
        }
    }
