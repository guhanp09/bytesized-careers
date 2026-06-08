"""add profile experience

Revision ID: 0019_profile_experience
Revises: 0018_talent_interest_job_id
Create Date: 2026-06-06 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0019_profile_experience"
down_revision = "0018_talent_interest_job_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    op.add_column(
        "users",
        sa.Column(
            "profile_experience",
            postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb") if is_postgres else sa.text("'[]'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "profile_experience")
