from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class InteractionUserPreference(Base):
    """One participant's *personal* organisation of one conversation.

    Strictly private and strictly per-user. Two people looking at the same
    relationship each get their own row, so a recruiter starring an applicant and
    that applicant saving the same thread never see or overwrite each other.
    Nothing here is ever serialised to the counterparty.

    Deliberately bounded to a handful of named columns rather than a JSON blob:
    this is personal organisation for one conversation, not a settings store. New
    personal features earn a named column and a migration, which keeps the table
    queryable (a "starred" filter is an index scan) and keeps its purpose honest.

    Nothing in this table is lifecycle state. Writing a row never changes an
    application's status, never posts a message, never creates a notification,
    and never appears in a participant-visible timeline. The authoritative
    lifecycle stays entirely in the interaction records and the transition
    service.

    The conversation is the anchor because it is the one identifier that survives
    every mode: the record *is* the thread for both applications and hiring
    requests, so a user switching between talent and recruiter modes — or acting
    through a hiring identity — still resolves to exactly one row. Keying on the
    application/interest instead would have produced two competing rows for the
    same relationship.
    """

    __tablename__ = "interaction_user_preferences"
    __table_args__ = (
        # One row per person per conversation. The database, not the service,
        # is what makes a concurrent double-write impossible.
        UniqueConstraint("user_id", "conversation_id", name="uq_interaction_pref_user_conversation"),
        # Serves the "my starred threads" and "what have I snoozed" reads.
        Index("ix_interaction_pref_user_starred", "user_id", "starred_at"),
        Index("ix_interaction_pref_user_snoozed", "user_id", "snoozed_until"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Cascades with the conversation: personal organisation of a thread that no
    #: longer exists has no meaning, and leaving orphans would slowly leak rows.
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    #: Set when starred, cleared when unstarred. A timestamp rather than a boolean
    #: so "how long has this been sitting starred?" is answerable — that is what
    #: stops the starred list becoming a graveyard.
    starred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Hides queue *recommendations* until this moment passes. Never hides the
    #: conversation itself and never changes its status.
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: The user dismissed the first-open decision surface for this thread.
    decision_prompt_dismissed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Which generation of the prompt rules that dismissal answered. Bumping the
    #: version re-offers the surface rather than honouring a dismissal that was
    #: made about different behaviour.
    decision_prompt_trigger_version: Mapped[int | None] = mapped_column(nullable=True)
    #: "No reply needed" — the user has said this thread is not awaiting them.
    #: Cleared automatically when the counterparty speaks again.
    queue_dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
