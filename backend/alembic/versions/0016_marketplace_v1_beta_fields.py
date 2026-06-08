"""marketplace v1 beta fields

Revision ID: 0016_marketplace_v1_beta_fields
Revises: 0015_marketplace_core
Create Date: 2026-05-30 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0016_marketplace_v1_beta_fields"
down_revision = "0015_marketplace_core"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("work_mode", sa.String(length=32), nullable=True))
    op.add_column("jobs", sa.Column("contract_type", sa.String(length=64), nullable=True))
    op.add_column("jobs", sa.Column("timezone_overlap", sa.String(length=128), nullable=True))
    op.add_column("jobs", sa.Column("weekly_hours", sa.String(length=64), nullable=True))
    op.add_column(
        "jobs",
        sa.Column(
            "application_mode",
            sa.String(length=32),
            server_default="internal",
            nullable=False,
        ),
    )
    op.add_column("jobs", sa.Column("external_apply_url", sa.String(length=2048), nullable=True))
    op.add_column("jobs", sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("featured_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_jobs_work_mode", "jobs", ["work_mode"])
    op.create_index("ix_jobs_contract_type", "jobs", ["contract_type"])
    op.create_index("ix_jobs_deadline_at", "jobs", ["deadline_at"])
    op.create_index("ix_jobs_featured_until", "jobs", ["featured_until"])

    op.add_column(
        "saved_jobs",
        sa.Column("job_snapshot", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
    )

    op.add_column("talent_listings", sa.Column("primary_role", sa.String(length=128), nullable=True))
    op.add_column("talent_listings", sa.Column("experience_level", sa.String(length=64), nullable=True))
    op.add_column("talent_listings", sa.Column("rate_min", sa.Numeric(12, 2), nullable=True))
    op.add_column("talent_listings", sa.Column("rate_max", sa.Numeric(12, 2), nullable=True))
    op.add_column(
        "talent_listings",
        sa.Column("rate_currency", sa.String(length=3), server_default="INR", nullable=False),
    )
    op.add_column("talent_listings", sa.Column("open_slots", sa.Integer(), nullable=True))
    op.add_column("talent_listings", sa.Column("turnaround", sa.String(length=128), nullable=True))
    op.add_column("talent_listings", sa.Column("featured_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("talent_listings", sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("talent_listings", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_talent_listings_primary_role", "talent_listings", ["primary_role"])
    op.create_index("ix_talent_listings_featured_until", "talent_listings", ["featured_until"])

    op.add_column(
        "saved_talent_listings",
        sa.Column("talent_snapshot", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
    )

    op.add_column(
        "notifications",
        sa.Column("category", sa.String(length=64), server_default="system", nullable=False),
    )
    op.add_column("notifications", sa.Column("action_url", sa.String(length=1024), nullable=True))
    op.create_index("ix_notifications_category", "notifications", ["category"])

    op.add_column("reports", sa.Column("resolved_by_user_id", sa.Uuid(), nullable=True))
    op.add_column("reports", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reports", sa.Column("action", sa.String(length=64), nullable=True))
    op.create_foreign_key(
        "fk_reports_resolved_by_user_id_users",
        "reports",
        "users",
        ["resolved_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_reports_resolved_by_user_id", "reports", ["resolved_by_user_id"])

    op.add_column("entitlements", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("entitlements", sa.Column("checkout_intent_id", sa.String(length=128), nullable=True))
    op.create_index("ix_entitlements_expires_at", "entitlements", ["expires_at"])
    op.create_unique_constraint(
        "uq_entitlements_checkout_intent_id",
        "entitlements",
        ["checkout_intent_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_entitlements_checkout_intent_id", "entitlements", type_="unique")
    op.drop_index("ix_entitlements_expires_at", table_name="entitlements")
    op.drop_column("entitlements", "checkout_intent_id")
    op.drop_column("entitlements", "expires_at")

    op.drop_index("ix_reports_resolved_by_user_id", table_name="reports")
    op.drop_constraint("fk_reports_resolved_by_user_id_users", "reports", type_="foreignkey")
    op.drop_column("reports", "action")
    op.drop_column("reports", "resolved_at")
    op.drop_column("reports", "resolved_by_user_id")

    op.drop_index("ix_notifications_category", table_name="notifications")
    op.drop_column("notifications", "action_url")
    op.drop_column("notifications", "category")

    op.drop_column("saved_talent_listings", "talent_snapshot")

    op.drop_index("ix_talent_listings_featured_until", table_name="talent_listings")
    op.drop_index("ix_talent_listings_primary_role", table_name="talent_listings")
    op.drop_column("talent_listings", "closed_at")
    op.drop_column("talent_listings", "paused_at")
    op.drop_column("talent_listings", "featured_until")
    op.drop_column("talent_listings", "turnaround")
    op.drop_column("talent_listings", "open_slots")
    op.drop_column("talent_listings", "rate_currency")
    op.drop_column("talent_listings", "rate_max")
    op.drop_column("talent_listings", "rate_min")
    op.drop_column("talent_listings", "experience_level")
    op.drop_column("talent_listings", "primary_role")

    op.drop_column("saved_jobs", "job_snapshot")

    op.drop_index("ix_jobs_featured_until", table_name="jobs")
    op.drop_index("ix_jobs_deadline_at", table_name="jobs")
    op.drop_index("ix_jobs_contract_type", table_name="jobs")
    op.drop_index("ix_jobs_work_mode", table_name="jobs")
    op.drop_column("jobs", "closed_at")
    op.drop_column("jobs", "paused_at")
    op.drop_column("jobs", "featured_until")
    op.drop_column("jobs", "deadline_at")
    op.drop_column("jobs", "external_apply_url")
    op.drop_column("jobs", "application_mode")
    op.drop_column("jobs", "weekly_hours")
    op.drop_column("jobs", "timezone_overlap")
    op.drop_column("jobs", "contract_type")
    op.drop_column("jobs", "work_mode")
