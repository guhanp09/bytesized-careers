from __future__ import annotations

import json
from io import StringIO
from pathlib import Path

from app.core.operational_alerts import (
    ALERT_DEFINITIONS,
    AlertKey,
    evaluate_log_record,
)
from scripts.evaluate_operational_alerts import evaluate_stream

_ALERT_FIXTURES: dict[AlertKey, dict[str, object]] = {
    AlertKey.BACKEND_UNHANDLED: {
        "error_event": {"source": "backend", "kind": "unhandled_exception"}
    },
    AlertKey.BROWSER_EXCEPTION: {
        "error_event": {"source": "browser", "kind": "client_exception"}
    },
    AlertKey.DATABASE_UNAVAILABLE: {
        "metric_event": {"name": "database.probe", "outcome": "unavailable"}
    },
    AlertKey.RATE_LIMIT_UNAVAILABLE: {
        "metric_event": {"name": "redis.rate_limit", "outcome": "unavailable"}
    },
    AlertKey.EMAIL_WORKER_FAILED: {
        "metric_event": {"name": "email.worker_pass", "outcome": "failed"}
    },
    AlertKey.EMAIL_DELIVERY_FAILED: {
        "metric_event": {
            "name": "email.delivery",
            "outcome": "failed",
            "count": 4,
        }
    },
    AlertKey.EMAIL_ENQUEUE_FAILED: {"message": "notification_email_queue_failed"},
    AlertKey.REALTIME_PUBLISH_FAILED: {
        "metric_event": {"name": "realtime.publish", "outcome": "failed"}
    },
    AlertKey.AI_PROVIDER_FAILED: {
        "metric_event": {"name": "ai.provider_call", "outcome": "failed"}
    },
    AlertKey.JOB_IMPORT_SWEEPER_FAILED: {"message": "job_import_sweep_failed"},
}


def test_every_alert_definition_has_a_selectable_finite_rule() -> None:
    assert set(_ALERT_FIXTURES) == set(ALERT_DEFINITIONS)

    selected: set[AlertKey] = set()
    for expected_key, record in _ALERT_FIXTURES.items():
        alerts = evaluate_log_record(record)
        assert len(alerts) == 1
        alert = alerts[0]
        assert alert.definition.key is expected_key
        assert set(alert.as_dict()) == {
            "key",
            "severity",
            "summary",
            "runbook",
            "count",
        }
        assert alert.as_dict()["runbook"].startswith("docs/OPERATIONS_ALERTS.md#")
        selected.add(alert.definition.key)

    assert selected == set(ALERT_DEFINITIONS)


def test_normal_and_recoverable_states_do_not_wake_an_operator() -> None:
    records = (
        {"metric_event": {"name": "http.request", "outcome": "success"}},
        {"metric_event": {"name": "http.request", "outcome": "client_error"}},
        {"metric_event": {"name": "redis.rate_limit", "outcome": "rejected"}},
        {"metric_event": {"name": "email.delivery", "outcome": "retrying"}},
        {"metric_event": {"name": "email.delivery", "outcome": "suppressed"}},
        {"metric_event": {"name": "ai.provider_call", "outcome": "cancelled"}},
        {"message": "email_worker_started"},
    )

    assert all(evaluate_log_record(record) == () for record in records)


def test_alert_payload_never_copies_customer_or_provider_content() -> None:
    record = {
        "message": "job_import_sweep_failed",
        "request_id": "private-customer@example.com",
        "exception": {"message": "Bearer private-token"},
        "metric_event": {
            "name": "ai.provider_call",
            "outcome": "failed",
            "source": "Private job text",
            "url": "https://creatorjobs.example/u/private-customer",
        },
        "customer": "private-customer@example.com",
    }

    rendered = json.dumps([alert.as_dict() for alert in evaluate_log_record(record)])

    assert "private-customer" not in rendered
    assert "private-token" not in rendered
    assert "Private job text" not in rendered
    assert "creatorjobs.example" not in rendered


