from __future__ import annotations

from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.seed import seed_marketplace_demo_data_if_missing
from app.db.seed_data_jobs import _JOB_FIRST_MESSAGE_REQUIREMENTS
from app.db.seed_data_jobs import _stable_uuid as job_stable_uuid
from app.db.seed_data_talent import _TALENT_FIRST_MESSAGE_REQUIREMENTS
from app.db.seed_data_talent import _stable_uuid as talent_stable_uuid
from app.models import Job, TalentListing


async def test_seed_reconciles_first_message_requirements_onto_existing_rows(tmp_path) -> None:
    # An isolated, throwaway DB so this never contaminates the shared test fixtures.
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'reconcile.db'}", future=True)
    event.listen(
        engine.sync_engine,
        "connect",
        lambda dbapi_connection, _: dbapi_connection.execute("PRAGMA foreign_keys=ON"),
    )
    Session = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    job_id = job_stable_uuid("job_1")
    listing_id = talent_stable_uuid("talent_01")

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # First run inserts the demo rows with their requirements.
        async with Session() as session:
            await seed_marketplace_demo_data_if_missing(session)

        # Simulate an older DB whose seeded rows predate the requirements feature
        # (this is exactly the state that let Apply/Hire bypass the modal).
        async with Session() as session:
            job = (await session.execute(select(Job).where(Job.id == job_id))).scalar_one()
            listing = (
                await session.execute(select(TalentListing).where(TalentListing.id == listing_id))
            ).scalar_one()
            job.application_requirements = []
            listing.first_message_requirements = []
            await session.commit()

        # Re-running the seed reconciles requirements onto the existing rows.
        async with Session() as session:
            result = await seed_marketplace_demo_data_if_missing(session)
            assert result["jobs"]["updated"] >= 1
            assert result["talent"]["updated"] >= 1

        async with Session() as session:
            job = (await session.execute(select(Job).where(Job.id == job_id))).scalar_one()
            listing = (
                await session.execute(select(TalentListing).where(TalentListing.id == listing_id))
            ).scalar_one()
            assert job.application_requirements == _JOB_FIRST_MESSAGE_REQUIREMENTS["job_1"]
            assert listing.first_message_requirements == _TALENT_FIRST_MESSAGE_REQUIREMENTS["talent_01"]
    finally:
        await engine.dispose()
