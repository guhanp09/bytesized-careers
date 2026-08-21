from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.error_reporting import browser_error_event, emit_error_event
from app.core.rate_limit import CLIENT_ERROR_LIMIT, rate_limit
from app.schemas.telemetry import ClientErrorReport

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


@router.post("/client-errors", status_code=status.HTTP_202_ACCEPTED)
async def ingest_client_error(
    payload: ClientErrorReport,
    _limit: None = rate_limit(CLIENT_ERROR_LIMIT),
) -> Response:
    # Intentionally no authentication context, body text, browser URL or user
    # identity. Error boundaries must still work when authentication is the
    # failing subsystem, and those values are not required to group a crash.
    emit_error_event(browser_error_event(payload))
    return Response(status_code=status.HTTP_202_ACCEPTED)
