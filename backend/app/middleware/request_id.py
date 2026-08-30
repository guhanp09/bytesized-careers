from __future__ import annotations

import re
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_request_id_ctx_var: ContextVar[str] = ContextVar("request_id", default="")
_CANONICAL_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def get_request_id() -> str:
    return _request_id_ctx_var.get() or ""


def safe_request_id(candidate: str | None) -> str:
    """Accept only a canonical UUID, otherwise create a server-owned one.

    Request IDs are copied into every structured log record. Treating the raw
    header as one lets a caller turn an email, bearer token, URL, or megabyte of
    text into log content under a field operators trust. UUIDs retain ordinary
    upstream correlation without accepting arbitrary customer-controlled text.
    """

    if candidate and _CANONICAL_UUID.fullmatch(candidate):
        return str(uuid.UUID(candidate))
    return str(uuid.uuid4())


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = safe_request_id(request.headers.get("x-request-id"))
        token = _request_id_ctx_var.set(request_id)
        request.state.request_id = request_id

        try:
            response = await call_next(request)
        finally:
            _request_id_ctx_var.reset(token)

        response.headers["X-Request-ID"] = request_id
        return response
