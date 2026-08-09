from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.core.job_taxonomy import CURRENT_LISTING_SCHEMA_VERSION
from app.core.tool_catalog import tool_display_names

json_list_type = JSON().with_variant(JSONB, "postgresql")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    listing_schema_version: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=CURRENT_LISTING_SCHEMA_VERSION,
        server_default=str(CURRENT_LISTING_SCHEMA_VERSION),
        index=True,
    )
    primary_role_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("roles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    primary_role_name_snapshot: Mapped[str | None] = mapped_column(String(120), nullable=True)
    role_specialization: Mapped[str | None] = mapped_column(String(120), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    budget_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    budget_max: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    compensation_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    budget_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    budget_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    budget_unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    budget_unit_custom: Mapped[str | None] = mapped_column(String(64), nullable=True)

    experience_level: Mapped[str | None] = mapped_column(String(64), nullable=True)
    platforms: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    start_timeframe: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    work_mode: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    contract_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    engagement_type: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    timezone_overlap: Mapped[str | None] = mapped_column(String(128), nullable=True)
    weekly_hours: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expected_weekly_hours_min: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    expected_weekly_hours_max: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    turnaround_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    turnaround_unit: Mapped[str | None] = mapped_column(String(24), nullable=True)
    turnaround_basis: Mapped[str | None] = mapped_column(String(24), nullable=True)
    application_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="internal", server_default="internal")
    external_apply_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    about_channel: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsibilities: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    requirements: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    # Keys (from the shared first-message requirements registry) that applicants
    # must answer in their opening message. Empty list = no specific requirements.
    application_requirements: Mapped[list[str]] = mapped_column(
        json_list_type, nullable=False, default=list, server_default="[]"
    )
    how_to_apply: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_videos: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    tags: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list)
    languages: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list, server_default="[]")
    content_niches: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list, server_default="[]")
    content_genres: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list, server_default="[]")
    formats_hired_for: Mapped[list[str]] = mapped_column(json_list_type, nullable=False, default=list, server_default="[]")
    required_tool_keys: Mapped[list[str] | None] = mapped_column(json_list_type, nullable=True)
    other_required_tools: Mapped[list[str] | None] = mapped_column(json_list_type, nullable=True)

    deliverables: Mapped[list[dict[str, object]] | None] = mapped_column(json_list_type, nullable=True)
    required_skill_keys: Mapped[list[str] | None] = mapped_column(json_list_type, nullable=True)
    preferred_skill_keys: Mapped[list[str] | None] = mapped_column(json_list_type, nullable=True)
    other_required_skills: Mapped[list[str] | None] = mapped_column(json_list_type, nullable=True)
    other_preferred_skills: Mapped[list[str] | None] = mapped_column(json_list_type, nullable=True)
    required_skills_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    preferred_skills_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    revision_policy: Mapped[str | None] = mapped_column(String(24), nullable=True)
    revision_rounds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revision_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_inputs: Mapped[list[dict[str, object]] | None] = mapped_column(json_list_type, nullable=True)
    source_inputs_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    creative_autonomy: Mapped[str | None] = mapped_column(String(32), nullable=True)
    creative_autonomy_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    language_requirements: Mapped[list[dict[str, object]] | None] = mapped_column(
        json_list_type, nullable=True
    )

    trial_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    trial_scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    trial_effort_value: Mapped[Decimal | None] = mapped_column(Numeric(6, 1), nullable=True)
    trial_effort_unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    trial_compensation_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    trial_compensation_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    trial_compensation_basis: Mapped[str | None] = mapped_column(String(24), nullable=True)
    trial_work_usage: Mapped[str | None] = mapped_column(String(24), nullable=True)
    trial_portfolio_permission: Mapped[str | None] = mapped_column(String(24), nullable=True)
    trial_attribution: Mapped[str | None] = mapped_column(String(24), nullable=True)
    unpaid_trial_confirmed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    trial_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    start_timing: Mapped[str | None] = mapped_column(String(24), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    duration_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    duration_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_unit: Mapped[str | None] = mapped_column(String(12), nullable=True)
    engagement_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    hiring_process: Mapped[list[dict[str, object]] | None] = mapped_column(json_list_type, nullable=True)
    hiring_process_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    screening_questions: Mapped[list[dict[str, object]] | None] = mapped_column(
        json_list_type, nullable=True
    )
    employer_context_type: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)

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
    hiring_external_url_snapshot: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    managed_by_agency_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)

    #: Brand About enrichment: what happened, for which identity, and whether an
    #: attempt is still live.
    #:
    #: Four nullable columns rather than a workflow system. Each answers one
    #: question the trigger has to ask before doing anything: has this been
    #: tried, was it tried for *this* brand, is somebody already doing it, and
    #: has that attempt been running long enough to be considered dead.
    brand_about_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    #: The hiring identity an attempt was started for. A result is discarded
    #: when the recruiter has since chosen a different brand, which is the one
    #: way this feature could write the wrong company's description.
    brand_about_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True
    )
    #: Compare-and-set claim, the same mechanism import processing uses. Two
    #: tabs, a double save and a refresh all resolve to one attempt.
    brand_about_attempt_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True
    )
    brand_about_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

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

    @property
    def tools(self) -> list[str] | None:
        known = tool_display_names(self.required_tool_keys)
        if known is None and self.other_required_tools is None:
            return None
        return [*(known or []), *(self.other_required_tools or [])]
