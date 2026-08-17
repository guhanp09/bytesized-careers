from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.job_import_readiness_check import check_job_import_readiness
from app.db.session import SessionLocal
from app.health.service import SessionFactory, check_db, check_readiness
from app.realtime.bus import UnsafeRealtimeConfigurationError, build_realtime_bus

router = APIRouter(prefix="/health", tags=["health"])

#: Three different questions, and conflating any two of them causes an outage
#: rather than preventing one.
#:
#:   LIVENESS  (`/health`)        is this process alive? Consults NOTHING.
#:   READINESS (`/health/ready`)  would a request succeed? Consults only what
#:                                every request needs.
#:   FEATURE   (`/health/…`)      what can one optional feature promise? Always
#:                                200, because a feature is not the instance.
#:
#: A liveness probe that consults the database restarts every container during a
#: database blip, and the restarts add load to the thing already struggling. A
#: readiness probe that consults an optional feature takes an instance out of
#: rotation over a provider outage it could have survived. Neither failure looks
#: like a monitoring mistake while it is happening.
#:
#: All of these are unauthenticated, so none of them may name a host, a URL, a
#: credential, or an exception message. tests/test_health_contracts.py asserts
#: that against real secret-shaped values rather than trusting it.


@router.get("", summary="Liveness probe")
async def health() -> dict[str, str]:
    """Alive. Deliberately takes no dependency and reads no configuration.

    If this ever grows a `Depends`, a dependency outage becomes a restart loop.
    """

    return {"status": "ok"}


def get_readiness_session_factory() -> SessionFactory:
    """The sessionmaker readiness should use.

    A dependency that returns a factory rather than a session, which is the whole
    trick: it cannot fail, so a database outage still reaches the handler and
    still answers 503 — while remaining overridable, so the test suite points the
    probe at the test database instead of the developer's.
    """

    return SessionLocal


@router.get("/ready", summary="Readiness probe")
async def health_ready(
    response: Response,
    session_factory: SessionFactory = Depends(get_readiness_session_factory),
) -> dict[str, object]:
    """Whether this instance should be sent traffic.

    503 when the database is unreachable — not 500, which is what taking the
    request-scoped session dependency would produce, because a failure there
    happens before the handler runs. Optional features are deliberately absent:
    readiness is about the instance, not about what every feature can offer.
    """

    readiness = await check_readiness(session_factory)
    if not readiness.ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return readiness.as_dict()


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
