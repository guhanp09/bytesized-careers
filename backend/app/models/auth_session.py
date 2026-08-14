from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuthSession(Base):
    """One durable login/session family for a user and authentication event."""

    __tablename__ = "auth_sessions"
    __table_args__ = (
        CheckConstraint(
            "(strong_auth_method IS NULL AND strong_auth_verified_at IS NULL "
            "AND strong_auth_expires_at IS NULL) OR "
            "(strong_auth_method IN ('recovery_code', 'totp', 'webauthn') "
            "AND strong_auth_verified_at IS NOT NULL "
            "AND strong_auth_expires_at IS NOT NULL "
            "AND strong_auth_expires_at > strong_auth_verified_at)",
            name="ck_auth_sessions_strong_auth_complete",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    authentication_method: Mapped[str] = mapped_column(String(32), nullable=False)
    # Set only after a real second-factor verifier succeeds. Access JWT claims
    # never confer assurance; the authoritative state lives on this family.
    strong_auth_method: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )
    strong_auth_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    strong_auth_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    absolute_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
    )
    last_refreshed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    revocation_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    compromise_detected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class AuthRefreshCredential(Base):
    """One one-time refresh credential; only its SHA-256 digest is persisted."""

    __tablename__ = "auth_refresh_credentials"
    __table_args__ = (
        Index("ix_auth_refresh_session_issued", "session_id", "issued_at"),
    )

    # The record ID is also the signed JWT `jti`, avoiding a second public
    # identifier while keeping the raw credential absent from storage.
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("auth_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
    )
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("auth_refresh_credentials.id", ondelete="SET NULL"),
        nullable=True,
    )


__all__ = ["AuthRefreshCredential", "AuthSession"]
