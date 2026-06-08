"""portfolio proof-of-work cards

Revision ID: 0009_portfolio_proof_cards
Revises: 0008_jobs_budget_unit_and_range
Create Date: 2026-05-11 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009_portfolio_proof_cards"
down_revision: str | None = "0008_jobs_budget_unit_and_range"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


json_type = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column(
        "portfolio_items",
        sa.Column("source_type", sa.String(length=32), nullable=False, server_default="custom"),
    )
    op.add_column("portfolio_items", sa.Column("source_url", sa.String(length=2048), nullable=True))
    op.add_column("portfolio_items", sa.Column("role_id", sa.Uuid(), nullable=True))
    op.add_column("portfolio_items", sa.Column("role_name", sa.String(length=255), nullable=True))
    op.add_column("portfolio_items", sa.Column("contribution_summary", sa.Text(), nullable=True))
    op.add_column("portfolio_items", sa.Column("channel_id", sa.String(length=255), nullable=True))
    op.add_column("portfolio_items", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "portfolio_items",
        sa.Column("contribution_tags", json_type, nullable=False, server_default=sa.text("'[]'")),
    )
    op.add_column(
        "portfolio_items",
        sa.Column("public_metrics", json_type, nullable=False, server_default=sa.text("'{}'")),
    )
    op.add_column(
        "portfolio_items",
        sa.Column("manual_metrics", json_type, nullable=False, server_default=sa.text("'{}'")),
    )
    op.add_column(
        "portfolio_items",
        sa.Column("verification_status", sa.String(length=64), nullable=False, server_default="manual"),
    )
    op.add_column(
        "portfolio_items",
        sa.Column("visibility", sa.String(length=16), nullable=False, server_default="public"),
    )
    op.add_column(
        "portfolio_items",
        sa.Column("portfolio_status", sa.String(length=16), nullable=False, server_default="now"),
    )
    op.add_column(
        "portfolio_items",
        sa.Column("is_featured", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_foreign_key(
        "fk_portfolio_items_role_id_roles",
        "portfolio_items",
        "roles",
        ["role_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_portfolio_items_source_type", "portfolio_items", ["source_type"])
    op.create_index("ix_portfolio_items_visibility", "portfolio_items", ["visibility"])
    op.create_index("ix_portfolio_items_portfolio_status", "portfolio_items", ["portfolio_status"])
    op.create_index("ix_portfolio_items_is_featured", "portfolio_items", ["is_featured"])


def downgrade() -> None:
    op.drop_index("ix_portfolio_items_is_featured", table_name="portfolio_items")
    op.drop_index("ix_portfolio_items_portfolio_status", table_name="portfolio_items")
    op.drop_index("ix_portfolio_items_visibility", table_name="portfolio_items")
    op.drop_index("ix_portfolio_items_source_type", table_name="portfolio_items")
    op.drop_constraint("fk_portfolio_items_role_id_roles", "portfolio_items", type_="foreignkey")
    op.drop_column("portfolio_items", "is_featured")
    op.drop_column("portfolio_items", "portfolio_status")
    op.drop_column("portfolio_items", "visibility")
    op.drop_column("portfolio_items", "verification_status")
    op.drop_column("portfolio_items", "manual_metrics")
    op.drop_column("portfolio_items", "public_metrics")
    op.drop_column("portfolio_items", "contribution_tags")
    op.drop_column("portfolio_items", "published_at")
    op.drop_column("portfolio_items", "channel_id")
    op.drop_column("portfolio_items", "contribution_summary")
    op.drop_column("portfolio_items", "role_name")
    op.drop_column("portfolio_items", "role_id")
    op.drop_column("portfolio_items", "source_url")
    op.drop_column("portfolio_items", "source_type")
