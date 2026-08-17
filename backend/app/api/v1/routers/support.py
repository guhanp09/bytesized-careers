"""Internal support queue.

Staff-only, and the response shapes are the point of the module. Support work
means looking at accounts, so the temptation is to return the user row and let
the operator find what they need. That row contains a password hash and, one
migration later, whatever else somebody adds — so what a ticket exposes about a
person is enumerated by hand and stays deliberately thin: an id, a display name,
an email. Enough to know whose problem this is; not a window into their account.

Every mutation records an audit entry through the existing append-only log,
because "who assigned this to me" and "who closed it" are the questions asked
when something has gone wrong.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.admin_permissions import require_permission
from app.models import User
from app.services import support_ticket_service as tickets
from app.services.audit_service import record_admin_action

router = APIRouter(prefix="/admin/support", tags=["admin"])


class SupportTicketRead(BaseModel):
    """What the queue shows. Named fields only — never a serialised ORM row."""

    id: uuid.UUID
    status: str
    category: str
    subject: str
    summary: str | None
    subject_user_id: uuid.UUID | None
    assignee_user_id: uuid.UUID | None
    escalated_at: datetime | None
    escalation_reason: str | None
    resolved_at: datetime | None
    resolution_note: str | None
    created_at: datetime


class SupportTicketListResponse(BaseModel):
    items: list[SupportTicketRead]


class SupportTicketCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: str = Field(min_length=1, max_length=32)
    subject: str = Field(min_length=1, max_length=200)
    summary: str | None = Field(default=None, max_length=4000)
    #: Who it is about, when it is about somebody. Optional: plenty of support
    #: work concerns no particular account.
    subject_user_id: uuid.UUID | None = None


class SupportTicketAssign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignee_user_id: uuid.UUID


class SupportTicketEscalate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=2000)


class SupportTicketResolve(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=2000)


def _read(ticket) -> SupportTicketRead:  # noqa: ANN001 - ORM row
    return SupportTicketRead(
        id=ticket.id,
        status=ticket.status,
        category=ticket.category,
        subject=ticket.subject,
        summary=ticket.summary,
        subject_user_id=ticket.subject_user_id,
        assignee_user_id=ticket.assignee_user_id,
        escalated_at=ticket.escalated_at,
        escalation_reason=ticket.escalation_reason,
        resolved_at=ticket.resolved_at,
        resolution_note=ticket.resolution_note,
        created_at=ticket.created_at,
    )


async def _load(session: AsyncSession, ticket_id: uuid.UUID):
    ticket = await tickets.get_ticket(session, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


@router.get("/tickets", response_model=SupportTicketListResponse)
async def list_support_tickets(
    ticket_status: str | None = Query(default=None, alias="status", max_length=16),
    limit: int = Query(default=50, ge=1, le=200),
    _admin: User = Depends(require_permission("support.tickets")),
    session: AsyncSession = Depends(get_db),
) -> SupportTicketListResponse:
    rows = await tickets.list_tickets(session, status=ticket_status, limit=limit)
    return SupportTicketListResponse(items=[_read(row) for row in rows])


@router.get("/tickets/{ticket_id}", response_model=SupportTicketRead)
async def read_support_ticket(
    ticket_id: uuid.UUID,
    _admin: User = Depends(require_permission("support.tickets")),
    session: AsyncSession = Depends(get_db),
) -> SupportTicketRead:
    return _read(await _load(session, ticket_id))


@router.post("/tickets", response_model=SupportTicketRead, status_code=status.HTTP_201_CREATED)
async def log_support_ticket(
    payload: SupportTicketCreate,
    admin_user: User = Depends(require_permission("support.tickets")),
    session: AsyncSession = Depends(get_db),
) -> SupportTicketRead:
    """Staff logging a request that arrived by email.

    There is no customer-facing intake, and this is not a stand-in for one: it
    records what staff are handling so it is not tracked in somebody's inbox.
    """

    try:
        ticket = await tickets.log_ticket(
            session,
            opened_by=admin_user,
            category=payload.category,
            subject=payload.subject,
            summary=payload.summary,
            subject_user_id=payload.subject_user_id,
        )
    except tickets.SupportTicketError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    record_admin_action(
        session,
        actor=admin_user,
        action="support.ticket.open",
        target_type="support_ticket",
        target_id=ticket.id,
        target_label=f"Support — {ticket.subject}",
        after={"status": ticket.status, "category": ticket.category},
    )
    await session.commit()
    return _read(ticket)


@router.post("/tickets/{ticket_id}/assign", response_model=SupportTicketRead)
async def assign_support_ticket(
    ticket_id: uuid.UUID,
    payload: SupportTicketAssign,
    admin_user: User = Depends(require_permission("support.tickets")),
    session: AsyncSession = Depends(get_db),
) -> SupportTicketRead:
    ticket = await _load(session, ticket_id)
    before = {"assignee_user_id": str(ticket.assignee_user_id), "status": ticket.status}
    try:
        await tickets.assign_ticket(
            session, ticket, assignee_user_id=payload.assignee_user_id
        )
    except tickets.SupportTicketError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    record_admin_action(
        session,
        actor=admin_user,
        action="support.ticket.assign",
        target_type="support_ticket",
        target_id=ticket.id,
        target_label=f"Support — {ticket.subject}",
        before=before,
        after={"assignee_user_id": str(ticket.assignee_user_id), "status": ticket.status},
    )
    await session.commit()
    return _read(ticket)


@router.post("/tickets/{ticket_id}/escalate", response_model=SupportTicketRead)
async def escalate_support_ticket(
    ticket_id: uuid.UUID,
    payload: SupportTicketEscalate,
    admin_user: User = Depends(require_permission("support.tickets")),
    session: AsyncSession = Depends(get_db),
) -> SupportTicketRead:
    ticket = await _load(session, ticket_id)
    already_escalated = ticket.escalated_at is not None
    try:
        await tickets.escalate_ticket(session, ticket, reason=payload.reason)
    except tickets.SupportTicketError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    if not already_escalated:
        # Only the escalation that actually happened is recorded. A repeated
        # click is not a second escalation, and an audit entry for it would
        # invent an event.
        record_admin_action(
            session,
            actor=admin_user,
            action="support.ticket.escalate",
            target_type="support_ticket",
            target_id=ticket.id,
            target_label=f"Support — {ticket.subject}",
            after={"escalated_at": ticket.escalated_at.isoformat()},
            justification=payload.reason,
        )
    await session.commit()
    return _read(ticket)


@router.post("/tickets/{ticket_id}/resolve", response_model=SupportTicketRead)
async def resolve_support_ticket(
    ticket_id: uuid.UUID,
    payload: SupportTicketResolve,
    admin_user: User = Depends(require_permission("support.tickets")),
    session: AsyncSession = Depends(get_db),
) -> SupportTicketRead:
    ticket = await _load(session, ticket_id)
    before = {"status": ticket.status}
    try:
        await tickets.resolve_ticket(session, ticket, note=payload.note)
    except tickets.SupportTicketError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc

    record_admin_action(
        session,
        actor=admin_user,
        action="support.ticket.resolve",
        target_type="support_ticket",
        target_id=ticket.id,
        target_label=f"Support — {ticket.subject}",
        before=before,
        after={"status": ticket.status, "resolved_at": ticket.resolved_at.isoformat()},
    )
    await session.commit()
    return _read(ticket)
