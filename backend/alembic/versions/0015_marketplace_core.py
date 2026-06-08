"""marketplace core

Revision ID: 0015_marketplace_core
Revises: 0014_portfolio_project_states
Create Date: 2026-05-30 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0015_marketplace_core"
down_revision = "0014_portfolio_project_states"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "job_id", name="uq_saved_jobs_user_job"),
    )
    op.create_index("ix_saved_jobs_user_id", "saved_jobs", ["user_id"])
    op.create_index("ix_saved_jobs_job_id", "saved_jobs", ["job_id"])

    op.create_table(
        "job_applications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("applicant_user_id", sa.Uuid(), nullable=False),
        sa.Column("job_owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("cover_note", sa.Text(), nullable=True),
        sa.Column("portfolio_item_ids", sa.JSON(), nullable=False),
        sa.Column("applicant_snapshot", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["applicant_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "applicant_user_id", name="uq_job_applications_job_applicant"),
    )
    op.create_index("ix_job_applications_job_id", "job_applications", ["job_id"])
    op.create_index("ix_job_applications_applicant_user_id", "job_applications", ["applicant_user_id"])
    op.create_index("ix_job_applications_job_owner_user_id", "job_applications", ["job_owner_user_id"])
    op.create_index("ix_job_applications_status", "job_applications", ["status"])

    op.create_table(
        "talent_listings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("roles", sa.JSON(), nullable=False),
        sa.Column("niche", sa.String(length=255), nullable=True),
        sa.Column("formats", sa.JSON(), nullable=False),
        sa.Column("platforms", sa.JSON(), nullable=False),
        sa.Column("tools", sa.JSON(), nullable=False),
        sa.Column("work_mode", sa.String(length=64), nullable=True),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("availability_status", sa.String(length=16), nullable=False),
        sa.Column("rate_note", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("portfolio_item_ids", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("is_featured", sa.Boolean(), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False),
        sa.Column("saves", sa.Integer(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_talent_listings_owner_user_id", "talent_listings", ["owner_user_id"])
    op.create_index("ix_talent_listings_title", "talent_listings", ["title"])
    op.create_index("ix_talent_listings_niche", "talent_listings", ["niche"])
    op.create_index("ix_talent_listings_location", "talent_listings", ["location"])
    op.create_index("ix_talent_listings_status", "talent_listings", ["status"])
    op.create_index("ix_talent_listings_deleted_at", "talent_listings", ["deleted_at"])

    op.create_table(
        "saved_talent_listings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("talent_listing_id", sa.Uuid(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["talent_listing_id"], ["talent_listings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "talent_listing_id", name="uq_saved_talent_user_listing"),
    )
    op.create_index("ix_saved_talent_listings_user_id", "saved_talent_listings", ["user_id"])
    op.create_index("ix_saved_talent_listings_talent_listing_id", "saved_talent_listings", ["talent_listing_id"])

    op.create_table(
        "talent_interests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("talent_listing_id", sa.Uuid(), nullable=False),
        sa.Column("recruiter_user_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recruiter_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["talent_listing_id"], ["talent_listings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("talent_listing_id", "recruiter_user_id", name="uq_talent_interest_listing_recruiter"),
    )
    op.create_index("ix_talent_interests_talent_listing_id", "talent_interests", ["talent_listing_id"])
    op.create_index("ix_talent_interests_recruiter_user_id", "talent_interests", ["recruiter_user_id"])
    op.create_index("ix_talent_interests_owner_user_id", "talent_interests", ["owner_user_id"])
    op.create_index("ix_talent_interests_status", "talent_interests", ["status"])

    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("resource_type", sa.String(length=64), nullable=True),
        sa.Column("resource_id", sa.String(length=64), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_type", "notifications", ["type"])
    op.create_index("ix_notifications_read_at", "notifications", ["read_at"])

    op.create_table(
        "reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reporter_user_id", sa.Uuid(), nullable=True),
        sa.Column("target_type", sa.String(length=64), nullable=False),
        sa.Column("target_id", sa.String(length=64), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reports_reporter_user_id", "reports", ["reporter_user_id"])
    op.create_index("ix_reports_target_type", "reports", ["target_type"])
    op.create_index("ix_reports_target_id", "reports", ["target_id"])
    op.create_index("ix_reports_status", "reports", ["status"])

    op.create_table(
        "entitlements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_entitlements_user_id", "entitlements", ["user_id"])
    op.create_index("ix_entitlements_kind", "entitlements", ["kind"])
    op.create_index("ix_entitlements_status", "entitlements", ["status"])


def downgrade() -> None:
    op.drop_table("entitlements")
    op.drop_table("reports")
    op.drop_table("notifications")
    op.drop_table("talent_interests")
    op.drop_table("saved_talent_listings")
    op.drop_table("talent_listings")
    op.drop_table("job_applications")
    op.drop_table("saved_jobs")
