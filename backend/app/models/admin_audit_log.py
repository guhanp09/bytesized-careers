from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

json_obj_type = JSON().with_variant(JSONB, "postgresql")


class AdminAuditLog(Base):
    """Append-only record of every admin action (docs/ADMIN_PANEL_PLAN.md §15).

    Written in the same transaction as the action it records. There is
    deliberately no update or delete path anywhere in the app for this table —
    it is the accountability record. `target_label` snapshots a human-readable
    name at write time so entries stay legible after the target changes or is
    removed; `justification` is required by the API layer for destructive and
    privacy-sensitive actions; `report_id` links the report that legitimized
    the action (especially reported-conversation views).
    """

    __tablename__ = "admin_audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Namespaced action key, e.g. "report.hide_listing", "user.suspend",
    # "identity.approve", "job.state.pause", "conversation.view_reported".
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    before_json: Mapped[dict | None] = mapped_column(json_obj_type, nullable=True)
    after_json: Mapped[dict | None] = mapped_column(json_obj_type, nullable=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("reports.id", ondelete="SET NULL"), nullable=True
    )
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
