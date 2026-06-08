"""add user account type

Revision ID: 0010_user_account_type
Revises: 0009_portfolio_proof_cards
Create Date: 2026-05-15 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010_user_account_type"
down_revision: str | None = "0009_portfolio_proof_cards"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "account_type",
            sa.String(length=16),
            nullable=False,
            server_default="TALENT",
        ),
    )
    op.add_column(
        "users",
        sa.Column("account_type_selected_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_account_type", "users", ["account_type"])


def downgrade() -> None:
    op.drop_index("ix_users_account_type", table_name="users")
    op.drop_column("users", "account_type_selected_at")
    op.drop_column("users", "account_type")
