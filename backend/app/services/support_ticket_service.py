"""The small set of things that happen to a support ticket.

Four operations — log it, assign it, escalate it, resolve it — and the value of
putting them here rather than in the route is that each one states a rule the
route would otherwise imply by omission.

Two rules are worth naming.

An assignee must be somebody who could actually work the ticket. Accepting any
user id would let a ticket be assigned to a member of the public, who would never
see it, and the ticket would look handled while nobody was handling it.

And resolution is not a toggle. A resolved ticket stays resolved: reopening is
not implemented rather than forbidden by a check, because "reopen" is a product
decision about what happens to the resolution note and the original timestamps,
and a silent overwrite is the wrong answer to it. Logging a new ticket that
references the old one is the honest workaround until that decision is made.

Escalation is a flag alongside the status, not a status of its own. A ticket can
be escalated while assigned and stays escalated once resolved, and collapsing
them into one column would lose one fact to record the other.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.account_types import is_admin
from app.models.support_ticket import SupportTicket
from app.models.user import User

OPEN = "open"
ASSIGNED = "assigned"
RESOLVED = "resolved"

#: What a ticket can be about. A fixed set rather than free text so the queue can
#: be grouped without normalising strings somebody typed differently.
CATEGORIES = frozenset(
    {
        "account_access",
        "payments",
        "abuse_report",
        "data_request",
        "bug",
        "other",
    }
)


class SupportTicketError(Exception):
    """The operation is not valid for this ticket."""


def _now() -> datetime:
    return datetime.now(UTC)


async def _staff_member(session: AsyncSession, user_id: uuid.UUID) -> User:
    """Resolve an assignee, refusing anyone who could not work the ticket.

    Checked against the account rather than against a role name in the request:
    a client-supplied label is the caller's claim about themselves, not a fact.
    """

    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None or not is_admin(user):
        raise SupportTicketError("Tickets can only be assigned to support staff.")
    return user


async def log_ticket(
    session: AsyncSession,
    *,
    opened_by: User,
    category: str,
    subject: str,
    summary: str | None = None,
    subject_user_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> SupportTicket:
    """Record a request that arrived somewhere else.

    Intake is email today, so this is staff writing down what came in. Bounded
    lengths because a support queue is browsed by people who are not involved in
    every ticket, and pasting a customer's entire message into a field they all
    read is a privacy decision nobody made.
    """

    if category not in CATEGORIES:
        raise SupportTicketError(f"Unknown support category: {category!r}")

    trimmed_subject = (subject or "").strip()
    if not trimmed_subject:
        raise SupportTicketError("A ticket needs a subject.")

    ticket = SupportTicket(
        status=OPEN,
        category=category,
        subject=trimmed_subject[:200],
        summary=(summary or "").strip()[:4000] or None,
        subject_user_id=subject_user_id,
        opened_by_user_id=opened_by.id,
        created_at=now or _now(),
    )
    session.add(ticket)
    await session.flush()
    return ticket


async def assign_ticket(
    session: AsyncSession,
    ticket: SupportTicket,
    *,
    assignee_user_id: uuid.UUID,
    now: datetime | None = None,
) -> SupportTicket:
    """Give the ticket an owner, so "who is doing this" has one answer."""

    if ticket.status == RESOLVED:
        raise SupportTicketError("A resolved ticket cannot be reassigned.")

    assignee = await _staff_member(session, assignee_user_id)
    ticket.assignee_user_id = assignee.id
    ticket.status = ASSIGNED
    ticket.updated_at = now or _now()
    await session.flush()
    return ticket


async def escalate_ticket(
    session: AsyncSession,
    ticket: SupportTicket,
    *,
    reason: str,
    now: datetime | None = None,
) -> SupportTicket:
    """Mark a ticket as needing someone more senior, with a reason.

    Idempotent: escalating twice keeps the first reason and timestamp, because
    the first escalation is when it happened and a second click is not a second
    escalation.
    """

    trimmed = (reason or "").strip()
    if not trimmed:
        raise SupportTicketError("An escalation needs a reason.")

    if ticket.escalated_at is None:
        ticket.escalated_at = now or _now()
        ticket.escalation_reason = trimmed[:2000]
        ticket.updated_at = now or _now()
        await session.flush()
    return ticket


async def resolve_ticket(
    session: AsyncSession,
    ticket: SupportTicket,
    *,
    note: str | None = None,
    now: datetime | None = None,
) -> SupportTicket:
    """Close the ticket out.

    Refuses a ticket that is already resolved rather than overwriting the
    original resolution. The first resolution is the one that happened; a second
    one would quietly replace both the note and the time it was closed.

    Escalation is deliberately left standing: a ticket that had to be escalated
    was still escalated after it is resolved, and that is worth being able to
    count.
    """

    if ticket.status == RESOLVED:
        raise SupportTicketError("This ticket is already resolved.")

    ticket.status = RESOLVED
    ticket.resolved_at = now or _now()
    ticket.resolution_note = (note or "").strip()[:2000] or None
    ticket.updated_at = now or _now()
    await session.flush()
    return ticket


async def get_ticket(
    session: AsyncSession, ticket_id: uuid.UUID
) -> SupportTicket | None:
    return (
        await session.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ).scalar_one_or_none()


async def list_tickets(
    session: AsyncSession,
    *,
    status: str | None = None,
    limit: int = 50,
) -> list[SupportTicket]:
    """The queue, newest first, bounded.

    Bounded because an unbounded list is a page that stops loading once the
    product succeeds.
    """

    query = select(SupportTicket).order_by(SupportTicket.created_at.desc()).limit(
        min(max(limit, 1), 200)
    )
    if status is not None:
        query = query.where(SupportTicket.status == status)
    return list((await session.execute(query)).scalars().all())
