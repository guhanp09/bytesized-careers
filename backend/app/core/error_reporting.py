from __future__ import annotations

import logging
import re
from typing import Any

from starlette.requests import Request

from app.core.logging import safe_traceback_frames

logger = logging.getLogger(__name__)

_SAFE_ROUTE = re.compile(r"^/[A-Za-z0-9_./{}:-]{0,239}$")


def _route_template(request: Request) -> str:
    """Return the matched template, never the customer-controlled URL."""

    route = request.scope.get("route")
    candidate = getattr(route, "path", None)
    if isinstance(candidate, str) and _SAFE_ROUTE.fullmatch(candidate):
        return candidate
    return "unmatched"


def backend_error_event(request: Request, exc: Exception) -> dict[str, object]:
    return {
        "source": "backend",
        "kind": "unhandled_exception",
        "exception_type": type(exc).__name__,
        "method": request.method,
        "route": _route_template(request),
        "frames": safe_traceback_frames(exc.__traceback__),
    }


def emit_error_event(event: dict[str, object]) -> bool:
    """Best-effort event ingestion that can never replace the user response.

    The deployment log drain is the vendor-neutral transport. A blocked or
    broken drain must be visible through platform log-health monitoring, but an
    exception raised while writing one event must not turn a handled failure
    into a second failure or recursively report itself.
    """

    try:
        logger.error("error_event", extra={"error_event": event})
    except Exception:
        return False
    return True


def browser_error_event(payload: Any) -> dict[str, object]:
    """Translate a validated browser DTO into the finite structured schema."""

    event: dict[str, object] = {
        "source": "browser",
        "kind": "client_exception",
        "exception_type": payload.name,
        "boundary": payload.boundary,
        "frames": [frame.model_dump(exclude_none=True) for frame in payload.frames],
    }
    if payload.digest:
        event["digest"] = payload.digest
    if payload.release:
        event["release"] = payload.release
    return event
