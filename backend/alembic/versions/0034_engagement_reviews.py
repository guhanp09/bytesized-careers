"""engagement lifecycle and two-sided reviews

Revision ID: 0034_engagement_reviews
Revises: 0033_job_budget_note
Create Date: 2026-07-10 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0034_engagement_reviews"
down_revision = "0033_job_budget_note"
branch_labels = None
depends_on = None


def _json_type() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "engagements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("source_record_id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=True),
        sa.Column("talent_interest_id", sa.Uuid(), nullable=True),
        sa.Column("recruiter_user_id", sa.Uuid(), nullable=True),
        sa.Column("talent_user_id", sa.Uuid(), nullable=True),
        sa.Column("context_snapshot", _json_type(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="ready_to_start", nullable=False),
        sa.Column("start_requested_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("start_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("start_response_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completion_requested_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("completion_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completion_response_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_outcome", sa.String(length=32), nullable=True),
        sa.Column("completion_note", sa.Text(), nullable=True),
        sa.Column("latest_issue_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("latest_issue_note", sa.Text(), nullable=True),
        sa.Column("latest_issue_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_window_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("source_type IN ('job_application', 'talent_interest')", name="ck_engagement_source_type"),
        sa.CheckConstraint(
            "status IN ('ready_to_start', 'start_pending', 'active', 'completion_pending', "
            "'completed', 'ended_after_start', 'cancelled_before_start')",
            name="ck_engagement_status",
        ),
        sa.CheckConstraint(
            "requested_outcome IS NULL OR requested_outcome IN ('completed', 'ended_after_start')",
            name="ck_engagement_requested_outcome",
        ),
        sa.CheckConstraint(
            "recruiter_user_id IS NULL OR talent_user_id IS NULL OR recruiter_user_id <> talent_user_id",
            name="ck_engagement_distinct_participants",
        ),
        sa.ForeignKeyConstraint(["application_id"], ["job_applications.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["talent_interest_id"], ["talent_interests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["recruiter_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["talent_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["start_requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["completion_requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["latest_issue_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_type", "source_record_id", name="uq_engagement_source"),
        sa.UniqueConstraint("application_id", name="uq_engagement_application"),
        sa.UniqueConstraint("talent_interest_id", name="uq_engagement_talent_interest"),
    )
    for column in (
        "source_type", "source_record_id", "application_id", "talent_interest_id",
        "recruiter_user_id", "talent_user_id", "status", "start_response_due_at",
        "completion_response_due_at", "finalized_at", "review_window_ends_at",
    ):
        op.create_index(f"ix_engagements_{column}", "engagements", [column], unique=False)

    op.create_table(
        "engagement_reviews",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("engagement_id", sa.Uuid(), nullable=False),
        sa.Column("reviewer_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewee_user_id", sa.Uuid(), nullable=True),
        sa.Column("direction", sa.String(length=32), nullable=False),
        sa.Column("reviewer_snapshot", _json_type(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("overall_rating", sa.Integer(), nullable=False),
        sa.Column("dimension_ratings", _json_type(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("public_feedback", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="submitted", nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hidden_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("hidden_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("direction IN ('recruiter_to_talent', 'talent_to_recruiter')", name="ck_engagement_review_direction"),
        sa.CheckConstraint("overall_rating >= 1 AND overall_rating <= 5", name="ck_review_overall_rating"),
        sa.CheckConstraint("status IN ('submitted', 'published', 'hidden')", name="ck_engagement_review_status"),
        sa.ForeignKeyConstraint(["engagement_id"], ["engagements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewee_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["hidden_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("engagement_id", "direction", name="uq_engagement_review_direction"),
    )
    for column in (
        "engagement_id", "reviewer_user_id", "reviewee_user_id", "direction", "status", "published_at",
    ):
        op.create_index(f"ix_engagement_reviews_{column}", "engagement_reviews", [column], unique=False)


def downgrade() -> None:
    op.drop_table("engagement_reviews")
    op.drop_table("engagements")
