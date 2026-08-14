from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StrongAuthTotpCredential(Base):
    """One encrypted pending or confirmed TOTP factor for an account."""

    __tablename__ = "strong_auth_totp_credentials"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_strong_auth_totp_user"),
        CheckConstraint(
            "(confirmed_at IS NULL AND enrollment_expires_at IS NOT NULL) OR "
            "(confirmed_at IS NOT NULL AND enrollment_expires_at IS NULL)",
            name="ck_strong_auth_totp_lifecycle",
        ),
        CheckConstraint(
            "failed_attempt_count >= 0 AND failed_attempt_count <= 5",
            name="ck_strong_auth_totp_failed_attempts",
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
    secret_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    enrollment_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_used_step: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    failed_attempt_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class StrongAuthRecoveryCode(Base):
    """Hash-only one-time recovery material for one confirmed TOTP factor."""

    __tablename__ = "strong_auth_recovery_codes"
    __table_args__ = (
        UniqueConstraint(
            "code_hash",
            name="uq_strong_auth_recovery_code_hash",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    credential_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("strong_auth_totp_credentials.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


__all__ = ["StrongAuthRecoveryCode", "StrongAuthTotpCredential"]
