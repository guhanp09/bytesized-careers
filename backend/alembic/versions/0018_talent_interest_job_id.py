"""Add job association to talent interests.

Revision ID: 0018_talent_interest_job_id
Revises: 0017_password_reset_tokens
Create Date: 2026-06-01 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0018_talent_interest_job_id"
down_revision = "0017_password_reset_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("talent_interests", sa.Column("job_id", sa.Uuid(), nullable=True))
    op.create_index("ix_talent_interests_job_id", "talent_interests", ["job_id"], unique=False)
    op.create_foreign_key(
        "fk_talent_interests_job_id_jobs",
        "talent_interests",
        "jobs",
        ["job_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_talent_interests_job_id_jobs", "talent_interests", type_="foreignkey")
    op.drop_index("ix_talent_interests_job_id", table_name="talent_interests")
    op.drop_column("talent_interests", "job_id")
