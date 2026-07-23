from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import (
    Conversation,
    EmailOutbox,
    Engagement,
    InteractionStatusEvent,
    InteractionTransitionRequest,
    Job,
    JobApplication,
    Message,
    Notification,
    TalentInterest,
    TalentListing,
    User,
)
from app.services import interaction_transition_service as transitions


DATABASE_URL = os.getenv("POSTGRES_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="Set POSTGRES_TEST_DATABASE_URL via scripts/test_interaction_status_postgres.sh",
)


def _session_factory() -> async_sessionmaker[AsyncSession]:
    assert DATABASE_URL
    engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _application_fixture(factory: async_sessionmaker[AsyncSession]) -> tuple[uuid.UUID, uuid.UUID]:
    owner_id, talent_id, job_id, application_id = (uuid.uuid4() for _ in range(4))
    async with factory() as session:
        session.add_all(
            [
                User(id=owner_id, email=f"pg-owner-{owner_id}@example.com", username=f"o{owner_id.hex[:12]}"),
                User(id=talent_id, email=f"pg-talent-{talent_id}@example.com", username=f"t{talent_id.hex[:12]}"),
            ]
        )
        await session.flush()
        session.add(
            Job(
                id=job_id,
                title="PostgreSQL transition fixture",
                category="Editing",
                posted_by_user_id=owner_id,
                status="published",
            )
        )
        await session.flush()
        session.add(
            JobApplication(
                id=application_id,
                job_id=job_id,
                applicant_user_id=talent_id,
                job_owner_user_id=owner_id,
                applicant_snapshot={},
            )
        )
        await session.commit()
    return owner_id, application_id


async def _interest_fixture(factory: async_sessionmaker[AsyncSession]) -> tuple[uuid.UUID, uuid.UUID]:
    talent_id, recruiter_id, listing_id, interest_id = (uuid.uuid4() for _ in range(4))
    async with factory() as session:
        session.add_all(
            [
                User(id=talent_id, email=f"pg-talent-{talent_id}@example.com", username=f"t{talent_id.hex[:12]}"),
                User(id=recruiter_id, email=f"pg-recruiter-{recruiter_id}@example.com", username=f"r{recruiter_id.hex[:12]}"),
            ]
        )
        await session.flush()
        session.add(
            TalentListing(
                id=listing_id,
                owner_user_id=talent_id,
                title="PostgreSQL talent fixture",
                status="published",
            )
        )
        await session.flush()
        session.add(
            TalentInterest(
                id=interest_id,
                talent_listing_id=listing_id,
                recruiter_user_id=recruiter_id,
                owner_user_id=talent_id,
            )
        )
        await session.commit()
    return talent_id, interest_id


async def _hire(
    factory: async_sessionmaker[AsyncSession], owner_id: uuid.UUID, application_id: uuid.UUID,
    *, key: str, status: str = "hired",
) -> str:
    async with factory() as session:
        actor = await session.get(User, owner_id)
        assert actor is not None
        result = await transitions.transition_application(
            session,
            application_id=application_id,
            actor=actor,
            requested_status=status,
            expected_version=1,
            idempotency_key=key,
        )
        await session.commit()
        return result.outcome


async def _accept(
    factory: async_sessionmaker[AsyncSession], talent_id: uuid.UUID, interest_id: uuid.UUID,
    *, key: str,
) -> str:
    async with factory() as session:
        actor = await session.get(User, talent_id)
        assert actor is not None
        result = await transitions.transition_interest(
            session,
            interest_id=interest_id,
            actor=actor,
            requested_status="accepted",
            expected_version=1,
            idempotency_key=key,
        )
        await session.commit()
        return result.outcome


async def _share_application_decision(
    factory: async_sessionmaker[AsyncSession],
    owner_id: uuid.UUID,
    application_id: uuid.UUID,
    *,
    key: str,
    note: str | None = None,
) -> str:
    async with factory() as session:
        actor = await session.get(User, owner_id)
        assert actor is not None
        result = await transitions.share_application_status(
            session,
            application_id=application_id,
            actor=actor,
            requested_status="rejected",
            expected_version=2,
            idempotency_key=key,
            note=note,
        )
        await session.commit()
        return result.outcome


async def _count(session: AsyncSession, model, *criteria) -> int:
    return int(
        (
            await session.execute(select(func.count()).select_from(model).where(*criteria))
        ).scalar_one()
    )


async def test_concurrent_hired_same_key_is_exactly_once() -> None:
    factory = _session_factory()
    owner_id, application_id = await _application_fixture(factory)
    key = str(uuid.uuid4())
    outcomes = await asyncio.gather(
        _hire(factory, owner_id, application_id, key=key),
        _hire(factory, owner_id, application_id, key=key),
    )
    assert sorted(outcomes) == ["already_in_state", "transitioned"]

    async with factory() as session:
        application = await session.get(JobApplication, application_id)
        assert application is not None
        assert (application.status, application.participant_status, application.status_version) == (
            "hired",
            "hired",
            2,
        )
        assert await _count(session, Engagement, Engagement.application_id == application_id) == 1
        assert await _count(session, InteractionStatusEvent, InteractionStatusEvent.interaction_id == application_id) == 1
        assert await _count(session, InteractionTransitionRequest, InteractionTransitionRequest.idempotency_key == key) == 1
        assert await _count(session, Notification, Notification.resource_id == str(application_id)) == 1
        assert await _count(session, Message, Message.metadata_json["stage"].as_string() == "hired") == 1
        assert await _count(session, EmailOutbox, EmailOutbox.event_key == "application_status_changed") == 1


