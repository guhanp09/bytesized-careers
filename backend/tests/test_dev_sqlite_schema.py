from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.db.dev_sqlite_schema import sync_dev_sqlite_schema


@pytest.mark.parametrize("missing_column", ["work_mode", "application_mode", "deadline_at"])
async def test_dev_sqlite_schema_sync_adds_missing_job_columns(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    missing_column: str,
) -> None:
    db_path = tmp_path / f"stale-{missing_column}.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")

    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
                CREATE TABLE jobs (
                    id CHAR(32) NOT NULL PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    category VARCHAR(64) NOT NULL,
                    location VARCHAR(255),
                    budget_amount NUMERIC(12, 2),
                    budget_max NUMERIC(12, 2),
                    budget_note VARCHAR(64),
                    budget_currency VARCHAR(3) NOT NULL,
                    budget_unit VARCHAR(32) NOT NULL,
                    experience_level VARCHAR(64),
                    platforms JSON NOT NULL,
                    start_timeframe VARCHAR(32),
                    about_channel TEXT,
                    responsibilities JSON NOT NULL,
                    requirements JSON NOT NULL,
                    how_to_apply TEXT,
                    reference_videos JSON NOT NULL,
                    tags JSON NOT NULL,
                    youtube_channel_id VARCHAR(255),
                    is_verified BOOLEAN NOT NULL,
                    channel_name VARCHAR(255),
                    channel_logo_url VARCHAR(1024),
                    channel_subscribers INTEGER,
                    channel_profile_slug VARCHAR(255),
                    posted_by_agency BOOLEAN NOT NULL,
                    agency_profile_slug VARCHAR(255),
                    posted_platform VARCHAR(32),
                    posted_youtube_channel_id VARCHAR(255),
                    posted_by_user_id CHAR(32),
                    hiring_identity_id CHAR(32),
                    hiring_display_name_snapshot VARCHAR(255),
                    hiring_platform_snapshot VARCHAR(20),
                    hiring_verification_status_snapshot VARCHAR(20),
                    managed_by_agency_name_snapshot VARCHAR(255),
                    views INTEGER NOT NULL,
                    applicants INTEGER NOT NULL,
                    response_rate INTEGER NOT NULL,
                    status VARCHAR(20) NOT NULL,
                    deleted_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
                """
            )
        )

    await sync_dev_sqlite_schema(engine)

    async with engine.begin() as conn:
        columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("jobs")}
        )

    assert missing_column in columns
    await engine.dispose()


async def test_dev_sqlite_schema_sync_adds_profile_experience_to_populated_users(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db_path = tmp_path / "stale-users.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")

    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
                CREATE TABLE users (
                    id CHAR(32) NOT NULL PRIMARY KEY,
                    email VARCHAR(320) NOT NULL UNIQUE,
                    username VARCHAR(20),
                    username_change_count INTEGER NOT NULL,
                    account_type VARCHAR(16) DEFAULT 'TALENT' NOT NULL,
                    onboarding_intent VARCHAR(32) DEFAULT 'DECIDE_LATER' NOT NULL,
                    avatar_mode VARCHAR(32) NOT NULL,
                    skills JSON NOT NULL,
                    public_links JSON NOT NULL,
                    availability_status VARCHAR(16) NOT NULL,
                    hiring_verification_status VARCHAR(32) DEFAULT 'unverified' NOT NULL,
                    privacy_settings JSON NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
                """
            )
        )
        await conn.execute(
            text(
                """
                INSERT INTO users (
                    id,
                    email,
                    username_change_count,
                    avatar_mode,
                    skills,
                    public_links,
                    availability_status,
                    privacy_settings
                )
                VALUES (
                    '11111111111111111111111111111111',
                    'stale@example.com',
                    0,
                    'generic',
                    '[]',
                    '[]',
                    'selective',
                    '{}'
                )
                """
            )
        )

    await sync_dev_sqlite_schema(engine)

    async with engine.begin() as conn:
        columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("users")}
        )
        value = (
            await conn.execute(
                text("SELECT profile_experience FROM users WHERE email = 'stale@example.com'")
            )
        ).scalar_one()

    assert "profile_experience" in columns
    assert value == "[]"
    await engine.dispose()
