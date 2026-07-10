from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette import status
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "")


def error_payload(
    *, code: str, message: str, request: Request, details: object | None = None
) -> dict[str, object]:
    payload: dict[str, object] = {
        "error": {
            "code": code,
            "message": message,
            "request_id": _request_id(request),
        }
    }
    if details is not None:
        payload["error"]["details"] = details
    return payload


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict):
        raw_code = exc.detail.get("code")
        raw_message = exc.detail.get("message")
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(
                code=str(raw_code or f"http_{exc.status_code}"),
                message=str(raw_message or exc.detail),
                request=request,
                details=exc.detail,
            ),
        )
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(
            code=f"http_{exc.status_code}", message=str(exc.detail), request=request
        ),
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    details = exc.errors()
    # Pydantic model validators place the original ValueError in ctx.error.
    # Starlette's JSONResponse cannot serialize exception instances directly.
    for detail in details:
        context = detail.get("ctx")
        if context and isinstance(context.get("error"), Exception):
            detail["ctx"] = {**context, "error": str(context["error"])}
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=error_payload(
            code="validation_error",
            message="Request validation failed",
            request=request,
            details=details,
        ),
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled server error", exc_info=exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=error_payload(
            code="internal_server_error",
            message="Internal server error",
            request=request,
        ),
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
