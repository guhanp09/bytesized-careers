"""Disabling real production delivery must preserve, not consume, the outbox."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.core.config import settings
from app.models import EmailOutbox
from app.notifications import runner, worker
from app.notifications.provider import (
    EmailDeliveryPaused,
    MockEmailProvider,
    ProviderResult,
    SmtpEmailProvider,
)
from tests.test_email_outbox_worker import _queue, _reload
from tests.test_email_worker_runner import _Factory

NOW = datetime(2026, 9, 24, tzinfo=UTC)


@pytest_asyncio.fixture(autouse=True)
async def isolated_production_settings(monkeypatch, db_session):
    # All engine access stays on conftest's disposable test DB, never settings' DB.
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "email_mode", "smtp")
    monkeypatch.setattr(settings, "email_delivery_enabled", False)
    await db_session.execute(delete(EmailOutbox))
    await db_session.flush()


class RecordingProvider:
    def __init__(self, *, pause_after_send=False):
        self.calls = []
        self.pause_after_send = pause_after_send

    async def send(self, row):
        self.calls.append(row.id)
        if self.pause_after_send:
            settings.email_delivery_enabled = False
        return ProviderResult.sent(f"test-provider-{row.id}")


@pytest.mark.parametrize("mode,enabled", [("smtp", False), ("log", False), ("log", True)])
def test_disabled_or_invalid_production_selection_never_returns_mock(monkeypatch, mode, enabled):
    monkeypatch.setattr(settings, "email_mode", mode)
    monkeypatch.setattr(settings, "email_delivery_enabled", enabled)
    assert runner.build_provider() is None


def test_enabled_production_selects_smtp(monkeypatch):
    monkeypatch.setattr(settings, "email_delivery_enabled", True)
    assert isinstance(runner.build_provider(), SmtpEmailProvider)


@pytest.mark.parametrize("environment", ["development", "test", "staging"])
def test_nonproduction_mock_compatibility(monkeypatch, environment):
    monkeypatch.setattr(settings, "app_env", environment)
    assert isinstance(runner.build_provider(), MockEmailProvider)


async def test_mock_cannot_record_production_success_even_if_called_directly(db_session):
    row = await _queue(db_session)
    provider = MockEmailProvider()
    with pytest.raises(RuntimeError):
        await provider.send(row)
    assert provider.sent == []


async def test_paused_worker_never_claims_or_uses_session(monkeypatch):
    async def forbidden_claim(*args, **kwargs):
        pytest.fail("production pause attempted to claim mail")

    monkeypatch.setattr(worker, "claim_due_emails", forbidden_claim)
    provider = RecordingProvider()
    run = await worker.process_outbox_once(None, provider=provider, now=NOW)
    assert run.claimed == run.sent == run.retrying == run.failed == 0
    assert run.paused
    assert provider.calls == []


async def test_pause_preserves_every_delivery_field_then_resumes_once(monkeypatch, db_session):
    row = await _queue(db_session)
    row_id = row.id
    fields = (
        "status",
        "attempts",
        "leased_by",
        "leased_until",
        "next_attempt_at",
        "processed_at",
        "provider_message_id",
        "error",
    )
    before = {name: getattr(row, name) for name in fields}
    provider = RecordingProvider()
    run = await worker.process_outbox_once(db_session, provider=provider, now=NOW)
    assert run.sent == run.claimed == 0
    after = await _reload(db_session, row_id)
    assert {name: getattr(after, name) for name in fields} == before
    monkeypatch.setattr(settings, "email_delivery_enabled", True)
    resumed = await worker.process_outbox_once(db_session, provider=provider, now=NOW)
    assert resumed.sent == 1
    assert (await _reload(db_session, row_id)).attempts == 1
    again = await worker.process_outbox_once(db_session, provider=provider, now=NOW)
    assert again.claimed == 0
    assert provider.calls == [row_id]


async def test_injected_mock_rejected_before_enabled_production_claim(monkeypatch, db_session):
    monkeypatch.setattr(settings, "email_delivery_enabled", True)
    row_id = (await _queue(db_session)).id
    with pytest.raises(RuntimeError):
        await worker.process_outbox_once(db_session, provider=MockEmailProvider(), now=NOW)
    row = await _reload(db_session, row_id)
    assert row.status == "queued" and row.attempts == 0 and row.leased_by is None


async def test_pause_mid_batch_stops_unattempted_rows_without_spending_retries(
    monkeypatch, db_session
):
    ids = [(await _queue(db_session)).id for _ in range(2)]
    monkeypatch.setattr(settings, "email_delivery_enabled", True)
    provider = RecordingProvider(pause_after_send=True)
    run = await worker.process_outbox_once(db_session, provider=provider, limit=2, now=NOW)
    assert run.claimed == 2 and run.sent == 1 and run.paused
    remaining_id = next(row_id for row_id in ids if row_id not in provider.calls)
    remaining = await _reload(db_session, remaining_id)
    assert remaining.status == "queued" and remaining.attempts == 0
    # Already acquired leases expire normally; don't add an unfenced release path.
    monkeypatch.setattr(settings, "email_delivery_enabled", True)
    resumed = await worker.process_outbox_once(
        db_session, provider=provider, now=NOW + timedelta(seconds=121)
    )
    assert resumed.sent == 1
    assert set(provider.calls) == set(ids)


async def test_smtp_checks_pause_at_the_last_send_boundary(monkeypatch, db_session):
    calls = []
    monkeypatch.setattr("app.notifications.provider.send_auth_email", lambda **kw: calls.append(kw))
    with pytest.raises(RuntimeError):
        await SmtpEmailProvider().send(await _queue(db_session))
    assert calls == []


async def test_provider_pause_is_not_a_failed_attempt(monkeypatch, db_session):
    class PausedProvider:
        async def send(self, row):
            raise EmailDeliveryPaused("Paused before any I/O")

    monkeypatch.setattr(settings, "email_delivery_enabled", True)
    row_id = (await _queue(db_session)).id
    run = await worker.process_outbox_once(db_session, provider=PausedProvider(), now=NOW)
    row = await _reload(db_session, row_id)
    assert run.claimed == 1 and run.paused
    assert run.sent == run.retrying == run.failed == 0
    assert row.status == "queued" and row.attempts == 0 and row.error is None
    assert row.processed_at is None and row.provider_message_id is None


async def test_pause_during_consent_lookup_prevents_provider_call(monkeypatch, db_session):
    async def pause_during_lookup(*args, **kwargs):
        monkeypatch.setattr(settings, "email_delivery_enabled", False)
        return frozenset()

    monkeypatch.setattr(settings, "email_delivery_enabled", True)
    monkeypatch.setattr(worker, "opted_out_categories", pause_during_lookup)
    row_id = (await _queue(db_session)).id
    provider = RecordingProvider()
    run = await worker.process_outbox_once(db_session, provider=provider, now=NOW)
    assert run.paused and provider.calls == []
    row = await _reload(db_session, row_id)
    assert row.status == "queued" and row.attempts == 0


async def test_runner_pauses_without_session_and_reselects_sender_on_resume(monkeypatch):
    factory = _Factory()

    class ResumeAfterOneInterval(asyncio.Event):
        async def wait(self):
            if self.is_set():
                return True
            assert factory.sessions == [], "paused runner opened a DB session"
            monkeypatch.setattr(settings, "email_delivery_enabled", True)
            raise TimeoutError

    stop = ResumeAfterOneInterval()

    async def pass_once(session, **kwargs):
        assert settings.email_delivery_enabled, "runner drained while paused"
        assert isinstance(kwargs["provider"], SmtpEmailProvider)
        stop.set()

    monkeypatch.setattr(worker, "process_outbox_once", pass_once)
    await asyncio.wait_for(runner.run_worker_forever(factory, stop=stop), timeout=5)
    assert len(factory.sessions) == 1 and factory.sessions[0].committed == 1
