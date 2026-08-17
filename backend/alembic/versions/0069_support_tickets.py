"""Internal support tickets.

Revision ID: 0069_support_tickets
Revises: 0068_account_deletion_hidden_at

A new table, so nothing existing changes shape and deploy order does not matter.

Every user reference is SET NULL rather than CASCADE. A ticket is a record of
work staff did, and deleting the account it concerned must not delete the
evidence that it was handled — the same reasoning as the admin audit log.

`escalated_at` is a separate column rather than a status value: a ticket can be
escalated while assigned, and stays escalated after it is resolved. Folding it
into the status would lose one of those facts to record the other.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0069_support_tickets"
down_revision = "0068_account_deletion_hidden_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("subject_user_id", sa.Uuid(), nullable=True),
        sa.Column("opened_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("assignee_user_id", sa.Uuid(), nullable=True),
        sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("escalation_reason", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["subject_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["opened_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assignee_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_support_tickets_status", "support_tickets", ["status"])
    op.create_index("ix_support_tickets_subject_user_id", "support_tickets", ["subject_user_id"])
    op.create_index("ix_support_tickets_assignee_user_id", "support_tickets", ["assignee_user_id"])
    op.create_index("ix_support_tickets_created_at", "support_tickets", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_support_tickets_created_at", table_name="support_tickets")
    op.drop_index("ix_support_tickets_assignee_user_id", table_name="support_tickets")
    op.drop_index("ix_support_tickets_subject_user_id", table_name="support_tickets")
    op.drop_index("ix_support_tickets_status", table_name="support_tickets")
    op.drop_table("support_tickets")
