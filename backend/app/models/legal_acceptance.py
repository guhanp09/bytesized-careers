from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LegalAcceptance(Base):
    """One person agreeing to one version of one document, on one date.

    A row per acceptance rather than a column on the user, because the question
    that gets asked later is "what did they agree to, and when" — and a boolean
    that gets overwritten when the terms change cannot answer it. Records are
    written and never updated.

    Unique on (user, document, version) so that clicking accept twice records the
    same fact once. Idempotence here matters: the client may retry, and a second
    row would suggest a second, separate agreement that never happened.
    """

    __tablename__ = "legal_acceptances"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "document_key", "version", name="uq_legal_acceptance_user_document_version"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        # CASCADE: an acceptance describes a person's agreement, and once the
        # account is gone there is no one whose agreement it records. Anything
        # that must outlive deletion belongs in the audit log, not here.
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
