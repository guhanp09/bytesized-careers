"""recruiter hiring profile fields (platforms, collaboration styles, work mode)

Adds three additive, backward-compatible columns to `users` so the recruiter/
hiring profile can persist multiple platforms, multiple collaboration styles, and
a single work mode (Remote/Hybrid/On-site). The list columns default to an empty
list and `work_mode` is nullable, so profiles saved before this migration keep
rendering unchanged — no existing data is converted or destroyed.

This also merges the two pre-existing heads (`0022_first_message_requirements`
and `0024_talent_experience_years`) so the revision graph has a single head again.

Revision ID: 0025_hiring_profile_fields
Revises: 0022_first_message_requirements, 0024_talent_experience_years
Create Date: 2026-06-25 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0025_hiring_profile_fields"
down_revision = ("0022_first_message_requirements", "0024_talent_experience_years")
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_list = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    list_default = sa.text("'[]'::jsonb") if is_postgres else sa.text("'[]'")

    op.add_column(
        "users",
        sa.Column(
            "collaboration_styles",
            json_list,
            nullable=False,
            server_default=list_default,
        ),
    )
    op.add_column(
        "users",
        sa.Column("work_mode", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "hiring_platforms",
            json_list,
            nullable=False,
            server_default=list_default,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "hiring_platforms")
    op.drop_column("users", "work_mode")
    op.drop_column("users", "collaboration_styles")
