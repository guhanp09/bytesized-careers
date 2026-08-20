from __future__ import annotations

from collections.abc import Callable
from uuid import UUID, uuid4

import pytest
from conftest import test_engine
from sqlalchemy import delete, event
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routers.marketplace import activity_summary
from app.models import (
    Conversation,
    Engagement,
    InteractionStatusEvent,
    Job,
    JobApplication,
    TalentInterest,
    TalentListing,
    User,
)

pytestmark = pytest.mark.asyncio


def _person(prefix: str, label: str, index: int, *, account_type: str) -> User:
    return User(
        id=uuid4(),
        email=f"query-bound-{prefix}-{label}-{index}@example.com",
        username=f"q{prefix}_{label[0]}{index}",
        display_name=f"Query Bound {label.title()} {index}",
        account_type=account_type,
    )


def _application_rows(
    *,
    prefix: str,
    owner: User,
    job: Job,
    start: int,
    stop: int,
) -> tuple[list[object], set[UUID], set[UUID]]:
    rows: list[object] = []
    user_ids: set[UUID] = set()
    application_ids: set[UUID] = set()
    for index in range(start, stop):
        applicant = _person(prefix, "applicant", index, account_type="TALENT")
        application_id = uuid4()
        application = JobApplication(
            id=application_id,
            job_id=job.id,
            applicant_user_id=applicant.id,
            job_owner_user_id=owner.id,
            applicant_snapshot={"display_name": applicant.display_name, "username": applicant.username},
            status="new",
            participant_status="new",
        )
        rows.extend(
            [
                applicant,
                application,
                Conversation(
                    context_type="job_application",
                    application_id=application_id,
                    job_id=job.id,
                    participant_a_user_id=applicant.id,
                    participant_b_user_id=owner.id,
                ),
                Engagement(
                    source_type="job_application",
                    source_record_id=application_id,
                    application_id=application_id,
                    recruiter_user_id=owner.id,
                    talent_user_id=applicant.id,
                    context_snapshot={
                        "recruiter_name": owner.display_name,
                        "talent_name": applicant.display_name,
                        "context_label": job.title,
                    },
                    status="ready_to_start",
                ),
                InteractionStatusEvent(
                    interaction_type="application",
                    interaction_id=application_id,
                    actor_user_id=owner.id,
                    previous_status=None,
                    new_status="new",
                    status_version=1,
                    event_kind="created",
                    audience="manager_only",
                    idempotency_key=f"query-bound-app-{application_id}",
                ),
            ]
        )
        user_ids.add(applicant.id)
        application_ids.add(application_id)
    return rows, user_ids, application_ids


def _interest_rows(
    *,
    prefix: str,
    owner: User,
    listing: TalentListing,
    start: int,
    stop: int,
) -> tuple[list[object], set[UUID], set[UUID]]:
    rows: list[object] = []
    user_ids: set[UUID] = set()
    interest_ids: set[UUID] = set()
    for index in range(start, stop):
        recruiter = _person(prefix, "recruiter", index, account_type="HIRING")
        interest_id = uuid4()
        interest = TalentInterest(
            id=interest_id,
            talent_listing_id=listing.id,
            recruiter_user_id=recruiter.id,
            owner_user_id=owner.id,
            note="A bounded-query hiring request.",
            status="new",
            participant_status="new",
        )
        rows.extend(
            [
                recruiter,
                interest,
                Conversation(
                    context_type="talent_interest",
                    talent_interest_id=interest_id,
                    talent_listing_id=listing.id,
                    participant_a_user_id=recruiter.id,
                    participant_b_user_id=owner.id,
                ),
                Engagement(
                    source_type="talent_interest",
                    source_record_id=interest_id,
                    talent_interest_id=interest_id,
                    recruiter_user_id=recruiter.id,
                    talent_user_id=owner.id,
                    context_snapshot={
                        "recruiter_name": recruiter.display_name,
                        "talent_name": owner.display_name,
                        "context_label": listing.title,
                    },
                    status="ready_to_start",
                ),
                InteractionStatusEvent(
                    interaction_type="hiring_request",
                    interaction_id=interest_id,
                    actor_user_id=owner.id,
                    previous_status=None,
                    new_status="new",
                    status_version=1,
                    event_kind="created",
                    audience="manager_only",
                    idempotency_key=f"query-bound-interest-{interest_id}",
                ),
            ]
        )
        user_ids.add(recruiter.id)
        interest_ids.add(interest_id)
    return rows, user_ids, interest_ids


async def _persist_relationship_rows(
    session: AsyncSession,
    rows: list[object],
) -> None:
    # These models intentionally expose IDs rather than ORM relationships, so
    # SQLAlchemy cannot infer all foreign-key insertion order from object links.
    people = [row for row in rows if isinstance(row, User)]
    interactions = [
        row for row in rows if isinstance(row, (JobApplication, TalentInterest))
    ]
    dependants = [
        row
        for row in rows
        if isinstance(row, (Conversation, Engagement, InteractionStatusEvent))
    ]
    session.add_all(people)
    await session.flush()
    session.add_all(interactions)
    await session.flush()
    session.add_all(dependants)
    await session.commit()


