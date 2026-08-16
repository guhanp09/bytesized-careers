from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EmailSuppression(Base):
    """An address the platform has been told to stop mailing.

    One row per address, because "are we allowed to mail this person" has to be
    a single answer. The history of why lives in ``reason`` and ``detail`` on
    that row and in the outbox rows themselves; a second suppression row for the
    same address would only create the question of which one wins.

    A suppression is not a deletion. The person still has an account, still has
    an inbox somewhere, and may well be back — so this records a decision about
    delivery, and nothing here touches the user.
    """

    __tablename__ = "email_suppressions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    #: Stored normalized (trimmed, casefolded). A bounce for `Person@Example.com`
    #: has to suppress `person@example.com` — it is the same mailbox.
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    #: hard_bounce | complaint | manual. Kept as a plain string rather than an
    #: enum so a provider category the platform has not seen before can be
    #: recorded rather than rejected at the boundary.
    reason: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    #: Where the decision came from — a provider name, or an operator.
    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The message that triggered it, when the provider told us.
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    #: Set when the suppression is lifted rather than deleting the row: the fact
    #: that an address once bounced is worth keeping, and a deleted row cannot
    #: explain why mail stopped for a fortnight.
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
