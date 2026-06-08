"""portfolio project states

Revision ID: 0014_portfolio_project_states
Revises: 0013_hiring_identities_and_job_snapshots
Create Date: 2026-05-18 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0014_portfolio_project_states"
down_revision = "0013_hiring_identities_and_job_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("portfolio_items", sa.Column("thumbnail_options", sa.JSON(), nullable=True))
    op.add_column(
        "portfolio_items",
        sa.Column("publish_status", sa.String(length=16), server_default="published", nullable=False),
    )
    op.create_index("ix_portfolio_items_publish_status", "portfolio_items", ["publish_status"])
    op.execute("UPDATE portfolio_items SET thumbnail_options = '[]' WHERE thumbnail_options IS NULL")
    op.alter_column("portfolio_items", "thumbnail_options", nullable=False)


def downgrade() -> None:
    op.drop_index("ix_portfolio_items_publish_status", table_name="portfolio_items")
    op.drop_column("portfolio_items", "publish_status")
    op.drop_column("portfolio_items", "thumbnail_options")
