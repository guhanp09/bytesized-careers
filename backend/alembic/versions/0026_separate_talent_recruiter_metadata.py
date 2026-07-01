"""separate talent vs recruiter profile metadata

Adds four additive, backward-compatible list columns to `users` so the recruiter/
hiring metadata (niches, genres, formats) lives independently of the talent-side
`content_style`, and the talent's own publishing platforms (`creator_platforms`)
live independently of the recruiter `hiring_platforms`. Every column defaults to an
empty list, so profiles saved before this migration keep rendering unchanged — no
existing data is converted or destroyed.

Revision ID: 0026_separate_talent_recruiter_metadata
Revises: 0025_hiring_profile_fields
Create Date: 2026-06-25 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0026_separate_talent_recruiter_metadata"
down_revision = "0025_hiring_profile_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_list = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    list_default = sa.text("'[]'::jsonb") if is_postgres else sa.text("'[]'")

    for column_name in ("hiring_niches", "hiring_genres", "hiring_formats", "creator_platforms"):
        op.add_column(
            "users",
            sa.Column(
                column_name,
                json_list,
                nullable=False,
                server_default=list_default,
            ),
        )


def downgrade() -> None:
    for column_name in ("creator_platforms", "hiring_formats", "hiring_genres", "hiring_niches"):
        op.drop_column("users", column_name)
