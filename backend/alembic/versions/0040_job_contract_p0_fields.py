"""Add nullable P0 job-contract fields.

Revision ID: 0040_job_contract_p0_fields
Revises: 0039_interaction_status_history
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0040_job_contract_p0_fields"
down_revision = "0039_interaction_status_history"
branch_labels = None
depends_on = None


def _json_type(bind):
    return postgresql.JSONB(astext_type=sa.Text()) if bind.dialect.name == "postgresql" else sa.JSON()


def upgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("jobs") as batch:
        batch.alter_column("category", existing_type=sa.String(length=64), nullable=True, server_default=None)
        batch.alter_column("budget_note", existing_type=sa.String(length=64), type_=sa.String(length=255))
        batch.alter_column(
            "budget_currency", existing_type=sa.String(length=3), nullable=True, server_default=None
        )
        batch.alter_column(
            "budget_unit", existing_type=sa.String(length=32), nullable=True, server_default=None
        )
        batch.add_column(sa.Column("listing_schema_version", sa.SmallInteger(), nullable=True))
        batch.add_column(sa.Column("primary_role_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("primary_role_name_snapshot", sa.String(length=120), nullable=True))
        batch.add_column(sa.Column("role_specialization", sa.String(length=120), nullable=True))
        batch.add_column(sa.Column("required_tool_keys", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("other_required_tools", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("engagement_type", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("compensation_mode", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("budget_unit_custom", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("expected_weekly_hours_min", sa.Numeric(5, 1), nullable=True))
        batch.add_column(sa.Column("expected_weekly_hours_max", sa.Numeric(5, 1), nullable=True))
        batch.add_column(sa.Column("turnaround_value", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("turnaround_unit", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("turnaround_basis", sa.String(length=24), nullable=True))
        batch.create_foreign_key(
            "fk_jobs_primary_role_id_roles", "roles", ["primary_role_id"], ["id"], ondelete="SET NULL"
        )
        batch.create_check_constraint(
            "ck_jobs_schema_version_positive",
            "listing_schema_version IS NULL OR listing_schema_version > 0",
        )
        batch.create_check_constraint(
            "ck_jobs_weekly_hours_min_range",
            "expected_weekly_hours_min IS NULL OR "
            "(expected_weekly_hours_min > 0 AND expected_weekly_hours_min <= 168)",
        )
        batch.create_check_constraint(
            "ck_jobs_weekly_hours_max_range",
            "expected_weekly_hours_max IS NULL OR "
            "(expected_weekly_hours_max > 0 AND expected_weekly_hours_max <= 168)",
        )
        batch.create_check_constraint(
            "ck_jobs_weekly_hours_order",
            "expected_weekly_hours_min IS NULL OR expected_weekly_hours_max IS NULL OR "
            "expected_weekly_hours_max >= expected_weekly_hours_min",
        )
        batch.create_check_constraint(
            "ck_jobs_turnaround_positive", "turnaround_value IS NULL OR turnaround_value > 0"
        )

    op.create_index("ix_jobs_listing_schema_version", "jobs", ["listing_schema_version"])
    op.create_index("ix_jobs_primary_role_id", "jobs", ["primary_role_id"])
    op.create_index("ix_jobs_engagement_type", "jobs", ["engagement_type"])


def downgrade() -> None:
    op.drop_index("ix_jobs_engagement_type", table_name="jobs")
    op.drop_index("ix_jobs_primary_role_id", table_name="jobs")
    op.drop_index("ix_jobs_listing_schema_version", table_name="jobs")

    # A downgrade restores the old non-null contract and is intentionally lossy.
    op.execute("UPDATE jobs SET category = 'Editing' WHERE category IS NULL")
    op.execute("UPDATE jobs SET budget_currency = 'INR' WHERE budget_currency IS NULL")
    op.execute("UPDATE jobs SET budget_unit = 'per project' WHERE budget_unit IS NULL")
    with op.batch_alter_table("jobs") as batch:
        batch.drop_constraint("ck_jobs_turnaround_positive", type_="check")
        batch.drop_constraint("ck_jobs_weekly_hours_order", type_="check")
        batch.drop_constraint("ck_jobs_weekly_hours_max_range", type_="check")
        batch.drop_constraint("ck_jobs_weekly_hours_min_range", type_="check")
        batch.drop_constraint("ck_jobs_schema_version_positive", type_="check")
        batch.drop_constraint("fk_jobs_primary_role_id_roles", type_="foreignkey")
        for column in (
            "turnaround_basis",
            "turnaround_unit",
            "turnaround_value",
            "expected_weekly_hours_max",
            "expected_weekly_hours_min",
            "budget_unit_custom",
            "compensation_mode",
            "engagement_type",
            "other_required_tools",
            "required_tool_keys",
            "role_specialization",
            "primary_role_name_snapshot",
            "primary_role_id",
            "listing_schema_version",
        ):
            batch.drop_column(column)
        batch.alter_column(
            "budget_unit",
            existing_type=sa.String(length=32),
            nullable=False,
            server_default="per project",
        )
        batch.alter_column(
            "budget_currency", existing_type=sa.String(length=3), nullable=False, server_default="INR"
        )
        batch.alter_column("budget_note", existing_type=sa.String(length=255), type_=sa.String(length=64))
        batch.alter_column(
            "category", existing_type=sa.String(length=64), nullable=False, server_default="Editing"
        )
