"""hiring identities and job snapshots

Revision ID: 0013_hiring_identities_and_job_snapshots
Revises: 0012_single_profile_hiring_info
Create Date: 2026-05-16 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0013_hiring_identities_and_job_snapshots"
down_revision = "0012_single_profile_hiring_info"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hiring_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("platform", sa.String(length=20), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("handle", sa.String(length=255), nullable=True),
        sa.Column("url", sa.String(length=1024), nullable=True),
        sa.Column("avatar_url", sa.String(length=1024), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("managed_by_agency_name", sa.String(length=255), nullable=True),
        sa.Column("is_agency_represented", sa.Boolean(), nullable=False),
        sa.Column("verification_status", sa.String(length=20), server_default="UNVERIFIED", nullable=False),
        sa.Column("verification_method", sa.String(length=40), server_default="NONE", nullable=False),
        sa.Column("verification_code", sa.String(length=64), nullable=True),
        sa.Column("proof_url", sa.String(length=1024), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_hiring_identities_owner_user_id", "hiring_identities", ["owner_user_id"])
    op.create_index("ix_hiring_identities_platform", "hiring_identities", ["platform"])
    op.create_index(
        "ix_hiring_identities_verification_status",
        "hiring_identities",
        ["verification_status"],
    )

    op.add_column("jobs", sa.Column("hiring_identity_id", sa.Uuid(), nullable=True))
    op.add_column("jobs", sa.Column("hiring_display_name_snapshot", sa.String(length=255), nullable=True))
    op.add_column("jobs", sa.Column("hiring_platform_snapshot", sa.String(length=20), nullable=True))
    op.add_column(
        "jobs",
        sa.Column("hiring_verification_status_snapshot", sa.String(length=20), nullable=True),
    )
    op.add_column("jobs", sa.Column("managed_by_agency_name_snapshot", sa.String(length=255), nullable=True))
    op.create_index("ix_jobs_hiring_identity_id", "jobs", ["hiring_identity_id"])
    op.create_foreign_key(
        "fk_jobs_hiring_identity_id_hiring_identities",
        "jobs",
        "hiring_identities",
        ["hiring_identity_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_jobs_hiring_identity_id_hiring_identities", "jobs", type_="foreignkey")
    op.drop_index("ix_jobs_hiring_identity_id", table_name="jobs")
    op.drop_column("jobs", "managed_by_agency_name_snapshot")
    op.drop_column("jobs", "hiring_verification_status_snapshot")
    op.drop_column("jobs", "hiring_platform_snapshot")
    op.drop_column("jobs", "hiring_display_name_snapshot")
    op.drop_column("jobs", "hiring_identity_id")

    op.drop_index("ix_hiring_identities_verification_status", table_name="hiring_identities")
    op.drop_index("ix_hiring_identities_platform", table_name="hiring_identities")
    op.drop_index("ix_hiring_identities_owner_user_id", table_name="hiring_identities")
    op.drop_table("hiring_identities")
