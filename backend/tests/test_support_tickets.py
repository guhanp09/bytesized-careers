"""The internal support queue: who can see it, and what it records.

This is staff tooling, not a customer-facing product. Requests arrive by email
today; the queue records what staff are doing about them so that work is not
tracked in somebody's inbox.

Two things are worth testing more than the happy path.

Authorization, because a support queue is a list of people's problems. An
ordinary account must not be able to read it, list it, or move a ticket through
it — and "cannot list" is not the same as "cannot read by id", so both are
checked.

And what the response contains, because support means looking at accounts and the
lazy way to do that is to return the user row. That row has a password hash in
it, and whatever else gets added next.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import AdminAuditLog, SupportTicket
from tests.conftest import TestSessionLocal
from tests.test_admin_panel import _admin_token, _auth
from tests.test_messaging import _register_verified_login

TICKETS = "/api/v1/admin/support/tickets"


def _instant(value: str) -> datetime:
    """Parse a timestamp whether or not it carries a zone.

    SQLite stores timezone-aware columns without tzinfo, so a value read back
    lacks the suffix a freshly written one has. Both describe the same instant.
    """

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


async def _ordinary_bearer(client: AsyncClient, label: str) -> str:
    return await _register_verified_login(
        client, email=f"{label}@example.com", username=label
    )


async def _open_ticket(client: AsyncClient, admin: str, **overrides) -> dict:
    payload = {
        "category": "account_access",
        "subject": "Cannot receive the verification email",
        "summary": "Arrived by email; sender says nothing has come through.",
    }
    payload.update(overrides)
    response = await client.post(TICKETS, headers=_auth(admin), json=payload)
    assert response.status_code == 201, response.text
    return response.json()


class TestOnlyStaffCanTouchTheQueue:
    async def test_an_ordinary_account_cannot_list_tickets(
        self, client: AsyncClient
    ) -> None:
        bearer = await _ordinary_bearer(client, f"sup_list_{uuid.uuid4().hex[:6]}")

        response = await client.get(TICKETS, headers=_auth(bearer))

        assert response.status_code == 403

    async def test_an_ordinary_account_cannot_read_a_ticket_by_id(
        self, client: AsyncClient
    ) -> None:
        """"Cannot list" and "cannot read by id" are different holes. A queue
        that hides the index but serves any id to anybody is not private."""

        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        bearer = await _ordinary_bearer(client, f"sup_read_{uuid.uuid4().hex[:6]}")

        response = await client.get(f"{TICKETS}/{ticket['id']}", headers=_auth(bearer))

        assert response.status_code == 403

    async def test_an_ordinary_account_cannot_log_a_ticket(
        self, client: AsyncClient
    ) -> None:
        bearer = await _ordinary_bearer(client, f"sup_open_{uuid.uuid4().hex[:6]}")

        response = await client.post(
            TICKETS,
            headers=_auth(bearer),
            json={"category": "bug", "subject": "Let me in"},
        )

        assert response.status_code == 403

    @pytest.mark.parametrize(
        ("action", "payload"),
        [
            ("assign", {"assignee_user_id": "00000000-0000-0000-0000-000000000001"}),
            ("escalate", {"reason": "Trying it on."}),
            ("resolve", {"note": "Closing someone else's ticket."}),
        ],
    )
    async def test_an_ordinary_account_cannot_move_a_ticket(
        self, client: AsyncClient, action: str, payload: dict
    ) -> None:
        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        bearer = await _ordinary_bearer(client, f"sup_mv_{action[:3]}_{uuid.uuid4().hex[:6]}")

        response = await client.post(
            f"{TICKETS}/{ticket['id']}/{action}", headers=_auth(bearer), json=payload
        )

        assert response.status_code == 403

    async def test_anonymous_access_is_refused(self, client: AsyncClient) -> None:
        assert (await client.get(TICKETS)).status_code in {401, 403}


class TestStaffCanRunTheQueue:
    async def test_a_ticket_can_be_logged(self, client: AsyncClient) -> None:
        admin = await _admin_token(client)

        ticket = await _open_ticket(client, admin)

        assert ticket["status"] == "open"
        assert ticket["category"] == "account_access"
        assert ticket["assignee_user_id"] is None

    async def test_an_unknown_category_is_refused(self, client: AsyncClient) -> None:
        """A fixed set, so the queue can be grouped without normalising strings
        somebody typed differently."""

        admin = await _admin_token(client)

        response = await client.post(
            TICKETS,
            headers=_auth(admin),
            json={"category": "not_a_category", "subject": "Hello"},
        )

        assert response.status_code == 400

    async def test_it_appears_in_the_queue(self, client: AsyncClient) -> None:
        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)

        listed = await client.get(TICKETS, headers=_auth(admin))

        assert listed.status_code == 200
        assert ticket["id"] in [row["id"] for row in listed.json()["items"]]

    async def test_it_can_be_assigned_to_staff(self, client: AsyncClient) -> None:
        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        me = await client.get("/api/v1/me", headers=_auth(admin))
        admin_id = me.json()["id"]

        response = await client.post(
            f"{TICKETS}/{ticket['id']}/assign",
            headers=_auth(admin),
            json={"assignee_user_id": admin_id},
        )

        assert response.status_code == 200
        assert response.json()["assignee_user_id"] == admin_id
        assert response.json()["status"] == "assigned"

    async def test_it_cannot_be_assigned_to_a_member_of_the_public(
        self, client: AsyncClient
    ) -> None:
        """The ticket would look handled while nobody was handling it: the
        assignee would never see it."""

        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        outsider = await _ordinary_bearer(client, f"sup_out_{uuid.uuid4().hex[:6]}")
        outsider_id = (await client.get("/api/v1/me", headers=_auth(outsider))).json()["id"]

        response = await client.post(
            f"{TICKETS}/{ticket['id']}/assign",
            headers=_auth(admin),
            json={"assignee_user_id": outsider_id},
        )

        assert response.status_code == 400

    async def test_it_can_be_escalated_with_a_reason(self, client: AsyncClient) -> None:
        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)

        response = await client.post(
            f"{TICKETS}/{ticket['id']}/escalate",
            headers=_auth(admin),
            json={"reason": "Needs someone who can see billing."},
        )

        assert response.status_code == 200
        assert response.json()["escalated_at"] is not None

    async def test_escalating_twice_keeps_the_first_escalation(
        self, client: AsyncClient
    ) -> None:
        """The first escalation is when it happened. A second click is not a
        second escalation."""

        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)

        first = await client.post(
            f"{TICKETS}/{ticket['id']}/escalate",
            headers=_auth(admin),
            json={"reason": "First reason."},
        )
        second = await client.post(
            f"{TICKETS}/{ticket['id']}/escalate",
            headers=_auth(admin),
            json={"reason": "Different reason."},
        )

        assert second.status_code == 200
        # Compared as instants rather than strings: the first response
        # serialises the aware datetime just written, while the second is read
        # back through SQLite, which drops tzinfo. Same moment, different
        # suffix — a test-environment difference, not a product one.
        assert _instant(second.json()["escalated_at"]) == _instant(
            first.json()["escalated_at"]
        )
        assert second.json()["escalation_reason"] == "First reason."

    async def test_it_can_be_resolved(self, client: AsyncClient) -> None:
        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)

        response = await client.post(
            f"{TICKETS}/{ticket['id']}/resolve",
            headers=_auth(admin),
            json={"note": "Resent the link; sender confirmed."},
        )

        assert response.status_code == 200
        assert response.json()["status"] == "resolved"
        assert response.json()["resolved_at"] is not None

    async def test_resolving_twice_is_refused(self, client: AsyncClient) -> None:
        """The first resolution is the one that happened. A second would quietly
        replace both the note and the time it was closed."""

        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        await client.post(
            f"{TICKETS}/{ticket['id']}/resolve", headers=_auth(admin), json={"note": "Done."}
        )

        again = await client.post(
            f"{TICKETS}/{ticket['id']}/resolve",
            headers=_auth(admin),
            json={"note": "Done again."},
        )

        assert again.status_code == 409

    async def test_a_resolved_ticket_keeps_its_escalation(
        self, client: AsyncClient
    ) -> None:
        """A ticket that had to be escalated was still escalated after it is
        closed, and that is worth being able to count."""

        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        await client.post(
            f"{TICKETS}/{ticket['id']}/escalate",
            headers=_auth(admin),
            json={"reason": "Needed billing access."},
        )

        resolved = await client.post(
            f"{TICKETS}/{ticket['id']}/resolve", headers=_auth(admin), json={}
        )

        assert resolved.json()["escalated_at"] is not None

    async def test_a_resolved_ticket_cannot_be_reassigned(
        self, client: AsyncClient
    ) -> None:
        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        admin_id = (await client.get("/api/v1/me", headers=_auth(admin))).json()["id"]
        await client.post(
            f"{TICKETS}/{ticket['id']}/resolve", headers=_auth(admin), json={}
        )

        response = await client.post(
            f"{TICKETS}/{ticket['id']}/assign",
            headers=_auth(admin),
            json={"assignee_user_id": admin_id},
        )

        assert response.status_code == 400

    async def test_an_unknown_ticket_is_a_404(self, client: AsyncClient) -> None:
        admin = await _admin_token(client)

        response = await client.get(f"{TICKETS}/{uuid.uuid4()}", headers=_auth(admin))

        assert response.status_code == 404


class TestTheResponseExposesNothingSensitive:
    async def test_it_returns_named_fields_rather_than_a_user_row(
        self, client: AsyncClient
    ) -> None:
        """Support means looking at accounts, and the lazy way is to return the
        user. That row has a password hash in it."""

        admin = await _admin_token(client)
        subject = await _ordinary_bearer(client, f"sup_sub_{uuid.uuid4().hex[:6]}")
        subject_id = (await client.get("/api/v1/me", headers=_auth(subject))).json()["id"]

        ticket = await _open_ticket(client, admin, subject_user_id=subject_id)

        serialised = str(ticket).lower()
        for forbidden in ("password", "hash", "token", "secret", "$2b$"):
            assert forbidden not in serialised, forbidden

    async def test_an_unexpected_field_is_refused(self, client: AsyncClient) -> None:
        admin = await _admin_token(client)

        response = await client.post(
            TICKETS,
            headers=_auth(admin),
            json={
                "category": "bug",
                "subject": "Hello",
                "status": "resolved",
            },
        )

        assert response.status_code == 422


class TestSensitiveActionsAreAudited:
    async def _audit_actions(self, ticket_id: str) -> list[str]:
        async with TestSessionLocal() as session:
            rows = await session.execute(
                select(AdminAuditLog.action).where(AdminAuditLog.target_id == ticket_id)
            )
            return list(rows.scalars().all())

    async def test_opening_assigning_and_resolving_are_recorded(
        self, client: AsyncClient
    ) -> None:
        """"Who assigned this to me" and "who closed it" are the questions asked
        when something has gone wrong."""

        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        admin_id = (await client.get("/api/v1/me", headers=_auth(admin))).json()["id"]
        await client.post(
            f"{TICKETS}/{ticket['id']}/assign",
            headers=_auth(admin),
            json={"assignee_user_id": admin_id},
        )
        await client.post(
            f"{TICKETS}/{ticket['id']}/resolve", headers=_auth(admin), json={}
        )

        actions = await self._audit_actions(ticket["id"])

        assert "support.ticket.open" in actions
        assert "support.ticket.assign" in actions
        assert "support.ticket.resolve" in actions

    async def test_a_repeated_escalation_records_one_event(
        self, client: AsyncClient
    ) -> None:
        """An audit entry for a click that changed nothing would invent an event."""

        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        for _ in range(3):
            await client.post(
                f"{TICKETS}/{ticket['id']}/escalate",
                headers=_auth(admin),
                json={"reason": "Same reason."},
            )

        actions = await self._audit_actions(ticket["id"])

        assert actions.count("support.ticket.escalate") == 1

    async def test_a_refused_action_records_nothing(self, client: AsyncClient) -> None:
        """A misleading success entry is worse than no entry: it says something
        happened that did not."""

        admin = await _admin_token(client)
        ticket = await _open_ticket(client, admin)
        outsider = await _ordinary_bearer(client, f"sup_aud_{uuid.uuid4().hex[:6]}")
        outsider_id = (await client.get("/api/v1/me", headers=_auth(outsider))).json()["id"]

        await client.post(
            f"{TICKETS}/{ticket['id']}/assign",
            headers=_auth(admin),
            json={"assignee_user_id": outsider_id},
        )

        actions = await self._audit_actions(ticket["id"])

        assert "support.ticket.assign" not in actions


class TestTheModelStaysSmall:
    def test_it_has_not_grown_a_helpdesk(self) -> None:
        """Scope guard. Attachments, threads, SLA timers and priority scoring are
        each a product decision, and none is needed to know who is handling
        what."""

        columns = set(SupportTicket.__table__.columns.keys())

        for absent in (
            "attachment_url",
            "thread_id",
            "sla_due_at",
            "priority",
            "csat_score",
            "external_message_id",
        ):
            assert absent not in columns, absent

    def test_escalation_is_a_flag_not_a_status(self) -> None:
        """A ticket can be escalated while assigned and stays escalated once
        resolved. One column could not hold both facts."""

        columns = set(SupportTicket.__table__.columns.keys())

        assert "escalated_at" in columns
        assert "status" in columns

    def test_no_user_reference_cascades(self) -> None:
        """A ticket records work staff did. Deleting the account it concerned
        must not delete the evidence it was handled."""

        for column_name in ("subject_user_id", "opened_by_user_id", "assignee_user_id"):
            column = SupportTicket.__table__.columns[column_name]
            foreign_key = next(iter(column.foreign_keys))
            assert foreign_key.ondelete == "SET NULL", column_name
