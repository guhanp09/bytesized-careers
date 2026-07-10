from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
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

json_obj_type = JSON().with_variant(JSONB, "postgresql")


class Engagement(Base):
    """A mutually acknowledged work relationship created from a marketplace record."""

    __tablename__ = "engagements"
    __table_args__ = (
        UniqueConstraint("source_type", "source_record_id", name="uq_engagement_source"),
        UniqueConstraint("application_id", name="uq_engagement_application"),
        UniqueConstraint("talent_interest_id", name="uq_engagement_talent_interest"),
        CheckConstraint(
            "source_type IN ('job_application', 'talent_interest')",
            name="ck_engagement_source_type",
        ),
        CheckConstraint(
            "status IN ('ready_to_start', 'start_pending', 'active', "
            "'completion_pending', 'completed', 'ended_after_start', 'cancelled_before_start')",
            name="ck_engagement_status",
        ),
        CheckConstraint(
            "requested_outcome IS NULL OR requested_outcome IN ('completed', 'ended_after_start')",
            name="ck_engagement_requested_outcome",
        ),
        CheckConstraint(
            "recruiter_user_id IS NULL OR talent_user_id IS NULL OR recruiter_user_id <> talent_user_id",
            name="ck_engagement_distinct_participants",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_record_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("job_applications.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    talent_interest_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("talent_interests.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    recruiter_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    talent_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    context_snapshot: Mapped[dict] = mapped_column(
        json_obj_type, nullable=False, default=dict, server_default="{}"
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="ready_to_start", server_default="ready_to_start", index=True
    )

    start_requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    start_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    start_response_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    completion_requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    completion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completion_response_due_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    requested_outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)
    completion_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    latest_issue_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    latest_issue_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    latest_issue_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    review_window_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class EngagementReview(Base):
    """Blind, role-scoped feedback from one engagement participant to the other."""

    __tablename__ = "engagement_reviews"
    __table_args__ = (
        UniqueConstraint("engagement_id", "direction", name="uq_engagement_review_direction"),
        CheckConstraint(
            "direction IN ('recruiter_to_talent', 'talent_to_recruiter')",
            name="ck_engagement_review_direction",
        ),
        CheckConstraint("overall_rating >= 1 AND overall_rating <= 5", name="ck_review_overall_rating"),
        CheckConstraint(
            "status IN ('submitted', 'published', 'hidden')",
            name="ck_engagement_review_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("engagements.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reviewer_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reviewee_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    direction: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    reviewer_snapshot: Mapped[dict] = mapped_column(
        json_obj_type, nullable=False, default=dict, server_default="{}"
    )
    overall_rating: Mapped[int] = mapped_column(Integer, nullable=False)
    dimension_ratings: Mapped[dict] = mapped_column(
        json_obj_type, nullable=False, default=dict, server_default="{}"
    )
    public_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="submitted", server_default="submitted", index=True
    )
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hidden_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    hidden_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
