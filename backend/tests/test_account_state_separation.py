"""Two ways an account can be stopped, and why they must stay apart.

An account can be stopped by an administrator, or by its own owner asking to be
deleted. These were once the same column, and the collision produced a real
escape rather than a tidiness problem:

    the suspend endpoint refuses an account that is already suspended,
    and a deletion request set that same column,
    so requesting deletion made an account impossible to suspend.

An abusive user could have requested deletion to become un-moderatable, then
cancelled once the attention passed — arriving back at a clean account.

So the states are independent, and these tests are about the four combinations
and the two "undo" directions. Each undo must touch only its own state.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest_asyncio

from app.core.account_state import (
    DELETION_PENDING_MESSAGE,
    SUSPENDED_MESSAGE,
    account_block,
    account_is_blocked,
)
from app.models import User
from app.services.account_deletion_service import cancel_request, request_deletion

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)


@pytest_asyncio.fixture
async def person(db_session) -> User:
    user = User(email=f"state-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add(user)
    await db_session.flush()
    return user


class TestTheFourCombinations:
    def test_an_ordinary_account_may_act(self) -> None:
        assert account_is_blocked(User(email="a@example.test")) is False

    def test_a_suspended_account_is_blocked(self) -> None:
        user = User(email="b@example.test", suspended_at=NOW)

        assert account_block(user).reason == SUSPENDED_MESSAGE

    def test_an_account_closing_itself_is_blocked(self) -> None:
        user = User(email="c@example.test", deletion_hidden_at=NOW)

        assert account_block(user).reason == DELETION_PENDING_MESSAGE

    def test_both_at_once_reports_the_suspension(self) -> None:
        """An administrative decision is the more consequential fact, and
        support needs to see it rather than a deletion notice hiding it."""

        user = User(email="d@example.test", suspended_at=NOW, deletion_hidden_at=NOW)

        assert account_block(user).reason == SUSPENDED_MESSAGE


class TestRequestingDeletionIsNotAnEscape:
    async def test_it_leaves_the_account_suspendable(
        self, db_session, person
    ) -> None:
        """The escape this separation closes. While these shared a column, the
        suspend endpoint's "already suspended" refusal meant an account that had
        asked to be deleted could not be suspended at all."""

        await request_deletion(db_session, person, now=NOW)

        # Exactly what the endpoint checks before suspending.
        assert person.suspended_at is None

    async def test_it_does_not_borrow_the_suspension_reason(
        self, db_session, person
    ) -> None:
        await request_deletion(db_session, person, now=NOW)

        assert person.suspension_reason is None
        assert person.suspended_by_user_id is None

    async def test_it_still_blocks_the_account(self, db_session, person) -> None:
        """Separation must not mean the deletion request stops taking effect."""

        await request_deletion(db_session, person, now=NOW)

        assert account_is_blocked(person) is True


class TestNeitherUndoTouchesTheOther:
    async def test_cancelling_deletion_leaves_a_suspension_in_place(
        self, db_session, person
    ) -> None:
        person.suspended_at = NOW
        person.suspension_reason = "Suspended by an administrator."
        await db_session.flush()

        await request_deletion(db_session, person, now=NOW)
        await cancel_request(db_session, person, now=NOW)

        assert person.suspended_at is not None
        assert person.suspension_reason == "Suspended by an administrator."
        assert account_is_blocked(person) is True

    async def test_lifting_a_suspension_leaves_a_deletion_request_in_place(
        self, db_session, person
    ) -> None:
        """The other direction: an administrator deciding someone is no longer
        suspended has not decided they want their account back."""

        await request_deletion(db_session, person, now=NOW)
        person.suspended_at = NOW
        person.suspension_reason = "Suspended by an administrator."
        await db_session.flush()

        # Exactly what unsuspend does.
        person.suspended_at = None
        person.suspension_reason = None
        await db_session.flush()

        assert person.deletion_hidden_at is not None
        assert account_is_blocked(person) is True


class TestEveryEnforcementPointAsksTheHelper:
    def test_the_authenticated_door_uses_it(self) -> None:
        """A second enforcement point checking only `suspended_at` is how one of
        these states silently stops being enforced."""

        import inspect

        from app.api import deps

        source = inspect.getsource(deps)

        assert "account_block(user)" in source

    def test_the_helper_reads_both_columns(self) -> None:
        import inspect

        from app.core import account_state

        source = inspect.getsource(account_state.account_block)

        assert "suspended_at" in source
        assert "deletion_hidden_at" in source


def test_the_deletion_service_never_writes_suspension_state() -> None:
    """Structural, because the bug was an assignment nobody meant as a policy
    decision. Deletion is the account holder's lifecycle; suspension is not."""

    import inspect

    from app.services import account_deletion_service

    source = inspect.getsource(account_deletion_service)

    assert "user.suspended_at =" not in source
    assert "user.suspension_reason =" not in source
