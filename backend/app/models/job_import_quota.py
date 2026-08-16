from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class JobImportQuotaCounter(Base):
    """How many import attempts one person has spent in the current window.

    One row per user, deliberately, because the question "may this person start
    another import" has to have a single answer that two simultaneous requests
    cannot both read as yes. Counting rows in an events table would be a check
    followed by an act; a counter can be consumed and checked in one statement.

    The window is stored rather than derived so a reset is a fact on the row
    instead of a calculation every reader has to agree on. `window_started_at`
    older than the window means the count no longer describes now, and the same
    statement that consumes a unit rolls it forward.
    """

    __tablename__ = "job_import_quota_counters"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    #: Attempts spent since `window_started_at`.
    used: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    window_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
