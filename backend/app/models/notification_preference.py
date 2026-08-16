from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NotificationOptOut(Base):
    """One person refusing one category of email.

    An opt-OUT rather than an opt-in: absence of a row means subscribed. Stored
    the other way round, a category added next year would arrive switched off
    for everyone who registered before it existed — a feature nobody could find,
    failing silently.

    A row per (user, category) rather than a JSON blob of preferences, so the
    question "who has opted out of digests" is a query rather than a scan, and
    so a partial write cannot corrupt unrelated preferences.
    """

    __tablename__ = "notification_opt_outs"
    __table_args__ = (
        UniqueConstraint("user_id", "category", name="uq_notification_opt_out_user_category"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
