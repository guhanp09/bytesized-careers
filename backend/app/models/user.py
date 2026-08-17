from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

json_obj_type = JSON().with_variant(JSONB, "postgresql")
json_list_type = JSON().with_variant(JSONB, "postgresql")
default_privacy_settings = {
    "show_bio": True,
    "show_links": True,
    "show_skills": True,
    "show_location": False,
    "show_availability": False,
    "show_youtube_badge": True,
}


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(20), nullable=True, unique=True, index=True)
    username_change_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    username_last_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    account_type: Mapped[str] = mapped_column(String(16), nullable=False, default="TALENT", server_default="TALENT")
    account_type_selected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    onboarding_intent: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="DECIDE_LATER",
        server_default="DECIDE_LATER",
    )
    onboarding_intent_selected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Admin suspension (reversible): a suspended account is rejected at auth and
    # its published content is excluded from public marketplace queries. Set only
    # through the audited admin endpoints (docs/ADMIN_PANEL_PLAN.md §12).
    #: An ADMINISTRATIVE decision about this account. Never written by the
    #: account holder's own actions — see `deletion_hidden_at` for that.
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    #: The account holder's own deletion request taking effect. Separate from
    #: suspension because the two are independent lifecycles: sharing a column
    #: meant requesting deletion made an account un-suspendable (the suspend
    #: endpoint refuses an already-suspended account), so asking to be deleted
    #: was a way to become un-moderatable. Either hides the account; neither
    #: cancels the other.
    deletion_hidden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    suspension_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    suspended_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Coarse activity signal for the admin directory (touched at most every 15
    # minutes on authenticated requests — not a precise presence system).
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    headline: Mapped[str | None] = mapped_column(String(160), nullable=True)
    avatar_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="generic")
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    avatar_youtube_channel_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    banner_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    skills: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    public_links: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    profile_experience: Mapped[list[dict[str, object]]] = mapped_column(
        json_list_type,
        nullable=False,
        default=list,
        server_default="[]",
    )
    availability_status: Mapped[str] = mapped_column(String(16), nullable=False, default="selective")
    availability: Mapped[str | None] = mapped_column(String(255), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    instagram_handle: Mapped[str | None] = mapped_column(String(255), nullable=True)
    instagram_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    project_type_preference: Mapped[str | None] = mapped_column(String(16), nullable=True)
    collaboration_turnaround: Mapped[str | None] = mapped_column(String(255), nullable=True)
    collaboration_revisions: Mapped[str | None] = mapped_column(String(255), nullable=True)
    collaboration_working_hours: Mapped[str | None] = mapped_column(String(255), nullable=True)
    collaboration_tools: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Additive recruiter/hiring fields. Lists default to [] and work_mode is nullable so
    # existing profiles (saved before these columns existed) keep rendering unchanged.
    collaboration_styles: Mapped[list[str]] = mapped_column(
        json_list_type,
        nullable=False,
        default=list,
        server_default="[]",
    )
    work_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    hiring_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    hiring_website_or_social_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    hiring_primary_platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    hiring_platforms: Mapped[list[str]] = mapped_column(
        json_list_type,
        nullable=False,
        default=list,
        server_default="[]",
    )
    # Recruiter/hiring metadata kept SEPARATE from the talent-side content_style so a
    # user can describe what they hire for independently of what they create. All
    # default to [] so existing profiles keep rendering unchanged.
    hiring_niches: Mapped[list[str]] = mapped_column(
        json_list_type,
        nullable=False,
        default=list,
        server_default="[]",
    )
    hiring_genres: Mapped[list[str]] = mapped_column(
        json_list_type,
        nullable=False,
        default=list,
        server_default="[]",
    )
    hiring_formats: Mapped[list[str]] = mapped_column(
        json_list_type,
        nullable=False,
        default=list,
        server_default="[]",
    )
    # Talent-side publishing platforms, kept separate from the recruiter hiring_platforms.
    creator_platforms: Mapped[list[str]] = mapped_column(
        json_list_type,
        nullable=False,
        default=list,
        server_default="[]",
    )
    hiring_channels_or_pages_managed: Mapped[str | None] = mapped_column(Text, nullable=True)
    hiring_verification_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="unverified",
        server_default="unverified",
    )
    privacy_settings: Mapped[dict[str, bool]] = mapped_column(
        json_obj_type,
        nullable=False,
        default=lambda: dict(default_privacy_settings),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