def test_static_log_rules_require_exact_equality() -> None:
    assert evaluate_log_record(
        {
            "message": (
                "job_import_sweep_failed for private-customer@example.com"
            )
        }
    ) == ()
    assert evaluate_log_record({"message": 123}) == ()
    assert evaluate_log_record("not an object") == ()


def test_stream_consumer_deduplicates_each_finite_key_and_sets_exit_status() -> None:
    lines = [
        "not-json\n",
        json.dumps(_ALERT_FIXTURES[AlertKey.EMAIL_DELIVERY_FAILED]) + "\n",
        json.dumps(_ALERT_FIXTURES[AlertKey.EMAIL_DELIVERY_FAILED]) + "\n",
        json.dumps(_ALERT_FIXTURES[AlertKey.DATABASE_UNAVAILABLE]) + "\n",
    ]
    output = StringIO()

    status = evaluate_stream(lines, output)
    emitted = [json.loads(line)["alert_event"] for line in output.getvalue().splitlines()]

    assert status == 2
    assert [event["key"] for event in emitted] == [
        AlertKey.EMAIL_DELIVERY_FAILED.value,
        AlertKey.DATABASE_UNAVAILABLE.value,
    ]
    assert emitted[0]["count"] == 4


def test_stream_consumer_returns_success_when_no_alert_is_selected() -> None:
    output = StringIO()

    status = evaluate_stream(
        [json.dumps({"metric_event": {"name": "email.delivery", "outcome": "retrying"}})],
        output,
    )

    assert status == 0
    assert output.getvalue() == ""


def test_every_alert_rule_has_a_production_producer_and_one_cli_consumer() -> None:
    backend = Path(__file__).resolve().parents[1]
    evidence = {
        AlertKey.BACKEND_UNHANDLED: ("app/core/error_reporting.py", "unhandled_exception"),
        AlertKey.BROWSER_EXCEPTION: ("app/core/error_reporting.py", "client_exception"),
        AlertKey.DATABASE_UNAVAILABLE: ("app/health/service.py", "record_database_probe"),
        AlertKey.RATE_LIMIT_UNAVAILABLE: ("app/core/rate_limit.py", "record_redis_rate_limit"),
        AlertKey.EMAIL_WORKER_FAILED: ("app/notifications/runner.py", "record_email_worker_pass"),
        AlertKey.EMAIL_DELIVERY_FAILED: ("app/notifications/worker.py", "record_email_deliveries"),
        AlertKey.EMAIL_ENQUEUE_FAILED: (
            "app/notifications/service.py",
            "notification_email_queue_failed",
        ),
        AlertKey.REALTIME_PUBLISH_FAILED: (
            "app/realtime/manager.py",
            "record_realtime_publish",
        ),
        AlertKey.AI_PROVIDER_FAILED: (
            "app/services/job_import_processing_service.py",
            "record_ai_provider_call",
        ),
        AlertKey.JOB_IMPORT_SWEEPER_FAILED: (
            "app/services/job_import_sweeper.py",
            "job_import_sweep_failed",
        ),
    }
    assert set(evidence) == set(ALERT_DEFINITIONS)

    for key, (relative_path, marker) in evidence.items():
        source = (backend / relative_path).read_text()
        assert marker in source, f"{key.value} has no production producer"

    consumer = (backend / "scripts/evaluate_operational_alerts.py").read_text()
    assert consumer.count("evaluate_log_record(record)") == 1
    assert consumer.count('{"alert_event": alert.as_dict()}') == 1


def test_every_alert_points_to_a_real_specific_runbook_section() -> None:
    repository = Path(__file__).resolve().parents[2]
    runbook = (repository / "docs/OPERATIONS_ALERTS.md").read_text()
    anchors = {
        "-".join(line.removeprefix("## ").strip().lower().split())
        for line in runbook.splitlines()
        if line.startswith("## ")
    }

    for definition in ALERT_DEFINITIONS.values():
        path, separator, anchor = definition.runbook.partition("#")
        assert path == "docs/OPERATIONS_ALERTS.md"
        assert separator == "#"
        assert anchor in anchors
