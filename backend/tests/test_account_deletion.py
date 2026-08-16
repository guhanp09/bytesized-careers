"""Asking for an account to be deleted.

The instinct is to delete the row, and it is the wrong one — not from
squeamishness, but because an account is entangled with other people's records.
Their messages are half of somebody else's conversation. Their application is a
decision a recruiter is in the middle of. Erasing all of that inside the request
that asked for it resolves every one of those questions silently, in whatever
way the query happened to be written, and irreversibly.

So what is tested here is the part that can be true immediately and destroys
nothing: the request is recorded, the person stops being visible, and every
session ends. What gets erased, and after how long, is a legal and product
decision recorded as such — inventing a retention period would be worse than
leaving it open, because a wrong number looks exactly like a right one.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import AccountDeletionRequest, AuthSession, User
from app.services.account_deletion_service import (
    CANCELLED,
    REQUESTED,
    AccountDeletionError,
    cancel_request,
    open_request,
    request_deletion,
)

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)


@pytest_asyncio.fixture
async def person(db_session) -> User:
    user = User(email=f"deletion-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add(user)
    await db_session.flush()
    return user


class TestAskingIsRecorded:
    async def test_a_request_is_stored(self, db_session, person) -> None:
        request = await request_deletion(db_session, person, reason="Done here.", now=NOW)

        assert request.status == REQUESTED
        assert request.reason == "Done here."
        assert await open_request(db_session, person.id) is not None

    async def test_asking_twice_is_one_request(self, db_session, person) -> None:
        """Two open requests would mean two answers to "when does this happen",
        and someone asking again is repeating themselves, not asking for
        something new."""

        first = await request_deletion(db_session, person, now=NOW)
        second = await request_deletion(db_session, person, now=NOW)

        assert first.id == second.id
        rows = (
            await db_session.execute(
                select(AccountDeletionRequest).where(
                    AccountDeletionRequest.user_id == person.id
                )
            )
        ).scalars().all()
        assert len(rows) == 1

    async def test_a_very_long_reason_is_bounded(self, db_session, person) -> None:
        request = await request_deletion(db_session, person, reason="x" * 9000, now=NOW)

        assert request.reason is not None
        assert len(request.reason) <= 2000

    async def test_an_empty_reason_is_stored_as_nothing(
        self, db_session, person
    ) -> None:
        """A blank string pretends an explanation was given."""

        request = await request_deletion(db_session, person, reason="   ", now=NOW)

        assert request.reason is None


class TestTheImmediateEffects:
    async def test_the_account_stops_being_visible(self, db_session, person) -> None:
        """The part the person actually asked for that can be done at once and
        undone if they change their mind."""

        await request_deletion(db_session, person, now=NOW)

        assert person.suspended_at == NOW
        assert person.suspension_reason is not None

    async def test_every_session_is_ended(self, db_session, person) -> None:
        """Between asking and completing there is a window, and a session that
        survives it is a stolen laptop still using an account whose owner has
        said they are finished with it."""

        session_row = AuthSession(
            user_id=person.id,
            authentication_method="password",
            absolute_expires_at=NOW.replace(year=2030),
        )
        db_session.add(session_row)
        await db_session.flush()

        await request_deletion(db_session, person, now=NOW)
        await db_session.refresh(session_row)

        assert session_row.revoked_at is not None

    async def test_nothing_is_destroyed_yet(self, db_session, person) -> None:
        """The account still exists. What is erased and when is policy, not a
        side effect of the request."""

        await request_deletion(db_session, person, now=NOW)

        assert await db_session.get(User, person.id) is not None


class TestChangingYourMind:
    async def test_cancelling_restores_visibility(self, db_session, person) -> None:
        await request_deletion(db_session, person, now=NOW)

        cancelled = await cancel_request(db_session, person, now=NOW)

        assert cancelled.status == CANCELLED
        assert cancelled.cancelled_at is not None
        assert person.suspended_at is None
        assert person.suspension_reason is None

    async def test_cancelling_without_a_request_is_refused(
        self, db_session, person
    ) -> None:
        with pytest.raises(AccountDeletionError):
            await cancel_request(db_session, person, now=NOW)

    async def test_cancelling_does_not_lift_an_administrator_suspension(
        self, db_session, person
    ) -> None:
        """The dangerous case. Otherwise a suspended account could restore
        itself by asking to be deleted and then changing its mind."""

        person.suspended_at = NOW
        person.suspension_reason = "Suspended by an administrator for abuse."
        await db_session.flush()

        await request_deletion(db_session, person, now=NOW)
        await cancel_request(db_session, person, now=NOW)

        assert person.suspended_at is not None
        assert person.suspension_reason == "Suspended by an administrator for abuse."

    async def test_a_cancelled_request_is_no_longer_outstanding(
        self, db_session, person
    ) -> None:
        await request_deletion(db_session, person, now=NOW)
        await cancel_request(db_session, person, now=NOW)

        assert await open_request(db_session, person.id) is None

    async def test_asking_again_after_cancelling_opens_a_new_request(
        self, db_session, person
    ) -> None:
        await request_deletion(db_session, person, now=NOW)
        await cancel_request(db_session, person, now=NOW)

        again = await request_deletion(db_session, person, now=NOW)

        assert again.status == REQUESTED
        assert person.suspended_at is not None


class TestOneAccountsRequestIsNotAnothers:
    async def test_requesting_does_not_touch_anyone_else(self, db_session) -> None:
        first = User(email=f"del-a-{uuid.uuid4().hex[:8]}@example.test")
        second = User(email=f"del-b-{uuid.uuid4().hex[:8]}@example.test")
        db_session.add_all([first, second])
        await db_session.flush()

        await request_deletion(db_session, first, now=NOW)

        assert second.suspended_at is None
        assert await open_request(db_session, second.id) is None


def test_the_service_invents_no_retention_period() -> None:
    """The duration is a legal and product decision. A number chosen here would
    look exactly like a number someone decided, which is the problem."""

    import inspect

    from app.services import account_deletion_service

    source = inspect.getsource(account_deletion_service)

    for invented in ("timedelta(days=30", "timedelta(days=90", "RETENTION_DAYS"):
        assert invented not in source, invented
