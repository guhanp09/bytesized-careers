"""listing languages

Adds a structured `languages` JSON-list column to `jobs` and `talent_listings`
so search can match creator-economy language requirements (e.g. Hindi, Tamil)
as a first-class signal instead of guessing from free text. Additive and
non-destructive: existing rows default to an empty list.

Revision ID: 0025_listing_languages
Revises: 0024_talent_experience_years
Create Date: 2026-06-26 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0025_listing_languages"
down_revision = "0024_talent_experience_years"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("languages", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.add_column(
        "talent_listings",
        sa.Column("languages", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("talent_listings", "languages")
    op.drop_column("jobs", "languages")