async def test_concurrent_hired_different_keys_and_conflicting_change_are_safe() -> None:
    factory = _session_factory()
    owner_id, application_id = await _application_fixture(factory)
    outcomes = await asyncio.gather(
        _hire(factory, owner_id, application_id, key=str(uuid.uuid4())),
        _hire(factory, owner_id, application_id, key=str(uuid.uuid4())),
    )
    assert sorted(outcomes) == ["already_in_state", "transitioned"]

    owner_two, application_two = await _application_fixture(factory)
    competing = await asyncio.gather(
        _hire(factory, owner_two, application_two, key=str(uuid.uuid4()), status="hired"),
        _hire(factory, owner_two, application_two, key=str(uuid.uuid4()), status="rejected"),
        return_exceptions=True,
    )
    assert sum(isinstance(value, str) for value in competing) == 1
    async with factory() as session:
        row = await session.get(JobApplication, application_two)
        assert row is not None
        assert row.status_version == 2
        if row.status == "hired":
            assert await _count(session, Engagement, Engagement.application_id == application_two) == 1
        else:
            assert row.status == "rejected"
            assert await _count(session, Engagement, Engagement.application_id == application_two) == 0


async def test_concurrent_accepted_is_exactly_once() -> None:
    factory = _session_factory()
    talent_id, interest_id = await _interest_fixture(factory)
    outcomes = await asyncio.gather(
        _accept(factory, talent_id, interest_id, key=str(uuid.uuid4())),
        _accept(factory, talent_id, interest_id, key=str(uuid.uuid4())),
    )
    assert sorted(outcomes) == ["already_in_state", "transitioned"]
    async with factory() as session:
        interest = await session.get(TalentInterest, interest_id)
        assert interest is not None
        assert (interest.status, interest.participant_status, interest.status_version) == (
            "accepted",
            "accepted",
            2,
        )
        assert await _count(session, Engagement, Engagement.talent_interest_id == interest_id) == 1
        assert await _count(session, Notification, Notification.resource_id == str(interest_id)) == 1


async def test_concurrent_status_communication_is_exactly_once() -> None:
    factory = _session_factory()
    owner_id, application_id = await _application_fixture(factory)
    await _hire(
        factory,
        owner_id,
        application_id,
        key=str(uuid.uuid4()),
        status="rejected",
    )
    outcomes = await asyncio.gather(
        _share_application_decision(
            factory, owner_id, application_id, key=str(uuid.uuid4())
        ),
        _share_application_decision(
            factory, owner_id, application_id, key=str(uuid.uuid4())
        ),
    )
    assert sorted(outcomes) == ["already_in_state", "transitioned"]

    async with factory() as session:
        application = await session.get(JobApplication, application_id)
        assert application is not None
        assert (
            application.status,
            application.participant_status,
            application.status_version,
        ) == ("rejected", "rejected", 3)
        assert await _count(
            session,
            InteractionStatusEvent,
            InteractionStatusEvent.interaction_id == application_id,
            InteractionStatusEvent.event_kind == "communicated",
        ) == 1
        assert await _count(
            session, Notification, Notification.resource_id == str(application_id)
        ) == 1
        assert await _count(
            session, Message, Message.metadata_json["stage"].as_string() == "rejected"
        ) == 1
        assert await _count(
            session,
            EmailOutbox,
            EmailOutbox.dedupe_key.like(f"application:{application_id}:%:communicated:email"),
        ) == 1


async def test_engagement_uniqueness_rejects_a_duplicate_historical_relationship() -> None:
    factory = _session_factory()
    owner_id, application_id = await _application_fixture(factory)
    await _hire(factory, owner_id, application_id, key=str(uuid.uuid4()))

    async with factory() as session:
        application = await session.get(JobApplication, application_id)
        assert application is not None
        duplicate = Engagement(
            source_type="job_application",
            source_record_id=application_id,
            application_id=application_id,
            recruiter_user_id=application.job_owner_user_id,
            talent_user_id=application.applicant_user_id,
            context_snapshot={},
        )
        session.add(duplicate)
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()
        assert await _count(
            session, Engagement, Engagement.application_id == application_id
        ) == 1


async def test_concurrent_share_with_a_note_delivers_exactly_one_note() -> None:
    """Two racing shares must not double-post the manager's explanation."""
    factory = _session_factory()
    owner_id, application_id = await _application_fixture(factory)
    await _hire(
        factory,
        owner_id,
        application_id,
        key=str(uuid.uuid4()),
        status="rejected",
    )
    note = "Going with a candidate who has more long-form experience."
    outcomes = await asyncio.gather(
        _share_application_decision(
            factory, owner_id, application_id, key=str(uuid.uuid4()), note=note
        ),
        _share_application_decision(
            factory, owner_id, application_id, key=str(uuid.uuid4()), note=note
        ),
    )
    assert sorted(outcomes) == ["already_in_state", "transitioned"]

    async with factory() as session:
        # Scoped to this application's own thread: the module shares one
        # database, so an unscoped message count picks up other tests' rows.
        conversation_id = (
            await session.execute(
                select(Conversation.id).where(Conversation.application_id == application_id)
            )
        ).scalar_one()
        # One decision, one explanation, one notification — under a real race.
        assert await _count(
            session,
            Message,
            Message.conversation_id == conversation_id,
            Message.metadata_json["status_note"].as_boolean().is_(True),
        ) == 1
        assert await _count(
            session,
            Message,
            Message.conversation_id == conversation_id,
            Message.metadata_json["stage"].as_string() == "rejected",
        ) == 2
        assert await _count(
            session, Notification, Notification.resource_id == str(application_id)
        ) == 1
        assert await _count(
            session,
            InteractionStatusEvent,
            InteractionStatusEvent.interaction_id == application_id,
            InteractionStatusEvent.event_kind == "communicated",
        ) == 1
