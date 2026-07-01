"""talent creator context fields

Adds optional structured creator-economy metadata to talent listings. Formats
already exist on talent listings, so this revision adds niches and genres only.

Revision ID: 0028_talent_creator_context_fields
Revises: 0027_job_creator_context_fields
Create Date: 2026-06-27 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0028_talent_creator_context_fields"
down_revision = "0027_job_creator_context_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_list = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    list_default = sa.text("'[]'::jsonb") if is_postgres else sa.text("'[]'")

    for column_name in ("content_niches", "content_genres"):
        op.add_column(
            "talent_listings",
            sa.Column(
                column_name,
                json_list,
                nullable=False,
                server_default=list_default,
            ),
        )


def downgrade() -> None:
    for column_name in ("content_genres", "content_niches"):
        op.drop_column("talent_listings", column_name)