async def _count_summary_selects(
    session: AsyncSession,
    owner: User,
) -> tuple[object, int]:
    select_count = 0

    def count_selects(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal select_count
        if statement.lstrip().upper().startswith("SELECT"):
            select_count += 1

    listener: Callable[..., None] = count_selects
    event.listen(test_engine.sync_engine, "before_cursor_execute", listener)
    try:
        result = await activity_summary(current_user=owner, session=session)
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", listener)
    return result, select_count


async def test_activity_summary_select_count_is_bounded_by_query_shape(
    db_session: AsyncSession,
) -> None:
    prefix = uuid4().hex[:6]
    owner = _person(prefix, "owner", 0, account_type="HIRING")
    job = Job(
        id=uuid4(),
        title="Bounded-query creator editor",
        posted_by_user_id=owner.id,
        status="published",
        application_mode="internal",
    )
    listing = TalentListing(
        id=uuid4(),
        owner_user_id=owner.id,
        title="Bounded-query creator talent",
        status="published",
    )
    created_user_ids = {owner.id}
    application_ids: set[UUID] = set()
    interest_ids: set[UUID] = set()

    try:
        first_app_rows, first_app_users, first_application_ids = _application_rows(
            prefix=prefix,
            owner=owner,
            job=job,
            start=0,
            stop=1,
        )
        first_interest_rows, first_interest_users, first_interest_ids = _interest_rows(
            prefix=prefix,
            owner=owner,
            listing=listing,
            start=0,
            stop=1,
        )
        db_session.add(owner)
        await db_session.flush()
        db_session.add_all([job, listing])
        await db_session.commit()
        await _persist_relationship_rows(
            db_session,
            [*first_app_rows, *first_interest_rows],
        )
        created_user_ids.update(first_app_users | first_interest_users)
        application_ids.update(first_application_ids)
        interest_ids.update(first_interest_ids)
        db_session.expunge_all()

        one_each, one_each_selects = await _count_summary_selects(db_session, owner)
        assert len(one_each.received_applications) == 1
        assert len(one_each.received_interests) == 1

        more_app_rows, more_app_users, more_application_ids = _application_rows(
            prefix=prefix,
            owner=owner,
            job=job,
            start=1,
            stop=24,
        )
        more_interest_rows, more_interest_users, more_interest_ids = _interest_rows(
            prefix=prefix,
            owner=owner,
            listing=listing,
            start=1,
            stop=24,
        )
        await _persist_relationship_rows(
            db_session,
            [*more_app_rows, *more_interest_rows],
        )
        created_user_ids.update(more_app_users | more_interest_users)
        application_ids.update(more_application_ids)
        interest_ids.update(more_interest_ids)
        db_session.expunge_all()

        twenty_four_each, twenty_four_each_selects = await _count_summary_selects(
            db_session, owner
        )
        assert len(twenty_four_each.received_applications) == 24
        assert len(twenty_four_each.received_interests) == 24
        assert all(item.engagement is not None for item in twenty_four_each.received_applications)
        assert all(item.engagement is not None for item in twenty_four_each.received_interests)

        # Record count may change parameter count and response work; it must not
        # change the number of database round trips. One query of tolerance keeps
        # this portable across SQLite and PostgreSQL transaction bookkeeping.
        assert twenty_four_each_selects <= one_each_selects + 1, (
            one_each_selects,
            twenty_four_each_selects,
        )
        assert twenty_four_each_selects <= 18
    finally:
        await db_session.rollback()
        if application_ids:
            await db_session.execute(
                delete(InteractionStatusEvent).where(
                    InteractionStatusEvent.interaction_type == "application",
                    InteractionStatusEvent.interaction_id.in_(application_ids),
                )
            )
            await db_session.execute(
                delete(Engagement).where(Engagement.application_id.in_(application_ids))
            )
            await db_session.execute(
                delete(Conversation).where(Conversation.application_id.in_(application_ids))
            )
            await db_session.execute(
                delete(JobApplication).where(JobApplication.id.in_(application_ids))
            )
        if interest_ids:
            await db_session.execute(
                delete(InteractionStatusEvent).where(
                    InteractionStatusEvent.interaction_type == "hiring_request",
                    InteractionStatusEvent.interaction_id.in_(interest_ids),
                )
            )
            await db_session.execute(
                delete(Engagement).where(Engagement.talent_interest_id.in_(interest_ids))
            )
            await db_session.execute(
                delete(Conversation).where(Conversation.talent_interest_id.in_(interest_ids))
            )
            await db_session.execute(
                delete(TalentInterest).where(TalentInterest.id.in_(interest_ids))
            )
        await db_session.execute(delete(Job).where(Job.id == job.id))
        await db_session.execute(delete(TalentListing).where(TalentListing.id == listing.id))
        await db_session.execute(delete(User).where(User.id.in_(created_user_ids)))
        await db_session.commit()
