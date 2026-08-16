"""How many imports one person may start, and why the answer is one statement.

The naive quota reads the counter, decides in Python whether there is room, and
writes the increment. Ten simultaneous requests then all read "3 used of 20" and
all proceed. A limit that can be exceeded by asking quickly is not a limit, and
what it is protecting here is provider spend.

The window reset has the same shape and the same trap: "if the window is old,
reset it, then increment" is two steps, and two requests arriving as a window
rolls over would both reset and both start from one.

Enforcement is per USER, not per draft. The cost being bounded belongs to the
provider, and one person with fifty drafts is precisely the case a per-draft
limit would miss.
"""

from __future__ import annotations

import inspect
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio

from app.core import config
from app.models import User
from app.repositories import job_import_quota_repository as quota_repository
from app.repositories.job_import_quota_repository import (
    consume_import_quota,
    release_import_quota,
)

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)
WINDOW = timedelta(hours=24)


@pytest_asyncio.fixture
async def person(db_session) -> User:
    user = User(email=f"quota-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add(user)
    await db_session.flush()
    return user


async def _spend(db_session, person: User, *, limit: int = 3, now: datetime = NOW):
    return await consume_import_quota(
        db_session, person.id, limit=limit, window=WINDOW, now=now
    )


class TestSpendingUnits:
    async def test_the_first_request_is_allowed(self, db_session, person) -> None:
        outcome = await _spend(db_session, person)

        assert outcome.allowed is True
        assert outcome.used == 1
        assert outcome.remaining == 2

    async def test_the_limit_is_reached_exactly(self, db_session, person) -> None:
        for expected in (1, 2, 3):
            outcome = await _spend(db_session, person)
            assert outcome.allowed is True
            assert outcome.used == expected

        refused = await _spend(db_session, person)

        assert refused.allowed is False
        assert refused.remaining == 0

    async def test_a_refusal_does_not_keep_incrementing(self, db_session, person) -> None:
        """Otherwise a caller retrying in a loop pushes the window's reset
        further away with every refusal."""

        for _ in range(3):
            await _spend(db_session, person)
        for _ in range(5):
            await _spend(db_session, person)

        # Still exactly at the limit rather than at eight.
        allowed_after_window = await _spend(
            db_session, person, now=NOW + WINDOW + timedelta(seconds=1)
        )
        assert allowed_after_window.used == 1

    async def test_one_persons_quota_is_not_anothers(self, db_session) -> None:
        first = User(email=f"quota-a-{uuid.uuid4().hex[:8]}@example.test")
        second = User(email=f"quota-b-{uuid.uuid4().hex[:8]}@example.test")
        db_session.add_all([first, second])
        await db_session.flush()

        for _ in range(3):
            await consume_import_quota(
                db_session, first.id, limit=3, window=WINDOW, now=NOW
            )

        outcome = await consume_import_quota(
            db_session, second.id, limit=3, window=WINDOW, now=NOW
        )

        assert outcome.allowed is True


class TestTheWindow:
    async def test_it_resets_once_the_window_has_passed(self, db_session, person) -> None:
        for _ in range(3):
            await _spend(db_session, person)
        assert (await _spend(db_session, person)).allowed is False

        later = await _spend(db_session, person, now=NOW + WINDOW + timedelta(seconds=1))

        assert later.allowed is True
        assert later.used == 1

    async def test_it_does_not_reset_early(self, db_session, person) -> None:
        for _ in range(3):
            await _spend(db_session, person)

        just_inside = await _spend(
            db_session, person, now=NOW + WINDOW - timedelta(seconds=1)
        )

        assert just_inside.allowed is False

    async def test_the_window_start_moves_only_on_reset(self, db_session, person) -> None:
        """A sliding start would let a steady trickle of requests postpone the
        reset indefinitely."""

        await _spend(db_session, person)
        second = await _spend(db_session, person, now=NOW + timedelta(hours=1))

        assert second.used == 2
        # Still inside the original window, so the limit still binds.
        assert (
            await _spend(db_session, person, now=NOW + timedelta(hours=2))
        ).used == 3
        assert (
            await _spend(db_session, person, now=NOW + timedelta(hours=3))
        ).allowed is False


class TestRefunds:
    async def test_a_unit_can_be_given_back(self, db_session, person) -> None:
        """The unit stands for a provider call. A request refused before making
        one has not spent anything."""

        await _spend(db_session, person)
        await release_import_quota(db_session, person.id, now=NOW)

        outcome = await _spend(db_session, person)

        assert outcome.used == 1

    async def test_a_refund_cannot_manufacture_quota(self, db_session, person) -> None:
        for _ in range(4):
            await release_import_quota(db_session, person.id, now=NOW)

        outcome = await _spend(db_session, person)

        assert outcome.used == 1


class TestItIsOneStatement:
    """Structural, because SQLite on one connection cannot show the race.

    A read-then-decide-then-write quota passes every behavioural test above and
    fails in production the first time two requests arrive together.
    """

    def test_consuming_does_not_select_first(self) -> None:
        source_text = inspect.getsource(consume_import_quota)

        assert "update(JobImportQuotaCounter)" in source_text
        assert ".returning(" in source_text
        assert "select(" not in source_text

    def test_the_window_reset_is_inside_the_same_statement(self) -> None:
        """A separate "reset if stale" step is another read-then-write, and two
        requests at the rollover would both reset and both start from one."""

        source_text = inspect.getsource(consume_import_quota)

        assert "case(" in source_text
        assert source_text.count("update(JobImportQuotaCounter)") == 1

    def test_creating_the_row_cannot_race(self) -> None:
        source_text = inspect.getsource(quota_repository._ensure_counter)

        assert "on_conflict_do_nothing" in source_text

    def test_the_module_offers_no_read_helper(self) -> None:
        """A "get the counter" helper would be used to decide, and deciding in
        Python is the defect."""

        exported = [
            name
            for name in dir(quota_repository)
            if name.startswith(("get_", "find_", "count_")) and not name.startswith("_")
        ]

        assert exported == []


@pytest.mark.parametrize("limit", [1, 2, 10])
async def test_the_limit_is_honoured_exactly(db_session, person, limit: int) -> None:
    allowed = 0
    for _ in range(limit + 3):
        if (
            await consume_import_quota(
                db_session, person.id, limit=limit, window=WINDOW, now=NOW
            )
        ).allowed:
            allowed += 1

    assert allowed == limit


def test_the_shipped_default_is_a_real_limit() -> None:
    """Large enough not to interrupt ordinary work, small enough to bound a
    runaway. A default of "unlimited" would make the setting decorative."""

    assert 1 <= config.Settings().job_import_daily_quota <= 200
