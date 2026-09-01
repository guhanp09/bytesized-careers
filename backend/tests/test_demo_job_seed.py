from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.seed import seed_jobs_from_seed_data_if_missing
from app.db.seed_data_jobs import DEMO_JOB_IDS, _stable_uuid, demo_hiring_identities, job_specs
from app.models import Job, Role, User
from app.repositories.job_repository import JobRepository
from app.services.job_service import JobService, JobValidationError


async def _session_factory(tmp_path) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'demo-jobs.db'}", future=True)
    event.listen(
        engine.sync_engine,
        "connect",
        lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"),
    )
    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield session_factory
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_demo_job_seed_is_deterministic_idempotent_public_safe_and_non_destructive(
    tmp_path,
) -> None:
    async for Session in _session_factory(tmp_path):
        user_id = uuid4()
        user_job_id = uuid4()
        async with Session() as session:
            session.add(
                User(
                    id=user_id,
                    email="local-user@example.test",
                    username="local_user",
                    display_name="Local User",
                )
            )
            await session.flush()
            session.add(
                Job(
                    id=user_job_id,
                    title="User-created local draft",
                    category=None,
                    listing_schema_version=3,
                    posted_by_user_id=user_id,
                    status="draft",
                )
            )
            session.add(
                Job(
                    id=_stable_uuid("job_25"),
                    title="Retired deterministic demo listing",
                    category="Editing",
                    listing_schema_version=1,
                    status="published",
                )
            )
            await session.commit()

        async with Session() as session:
            first = await seed_jobs_from_seed_data_if_missing(session)
            assert first == {
                "inserted": 24,
                "created": 24,
                "updated": 1,
                "unchanged": 0,
                "skipped": 0,
            }

        async with Session() as session:
            first_deadlines = dict(
                (await session.execute(select(Job.id, Job.deadline_at).where(Job.id.in_(DEMO_JOB_IDS)))).all()
            )
            second = await seed_jobs_from_seed_data_if_missing(session)
            assert second == {
                "inserted": 0,
                "created": 0,
                "updated": 0,
                "unchanged": 24,
                "skipped": 1,
            }

        async with Session() as session:
            all_seeded = (
                await session.execute(select(Job).where(Job.id.in_(DEMO_JOB_IDS)))
            ).scalars().all()
            assert len(all_seeded) == len(set(DEMO_JOB_IDS)) == 24
            assert {job.status for job in all_seeded} == {"published", "draft", "paused", "closed"}
            assert all(job.listing_schema_version == 3 for job in all_seeded)
            assert all(job.primary_role_id is not None for job in all_seeded)
            assert all(job.hiring_identity_id is not None for job in all_seeded)
            assert all(job.deliverables for job in all_seeded)

            second_deadlines = dict(
                (await session.execute(select(Job.id, Job.deadline_at).where(Job.id.in_(DEMO_JOB_IDS)))).all()
            )
            assert second_deadlines == first_deadlines
            assert all(
                deadline is not None
                and deadline.replace(tzinfo=deadline.tzinfo or UTC) > datetime.now(UTC)
                for deadline in second_deadlines.values()
            )

            user_job = await session.get(Job, user_job_id)
            assert user_job is not None
            assert user_job.title == "User-created local draft"
            assert user_job.status == "draft"
            retired_job = await session.get(Job, _stable_uuid("job_25"))
            assert retired_job is not None
            assert retired_job.status == "closed"
            assert retired_job.title == "Retired deterministic demo listing"
            assert await session.scalar(select(func.count()).select_from(Job)) == 26

            public_jobs, public_total = await JobService(JobRepository(session)).list_jobs(
                limit=100,
                offset=0,
                q=None,
                role=None,
                platform=None,
                format_filter=None,
                work_mode=None,
                engagement_type=None,
                budget_unit=None,
                language=None,
                location=None,
                start_timeframe=None,
            )
            assert public_total == len(public_jobs) == 21
            assert {job.status for job in public_jobs} == {"published"}
            assert {job.id for job in public_jobs}.isdisjoint(
                {_stable_uuid("job_22"), _stable_uuid("job_23"), _stable_uuid("job_24")}
            )


def test_demo_hiring_identities_do_not_invent_avatar_evidence() -> None:
    assert all(identity["avatar_url"] is None for identity in demo_hiring_identities())


