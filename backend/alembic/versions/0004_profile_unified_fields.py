"""profile unified fields for public/private profile system

Revision ID: 0004_profile_unified_fields
Revises: 0003_profile_username
Create Date: 2026-02-17 00:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_profile_unified_fields"
down_revision: str | None = "0003_profile_username"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    op.add_column("users", sa.Column("headline", sa.String(length=160), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "availability_status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'selective'"),
        ),
    )
    op.add_column("users", sa.Column("timezone", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("instagram_handle", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("instagram_url", sa.String(length=1024), nullable=True))
    op.add_column("users", sa.Column("project_type_preference", sa.String(length=16), nullable=True))
    op.add_column("users", sa.Column("collaboration_turnaround", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("collaboration_revisions", sa.String(length=255), nullable=True))
    op.add_column(
        "users", sa.Column("collaboration_working_hours", sa.String(length=255), nullable=True)
    )
    op.add_column("users", sa.Column("collaboration_tools", sa.String(length=255), nullable=True))

    op.add_column("portfolio_items", sa.Column("role", sa.String(length=255), nullable=True))
    op.add_column("portfolio_items", sa.Column("media_url", sa.String(length=1024), nullable=True))
    op.add_column("portfolio_items", sa.Column("metrics", sa.Text(), nullable=True))
    op.add_column(
        "portfolio_items",
        sa.Column(
            "tools",
            (
                postgresql.JSONB(astext_type=sa.Text())
                if is_postgres
                else sa.JSON()
            ),
            nullable=False,
            server_default=(sa.text("'[]'::jsonb") if is_postgres else sa.text("'[]'")),
        ),
    )


def downgrade() -> None:
    op.drop_column("portfolio_items", "tools")
    op.drop_column("portfolio_items", "metrics")
    op.drop_column("portfolio_items", "media_url")
    op.drop_column("portfolio_items", "role")

    op.drop_column("users", "collaboration_tools")
    op.drop_column("users", "collaboration_working_hours")
    op.drop_column("users", "collaboration_revisions")
    op.drop_column("users", "collaboration_turnaround")
    op.drop_column("users", "project_type_preference")
    op.drop_column("users", "instagram_url")
    op.drop_column("users", "instagram_handle")
    op.drop_column("users", "timezone")
    op.drop_column("users", "availability_status")
    op.drop_column("users", "headline")
