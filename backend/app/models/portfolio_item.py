from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

json_list_type = JSON().with_variant(JSONB, "postgresql")


class PortfolioItem(Base):
    __tablename__ = "portfolio_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="custom", index=True)
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    role_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )
    role_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_role_in_project: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    contribution_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    what_i_did: Mapped[str | None] = mapped_column(Text, nullable=True)
    contribution_highlights: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    timestamp_notes: Mapped[list[dict[str, Any]]] = mapped_column(json_list_type, nullable=False, default=list)
    media_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    metrics: Mapped[str | None] = mapped_column(Text, nullable=True)
    youtube_url: Mapped[str | None] = mapped_column(String(2048), nullable=True, index=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    thumbnail_options: Mapped[list[dict[str, Any]]] = mapped_column(json_list_type, nullable=False, default=list)
    channel_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    channel_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    views: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    published_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration: Mapped[str | None] = mapped_column(String(64), nullable=True)
    retention_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    links: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    tags: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    contribution_tags: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    tools: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    content_niches: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    content_genres: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    platforms: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    formats: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    results: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    public_metrics: Mapped[dict[str, Any]] = mapped_column(json_list_type, nullable=False, default=dict)
    manual_metrics: Mapped[dict[str, Any]] = mapped_column(json_list_type, nullable=False, default=dict)
    verification_status: Mapped[str] = mapped_column(String(64), nullable=False, default="manual")
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="public", index=True)
    portfolio_status: Mapped[str] = mapped_column(String(16), nullable=False, default="now", index=True)
    publish_status: Mapped[str] = mapped_column(String(16), nullable=False, default="published", index=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="now", index=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
