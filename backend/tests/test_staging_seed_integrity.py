from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db import seed_data_personas as personas
from app.db.base import Base
from app.db.seed import seed_full_demo
from app.db.seed_data_jobs import SEEDED_JOBS
from app.db.seed_data_talent import SEEDED_TALENT_LISTINGS, SEEDED_TALENT_USERS
from app.models import (
    HiringIdentity,
    Job,
    JobApplication,
    Notification,
    PortfolioItem,
    Report,
    Role,
    SavedJob,
    SavedTalentListing,
    TalentInterest,
    TalentListing,
    User,
)


async def _create_seed_database(
    tmp_path: Path,
) -> tuple[object, async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'staging-seed.db'}", future=True)

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, session_factory


async def _all_ids(session: AsyncSession, model: type) -> set[object]:
    rows = await session.execute(select(model.id))
    return set(rows.scalars().all())


async def _count_rows(session: AsyncSession, model: type) -> int:
    return len(await _all_ids(session, model))


async def _assert_foreign_keys_resolve(session: AsyncSession) -> None:
    user_ids = await _all_ids(session, User)
    job_ids = await _all_ids(session, Job)
    listing_ids = await _all_ids(session, TalentListing)
    identity_ids = await _all_ids(session, HiringIdentity)
    role_ids = await _all_ids(session, Role)

    for identity in (await session.execute(select(HiringIdentity))).scalars().all():
        assert identity.owner_user_id in user_ids
    for listing in (await session.execute(select(TalentListing))).scalars().all():
        assert listing.owner_user_id in user_ids
    for job in (await session.execute(select(Job))).scalars().all():
        assert job.posted_by_user_id is None or job.posted_by_user_id in user_ids
        assert job.hiring_identity_id is None or job.hiring_identity_id in identity_ids
    for item in (await session.execute(select(PortfolioItem))).scalars().all():
        assert item.user_id in user_ids
        assert item.role_id is None or item.role_id in role_ids
    for application in (await session.execute(select(JobApplication))).scalars().all():
        assert application.job_id in job_ids
        assert application.applicant_user_id in user_ids
        assert application.job_owner_user_id is None or application.job_owner_user_id in user_ids
    for interest in (await session.execute(select(TalentInterest))).scalars().all():
        assert interest.talent_listing_id in listing_ids
        assert interest.recruiter_user_id in user_ids
        assert interest.owner_user_id in user_ids
        assert interest.job_id is None or interest.job_id in job_ids
    for saved_job in (await session.execute(select(SavedJob))).scalars().all():
        assert saved_job.user_id in user_ids
        assert saved_job.job_id in job_ids
    for saved_listing in (await session.execute(select(SavedTalentListing))).scalars().all():
        assert saved_listing.user_id in user_ids
        assert saved_listing.talent_listing_id in listing_ids
    for notification in (await session.execute(select(Notification))).scalars().all():
        assert notification.user_id in user_ids
        assert notification.actor_user_id is None or notification.actor_user_id in user_ids
    for report in (await session.execute(select(Report))).scalars().all():
        assert report.reporter_user_id is None or report.reporter_user_id in user_ids
        assert report.resolved_by_user_id is None or report.resolved_by_user_id in user_ids


@pytest.mark.asyncio
async def test_full_staging_seed_is_fk_safe_on_a_fresh_database(tmp_path: Path) -> None:
    engine, Session = await _create_seed_database(tmp_path)
    try:
        async with Session() as session:
            await seed_full_demo(session)
            await _assert_foreign_keys_resolve(session)

            assert await _count_rows(session, User) == (
                len(SEEDED_TALENT_USERS) + len(personas.build_persona_users())
            )
            assert await _count_rows(session, TalentListing) == (
                len(SEEDED_TALENT_LISTINGS) + len(personas.build_persona_talent_listings())
            )
            assert await _count_rows(session, Job) == (
                len(SEEDED_JOBS) + len(personas.build_persona_jobs())
            )
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_full_staging_seed_recovers_from_partial_users_and_is_idempotent(
    tmp_path: Path,
) -> None:
    engine, Session = await _create_seed_database(tmp_path)
    try:
        # Simulate an interrupted first attempt: one deterministic parent user
        # persisted, while its related listing did not.
        async with Session() as session:
            session.add(User(**SEEDED_TALENT_USERS[0]))
            await session.commit()

        async with Session() as session:
            await seed_full_demo(session)
            first_counts = {
                "users": await _count_rows(session, User),
                "jobs": await _count_rows(session, Job),
                "listings": await _count_rows(session, TalentListing),
                "applications": await _count_rows(session, JobApplication),
                "interests": await _count_rows(session, TalentInterest),
                "portfolio": await _count_rows(session, PortfolioItem),
            }
            await _assert_foreign_keys_resolve(session)

        async with Session() as session:
            await seed_full_demo(session)
            second_counts = {
                "users": await _count_rows(session, User),
                "jobs": await _count_rows(session, Job),
                "listings": await _count_rows(session, TalentListing),
                "applications": await _count_rows(session, JobApplication),
                "interests": await _count_rows(session, TalentInterest),
                "portfolio": await _count_rows(session, PortfolioItem),
            }
            await _assert_foreign_keys_resolve(session)

        assert second_counts == first_counts
    finally:
        await engine.dispose()
