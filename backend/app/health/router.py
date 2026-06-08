from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.health.service import check_db

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", summary="Liveness probe")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/db", summary="Database connectivity probe")
async def health_db(session: AsyncSession = Depends(get_db)) -> dict[str, str]:
    ok = await check_db(session)
    if not ok:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable")
    return {"status": "ok"}
