"""Small, privacy-bounded operational signals for every deployed process.

The API, email worker, and import sweeper already share one reliable transport:
structured stdout.  Emitting finite metric events there keeps local boot free of
an observability vendor and, unlike an in-process scrape registry, also works in
standalone workers that do not host an HTTP endpoint.

This module is deliberately the only place allowed to construct ``metric_event``
records.  Callers choose through narrow functions, not arbitrary label maps.
That makes label cardinality a code-reviewed schema rather than customer input.
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Mapping
from enum import StrEnum
from typing import Any

logger = logging.getLogger(__name__)


class MetricName(StrEnum):
    HTTP_REQUEST = "http.request"
    DATABASE_PROBE = "database.probe"
    REDIS_RATE_LIMIT = "redis.rate_limit"
    EMAIL_WORKER_PASS = "email.worker_pass"
    EMAIL_DELIVERY = "email.delivery"
    REALTIME_PUBLISH = "realtime.publish"
    AI_PROVIDER_CALL = "ai.provider_call"


class MetricSubsystem(StrEnum):
    HTTP = "http"
    AUTH = "auth"
    MEDIA = "media"
    AI_IMPORT = "ai_import"
    DATABASE = "database"
    REDIS = "redis"
    EMAIL = "email"
    REALTIME = "realtime"


class MetricOutcome(StrEnum):
    SUCCESS = "success"
    CLIENT_ERROR = "client_error"
    SERVER_ERROR = "server_error"
    ALLOWED = "allowed"
    REJECTED = "rejected"
    UNAVAILABLE = "unavailable"
    RETRYING = "retrying"
    FAILED = "failed"
    SUPPRESSED = "suppressed"
    CANCELLED = "cancelled"


_SAFE_ROUTE = re.compile(r"^/[A-Za-z0-9_./{}:-]{0,239}$")
_HTTP_METHODS = frozenset(
    {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"}
)
_METRIC_NAMES = frozenset(member.value for member in MetricName)
_METRIC_SUBSYSTEMS = frozenset(member.value for member in MetricSubsystem)
_METRIC_OUTCOMES = frozenset(member.value for member in MetricOutcome)


def canonical_route_template(scope: Mapping[str, Any]) -> str:
    """Return the framework route template, never the caller's raw path."""

    route = scope.get("route")
    candidate = getattr(route, "path", None)
    if (
        isinstance(candidate, str)
        and _SAFE_ROUTE.fullmatch(candidate)
        and "//" not in candidate
        and ".." not in candidate
    ):
        return candidate
    return "unmatched"


def _http_subsystem(route: str) -> MetricSubsystem:
    if re.search(r"(?:^|/)auth(?:/|$)", route):
        return MetricSubsystem.AUTH
    if route.endswith(("/me/avatar", "/me/banner")):
        return MetricSubsystem.MEDIA
    if re.search(r"(?:^|/)job-imports(?:/|$)", route):
        return MetricSubsystem.AI_IMPORT
    return MetricSubsystem.HTTP


def _duration_ms(elapsed_seconds: float) -> int:
    if not math.isfinite(elapsed_seconds) or elapsed_seconds < 0:
        return 0
    return min(86_400_000, round(elapsed_seconds * 1000))


def safe_metric_event(value: object) -> dict[str, object] | None:
    """Copy only the finite metric schema understood by operators."""

    if not isinstance(value, dict):
        return None
    name = value.get("name")
    subsystem = value.get("subsystem")
    outcome = value.get("outcome")
    if (
        not isinstance(name, str)
        or name not in _METRIC_NAMES
        or not isinstance(subsystem, str)
        or subsystem not in _METRIC_SUBSYSTEMS
        or not isinstance(outcome, str)
        or outcome not in _METRIC_OUTCOMES
    ):
        return None

    event: dict[str, object] = {
        "name": name,
        "subsystem": subsystem,
        "outcome": outcome,
    }
    for field, maximum in (("count", 1_000_000_000), ("duration_ms", 86_400_000)):
        raw = value.get(field)
        if isinstance(raw, int) and not isinstance(raw, bool) and 0 <= raw <= maximum:
            event[field] = raw

    method = value.get("method")
    if isinstance(method, str) and method in _HTTP_METHODS:
        event["method"] = method
    route = value.get("route")
    if (
        route == "unmatched"
        or isinstance(route, str)
        and _SAFE_ROUTE.fullmatch(route)
        and "//" not in route
        and ".." not in route
    ):
        event["route"] = route
    status_code = value.get("status_code")
    if (
        isinstance(status_code, int)
        and not isinstance(status_code, bool)
        and 100 <= status_code <= 599
    ):
        event["status_code"] = status_code
    return event


