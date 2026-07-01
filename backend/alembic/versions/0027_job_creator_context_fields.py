"""job creator context fields

Adds optional structured creator-economy metadata to jobs so search, ranking,
cards, and detail pages can use niche, genre, and deliverable signals without
guessing only from free text. Existing rows default to empty lists.

Revision ID: 0027_job_creator_context_fields
Revises: 0025_listing_languages, 0026_separate_talent_recruiter_metadata
Create Date: 2026-06-27 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0027_job_creator_context_fields"
down_revision = ("0025_listing_languages", "0026_separate_talent_recruiter_metadata")
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_list = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    list_default = sa.text("'[]'::jsonb") if is_postgres else sa.text("'[]'")

    for column_name in ("content_niches", "content_genres", "formats_hired_for"):
        op.add_column(
            "jobs",
            sa.Column(
                column_name,
                json_list,
                nullable=False,
                server_default=list_default,
            ),
        )


def downgrade() -> None:
    for column_name in ("formats_hired_for", "content_genres", "content_niches"):
        op.drop_column("jobs", column_name)