@pytest.mark.asyncio
async def test_demo_job_seed_covers_the_v3_marketplace_contract(tmp_path) -> None:
    async for Session in _session_factory(tmp_path):
        async with Session() as session:
            await seed_jobs_from_seed_data_if_missing(session)
            jobs = (
                await session.execute(select(Job).where(Job.id.in_(DEMO_JOB_IDS)))
            ).scalars().all()

        published = [job for job in jobs if job.status == "published"]
        assert len(published) == 21
        assert len({job.primary_role_name_snapshot for job in published}) >= 17
        assert {job.work_mode for job in published} == {"remote", "hybrid", "onsite"}
        assert {
            "one_time_project",
            "ongoing_freelance",
            "retainer",
            "part_time",
            "full_time",
            "fixed_term",
        }.issubset({job.engagement_type for job in published})
        assert {
            "per hour",
            "per day",
            "per deliverable",
            "per video",
            "per short",
            "per thumbnail",
            "per script",
            "per episode",
            "per project",
            "per week",
            "per month",
            "per year",
            "commission",
            "mixed",
            "custom",
        }.issubset({job.budget_unit for job in published})
        assert {job.trial_status for job in published} == {"none", "paid", "unpaid", "undecided"}
        assert sum(job.trial_status == "paid" for job in published) >= 2
        assert sum(job.trial_status == "unpaid" for job in published) == 1
        assert {job.application_mode for job in published} == {"internal", "external"}
        assert {job.employer_context_type for job in published}.issuperset(
            {"creator", "agency", "brand", "production_house", "other"}
        )
        assert {platform.casefold() for job in published for platform in job.platforms}.issuperset(
            {"youtube", "instagram", "tiktok", "podcast"}
        )
        assert any(job.required_skill_keys and job.preferred_skill_keys for job in published)
        # Language requirements are no longer part of active demo jobs (stored data
        # elsewhere stays intact for backward compatibility).
        assert not any(job.language_requirements for job in published)
        # Screening questions stay varied so the automated Inbox delivery can be shown:
        # jobs with none, one, and several questions, with required + optional mixed.
        screening_counts = sorted({len(job.screening_questions or []) for job in published})
        assert 0 in screening_counts, "expected at least one job with no screening questions"
        assert max(screening_counts) >= 3, "expected an agency-style multi-question set"
        all_questions = [q for job in published for q in (job.screening_questions or [])]
        assert any(q.get("required") for q in all_questions)
        assert any(not q.get("required") for q in all_questions)
        assert any(job.other_required_tools for job in published)
        assert any(job.role_specialization == "Creator and executive assistant" for job in published)
        sensitive_inputs = [
            item
            for job in published
            for item in job.source_inputs or []
            if item["type"] in {"analytics_access", "account_access"}
        ]
        assert sensitive_inputs
        assert all(item["sensitive_access_confirmed"] is True for item in sensitive_inputs)
        assert all(job.deadline_at is not None for job in published)


@pytest.mark.asyncio
async def test_demo_job_seed_fails_clearly_when_a_required_role_is_inactive(tmp_path) -> None:
    async for Session in _session_factory(tmp_path):
        async with Session() as session:
            await seed_jobs_from_seed_data_if_missing(session)
            role = (
                await session.execute(select(Role).where(Role.name == "Long-form Editor"))
            ).scalar_one()
            role.is_active = False
            await session.commit()

        async with Session() as session:
            with pytest.raises(JobValidationError) as error:
                await seed_jobs_from_seed_data_if_missing(session)
            assert error.value.field_errors == {
                "primary_role_id": ["Select an active creator role."]
            }


@pytest.mark.asyncio
async def test_demo_job_seed_refuses_production(monkeypatch, tmp_path) -> None:
    async for Session in _session_factory(tmp_path):
        monkeypatch.setattr(settings, "app_env", "production")
        async with Session() as session:
            with pytest.raises(RuntimeError, match="development or test"):
                await seed_jobs_from_seed_data_if_missing(session)


def test_shared_fixture_has_unique_stable_keys_and_safe_fictional_links() -> None:
    specs = job_specs()
    assert len(specs) == 24
    assert len({spec["key"] for spec in specs}) == 24
    assert len(set(DEMO_JOB_IDS)) == 24
    fixture_text = str(specs).casefold()
    assert "@gmail.com" not in fixture_text
    assert "@yahoo.com" not in fixture_text
    assert "api_key" not in fixture_text
    assert "'password':" not in fixture_text
    assert all(
        not spec["application"].get("external_url")
        or spec["application"]["external_url"].startswith("https://example.com/")
        for spec in specs
    )
