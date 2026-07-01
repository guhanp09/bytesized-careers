"""portfolio rich detail fields

Revision ID: 0030_portfolio_rich_detail_fields
Revises: 0029_messaging
Create Date: 2026-06-29 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0030_portfolio_rich_detail_fields"
down_revision = "0029_messaging"
branch_labels = None
depends_on = None


def _json_list_type() -> sa.types.TypeEngine:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def _json_list_default() -> sa.sql.elements.TextClause:
    bind = op.get_bind()
    return sa.text("'[]'::jsonb") if bind.dialect.name == "postgresql" else sa.text("'[]'")


def upgrade() -> None:
    json_list = _json_list_type()
    list_default = _json_list_default()

    op.add_column("portfolio_items", sa.Column("what_i_did", sa.Text(), nullable=True))
    for column_name in (
        "contribution_highlights",
        "timestamp_notes",
        "content_niches",
        "content_genres",
        "platforms",
        "formats",
        "results",
    ):
        op.add_column(
            "portfolio_items",
            sa.Column(column_name, json_list, nullable=False, server_default=list_default),
        )


def downgrade() -> None:
    for column_name in (
        "results",
        "formats",
        "platforms",
        "content_genres",
        "content_niches",
        "timestamp_notes",
        "contribution_highlights",
    ):
        op.drop_column("portfolio_items", column_name)
    op.drop_column("portfolio_items", "what_i_did")
