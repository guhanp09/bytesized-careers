"""single profile hiring info

Revision ID: 0012_single_profile_hiring_info
Revises: 0011_single_profile_onboarding_intent
Create Date: 2026-05-16 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0012_single_profile_hiring_info"
down_revision = "0011_single_profile_onboarding_intent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("hiring_type", sa.String(length=64), nullable=True))
    op.add_column(
        "users",
        sa.Column("hiring_website_or_social_url", sa.String(length=1024), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("hiring_primary_platform", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("hiring_channels_or_pages_managed", sa.Text(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "hiring_verification_status",
            sa.String(length=32),
            nullable=False,
            server_default="unverified",
        ),
    )
    op.create_index("ix_users_hiring_type", "users", ["hiring_type"])


def downgrade() -> None:
    op.drop_index("ix_users_hiring_type", table_name="users")
    op.drop_column("users", "hiring_verification_status")
    op.drop_column("users", "hiring_channels_or_pages_managed")
    op.drop_column("users", "hiring_primary_platform")
    op.drop_column("users", "hiring_website_or_social_url")
    op.drop_column("users", "hiring_type")
