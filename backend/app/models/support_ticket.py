from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SupportTicket(Base):
    """One piece of support work, logged and tracked by staff.

    Internal only. Requests arrive today through email, and this records what
    staff are doing about them — it is deliberately not a customer-facing portal,
    because a portal is a product with intake, notifications and expectations
    attached, and none of that is needed to stop beta support being tracked in
    somebody's inbox.

    `subject_user_id` is who the ticket is ABOUT and is nullable: plenty of
    support work concerns nobody in particular, and a required link would invite
    attaching an arbitrary account just to satisfy the column.

    Deliberately absent: attachments, threads, SLA timers, priority scoring,
    CSAT. Each is a product decision, and none of them is needed to know who is
    handling what.
    """

    __tablename__ = "support_tickets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    #: open -> assigned -> resolved, with escalated as a flag alongside rather
    #: than a state. Escalation is not a stage of the work: a ticket can be
    #: escalated while assigned and stay escalated once resolved, and folding it
    #: into the status would lose one fact to record the other.
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="open", server_default="open", index=True
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    #: What staff wrote down. Not the customer's raw email: pasting an entire
    #: message in here would put private content into a table that support staff
    #: browse for unrelated reasons.
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: Who the ticket is about, when it is about somebody. SET NULL so closing an
    #: account does not delete the record of having helped them.
    subject_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    #: Staff who logged it, and staff who owns it now.
    opened_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    escalated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    escalation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