def _emit(event: dict[str, object]) -> bool:
    """Best effort: losing telemetry must never break the operation measured."""

    safe = safe_metric_event(event)
    if safe is None:
        return False
    try:
        logger.info("metric_event", extra={"metric_event": safe})
    except Exception:
        return False
    return True


def record_http_request(
    scope: Mapping[str, Any],
    *,
    status_code: int,
    elapsed_seconds: float,
    raised: bool = False,
) -> bool:
    route = canonical_route_template(scope)
    method_value = str(scope.get("method", "")).upper()
    method = method_value if method_value in _HTTP_METHODS else ""
    if raised or status_code >= 500:
        outcome = MetricOutcome.SERVER_ERROR
    elif status_code >= 400:
        outcome = MetricOutcome.CLIENT_ERROR
    else:
        outcome = MetricOutcome.SUCCESS
    event: dict[str, object] = {
        "name": MetricName.HTTP_REQUEST.value,
        "subsystem": _http_subsystem(route).value,
        "outcome": outcome.value,
        "count": 1,
        "duration_ms": _duration_ms(elapsed_seconds),
        "route": route,
        "status_code": max(100, min(599, status_code)),
    }
    if method:
        event["method"] = method
    return _emit(event)


def record_database_probe(*, healthy: bool, elapsed_seconds: float) -> bool:
    return _emit(
        {
            "name": MetricName.DATABASE_PROBE.value,
            "subsystem": MetricSubsystem.DATABASE.value,
            "outcome": (
                MetricOutcome.SUCCESS.value if healthy else MetricOutcome.UNAVAILABLE.value
            ),
            "count": 1,
            "duration_ms": _duration_ms(elapsed_seconds),
        }
    )


def record_redis_rate_limit(
    *, allowed: bool | None, elapsed_seconds: float
) -> bool:
    outcome = (
        MetricOutcome.UNAVAILABLE
        if allowed is None
        else MetricOutcome.ALLOWED
        if allowed
        else MetricOutcome.REJECTED
    )
    return _emit(
        {
            "name": MetricName.REDIS_RATE_LIMIT.value,
            "subsystem": MetricSubsystem.REDIS.value,
            "outcome": outcome.value,
            "count": 1,
            "duration_ms": _duration_ms(elapsed_seconds),
        }
    )


def record_email_worker_pass(
    *, succeeded: bool, claimed: int, elapsed_seconds: float
) -> bool:
    return _emit(
        {
            "name": MetricName.EMAIL_WORKER_PASS.value,
            "subsystem": MetricSubsystem.EMAIL.value,
            "outcome": (
                MetricOutcome.SUCCESS.value if succeeded else MetricOutcome.FAILED.value
            ),
            "count": max(0, min(1_000_000_000, claimed)),
            "duration_ms": _duration_ms(elapsed_seconds),
        }
    )


def record_email_deliveries(
    *, sent: int, retrying: int, failed: int, suppressed: int
) -> None:
    outcomes = (
        (MetricOutcome.SUCCESS, sent),
        (MetricOutcome.RETRYING, retrying),
        (MetricOutcome.FAILED, failed),
        (MetricOutcome.SUPPRESSED, suppressed),
    )
    for outcome, count in outcomes:
        if count <= 0:
            continue
        _emit(
            {
                "name": MetricName.EMAIL_DELIVERY.value,
                "subsystem": MetricSubsystem.EMAIL.value,
                "outcome": outcome.value,
                "count": min(1_000_000_000, count),
            }
        )


def record_realtime_publish(*, succeeded: bool, elapsed_seconds: float) -> bool:
    return _emit(
        {
            "name": MetricName.REALTIME_PUBLISH.value,
            "subsystem": MetricSubsystem.REALTIME.value,
            "outcome": (
                MetricOutcome.SUCCESS.value if succeeded else MetricOutcome.FAILED.value
            ),
            "count": 1,
            "duration_ms": _duration_ms(elapsed_seconds),
        }
    )


def record_ai_provider_call(
    *, outcome: MetricOutcome, elapsed_seconds: float
) -> bool:
    if outcome not in {
        MetricOutcome.SUCCESS,
        MetricOutcome.FAILED,
        MetricOutcome.CANCELLED,
    }:
        return False
    return _emit(
        {
            "name": MetricName.AI_PROVIDER_CALL.value,
            "subsystem": MetricSubsystem.AI_IMPORT.value,
            "outcome": outcome.value,
            "count": 1,
            "duration_ms": _duration_ms(elapsed_seconds),
        }
    )
