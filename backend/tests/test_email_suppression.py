"""When the platform must stop mailing an address, and when it must not.

The rule that carries the most weight is the asymmetry between the two reasons
to suppress. A hard bounce is a fact about a mailbox: it does not exist, so
nothing can be delivered there and continuing to try costs the sending domain
its reputation. A complaint is a judgement about mail *we chose to send*: the
person is still there and still able to receive what they themselves asked for.

Collapsing the two is the expensive mistake in both directions. Treat every
complaint as a hard bounce and someone who once reported a job alert can never
reset their password again. Treat every hard bounce as a complaint and the
platform keeps mailing a dead address forever.

The webhook tests are about one thing: this endpoint cannot be authenticated the
ordinary way, so the signature is the only thing preventing a stranger from
posting a fabricated bounce and quietly cutting off anyone's mail.
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from conftest import TestSessionLocal
from sqlalchemy import delete, select

from app.core import config
from app.models import EmailOutbox, EmailSuppression
from app.notifications.provider import MockEmailProvider
from app.notifications.worker import process_outbox_once
from app.services.email_suppression_service import (
    COMPLAINT,
    HARD_BOUNCE,
    MANUAL,
    decide,
    find_suppression,
    may_send,
    record_suppression,
    release_suppression,
)
from app.services.email_webhook_signature import expected_signature, verify_signature

T0 = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)
WEBHOOK_PATH = "/api/v1/email-webhooks/delivery"
SECRET = "a-shared-webhook-secret"


@pytest_asyncio.fixture(autouse=True)
async def _isolate(db_session):
    """Committed, not flushed — a held write transaction locks SQLite out."""

    await db_session.execute(delete(EmailSuppression))
    await db_session.execute(delete(EmailOutbox))
    await db_session.commit()
    yield


def _suppression(reason: str, *, released: bool = False) -> EmailSuppression:
    return EmailSuppression(
        email="person@example.test",
        reason=reason,
        released_at=T0 if released else None,
    )


async def _stored(email: str) -> EmailSuppression | None:
    """Read through a fresh session.

    The endpoint commits on its own session; the test's session is already in a
    transaction and would keep showing the snapshot from before the request.
    """

    async with TestSessionLocal() as session:
        return await find_suppression(session, email)


def _signed(body: dict, *, secret: str = SECRET, timestamp: str | None = None) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode("utf-8")
    stamp = timestamp or str(int(time.time()))
    return raw, {
        "x-creatorjobs-signature": expected_signature(secret=secret, timestamp=stamp, body=raw),
        "x-creatorjobs-timestamp": stamp,
        "content-type": "application/json",
    }


class TestTheRuleIsAsymmetric:
    def test_a_hard_bounce_stops_everything_including_a_password_reset(self) -> None:
        """The mailbox does not exist. A reset link cannot arrive there."""

        decision = decide(_suppression(HARD_BOUNCE), event_key="auth.password_reset")
        assert decision.allowed is False

    def test_a_complaint_does_not_stop_a_password_reset(self) -> None:
        """Otherwise reporting one job alert locks someone out of their account."""

        assert decide(_suppression(COMPLAINT), event_key="auth.password_reset").allowed is True
        assert decide(_suppression(COMPLAINT), event_key="auth.verification").allowed is True

    def test_a_complaint_stops_the_mail_the_platform_chose_to_send(self) -> None:
        assert decide(_suppression(COMPLAINT), event_key="new_applicant").allowed is False

    def test_a_released_suppression_allows_mail_again(self) -> None:
        assert decide(_suppression(HARD_BOUNCE, released=True), event_key="new_applicant").allowed

    def test_an_unrecognised_reason_does_not_stop_anything(self) -> None:
        """Recorded but not ruled on. Silently dropping mail for a category
        nobody decided about is worse than sending it."""

        assert decide(_suppression("some_new_provider_category"), event_key="new_applicant").allowed

    def test_no_suppression_allows_mail(self) -> None:
        assert decide(None, event_key="new_applicant").allowed is True


class TestRecording:
    async def test_the_address_is_normalized(self, db_session) -> None:
        """A bounce for Person@Example.com is the same mailbox as person@example.com."""

        await record_suppression(
            db_session, email="  Person@Example.TEST ", reason=HARD_BOUNCE, now=T0
        )
        await db_session.flush()

        assert await find_suppression(db_session, "person@example.test") is not None

    async def test_a_repeated_report_does_not_raise_or_overwrite(self, db_session) -> None:
        """Providers redeliver webhooks. That is the contract, not a fault."""

        await record_suppression(
            db_session, email="dup@example.test", reason=HARD_BOUNCE, detail="first", now=T0
        )
        await db_session.flush()
        await record_suppression(
            db_session, email="dup@example.test", reason=COMPLAINT, detail="second", now=T0
        )
        await db_session.flush()

        rows = (
            await db_session.execute(
                select(EmailSuppression).where(EmailSuppression.email == "dup@example.test")
            )
        ).scalars().all()

        assert len(rows) == 1
        # The original decision stands; a later, vaguer report does not replace it.
        assert rows[0].reason == HARD_BOUNCE
        assert rows[0].detail == "first"

    async def test_a_transient_category_suppresses_nothing(self, db_session) -> None:
        """Soft bounces are what the retry schedule is for."""

        result = await record_suppression(
            db_session, email="soft@example.test", reason="soft_bounce", now=T0
        )
        await db_session.flush()

        assert result is None
        assert await find_suppression(db_session, "soft@example.test") is None

    async def test_releasing_keeps_the_history(self, db_session) -> None:
        await record_suppression(
            db_session, email="back@example.test", reason=HARD_BOUNCE, now=T0
        )
        await db_session.flush()

        released = await release_suppression(
            db_session, email="back@example.test", reason="address confirmed", now=T0
        )

        assert released is not None
        assert released.released_at is not None
        # Still there: "this bounced in March" is the context for April's
        # support conversation.
        assert await find_suppression(db_session, "back@example.test") is not None
        assert (
            await may_send(db_session, email="back@example.test", event_key="new_applicant")
        ).allowed is True


class TestTheWorkerHonoursIt:
    async def _queue(self, session, *, to_email: str, event_key: str) -> EmailOutbox:
        row = EmailOutbox(
            to_email=to_email,
            event_key=event_key,
            template_key=event_key,
            subject="Subject",
            body="Body",
            status="queued",
        )
        session.add(row)
        await session.flush()
        return row

    async def test_a_suppressed_address_is_never_handed_to_the_provider(
        self, db_session
    ) -> None:
        """Checked at send time, not enqueue time: an address can be suppressed
        after its mail is queued, and that queued mail is what must not go out."""

        row = await self._queue(
            db_session, to_email="gone@example.test", event_key="new_applicant"
        )
        await record_suppression(db_session, email="gone@example.test", reason=HARD_BOUNCE, now=T0)
        await db_session.flush()

        provider = MockEmailProvider()
        run = await process_outbox_once(db_session, provider=provider)

        assert provider.sent == []
        assert run.suppressed == 1
        assert run.sent == 0
        await db_session.refresh(row)
        assert row.status == "skipped"

    async def test_a_complaint_still_lets_the_reset_through(self, db_session) -> None:
        row = await self._queue(
            db_session, to_email="cross@example.test", event_key="auth.password_reset"
        )
        await record_suppression(db_session, email="cross@example.test", reason=COMPLAINT, now=T0)
        await db_session.flush()

        provider = MockEmailProvider()
        run = await process_outbox_once(db_session, provider=provider)

        assert run.sent == 1
        await db_session.refresh(row)
        assert row.status == "sent"

    async def test_an_unsuppressed_address_is_unaffected(self, db_session) -> None:
        row = await self._queue(
            db_session, to_email="fine@example.test", event_key="new_applicant"
        )

        run = await process_outbox_once(db_session, provider=MockEmailProvider())

        assert run.sent == 1
        await db_session.refresh(row)
        assert row.status == "sent"


class TestTheWebhookCannotBeForged:
    """The endpoint is unauthenticated by necessity, so this is the whole gate.

    A forged hard bounce is a denial of service against one account at a time:
    it stops that person receiving mail, including a password reset, and leaves
    nothing that looks like an attack.
    """

    async def test_a_valid_report_suppresses(self, client, db_session, monkeypatch) -> None:
        monkeypatch.setattr(config.settings, "email_webhook_secret", SECRET)
        body, headers = _signed({"event": "bounce", "email": "bounced@example.test"})

        response = await client.post(WEBHOOK_PATH, content=body, headers=headers)

        assert response.status_code == 200
        assert response.json() == {"ok": True, "suppressed": True}
        assert await _stored("bounced@example.test") is not None

    async def test_an_unsigned_report_is_refused(self, client, db_session, monkeypatch) -> None:
        monkeypatch.setattr(config.settings, "email_webhook_secret", SECRET)
        body = json.dumps({"event": "bounce", "email": "unsigned@example.test"}).encode()

        response = await client.post(
            WEBHOOK_PATH, content=body, headers={"content-type": "application/json"}
        )

        assert response.status_code == 401
        assert await _stored("unsigned@example.test") is None

    async def test_a_wrong_secret_is_refused(self, client, db_session, monkeypatch) -> None:
        monkeypatch.setattr(config.settings, "email_webhook_secret", SECRET)
        body, headers = _signed(
            {"event": "bounce", "email": "wrongkey@example.test"}, secret="not-the-secret"
        )

        response = await client.post(WEBHOOK_PATH, content=body, headers=headers)

        assert response.status_code == 401
        assert await _stored("wrongkey@example.test") is None

    async def test_a_tampered_body_is_refused(self, client, db_session, monkeypatch) -> None:
        """The signature covers the claim itself, not just the fact of a request."""

        monkeypatch.setattr(config.settings, "email_webhook_secret", SECRET)
        _, headers = _signed({"event": "bounce", "email": "original@example.test"})
        swapped = json.dumps({"event": "bounce", "email": "victim@example.test"}).encode()

        response = await client.post(WEBHOOK_PATH, content=swapped, headers=headers)

        assert response.status_code == 401
        assert await _stored("victim@example.test") is None

    async def test_a_replayed_report_expires(self, client, db_session, monkeypatch) -> None:
        """A captured request must not stay a working credential."""

        monkeypatch.setattr(config.settings, "email_webhook_secret", SECRET)
        stale = str(int(time.time()) - 3600)
        body, headers = _signed({"event": "bounce", "email": "replay@example.test"}, timestamp=stale)

        response = await client.post(WEBHOOK_PATH, content=body, headers=headers)

        assert response.status_code == 401
        assert await _stored("replay@example.test") is None

    async def test_an_unconfigured_secret_refuses_rather_than_allows(
        self, client, db_session, monkeypatch
    ) -> None:
        """A missing environment variable must not become an open door."""

        monkeypatch.setattr(config.settings, "email_webhook_secret", None)
        body, headers = _signed({"event": "bounce", "email": "nosecret@example.test"})

        response = await client.post(WEBHOOK_PATH, content=body, headers=headers)

        assert response.status_code == 401
        assert await _stored("nosecret@example.test") is None

    async def test_an_unknown_event_is_accepted_and_acted_on_by_nobody(
        self, client, db_session, monkeypatch
    ) -> None:
        """200 because a provider that gets an error retries, and retrying will
        not make an unknown category known. But nothing is suppressed."""

        monkeypatch.setattr(config.settings, "email_webhook_secret", SECRET)
        body, headers = _signed({"event": "opened", "email": "curious@example.test"})

        response = await client.post(WEBHOOK_PATH, content=body, headers=headers)

        assert response.status_code == 200
        assert response.json()["suppressed"] is False
        assert await _stored("curious@example.test") is None

    async def test_a_soft_bounce_does_not_suppress(
        self, client, db_session, monkeypatch
    ) -> None:
        monkeypatch.setattr(config.settings, "email_webhook_secret", SECRET)
        body, headers = _signed({"event": "soft_bounce", "email": "temporary@example.test"})

        response = await client.post(WEBHOOK_PATH, content=body, headers=headers)

        assert response.status_code == 200
        assert await _stored("temporary@example.test") is None

    async def test_a_report_with_no_address_is_refused(self, client, monkeypatch) -> None:
        monkeypatch.setattr(config.settings, "email_webhook_secret", SECRET)
        body, headers = _signed({"event": "bounce"})

        response = await client.post(WEBHOOK_PATH, content=body, headers=headers)

        assert response.status_code == 400


class TestTheSignatureRulesThemselves:
    """Pure checks, so the reasons for refusal can be read without an HTTP client."""

    def test_every_failure_mode_is_refused(self) -> None:
        body = b'{"event":"bounce"}'
        now = 1_800_000_000.0
        stamp = str(int(now))
        good = expected_signature(secret=SECRET, timestamp=stamp, body=body)

        assert verify_signature(
            secret=SECRET, signature=good, timestamp=stamp, body=body, now=now
        ).valid

        for case in (
            {"secret": None},
            {"secret": ""},
            {"signature": None},
            {"signature": ""},
            {"timestamp": None},
            {"timestamp": "not-a-number"},
            {"timestamp": str(int(now) - 3600)},
            {"body": b'{"event":"complaint"}'},
        ):
            arguments = {
                "secret": SECRET,
                "signature": good,
                "timestamp": stamp,
                "body": body,
                "now": now,
            }
            arguments.update(case)
            assert verify_signature(**arguments).valid is False, case

    @pytest.mark.parametrize("skew", [-299, 0, 299])
    def test_ordinary_clock_skew_is_tolerated(self, skew: int) -> None:
        """Refusing a slightly-off clock would drop real reports."""

        body = b'{"event":"bounce"}'
        now = 1_800_000_000.0
        stamp = str(int(now) + skew)

        assert verify_signature(
            secret=SECRET,
            signature=expected_signature(secret=SECRET, timestamp=stamp, body=body),
            timestamp=stamp,
            body=body,
            now=now,
        ).valid

    def test_the_timestamp_is_inside_the_signature(self) -> None:
        """Otherwise a captured body could be replayed under a fresh timestamp."""

        body = b'{"event":"bounce"}'
        first = expected_signature(secret=SECRET, timestamp="1000", body=body)
        second = expected_signature(secret=SECRET, timestamp="2000", body=body)

        assert first != second


def test_manual_suppression_is_a_blocking_reason() -> None:
    """An operator switching someone off has to actually switch them off."""

    assert decide(_suppression(MANUAL), event_key="new_applicant").allowed is False


def test_a_suppression_row_needs_no_user(db_session) -> None:
    """Mail is addressed to an address. Suppressing one must not require an
    account, or a bounce for a former user cannot be recorded at all."""

    row = EmailSuppression(email=f"stranger-{uuid.uuid4().hex[:8]}@example.test", reason=HARD_BOUNCE)
    assert not hasattr(row, "user_id")


def test_the_tolerance_window_is_bounded() -> None:
    from app.services.email_webhook_signature import DEFAULT_TOLERANCE_SECONDS

    assert 0 < DEFAULT_TOLERANCE_SECONDS <= timedelta(minutes=15).total_seconds()
