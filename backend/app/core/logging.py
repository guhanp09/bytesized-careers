from __future__ import annotations

import json
import logging
import re
import sys
import traceback
from datetime import UTC, datetime
from pathlib import PurePath
from types import TracebackType

from app.middleware.request_id import get_request_id

_EMAIL = re.compile(r"(?<![A-Za-z0-9.!#$%&'*+/=?^_`{|}~-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b(authorization|password|passwd|secret|token|api[_-]?key|client[_-]?secret)"
    r"\s*[:=]\s*([^\s,;&]+)"
)
_URL = re.compile(r"(?i)\b(?:https?|postgres(?:ql)?(?:\+asyncpg)?|redis)://[^\s]+")
_SAFE_IDENTIFIER = re.compile(r"[^A-Za-z0-9_.$<>:-]+")
_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9_./-]+")


def redact_log_text(value: object, *, limit: int = 512) -> str:
    """Bound and redact a log label without ever formatting its arguments.

    Application log calls use static event labels and put deliberately selected
    dimensions in structured fields. Third-party loggers, however, often use a
    ``%s`` template with credentials or request data in ``record.args``. The
    formatter therefore receives the template itself, not ``getMessage()``, so
    those arguments never enter the log stream. The regexes are a second line of
    defence for a label that was already interpolated before logging.
    """

    text = value if isinstance(value, str) else type(value).__name__
    text = _BEARER.sub("Bearer [redacted]", text)
    text = _JWT.sub("[redacted-token]", text)
    text = _SECRET_ASSIGNMENT.sub(lambda match: f"{match.group(1)}=[redacted]", text)
    text = _EMAIL.sub("[redacted-email]", text)
    text = _URL.sub("[redacted-url]", text)
    return text[:limit]


def _safe_identifier(value: object, *, default: str, limit: int = 120) -> str:
    normalized = _SAFE_IDENTIFIER.sub("_", str(value)).strip("_")[:limit]
    return normalized or default


def _safe_filename(filename: str) -> str:
    """Keep a useful module-relative frame name without leaking a host path."""

    parts = PurePath(filename.replace("\\", "/")).parts
    if "app" in parts:
        # Use the last `app` component. A checkout path itself may contain that
        # word; the package directory nearest the file is the useful one.
        start = len(parts) - 1 - tuple(reversed(parts)).index("app")
        selected = parts[start:]
    elif "site-packages" in parts:
        start = parts.index("site-packages") + 1
        selected = parts[start : start + 3]
    else:
        selected = parts[-1:]
    safe = _SAFE_FILENAME.sub("_", "/".join(selected))[:240]
    return safe or "unknown.py"


def safe_traceback_frames(
    traceback_value: TracebackType | None, *, limit: int = 20
) -> list[dict[str, object]]:
    """Return stack coordinates only—never exception text or source lines."""

    if traceback_value is None:
        return []
    extracted = traceback.extract_tb(traceback_value, limit=limit)
    return [
        {
            "file": _safe_filename(frame.filename),
            "line": max(1, int(frame.lineno)),
            "function": _safe_identifier(frame.name, default="unknown", limit=100),
        }
        for frame in extracted
    ]


def safe_exception(
    exc_info: tuple[type[BaseException], BaseException, TracebackType | None],
) -> dict[str, object]:
    """Describe an exception for operators without serialising its message."""

    exception_type, _exception, traceback_value = exc_info
    return {
        "type": _safe_identifier(exception_type.__name__, default="Exception"),
        "frames": safe_traceback_frames(traceback_value),
    }


_ERROR_STRING_FIELDS: dict[str, int] = {
    "source": 24,
    "kind": 64,
    "exception_type": 120,
    "boundary": 40,
    "digest": 128,
    "release": 100,
    "method": 12,
    "route": 240,
}


def safe_error_event(value: object) -> dict[str, object] | None:
    """Copy only the finite error-event schema understood by operations."""

    if not isinstance(value, dict):
        return None
    event: dict[str, object] = {}
    for key, field_limit in _ERROR_STRING_FIELDS.items():
        raw = value.get(key)
        if isinstance(raw, str) and raw:
            event[key] = redact_log_text(raw, limit=field_limit)

    raw_frames = value.get("frames")
    if isinstance(raw_frames, list):
        frames: list[dict[str, object]] = []
        for raw_frame in raw_frames[:20]:
            if not isinstance(raw_frame, dict):
                continue
            file_value = raw_frame.get("file")
            line_value = raw_frame.get("line")
            if not isinstance(file_value, str) or not isinstance(line_value, int):
                continue
            if (
                file_value.startswith("/_next/static/chunks/")
                and file_value.endswith(".js")
                and ".." not in file_value
                and "//" not in file_value
            ):
                safe_file = _SAFE_FILENAME.sub("_", file_value)[:240]
            else:
                safe_file = _safe_filename(file_value)
            frame: dict[str, object] = {
                "file": safe_file,
                "line": max(1, min(line_value, 10_000_000)),
            }
            column_value = raw_frame.get("column")
            if isinstance(column_value, int):
                frame["column"] = max(1, min(column_value, 10_000_000))
            function_value = raw_frame.get("function")
            if isinstance(function_value, str) and function_value:
                frame["function"] = _safe_identifier(
                    function_value, default="unknown", limit=100
                )
            frames.append(frame)
        event["frames"] = frames
    return event


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            # Never call getMessage(): its interpolation arguments commonly
            # contain request values, addresses and provider errors. Product
            # events use a static label plus explicitly curated dimensions.
            "message": redact_log_text(record.msg),
            "request_id": get_request_id(),
        }
        # Domain services attach explicitly curated, non-sensitive structured
        # fields under one namespace. Never serialize arbitrary LogRecord attrs.
        transition = getattr(record, "transition", None)
        if isinstance(transition, dict):
            payload["transition"] = transition
        error_event = safe_error_event(getattr(record, "error_event", None))
        if error_event is not None:
            payload["error_event"] = error_event
        if record.exc_info:
            payload["exception"] = safe_exception(record.exc_info)
        return json.dumps(payload, ensure_ascii=True)


class RequestIDFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


def configure_logging(log_level: str = "INFO") -> None:
    level = getattr(logging, log_level.upper(), logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestIDFilter())

    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(level)

    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(logger_name)
        logger.handlers = [handler]
        logger.setLevel(level)
        logger.propagate = False
