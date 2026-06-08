"""add popularity score to roles

Revision ID: 0007_roles_popularity_score
Revises: 0006_roles_registry_fields
Create Date: 2026-02-21 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_roles_popularity_score"
down_revision: str | None = "0006_roles_registry_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "roles",
        sa.Column("popularity_score", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.create_index("ix_roles_popularity_score", "roles", ["popularity_score"])


def downgrade() -> None:
    op.drop_index("ix_roles_popularity_score", table_name="roles")
    op.drop_column("roles", "popularity_score")
