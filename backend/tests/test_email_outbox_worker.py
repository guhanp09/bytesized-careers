"""The loop that turns queued intent into delivered mail.

Two properties matter more than the rest. A message must never be sent twice —
so a successful row has to be terminal from the worker's point of view, not just
marked. And a provider that misbehaves must not be able to strand a row: an
exception is a delivery failure like any other, because a client library
throwing on a socket error is exactly the transient case retries exist for.

The provider is a fake throughout. A queue test that needs a network is a queue
test that will be skipped.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import delete, select

from app.models import EmailOutbox
from app.notifications.provider import MockEmailProvider, ProviderResult
from app.notifications.worker import process_outbox_once
from app.repositories.email_outbox_delivery import BASE_RETRY_SECONDS, MAX_ATTEMPTS

T0 = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)


@pytest_asyncio.fixture(autouse=True)
async def _isolate_outbox(db_session):
    """Each test starts from an empty outbox — see test_email_outbox_claim."""
    await db_session.execute(delete(EmailOutbox))
    await db_session.flush()
    yield


class _ScriptedProvider:
    """Answers with whatever the test says, and counts the asking."""

    def __init__(self, *results) -> None:
        self.results = list(results)
        self.calls = 0

    async def send(self, row):
        self.calls += 1
        if not self.results:
            return ProviderResult.sent(message_id=f"prov-{self.calls}")
        return self.results.pop(0)


class _RaisingProvider:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc
        self.calls = 0

    async def send(self, row):
        self.calls += 1
        raise self.exc


async def _queue(session, **overrides) -> EmailOutbox:
    row = EmailOutbox(
        to_email=overrides.pop("to_email", f"{uuid.uuid4().hex[:8]}@example.test"),
        event_key=overrides.pop("event_key", "test_event"),
        template_key=overrides.pop("template_key", "test_template"),
        subject=overrides.pop("subject", "Subject"),
        status=overrides.pop("status", "queued"),
        **overrides,
    )
    session.add(row)
    await session.flush()
    return row


async def _reload(session, row_id) -> EmailOutbox:
    session.expire_all()
    found = await session.execute(select(EmailOutbox).where(EmailOutbox.id == row_id))
    return found.scalar_one()


class TestAPassDelivers:
    async def test_a_queued_row_is_sent(self, db_session) -> None:
        row = await _queue(db_session)
        provider = MockEmailProvider()

        run = await process_outbox_once(db_session, provider=provider, now=T0)

        assert run.claimed == 1 and run.sent == 1
        assert (await _reload(db_session, row.id)).status == "sent"

    async def test_the_provider_identifier_is_kept(self, db_session) -> None:
        row = await _queue(db_session)

        await process_outbox_once(db_session, provider=MockEmailProvider(), now=T0)

        assert (await _reload(db_session, row.id)).provider_message_id is not None

    async def test_an_empty_outbox_is_a_no_op(self, db_session) -> None:
        provider = MockEmailProvider()

        run = await process_outbox_once(db_session, provider=provider, now=T0)

        assert run.claimed == 0
        assert provider.sent == []

    async def test_it_respects_the_batch_limit(self, db_session) -> None:
        for _ in range(5):
            await _queue(db_session)

        run = await process_outbox_once(db_session, provider=MockEmailProvider(), limit=2, now=T0)

        assert run.claimed == 2 and run.sent == 2


class TestNothingIsSentTwice:
    async def test_a_second_pass_does_not_resend(self, db_session) -> None:
        """The failure this subsystem must never have."""
        await _queue(db_session)
        provider = _ScriptedProvider()

        await process_outbox_once(db_session, provider=provider, now=T0)
        await process_outbox_once(db_session, provider=provider, now=T0 + timedelta(hours=1))

        assert provider.calls == 1, "the provider was asked to send the same row twice"

    async def test_a_sent_row_is_not_reclaimed_after_its_lease_would_expire(
        self, db_session
    ) -> None:
        await _queue(db_session)
        provider = _ScriptedProvider()

        await process_outbox_once(db_session, provider=provider, now=T0)
        await process_outbox_once(db_session, provider=provider, now=T0 + timedelta(days=1))

        assert provider.calls == 1


class TestFailuresAreClassified:
    async def test_a_retryable_failure_comes_back_later(self, db_session) -> None:
        row = await _queue(db_session)
        provider = _ScriptedProvider(ProviderResult.retryable("smtp timeout"))

        run = await process_outbox_once(db_session, provider=provider, now=T0)

        assert run.retrying == 1 and run.sent == 0
        assert (await _reload(db_session, row.id)).status == "queued"

    async def test_the_retry_is_not_attempted_before_it_is_due(self, db_session) -> None:
        await _queue(db_session)
        provider = _ScriptedProvider(ProviderResult.retryable("smtp timeout"))

        await process_outbox_once(db_session, provider=provider, now=T0)
        await process_outbox_once(
            db_session, provider=provider, now=T0 + timedelta(seconds=BASE_RETRY_SECONDS - 1)
        )

        assert provider.calls == 1

    async def test_the_retry_is_attempted_once_due(self, db_session) -> None:
        await _queue(db_session)
        provider = _ScriptedProvider(ProviderResult.retryable("smtp timeout"))

        await process_outbox_once(db_session, provider=provider, now=T0)
        await process_outbox_once(
            db_session, provider=provider, now=T0 + timedelta(seconds=BASE_RETRY_SECONDS)
        )

        assert provider.calls == 2

    async def test_a_terminal_failure_is_never_retried(self, db_session) -> None:
        row = await _queue(db_session)
        provider = _ScriptedProvider(ProviderResult.terminal("invalid recipient"))

        run = await process_outbox_once(db_session, provider=provider, now=T0)
        await process_outbox_once(db_session, provider=provider, now=T0 + timedelta(days=7))

        assert run.failed == 1
        assert provider.calls == 1
        assert (await _reload(db_session, row.id)).status == "failed"

    async def test_a_suppressed_address_is_not_attempted_again(self, db_session) -> None:
        row = await _queue(db_session)
        provider = _ScriptedProvider(ProviderResult.suppressed("unsubscribed"))

        run = await process_outbox_once(db_session, provider=provider, now=T0)

        assert run.suppressed == 1
        reloaded = await _reload(db_session, row.id)
        assert reloaded.status == "skipped"
        # Nothing was sent, so nothing was attempted.
        assert reloaded.attempts == 0


class TestAMisbehavingProviderCannotStrandMail:
    async def test_an_exception_is_treated_as_a_retryable_failure(self, db_session) -> None:
        # Letting it escape would leave the row leased until expiry with no
        # record of why, which is the worst of both outcomes.
        row = await _queue(db_session)
        provider = _RaisingProvider(RuntimeError("connection reset"))

        run = await process_outbox_once(db_session, provider=provider, now=T0)

        assert run.retrying == 1
        reloaded = await _reload(db_session, row.id)
        assert reloaded.status == "queued"
        assert "connection reset" in (reloaded.error or "")

    async def test_one_bad_row_does_not_abandon_the_rest_of_the_batch(self, db_session) -> None:
        await _queue(db_session)
        await _queue(db_session)
        provider = _ScriptedProvider(
            ProviderResult.terminal("bad address"),
            ProviderResult.sent(message_id="prov-ok"),
        )

        run = await process_outbox_once(db_session, provider=provider, limit=2, now=T0)

        assert run.claimed == 2
        assert run.failed == 1 and run.sent == 1

    async def test_a_permanently_raising_provider_still_terminates(self, db_session) -> None:
        row = await _queue(db_session)
        provider = _RaisingProvider(RuntimeError("always down"))
        moment = T0

        for _ in range(MAX_ATTEMPTS + 2):
            run = await process_outbox_once(db_session, provider=provider, now=moment)
            if run.claimed == 0:
                break
            moment = moment + timedelta(hours=2)

        reloaded = await _reload(db_session, row.id)
        assert reloaded.status == "failed"
        assert reloaded.attempts == MAX_ATTEMPTS


class TestLeaseHandoff:
    async def test_a_row_left_leased_by_a_dead_worker_is_delivered_later(
        self, db_session
    ) -> None:
        # Simulates a crash between claiming and answering: the row keeps its
        # lease and nothing recorded an outcome.
        row = await _queue(db_session)
        from app.repositories.email_outbox_repository import claim_due_emails

        await claim_due_emails(db_session, worker_id="dead", now=T0)

        provider = MockEmailProvider()
        run = await process_outbox_once(
            db_session, provider=provider, now=T0 + timedelta(minutes=10)
        )

        assert run.sent == 1
        assert (await _reload(db_session, row.id)).status == "sent"
