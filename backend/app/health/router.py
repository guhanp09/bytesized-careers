from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.job_import_readiness_check import check_job_import_readiness
from app.health.service import check_db

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


@router.get("/db", summary="Database connectivity probe")
async def health_db(session: AsyncSession = Depends(get_db)) -> dict[str, str]:
    ok = await check_db(session)
    if not ok:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable")
    return {"status": "ok"}
