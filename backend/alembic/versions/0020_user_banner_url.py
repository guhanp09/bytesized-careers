"""add user banner url (profile cover image)

Revision ID: 0020_user_banner_url
Revises: 0019_profile_experience
Create Date: 2026-06-13 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0020_user_banner_url"
down_revision = "0019_profile_experience"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("banner_url", sa.String(length=1024), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "banner_url")
