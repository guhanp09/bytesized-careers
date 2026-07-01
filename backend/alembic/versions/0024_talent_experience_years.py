"""talent listing exact experience years

Adds a canonical numeric `experience_years` column to talent_listings. Talent
listings describe the talent's own background, so experience is now an exact
whole number of years rather than a range/level string. The legacy
`experience_level` column is retained untouched for backward compatibility — no
existing data is converted or destroyed by this migration.

Revision ID: 0024_talent_experience_years
Revises: 0023_job_hiring_external_url_snapshot
Create Date: 2026-06-23 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0024_talent_experience_years"
down_revision = "0023_job_hiring_external_url_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "talent_listings",
        sa.Column("experience_years", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("talent_listings", "experience_years")
