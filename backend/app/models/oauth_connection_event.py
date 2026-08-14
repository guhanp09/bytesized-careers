from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class OAuthConnectionEvent(Base):
    """Append-only, credential-free history for provider connection changes."""

    __tablename__ = "oauth_connection_events"
    __table_args__ = (
        CheckConstraint(
            "channel_links_removed >= 0",
            name="ck_oauth_connection_events_channel_links_removed",
        ),
        Index(
            "ix_oauth_connection_events_user_created",
            "user_id",
            "created_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    oauth_account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("oauth_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    provider_revocation_status: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )
    channel_links_removed: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )


__all__ = ["OAuthConnectionEvent"]
