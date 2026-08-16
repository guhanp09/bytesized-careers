from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AccountDeletionRequest(Base):
    """Someone asking for their account to be removed, and what happened next.

    A record rather than an immediate `DELETE`, for reasons that are not
    squeamishness. Deletion touches messages another person also participated
    in, applications a recruiter is mid-decision on, and records that may be
    subject to obligations nobody in this codebase gets to decide. Doing it in
    one statement inside a request means all of that is resolved by whoever
    wrote the query, silently and irreversibly.

    So the request is the durable fact. Everything visible to other people stops
    immediately; what is erased, and when, follows a policy that is written down
    elsewhere and can change without changing this table.

    `cancelled_at` exists because people change their minds, and the window in
    which that is possible is exactly the window this row describes.
    """

    __tablename__ = "account_deletion_requests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        # CASCADE: once the account is actually gone the request describes
        # nobody. The audit trail of the decision belongs in the admin audit
        # log, which outlives both.
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    #: requested -> cancelled | completed. Deliberately small: a state machine
    #: with more states than the product has behaviours invites states nothing
    #: can produce.
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="requested", server_default="requested", index=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
