from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

json_obj_type = JSON().with_variant(JSONB, "postgresql")


class EmailOutbox(Base):
    """Durable record of every notification email the platform intends to send.

    Rows are written ``queued`` and the worker moves them on: ``sent`` when a
    provider accepted the message, ``failed`` when it will not be retried again,
    ``skipped`` when it was suppressed. Authentication mail (verification, reset)
    goes through the same table — see ``notifications.email.queue_auth_email``.
    """

    __tablename__ = "email_outbox"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    to_email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    event_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    template_key: Mapped[str] = mapped_column(String(64), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    preview: Mapped[str | None] = mapped_column(String(600), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    cta_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(
        json_obj_type, nullable=False, default=dict, server_default="{}"
    )
    dedupe_key: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True)
    # queued -> sent | failed | skipped
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", server_default="queued", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Delivery bookkeeping. Separate from the intent above: everything here is
    # about the attempt to send, and a row is still a complete record of what
    # the platform meant to send with all of it null.
    #
    # `leased_until` is the only thing that decides reclaimability — a worker
    # that dies holding a lease strands nothing, because the lease lapses on a
    # clock rather than on the worker announcing its own death. `leased_by` is
    # for tracing which worker went quiet, never for deciding ownership.
    leased_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    leased_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    #: Provider attempts, not enqueues. A retry reuses this row so the count
    #: stays with the intent and duplicates cannot appear.
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    next_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Set once the provider accepts the message, so a later bounce or complaint
    #: can be matched back to it.
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
