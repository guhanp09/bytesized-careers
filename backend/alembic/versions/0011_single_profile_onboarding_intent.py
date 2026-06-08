"""single profile onboarding intent

Revision ID: 0011_single_profile_onboarding_intent
Revises: 0010_user_account_type
Create Date: 2026-05-15 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0011_single_profile_onboarding_intent"
down_revision = "0010_user_account_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "onboarding_intent",
            sa.String(length=32),
            nullable=False,
            server_default="DECIDE_LATER",
        ),
    )
    op.add_column(
        "users",
        sa.Column("onboarding_intent_selected_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE users
        SET
            onboarding_intent = CASE
                WHEN account_type = 'EMPLOYER' THEN 'HIRING_CREATOR_TALENT'
                WHEN account_type = 'BOTH' THEN 'BOTH'
                WHEN account_type = 'TALENT' THEN 'LOOKING_FOR_WORK'
                ELSE 'DECIDE_LATER'
            END,
            onboarding_intent_selected_at = account_type_selected_at
        WHERE account_type_selected_at IS NOT NULL
        """
    )
    op.create_index("ix_users_onboarding_intent", "users", ["onboarding_intent"])


def downgrade() -> None:
    op.drop_index("ix_users_onboarding_intent", table_name="users")
    op.drop_column("users", "onboarding_intent_selected_at")
    op.drop_column("users", "onboarding_intent")
