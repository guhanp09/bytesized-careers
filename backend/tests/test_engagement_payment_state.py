"""Payment state is its own plane.

The point of these tests is not that payment *works* — nothing here processes a
payment, and no endpoint sets one. The point is that the column cannot leak into
the decisions it sits beside: an application's stage, a participant's view of
that stage, an interview, or an engagement's own status.

That separation is easy to assert now and very hard to recover once a single
transition starts reading the field, which is exactly why it is pinned here
before any payment feature exists.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from test_engagement_reviews import _active_engagement, _auth, _hired_application

from app.models import Engagement

pytestmark = pytest.mark.asyncio


async def _set_payment(engagement_id: str, state: str | None, note: str | None = None) -> None:
    """Write payment state directly. No API does this, deliberately."""
    async with TestSessionLocal() as session:
        engagement = await session.scalar(
            select(Engagement).where(Engagement.id == UUID(str(engagement_id)))
        )
        assert engagement is not None
        engagement.payment_state = state
        engagement.payment_state_updated_at = datetime.now(UTC) if state else None
        engagement.payment_note = note
        await session.commit()


async def test_a_new_engagement_asserts_nothing_about_payment(client: AsyncClient) -> None:
    _, _, _, _, _, engagement_id = await _active_engagement(client, "pay_default")
    async with TestSessionLocal() as session:
        engagement = await session.scalar(select(Engagement).where(Engagement.id == UUID(str(engagement_id))))
        # None, not "not_applicable". Silence and "this will never involve a
        # payment" are different claims, and only one of them is true here.
        assert engagement.payment_state is None
        assert engagement.payment_state_updated_at is None
        assert engagement.payment_note is None


async def test_the_application_lifecycle_never_writes_payment_state(client: AsyncClient) -> None:
    recruiter, talent, _, _, application_id = await _hired_application(client, "pay_lifecycle")
    async with TestSessionLocal() as session:
        engagement = await session.scalar(
            select(Engagement).where(Engagement.application_id == UUID(str(application_id)))
        )
        engagement_id = engagement.id
        assert engagement.payment_state is None

    # Drive the engagement through its whole status arc.
    started = await client.post(
        f"/api/v1/me/applications/{application_id}/engagement/start-request",
        headers=_auth(talent),
    )
    assert started.status_code == 200, started.text
    confirmed = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/start-response",
        headers=_auth(recruiter),
        json={"decision": "confirm"},
    )
    assert confirmed.status_code == 200, confirmed.text

    async with TestSessionLocal() as session:
        engagement = await session.scalar(select(Engagement).where(Engagement.id == UUID(str(engagement_id))))
        assert engagement.status == "active"
        # Moving through the work states said nothing about money.
        assert engagement.payment_state is None


async def test_payment_state_does_not_gate_any_transition(client: AsyncClient) -> None:
    recruiter, talent, _, _, application_id = await _hired_application(client, "pay_gate")
    async with TestSessionLocal() as session:
        engagement = await session.scalar(
            select(Engagement).where(Engagement.application_id == UUID(str(application_id)))
        )
        engagement_id = str(engagement.id)

    # A disputed payment is the most obvious candidate for something a naive
    # implementation would block work on. It must not.
    await _set_payment(engagement_id, "disputed", "Chargeback opened by the payer.")

    started = await client.post(
        f"/api/v1/me/applications/{application_id}/engagement/start-request",
        headers=_auth(talent),
    )
    assert started.status_code == 200, started.text
    confirmed = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/start-response",
        headers=_auth(recruiter),
        json={"decision": "confirm"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "active"
    # And the payment plane is unchanged by the work moving.
    assert confirmed.json()["payment_state"] == "disputed"


async def test_engagement_status_and_payment_state_stay_independent(client: AsyncClient) -> None:
    recruiter, talent, _, _, _, engagement_id = await _active_engagement(client, "pay_indep")
    await _set_payment(engagement_id, "funded")

    completed = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/completion-request",
        headers=_auth(talent),
        json={"outcome": "completed", "note": "Everything agreed was delivered."},
    )
    assert completed.status_code == 200, completed.text
    confirmed = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/completion-response",
        headers=_auth(recruiter),
        json={"decision": "confirm"},
    )
    assert confirmed.status_code == 200, confirmed.text
    # Completed work does not release money, and saying so would be a lie about
    # a payment system that does not exist.
    assert confirmed.json()["status"] == "completed"
    assert confirmed.json()["payment_state"] == "funded"


async def test_participants_see_payment_state_and_strangers_get_no_engagement(
    client: AsyncClient,
) -> None:
    recruiter, talent, _, _, _, engagement_id = await _active_engagement(client, "pay_privacy")
    await _set_payment(engagement_id, "release_requested", "Awaiting payer confirmation.")

    for token in (recruiter, talent):
        listed = await client.get("/api/v1/me/engagements", headers=_auth(token))
        assert listed.status_code == 200, listed.text
        mine = [row for row in listed.json() if row["id"] == str(engagement_id)]
        assert mine, "a participant should see their own engagement"
        assert mine[0]["payment_state"] == "release_requested"
        assert mine[0]["payment_note"] == "Awaiting payer confirmation."

    # Someone who is not a participant never receives the engagement at all, so
    # there is no payment field for them to read.
    outsider, _, _, _, _ = await _hired_application(client, "pay_outsider")
    listed = await client.get("/api/v1/me/engagements", headers=_auth(outsider))
    assert listed.status_code == 200, listed.text
    assert all(row["id"] != str(engagement_id) for row in listed.json())


async def test_the_column_refuses_a_state_outside_its_vocabulary(client: AsyncClient) -> None:
    _, _, _, _, _, engagement_id = await _active_engagement(client, "pay_vocab")
    async with TestSessionLocal() as session:
        with pytest.raises(IntegrityError):
            await session.execute(text("UPDATE engagements SET payment_state = 'definitely_paid'"))
            await session.commit()


@pytest.mark.parametrize(
    "state",
    [
        "not_applicable",
        "setup_pending",
        "funding_pending",
        "funded",
        "work_in_progress",
        "release_requested",
        "released",
        "disputed",
        "refunded",
        "expired",
    ],
)
async def test_every_declared_state_round_trips(client: AsyncClient, state: str) -> None:
    _, _, _, _, _, engagement_id = await _active_engagement(client, f"pay_rt_{state}")
    await _set_payment(engagement_id, state)
    async with TestSessionLocal() as session:
        engagement = await session.scalar(select(Engagement).where(Engagement.id == UUID(str(engagement_id))))
        assert engagement.payment_state == state
