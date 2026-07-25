from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class InteractionInterview(Base):
    """The one interview currently arranged for a conversation.

    Scope is deliberately small. This is *not* a calendar: there are no
    invitations to third parties, no availability grids, no recurrence, no
    external calendar sync, and no reminders of its own. It records the four
    facts two people need in order to meet — when, in whose time zone, how, and
    whether the other side has confirmed — and nothing else.

    **One row per conversation.** The conversation is the anchor for the same
    reason it anchors ``interaction_user_preferences``: it is the single
    identifier that survives every mode, so a recruiter acting through a hiring
    identity and the applicant replying from their own account resolve to exactly
    one interview rather than two competing ones. Rescheduling updates this row
    rather than appending a new one; the *history* of what was proposed and when
    lives in the conversation, where both participants can already read it, so
    the table never becomes a second, divergent narrative.

    A later round reuses the row and increments ``round_number``. That keeps
    "what is the interview state of this relationship?" a single indexed lookup
    with no ordering ambiguity, which is the question every queue and row label
    actually asks.

    Both participants may read this record. Everything on it was deliberately
    communicated — a time, a method, a confirmation. Nothing private lives here:
    the manager's assessment of how the interview went is an
    ``InteractionPrivateNote``, and ``completed_at`` records only that the
    organiser has closed out the arrangement, which is bookkeeping rather than
    an opinion.
    """

    __tablename__ = "interaction_interviews"
    __table_args__ = (
        UniqueConstraint("conversation_id", name="uq_interaction_interview_conversation"),
        CheckConstraint(
            "status IN ('proposed', 'confirmed', 'completed', 'cancelled')",
            name="ck_interaction_interview_status",
        ),
        CheckConstraint(
            "meeting_method IN ('video_call', 'phone', 'in_person', 'other')",
            name="ck_interaction_interview_method",
        ),
        # Serves "which interviews of mine have a date that has passed?" — the
        # follow-up queue's only question.
        Index("ix_interaction_interview_status_scheduled", "status", "scheduled_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    #: proposed → the organiser has named a time; confirmed → the other side said
    #: yes; completed → the organiser closed it out (private bookkeeping);
    #: cancelled → called off, and the other side was told.
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="proposed", server_default="proposed", index=True
    )

    #: The absolute instant. Stored in UTC like every other timestamp here, so
    #: each participant can be shown it in their own zone without guessing.
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: The IANA zone the organiser was thinking in ("Asia/Kolkata"). Kept beside
    #: the instant because "4pm your time" and "4pm my time" are different
    #: promises, and only the organiser's stated zone explains which was meant.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC", server_default="UTC")
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    meeting_method: Mapped[str] = mapped_column(
        String(16), nullable=False, default="video_call", server_default="video_call"
    )
    #: The link, dial-in, or address. Free text because every provider formats
    #: these differently and validating them would reject working ones.
    meeting_detail: Mapped[str | None] = mapped_column(String(500), nullable=True)

    proposed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: What the time was before the most recent reschedule, so the update message
    #: can say what moved rather than silently replacing it.
    previous_scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reschedule_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    round_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: Optimistic concurrency, mirroring ``status_version`` on the interaction
    #: records. Two tabs proposing different times cannot both win: the second
    #: one is told the interview changed and shown the current arrangement.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    #: The idempotency key of the request that produced the current version. A
    #: retried submit finds its own key here and returns the row unchanged
    #: instead of rescheduling to the same time a second time.
    last_request_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
