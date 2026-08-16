"""Requests to delete an account.

Revision ID: 0067_account_deletion_requests
Revises: 0066_notification_preferences

A new table, so nothing existing changes shape and deploy order does not matter.

The row is the durable fact that someone asked. What is erased, and after how
long, is policy that lives outside this schema — deliberately, because the
duration is a legal and product decision and this table should not have to change
when it is made.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0067_account_deletion_requests"
down_revision = "0066_notification_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_deletion_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="requested"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_account_deletion_requests_user_id", "account_deletion_requests", ["user_id"]
    )
    op.create_index(
        "ix_account_deletion_requests_status", "account_deletion_requests", ["status"]
    )


def downgrade() -> None:
    op.drop_index("ix_account_deletion_requests_status", table_name="account_deletion_requests")
    op.drop_index("ix_account_deletion_requests_user_id", table_name="account_deletion_requests")
    op.drop_table("account_deletion_requests")
