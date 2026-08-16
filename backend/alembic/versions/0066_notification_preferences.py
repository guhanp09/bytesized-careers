"""Which categories of email a person has refused.

Revision ID: 0066_notification_preferences
Revises: 0065_legal_acceptances

A new table, so nothing existing changes shape and deploy order does not matter.

Rows record REFUSAL, not consent. Absence means subscribed, which is what keeps
a category added later from arriving switched off for every existing account —
that would be a feature nobody could find, failing silently.

A row per (user, category) rather than a preferences blob: "who has opted out of
digests" stays a query, and a partial write cannot corrupt unrelated choices.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0066_notification_preferences"
down_revision = "0065_legal_acceptances"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_opt_outs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "category", name="uq_notification_opt_out_user_category"),
    )
    op.create_index("ix_notification_opt_outs_user_id", "notification_opt_outs", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_notification_opt_outs_user_id", table_name="notification_opt_outs")
    op.drop_table("notification_opt_outs")
