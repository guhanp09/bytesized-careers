from __future__ import annotations

import logging
from typing import TypedDict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.seed_data_jobs import SEEDED_JOBS
from app.db.seed_data_talent import SEEDED_TALENT_LISTINGS, SEEDED_TALENT_USERS
from app.models import Job, TalentListing, User

logger = logging.getLogger(__name__)


class SeedResult(TypedDict):
    inserted: int
    skipped: int


async def seed_jobs_from_seed_data_if_missing(session: AsyncSession) -> SeedResult:
    inserted = 0
    skipped = 0

    seed_ids = [UUID(str(item["id"])) for item in SEEDED_JOBS]
    existing_rows = await session.execute(select(Job.id).where(Job.id.in_(seed_ids)))
    existing_ids = {row for row in existing_rows.scalars().all()}

    for payload in SEEDED_JOBS:
        job_id = UUID(str(payload["id"]))
        if job_id in existing_ids:
            skipped += 1
            continue
        session.add(Job(**payload))
        inserted += 1

    await session.commit()
    logger.info(
        "seed_jobs_complete",
        extra={"inserted": inserted, "skipped": skipped, "total_seed_records": len(SEEDED_JOBS)},
    )
    return {"inserted": inserted, "skipped": skipped}


async def seed_talent_from_seed_data_if_missing(session: AsyncSession) -> SeedResult:
    inserted = 0
    skipped = 0

    user_ids = [UUID(str(item["id"])) for item in SEEDED_TALENT_USERS]
    existing_user_rows = await session.execute(select(User.id).where(User.id.in_(user_ids)))
    existing_user_ids = {row for row in existing_user_rows.scalars().all()}
    for payload in SEEDED_TALENT_USERS:
        user_id = UUID(str(payload["id"]))
        if user_id in existing_user_ids:
            continue
        session.add(User(**payload))

    listing_ids = [UUID(str(item["id"])) for item in SEEDED_TALENT_LISTINGS]
    existing_listing_rows = await session.execute(select(TalentListing.id).where(TalentListing.id.in_(listing_ids)))
    existing_listing_ids = {row for row in existing_listing_rows.scalars().all()}

    for payload in SEEDED_TALENT_LISTINGS:
        listing_id = UUID(str(payload["id"]))
        if listing_id in existing_listing_ids:
            skipped += 1
            continue
        session.add(TalentListing(**payload))
        inserted += 1

    await session.commit()
    logger.info(
        "seed_talent_complete",
        extra={"inserted": inserted, "skipped": skipped, "total_seed_records": len(SEEDED_TALENT_LISTINGS)},
    )
    return {"inserted": inserted, "skipped": skipped}


async def seed_marketplace_demo_data_if_missing(session: AsyncSession) -> dict[str, SeedResult]:
    jobs = await seed_jobs_from_seed_data_if_missing(session)
    talent = await seed_talent_from_seed_data_if_missing(session)
    return {"jobs": jobs, "talent": talent}
