from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.job_import_readiness_check import check_job_import_readiness
from app.health.service import check_db
from app.realtime.bus import UnsafeRealtimeConfigurationError, build_realtime_bus

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", summary="Liveness probe")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/job-import", summary="AI job import readiness probe")
async def health_job_import() -> dict[str, object]:
    """Configuration readiness, without asking the provider anything.

    A probe that called the provider would bill a request every time a load
    balancer looked. 200 in every case, including switched-off and misconfigured:
    a readiness answer is not itself a failure, and a probe that 503s takes the
    process out of rotation over one feature.
    """

    return check_job_import_readiness().as_dict()


@router.get("/realtime", summary="Realtime delivery readiness probe")
async def health_realtime() -> dict[str, object]:
    """What realtime can and cannot promise in this deployment.

    Reported rather than inferred, because the failure it describes is
    invisible: a process-local bus running on two instances produces no error at
    any moment, only users who intermittently miss events. An operator looking
    at a dashboard should be able to see that this instance delivers to its own
    connections only.

    Never reports a broker as healthy when none is configured, and never names
    a URL or credential — this endpoint is unauthenticated.
    """

    try:
        bus = build_realtime_bus()
        configured = True
        detail = None
    except UnsafeRealtimeConfigurationError as exc:
        bus = None
        configured = False
        detail = str(exc)

    process_local = bus is None or getattr(bus, "name", "memory") == "memory"
    return {
        "configured": configured,
        # Named honestly: "delivers only to this process" is the fact that
        # matters, not whether an object was constructed.
        "cross_instance": configured and not process_local,
        "problem": detail,
    }


@router.get("/db", summary="Database connectivity probe")
async def health_db(session: AsyncSession = Depends(get_db)) -> dict[str, str]:
    ok = await check_db(session)
    if not ok:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable")
    return {"status": "ok"}
