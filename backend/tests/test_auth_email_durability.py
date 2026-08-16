"""Authentication email is a promise the database keeps, not a side effect.

The old arrangement sent verification and reset mail inline, after the
transaction had already committed. Two failures follow from that and neither is
visible in a passing test of the happy path:

* a crash between the commit and the send loses an email nobody knows is owed —
  the account exists and nothing will ever tell its owner how to verify it;
* a provider outage raises inside the request, so a signup that fully succeeded
  reports failure to the person who made it.

So these tests are about the seam, not the message. What has to hold is that the
intent is written in the same transaction as the thing it is about, that no
provider is contacted while a request is in flight, and that the worker is the
only thing that decides an email was delivered.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.models import EmailOutbox
from app.notifications.email import queue_auth_email
from app.notifications.provider import MockEmailProvider
from app.notifications.worker import process_outbox_once
from app.services import auth_service, email_service
from app.services.email_service import EmailDeliveryError


@pytest_asyncio.fixture(autouse=True)
async def _isolate_outbox(db_session):
    """An empty outbox per test — the queries below are table-wide.

    Committed rather than flushed: a held-open write transaction locks SQLite
    against the API client's own connection.
    """

    await db_session.execute(delete(EmailOutbox))
    await db_session.commit()
    yield


async def _rows_for(email: str, event_key: str) -> list[EmailOutbox]:
    async with TestSessionLocal() as session:
        found = await session.execute(
            select(EmailOutbox)
            .where(EmailOutbox.to_email == email)
            .where(EmailOutbox.event_key == event_key)
        )
        return list(found.scalars().all())


def _unique(prefix: str) -> tuple[str, str]:
    suffix = uuid.uuid4().hex[:8]
    return f"{prefix}{suffix}@example.com", f"{prefix}{suffix}"


class TestTheIntentIsRecorded:
    async def test_registration_queues_one_verification_email(
        self, client: AsyncClient
    ) -> None:
        email, username = _unique("verify")

        response = await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "a-strong-password", "username": username},
        )
        assert response.status_code == 200

        rows = await _rows_for(email, "auth.verification")
        assert len(rows) == 1
        assert rows[0].status == "queued"
        # Without the link in the row, the durable record is of an email that
        # cannot actually be sent later.
        assert "/auth/verify?token=" in (rows[0].body or "")

    async def test_the_queued_email_is_attributed_to_the_account(
        self, client: AsyncClient
    ) -> None:
        """user_id, so a later suppression or bounce can be traced to a person."""

        email, username = _unique("attributed")

        await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "a-strong-password", "username": username},
        )

        rows = await _rows_for(email, "auth.verification")
        assert rows[0].user_id is not None

    async def test_a_resend_queues_a_second_distinct_email(
        self, client: AsyncClient
    ) -> None:
        """A resend is a new email, not a duplicate of the first.

        Each issuance carries its own token, so the dedupe key differs and the
        unique constraint does not refuse the second one — which it would if the
        key were derived from the address alone.
        """

        email, username = _unique("resend")
        await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "a-strong-password", "username": username},
        )

        resend = await client.post("/api/v1/auth/resend-verification", json={"email": email})
        assert resend.status_code == 200

        rows = await _rows_for(email, "auth.verification")
        assert len(rows) == 2
        assert rows[0].dedupe_key != rows[1].dedupe_key


class TestNoProviderIsContactedDuringARequest:
    async def test_a_dead_provider_cannot_fail_a_signup(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        """The provider is unreachable for the whole request and it does not matter."""

        def explode(**_kwargs) -> None:
            raise EmailDeliveryError("SMTP unavailable")

        # smtp mode so nothing takes the local link-logging shortcut.
        monkeypatch.setattr(auth_service.settings, "email_mode", "smtp")
        monkeypatch.setattr(email_service, "send_auth_email", explode)

        email, username = _unique("outage")
        response = await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "a-strong-password", "username": username},
        )

        assert response.status_code == 200
        assert len(await _rows_for(email, "auth.verification")) == 1

    async def test_nothing_sends_while_the_request_runs(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        """Counted rather than inferred: the request must contact no provider at all.

        A test that only asserts "the request succeeded" would still pass if the
        send happened inline and worked.
        """

        calls: list[str] = []

        def record(**kwargs) -> None:
            calls.append(str(kwargs.get("to_email")))

        monkeypatch.setattr(auth_service.settings, "email_mode", "smtp")
        monkeypatch.setattr(email_service, "send_auth_email", record)

        email, username = _unique("noinline")
        await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "a-strong-password", "username": username},
        )

        assert calls == []


class TestTheWorkerFinishesTheJob:
    async def test_a_queued_verification_email_is_delivered_by_the_worker(
        self, client: AsyncClient, db_session
    ) -> None:
        email, username = _unique("delivered")
        await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "a-strong-password", "username": username},
        )

        provider = MockEmailProvider()
        run = await process_outbox_once(db_session, provider=provider)
        await db_session.commit()

        assert run.sent == 1
        assert [row.to_email for row in provider.sent] == [email]

        rows = await _rows_for(email, "auth.verification")
        assert rows[0].status == "sent"


class TestTheEnqueueIsPartOfTheTransaction:
    async def test_a_rolled_back_transaction_leaves_no_email(self, db_session) -> None:
        """No orphan intent: an email is owed only if the change it announces stuck."""

        email = f"rolled-back-{uuid.uuid4().hex[:8]}@example.com"
        queue_auth_email(
            db_session,
            to_email=email,
            subject="Verify your CreatorJobs email",
            text_body="link",
            event_key="auth.verification",
        )
        await db_session.rollback()

        assert await _rows_for(email, "auth.verification") == []

    async def test_an_unknown_event_name_is_refused(self, db_session) -> None:
        """A typo would file authentication mail under a name nothing recognises."""

        with pytest.raises(ValueError, match="Unknown authentication email event"):
            queue_auth_email(
                db_session,
                to_email="someone@example.com",
                subject="Subject",
                text_body="body",
                event_key="auth.verifcation",
            )
