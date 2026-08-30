"""Finite alert decisions over CreatorJobs' privacy-bounded log contract.

The application and its workers emit JSON records to stdout.  A production log
drain still has to retain and route those records, but the decision "does this
record require an operator?" should not be rewritten independently in every
provider console.  This module owns that small, provider-neutral decision.

Only already-sanitised, finite event values can select an alert.  The resulting
payload contains static text and a bounded count; it never copies a request ID,
exception text, route, customer value, provider response, or arbitrary label.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Final


class AlertKey(StrEnum):
    BACKEND_UNHANDLED = "backend_unhandled_exception"
    BROWSER_EXCEPTION = "browser_client_exception"
    DATABASE_UNAVAILABLE = "database_unavailable"
    RATE_LIMIT_UNAVAILABLE = "rate_limit_backend_unavailable"
    EMAIL_WORKER_FAILED = "email_worker_failed"
    EMAIL_DELIVERY_FAILED = "email_delivery_failed"
    EMAIL_ENQUEUE_FAILED = "email_enqueue_failed"
    REALTIME_PUBLISH_FAILED = "realtime_publish_failed"
    AI_PROVIDER_FAILED = "ai_provider_failed"
    JOB_IMPORT_SWEEPER_FAILED = "job_import_sweeper_failed"


class AlertSeverity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"


@dataclass(frozen=True)
class AlertDefinition:
    key: AlertKey
    severity: AlertSeverity
    summary: str
    runbook: str


@dataclass(frozen=True)
class OperationalAlert:
    definition: AlertDefinition
    count: int = 1

    def as_dict(self) -> dict[str, object]:
        """Return the only alert payload a downstream router needs."""

        return {
            "key": self.definition.key.value,
            "severity": self.definition.severity.value,
            "summary": self.definition.summary,
            "runbook": self.definition.runbook,
            "count": max(1, min(1_000_000_000, self.count)),
        }


_RUNBOOK = "docs/OPERATIONS_ALERTS.md"

ALERT_DEFINITIONS: Final[dict[AlertKey, AlertDefinition]] = {
    AlertKey.BACKEND_UNHANDLED: AlertDefinition(
        key=AlertKey.BACKEND_UNHANDLED,
        severity=AlertSeverity.HIGH,
        summary="An unhandled backend exception reached a customer request.",
        runbook=f"{_RUNBOOK}#backend-unhandled-exception",
    ),
    AlertKey.BROWSER_EXCEPTION: AlertDefinition(
        key=AlertKey.BROWSER_EXCEPTION,
        severity=AlertSeverity.MEDIUM,
        summary="A browser error boundary or global handler observed an exception.",
        runbook=f"{_RUNBOOK}#browser-client-exception",
    ),
    AlertKey.DATABASE_UNAVAILABLE: AlertDefinition(
        key=AlertKey.DATABASE_UNAVAILABLE,
        severity=AlertSeverity.CRITICAL,
        summary="The database readiness probe could not complete.",
        runbook=f"{_RUNBOOK}#database-unavailable",
    ),
    AlertKey.RATE_LIMIT_UNAVAILABLE: AlertDefinition(
        key=AlertKey.RATE_LIMIT_UNAVAILABLE,
        severity=AlertSeverity.CRITICAL,
        summary="The shared rate-limit backend was unavailable.",
        runbook=f"{_RUNBOOK}#rate-limit-backend-unavailable",
    ),
    AlertKey.EMAIL_WORKER_FAILED: AlertDefinition(
        key=AlertKey.EMAIL_WORKER_FAILED,
        severity=AlertSeverity.HIGH,
        summary="An email worker pass failed before it completed.",
        runbook=f"{_RUNBOOK}#email-worker-failed",
    ),
    AlertKey.EMAIL_DELIVERY_FAILED: AlertDefinition(
        key=AlertKey.EMAIL_DELIVERY_FAILED,
        severity=AlertSeverity.HIGH,
        summary="One or more email outbox rows reached terminal failure.",
        runbook=f"{_RUNBOOK}#email-delivery-failed",
    ),
    AlertKey.EMAIL_ENQUEUE_FAILED: AlertDefinition(
        key=AlertKey.EMAIL_ENQUEUE_FAILED,
        severity=AlertSeverity.HIGH,
        summary="A notification committed without its requested email intent.",
        runbook=f"{_RUNBOOK}#email-enqueue-failed",
    ),
    AlertKey.REALTIME_PUBLISH_FAILED: AlertDefinition(
        key=AlertKey.REALTIME_PUBLISH_FAILED,
        severity=AlertSeverity.MEDIUM,
        summary="A realtime hint failed; durable HTTP state remains authoritative.",
        runbook=f"{_RUNBOOK}#realtime-publish-failed",
    ),
    AlertKey.AI_PROVIDER_FAILED: AlertDefinition(
        key=AlertKey.AI_PROVIDER_FAILED,
        severity=AlertSeverity.MEDIUM,
        summary="An AI import provider call failed inside its bounded attempt.",
        runbook=f"{_RUNBOOK}#ai-provider-failed",
    ),
    AlertKey.JOB_IMPORT_SWEEPER_FAILED: AlertDefinition(
        key=AlertKey.JOB_IMPORT_SWEEPER_FAILED,
        severity=AlertSeverity.HIGH,
        summary="The stranded-import recovery sweep failed.",
        runbook=f"{_RUNBOOK}#job-import-sweeper-failed",
    ),
}


_METRIC_ALERTS: Final[dict[tuple[str, str], AlertKey]] = {
    ("database.probe", "unavailable"): AlertKey.DATABASE_UNAVAILABLE,
    ("redis.rate_limit", "unavailable"): AlertKey.RATE_LIMIT_UNAVAILABLE,
    ("email.worker_pass", "failed"): AlertKey.EMAIL_WORKER_FAILED,
    ("email.delivery", "failed"): AlertKey.EMAIL_DELIVERY_FAILED,
    ("realtime.publish", "failed"): AlertKey.REALTIME_PUBLISH_FAILED,
    ("ai.provider_call", "failed"): AlertKey.AI_PROVIDER_FAILED,
}

_ERROR_ALERTS: Final[dict[tuple[str, str], AlertKey]] = {
    ("backend", "unhandled_exception"): AlertKey.BACKEND_UNHANDLED,
    ("browser", "client_exception"): AlertKey.BROWSER_EXCEPTION,
}

# These producers predate metric_event and already emit one finite static label.
# Equality is intentional: a substring match would turn arbitrary log text into
# an alert selector.
_MESSAGE_ALERTS: Final[dict[str, AlertKey]] = {
    "notification_email_queue_failed": AlertKey.EMAIL_ENQUEUE_FAILED,
    "job_import_sweep_failed": AlertKey.JOB_IMPORT_SWEEPER_FAILED,
}


def _validate_contract() -> None:
    """Refuse a documented alert that no rule can ever produce."""

    rule_keys = set(_METRIC_ALERTS.values()) | set(_ERROR_ALERTS.values()) | set(
        _MESSAGE_ALERTS.values()
    )
    definition_keys = set(ALERT_DEFINITIONS)
    if rule_keys != definition_keys:
        missing_rules = sorted(key.value for key in definition_keys - rule_keys)
        missing_definitions = sorted(key.value for key in rule_keys - definition_keys)
        raise RuntimeError(
            "Operational alert registry mismatch: "
            f"missing rules={missing_rules}; missing definitions={missing_definitions}"
        )


_validate_contract()


def _bounded_count(event: Mapping[object, object]) -> int:
    raw = event.get("count")
    if isinstance(raw, int) and not isinstance(raw, bool) and 1 <= raw <= 1_000_000_000:
        return raw
    return 1


def evaluate_log_record(record: object) -> tuple[OperationalAlert, ...]:
    """Select finite alerts from one structured log record.

    A hostile or malformed line is ignored.  Even when a line contains extra
    customer-controlled fields, none can reach the returned payload.
    """

    if not isinstance(record, Mapping):
        return ()

    selected: list[OperationalAlert] = []

    error_event = record.get("error_event")
    if isinstance(error_event, Mapping):
        source = error_event.get("source")
        kind = error_event.get("kind")
        if isinstance(source, str) and isinstance(kind, str):
            key = _ERROR_ALERTS.get((source, kind))
            if key is not None:
                selected.append(OperationalAlert(ALERT_DEFINITIONS[key]))

    metric_event = record.get("metric_event")
    if isinstance(metric_event, Mapping):
        name = metric_event.get("name")
        outcome = metric_event.get("outcome")
        if isinstance(name, str) and isinstance(outcome, str):
            key = _METRIC_ALERTS.get((name, outcome))
            if key is not None:
                selected.append(
                    OperationalAlert(
                        ALERT_DEFINITIONS[key],
                        count=_bounded_count(metric_event),
                    )
                )

    message = record.get("message")
    if isinstance(message, str):
        key = _MESSAGE_ALERTS.get(message)
        if key is not None:
            selected.append(OperationalAlert(ALERT_DEFINITIONS[key]))

    return tuple(selected)
