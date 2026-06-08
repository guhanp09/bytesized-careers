from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import settings
from app.db.seed import seed_jobs_from_seed_data_if_missing, seed_marketplace_demo_data_if_missing

router = APIRouter(prefix="/dev/seed", tags=["dev"])


@router.post(
    "/jobs",
    summary="Seed sample jobs (development only)",
    description="Idempotently inserts sample jobs from backend seed data when APP_ENV=development.",
)
async def seed_jobs(session: AsyncSession = Depends(get_db)) -> dict[str, int | str]:
    if settings.app_env != "development":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    result = await seed_jobs_from_seed_data_if_missing(session)
    return {"status": "ok", "inserted": result["inserted"], "skipped": result["skipped"]}


@router.post(
    "/marketplace",
    summary="Seed sample marketplace data (development only)",
    description="Idempotently inserts sample jobs and talent listings when APP_ENV=development.",
)
async def seed_marketplace(session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    if settings.app_env != "development":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    result = await seed_marketplace_demo_data_if_missing(session)
    return {"status": "ok", **result}
