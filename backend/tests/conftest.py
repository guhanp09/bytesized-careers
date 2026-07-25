from __future__ import annotations

import os
import sys
from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.api.deps import get_db
from app.db.base import Base
from app.db.session import enable_sqlite_foreign_keys
from app.main import app
from app.models import Role
from app.services.email_service import clear_dev_auth_emails

TEST_DATABASE_URL = "sqlite+aiosqlite:///./test_creatorjobs_backend.db"


test_engine = create_async_engine(TEST_DATABASE_URL, future=True)
enable_sqlite_foreign_keys(test_engine)
TestSessionLocal = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestSessionLocal() as session:
        yield session


async def active_test_role_id(name: str = "Video Editor") -> str:
    """Return an active role for tests that exercise the current publication flow."""

    async with TestSessionLocal() as session:
        role = (await session.execute(select(Role).where(Role.name == name))).scalar_one_or_none()
        if role is None:
            role = Role(name=name, category="Production", is_active=True)
            session.add(role)
            await session.commit()
            await session.refresh(role)
        else:
            assert role.is_active, f"Test publication role {name!r} must remain active"
        return str(role.id)


async def valid_published_job_payload(**overrides: object) -> dict[str, object]:
    """Build the smallest ordinary job payload that satisfies the P0 publish contract."""

    payload: dict[str, object] = {
        "title": "Retention-focused video editor",
        "primary_role_id": await active_test_role_id(),
        "engagement_type": "one_time_project",
        "platforms": ["youtube"],
        "work_mode": "remote",
        "about_channel": "A creator-led channel publishing useful videos every week.",
        "responsibilities": ["Edit one polished creator video"],
        "requirements": ["Strong pacing and narrative judgment"],
        "start_timeframe": "ASAP",
        "application_mode": "internal",
        "compensation_mode": "range",
        "budget_amount": 1000,
        "budget_max": 1500,
        "budget_currency": "USD",
        "budget_unit": "per video",
        "deliverables": [
            {"type": "long_form_video", "quantity": 1, "frequency": "per_week"}
        ],
        "turnaround_value": 5,
        "turnaround_unit": "business_days",
        "turnaround_basis": "first_draft",
        "status": "published",
    }
    payload.update(overrides)
    return payload


async def create_valid_published_job(
    client: AsyncClient,
    owner_token: str,
    **overrides: object,
):
    """Create a published job through the API so publication validation is exercised."""

    return await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json=await valid_published_job_payload(**overrides),
    )


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_db() -> AsyncGenerator[None, None]:
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    app.dependency_overrides[get_db] = override_get_db
    yield

    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture()
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as test_client:
        yield test_client


@pytest_asyncio.fixture()
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Direct isolated-test DB access for domain-state setup assertions."""

    async with TestSessionLocal() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(autouse=True)
async def clear_dev_auth_email_outbox() -> AsyncGenerator[None, None]:
    clear_dev_auth_emails()
    yield
    clear_dev_auth_emails()
