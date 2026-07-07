from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

json_list_type = JSON().with_variant(JSONB, "postgresql")
json_obj_type = JSON().with_variant(JSONB, "postgresql")


class SavedJob(Base):
    __tablename__ = "saved_jobs"
    __table_args__ = (UniqueConstraint("user_id", "job_id", name="uq_saved_jobs_user_job"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_snapshot: Mapped[dict] = mapped_column(json_obj_type, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class JobApplication(Base):
    __tablename__ = "job_applications"
    __table_args__ = (UniqueConstraint("job_id", "applicant_user_id", name="uq_job_applications_job_applicant"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    applicant_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    cover_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    portfolio_item_ids: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    # Structured answers to the job's first-message requirements, keyed by
    # requirement key (see lib/firstMessageRequirements.ts). Empty = none required.
    first_message_answers: Mapped[dict] = mapped_column(
        json_obj_type, nullable=False, default=dict, server_default="{}"
    )
    applicant_snapshot: Mapped[dict] = mapped_column(json_obj_type, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="new", index=True)
    # Private annotation by the job owner managing this applicant. Never shown
    # to the applicant — sender-facing responses blank it.
    manager_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class TalentListing(Base):
    __tablename__ = "talent_listings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    primary_role: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    # Legacy free-form experience range/level (e.g. "2–4 years"); kept for backward compatibility.
    experience_level: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Canonical talent experience: exact whole years of self-declared experience.
    experience_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    roles: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    niche: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    content_niches: Mapped[list[str]] = mapped_column(
        json_list_type, nullable=False, default=list, server_default="[]"
    )
    content_genres: Mapped[list[str]] = mapped_column(
        json_list_type, nullable=False, default=list, server_default="[]"
    )
    formats: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    platforms: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    tools: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    languages: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list, server_default="[]")
    work_mode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    availability_status: Mapped[str] = mapped_column(String(16), nullable=False, default="selective")
    rate_min: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    rate_max: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    rate_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")
    rate_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    open_slots: Mapped[int | None] = mapped_column(Integer, nullable=True)
    turnaround: Mapped[str | None] = mapped_column(String(128), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    portfolio_item_ids: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    # Keys (from the shared first-message requirements registry) that recruiters
    # must answer when sending a hiring request. Empty list = no specific requirements.
    first_message_requirements: Mapped[list[str]] = mapped_column(
        json_list_type, nullable=False, default=list, server_default="[]"
    )
    first_message_custom_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    is_featured: Mapped[bool] = mapped_column(default=False, nullable=False)
    featured_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    saves: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class SavedTalentListing(Base):
    __tablename__ = "saved_talent_listings"
    __table_args__ = (
        UniqueConstraint("user_id", "talent_listing_id", name="uq_saved_talent_user_listing"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    talent_listing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("talent_listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    talent_snapshot: Mapped[dict] = mapped_column(json_obj_type, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TalentInterest(Base):
    __tablename__ = "talent_interests"
    __table_args__ = (
        UniqueConstraint("talent_listing_id", "recruiter_user_id", name="uq_talent_interest_listing_recruiter"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    talent_listing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("talent_listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    recruiter_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Structured answers to the talent listing's first-message requirements, keyed
    # by requirement key (see lib/firstMessageRequirements.ts). Empty = none required.
    first_message_answers: Mapped[dict] = mapped_column(
        json_obj_type, nullable=False, default=dict, server_default="{}"
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="new", index=True)
    # Private annotation by the talent (listing owner) managing this hiring
    # request. Never shown to the recruiter — sender-facing responses blank it.
    manager_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="system", server_default="system", index=True)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="normal", server_default="normal")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(
        json_obj_type, nullable=False, default=dict, server_default="{}"
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reporter_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    target_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open", index=True)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    action: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Entitlement(Base):
    __tablename__ = "entitlements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="free_launch")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    metadata_json: Mapped[dict] = mapped_column(json_obj_type, nullable=False, default=dict)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    checkout_intent_id: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
