from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

json_obj_type = JSON().with_variant(JSONB, "postgresql")


class EmailOutbox(Base):
    """Durable record of every notification email the platform intends to send.

    Phase 1 keeps real delivery disabled: rows are written with status ``queued``
    and the mock adapter marks them ``mocked`` without sending. When a production
    domain + provider are ready, the real adapter flips them to ``sent``/``failed``.
    Auth emails (verification / password reset) are unaffected — they keep using
    ``email_service.send_auth_email`` and its dev outbox.
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
    # queued -> mocked (dev, not sent) | sent | failed | skipped
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", server_default="queued", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
