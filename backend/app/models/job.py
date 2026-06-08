from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

json_list_type = JSON().with_variant(JSONB, "postgresql")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="Editing")
    location: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    budget_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    budget_max: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    budget_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    budget_unit: Mapped[str] = mapped_column(String(32), nullable=False, default="per project")

    experience_level: Mapped[str | None] = mapped_column(String(64), nullable=True)
    platforms: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    start_timeframe: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    work_mode: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    contract_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    timezone_overlap: Mapped[str | None] = mapped_column(String(128), nullable=True)
    weekly_hours: Mapped[str | None] = mapped_column(String(64), nullable=True)
    application_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="internal", server_default="internal")
    external_apply_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    about_channel: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsibilities: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    requirements: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    how_to_apply: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_videos: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    tags: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)

    youtube_channel_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    channel_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    channel_logo_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    channel_subscribers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    channel_profile_slug: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    posted_by_agency: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    agency_profile_slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    posted_platform: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    posted_youtube_channel_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    posted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    hiring_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("hiring_identities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    hiring_display_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hiring_platform_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    hiring_verification_status_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    managed_by_agency_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)

    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    applicants: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    response_rate: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    featured_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
