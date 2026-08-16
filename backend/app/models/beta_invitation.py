"""An invitation to a closed beta.

The security of an invite-only launch rests almost entirely on this table, so
the columns are chosen around the ways invitations usually leak:

* **Bound to an address.** An invitation names who it is for. A code that any
  recipient can redeem is a code that gets forwarded, posted, and scraped, and
  "invite-only" quietly becomes "anyone with the link".
* **Stored as a hash.** The raw token goes in the email and nowhere else. A
  database copy is a second place it can be read from — by a backup, a log, or
  an admin screen — and the platform never needs to read it back, only to check
  a presented one.
* **Single use, recorded.** `redeemed_at` and `redeemed_user_id` make redemption
  a fact rather than an inference, so a second attempt is refused by data rather
  than by timing.
* **Expiring.** An invitation that never lapses is a permanent credential.
* **Revocable.** Someone will send one to the wrong address.

Every one of those is enforced server-side. A client that decides for itself
whether an invitation is valid is not a check.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BetaInvitation(Base):
    __tablename__ = "beta_invitations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    #: Lowercased at write time. The address this invitation is for, and the only
    #: address that may redeem it.
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)

    #: SHA-256 of the token that was emailed. Unique so a presented token can be
    #: looked up directly without scanning, and so two invitations can never
    #: collide on the same secret.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    #: Who issued it. Nullable because a seeded or system-issued invitation has
    #: no human author, and losing the invitation would be worse than losing the
    #: attribution.
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    #: Redemption, as recorded fact rather than inference.
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    redeemed_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Kept for the audit trail — who withdrew access and why is worth more later
    #: than the row's absence would be.
    revoked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
