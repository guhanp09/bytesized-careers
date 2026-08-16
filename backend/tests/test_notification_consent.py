"""What someone can switch off, and what must keep arriving anyway.

The line matters in both directions and each side has a real cost.

Let someone unsubscribe from everything and they can lock themselves out of
their own account by clicking a link at the bottom of an email they did not
want — the password reset they ask for next simply never arrives, and nothing
tells them why.

Fail to honour an opt-out and the platform is sending mail to a person who
explicitly asked it to stop, which is the behaviour that produces spam
complaints and, from Phase 5, suppression of the whole address.

So the asymmetry is deliberate and it mirrors the suppression rule: a hard
bounce stops everything because the mailbox does not exist, while a complaint —
and an unsubscribe — stops only what the platform chose to send.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.core.notification_consent import (
    ESSENTIAL_CATEGORIES,
    OPTIONAL_CATEGORIES,
    category_for_event,
    is_essential,
    may_send,
    selectable_categories,
)
from app.models import EmailOutbox, NotificationOptOut, User
from app.notifications.provider import MockEmailProvider
from app.notifications.registry import (
    CATEGORY_DIGEST,
    CATEGORY_LIFECYCLE,
    EVENT_REGISTRY,
)
from app.notifications.worker import process_outbox_once
from app.repositories.notification_preference_repository import (
    clear_opt_out,
    opted_out_categories,
    record_opt_out,
)


@pytest_asyncio.fixture(autouse=True)
async def _empty_outbox(db_session):
    """The worker claims from the WHOLE table.

    Without this, a full-suite run hands these tests every queued email another
    test happened to leave behind, and the assertions count those instead. It
    passes in isolation and fails in the suite — the trap recorded in the Phase
    5C checkpoint, met again.
    """

    await db_session.execute(delete(EmailOutbox))
    await db_session.flush()
    yield


@pytest_asyncio.fixture
async def person(db_session) -> User:
    user = User(email=f"consent-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add(user)
    await db_session.flush()
    return user


class TestWhatCannotBeSwitchedOff:
    @pytest.mark.parametrize(
        "event_key",
        ["auth.verification", "auth.password_reset", "auth.invitation"],
    )
    def test_authentication_mail_is_always_sent(self, event_key: str) -> None:
        """Otherwise unsubscribing locks someone out of their own account, and
        the reset they request next never arrives with no explanation."""

        assert is_essential(event_key) is True
        assert (
            may_send(event_key, opted_out_categories=set(OPTIONAL_CATEGORIES | ESSENTIAL_CATEGORIES))
            is True
        )

    def test_an_unknown_event_is_treated_as_essential(self) -> None:
        """The failure directions are not symmetric. Wrongly sending one email
        is a nuisance; wrongly withholding a password reset is a lockout — so a
        typo must fail towards sending."""

        assert is_essential("some_event_nobody_registered") is True

    def test_transactional_mail_is_not_offered_as_a_choice(self) -> None:
        """A switch that does nothing is worse than no switch: the person
        believes they unsubscribed and the mail keeps coming."""

        for category in ESSENTIAL_CATEGORIES:
            assert category not in selectable_categories()


class TestWhatCanBeSwitchedOff:
    def test_lifecycle_mail_respects_an_opt_out(self) -> None:
        lifecycle_events = [
            key
            for key, event in EVENT_REGISTRY.items()
            if event.category == CATEGORY_LIFECYCLE
        ]
        # Derived from the registry rather than hand-listed: a hand-listed event
        # that turns out to be transactional makes the test assert nothing.
        assert lifecycle_events, "expected at least one lifecycle event to test"

        for event_key in lifecycle_events:
            assert may_send(event_key, opted_out_categories=set()) is True
            assert may_send(event_key, opted_out_categories={CATEGORY_LIFECYCLE}) is False

    def test_opting_out_of_one_category_leaves_the_others(self) -> None:
        lifecycle_event = next(
            key for key, event in EVENT_REGISTRY.items() if event.category == CATEGORY_LIFECYCLE
        )

        assert may_send(lifecycle_event, opted_out_categories={CATEGORY_DIGEST}) is True

    def test_every_selectable_category_is_actually_optional(self) -> None:
        for category in selectable_categories():
            assert category in OPTIONAL_CATEGORIES


class TestStoringTheRefusal:
    async def test_absence_of_a_row_means_subscribed(self, db_session, person) -> None:
        """Stored the other way round, a category added next year would arrive
        switched off for everyone who registered before it existed."""

        assert await opted_out_categories(db_session, person.id) == frozenset()

    async def test_a_refusal_is_recorded(self, db_session, person) -> None:
        await record_opt_out(db_session, user_id=person.id, category=CATEGORY_DIGEST)
        await db_session.flush()

        assert await opted_out_categories(db_session, person.id) == frozenset({CATEGORY_DIGEST})

    async def test_refusing_twice_is_the_same_refusal(self, db_session, person) -> None:
        """An unsubscribe link is clicked twice, prefetched by a mail client,
        and followed by a scanner. Each must mean the same thing."""

        for _ in range(3):
            await record_opt_out(db_session, user_id=person.id, category=CATEGORY_DIGEST)
            await db_session.flush()

        rows = await opted_out_categories(db_session, person.id)
        assert rows == frozenset({CATEGORY_DIGEST})

    async def test_it_can_be_undone(self, db_session, person) -> None:
        await record_opt_out(db_session, user_id=person.id, category=CATEGORY_DIGEST)
        await db_session.flush()

        await clear_opt_out(db_session, user_id=person.id, category=CATEGORY_DIGEST)
        await db_session.flush()

        assert await opted_out_categories(db_session, person.id) == frozenset()

    async def test_someone_with_no_account_has_refused_nothing(self, db_session) -> None:
        """Mail to a person who has no account — an invitation — has no
        preferences to consult, and reading that as "refused everything" would
        stop the one message that matters most."""

        assert await opted_out_categories(db_session, None) == frozenset()

    async def test_one_persons_refusal_is_not_anothers(self, db_session) -> None:
        first = User(email=f"consent-a-{uuid.uuid4().hex[:8]}@example.test")
        second = User(email=f"consent-b-{uuid.uuid4().hex[:8]}@example.test")
        db_session.add_all([first, second])
        await db_session.flush()

        await record_opt_out(db_session, user_id=first.id, category=CATEGORY_DIGEST)
        await db_session.flush()

        assert await opted_out_categories(db_session, second.id) == frozenset()


class TestTheWorkerHonoursIt:
    async def _queue(self, session, *, user: User, event_key: str) -> EmailOutbox:
        row = EmailOutbox(
            user_id=user.id,
            to_email=user.email,
            event_key=event_key,
            template_key=event_key,
            subject="Subject",
            body="Body",
            status="queued",
        )
        session.add(row)
        await session.flush()
        return row

    async def test_an_opted_out_category_is_not_sent(self, db_session, person) -> None:
        """Checked at send time, not enqueue: someone can unsubscribe after the
        mail is queued, and that queued mail is what must not go out."""

        lifecycle_event = next(
            key for key, event in EVENT_REGISTRY.items() if event.category == CATEGORY_LIFECYCLE
        )
        row = await self._queue(db_session, user=person, event_key=lifecycle_event)
        await record_opt_out(
            db_session, user_id=person.id, category=category_for_event(lifecycle_event)
        )
        await db_session.flush()

        provider = MockEmailProvider()
        run = await process_outbox_once(db_session, provider=provider)

        assert provider.sent == []
        assert run.suppressed == 1
        await db_session.refresh(row)
        assert row.status == "skipped"

    async def test_essential_mail_still_goes_out(self, db_session, person) -> None:
        """The property that keeps someone from locking themselves out."""

        row = await self._queue(db_session, user=person, event_key="auth.password_reset")
        for category in OPTIONAL_CATEGORIES | ESSENTIAL_CATEGORIES:
            await record_opt_out(db_session, user_id=person.id, category=category)
        await db_session.flush()

        provider = MockEmailProvider()
        run = await process_outbox_once(db_session, provider=provider)

        assert run.sent == 1
        await db_session.refresh(row)
        assert row.status == "sent"

    async def test_mail_to_someone_who_opted_out_of_something_else_is_sent(
        self, db_session, person
    ) -> None:
        lifecycle_event = next(
            key for key, event in EVENT_REGISTRY.items() if event.category == CATEGORY_LIFECYCLE
        )
        row = await self._queue(db_session, user=person, event_key=lifecycle_event)
        await record_opt_out(db_session, user_id=person.id, category=CATEGORY_DIGEST)
        await db_session.flush()

        provider = MockEmailProvider()
        run = await process_outbox_once(db_session, provider=provider)

        assert run.sent == 1
        await db_session.refresh(row)
        assert row.status == "sent"


def test_the_two_groups_do_not_overlap() -> None:
    """A category in both would make the rule depend on which check ran first."""

    assert not (OPTIONAL_CATEGORIES & ESSENTIAL_CATEGORIES)


def test_the_opt_out_model_has_no_consent_column() -> None:
    """Opt-out, not opt-in: the shape of the table is the policy."""

    columns = set(NotificationOptOut.__table__.columns.keys())

    assert "category" in columns
    assert "opted_in" not in columns
    assert "consented" not in columns
