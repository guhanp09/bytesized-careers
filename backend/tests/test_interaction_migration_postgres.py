from __future__ import annotations

import os

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import (
    Engagement,
    InteractionStatusEvent,
    JobApplication,
    Message,
    Notification,
    TalentInterest,
)
from tests.interaction_migration_fixtures import (
    HISTORICAL_INTERVIEWING,
    LEGACY_UNKNOWN_ARCHIVED,
    LEGACY_ACCEPTED,
    MISMATCHED_ENGAGEMENT,
    MISSING_ENGAGEMENT,
    VALID_HIRED,
)


DATABASE_URL = os.getenv("POSTGRES_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable PostgreSQL gate only")


async def _event(interaction_id):
    assert DATABASE_URL
    engine = create_async_engine(DATABASE_URL)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        row = (
            await session.execute(
                select(InteractionStatusEvent).where(
                    InteractionStatusEvent.interaction_id == interaction_id
                )
            )
        ).scalar_one()
    await engine.dispose()
    return row


async def test_valid_historical_hired_is_reconciled_without_user_facing_noise() -> None:
    event = await _event(VALID_HIRED)
    assert event.event_kind == "reconciled"
    assert event.metadata_json["integrity_codes"] == []
    assert event.metadata_json["trusted_messages_created"] is False
    assert event.metadata_json["notifications_created"] is False

    assert DATABASE_URL
    engine = create_async_engine(DATABASE_URL)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        assert int(
            (
                await session.execute(
                    select(func.count()).select_from(Message).where(
                        Message.metadata_json["transition_id"].as_string() == str(event.id)
                    )
                )
            ).scalar_one()
        ) == 0
        assert int(
            (
                await session.execute(
                    select(func.count()).select_from(Notification).where(
                        Notification.resource_id == str(VALID_HIRED)
                    )
                )
            ).scalar_one()
        ) == 0
    await engine.dispose()


async def test_invalid_historical_consequential_states_are_flagged_not_fabricated() -> None:
    missing = await _event(MISSING_ENGAGEMENT)
    mismatch = await _event(MISMATCHED_ENGAGEMENT)
    assert missing.event_kind == "integrity_issue"
    assert "consequential_status_missing_engagement" in missing.metadata_json["integrity_codes"]
    assert mismatch.event_kind == "integrity_issue"
    assert "engagement_participant_mismatch" in mismatch.metadata_json["integrity_codes"]

    assert DATABASE_URL
    engine = create_async_engine(DATABASE_URL)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        count = int(
            (
                await session.execute(
                    select(func.count()).select_from(Engagement).where(
                        Engagement.application_id == MISSING_ENGAGEMENT
                    )
                )
            ).scalar_one()
        )
        assert count == 0
    await engine.dispose()


async def test_legacy_contacted_and_historical_shared_state_are_canonicalized() -> None:
    accepted_event = await _event(LEGACY_ACCEPTED)
    interviewing_event = await _event(HISTORICAL_INTERVIEWING)
    assert accepted_event.event_kind == "reconciled"
    assert accepted_event.new_status == "accepted"
    assert interviewing_event.event_kind == "reconciled"
    assert interviewing_event.new_status == "interviewing"

    assert DATABASE_URL
    engine = create_async_engine(DATABASE_URL)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        interest = (
            await session.execute(
                select(TalentInterest).where(TalentInterest.id == LEGACY_ACCEPTED)
            )
        ).scalar_one()
        assert interest.status == "accepted"
        assert interest.participant_status == "accepted"
    await engine.dispose()


async def test_unknown_legacy_archive_is_preserved_for_deliberate_resolution() -> None:
    event = await _event(LEGACY_UNKNOWN_ARCHIVED)
    assert event.event_kind == "integrity_issue"
    assert "legacy_archive_previous_stage_unknown" in event.metadata_json["integrity_codes"]

    assert DATABASE_URL
    engine = create_async_engine(DATABASE_URL)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        application = await session.get(JobApplication, LEGACY_UNKNOWN_ARCHIVED)
        assert application is not None
        assert application.status == "archived"
        assert application.participant_status == "new"
        assert application.legacy_archive_resolution_required is True
    await engine.dispose()
