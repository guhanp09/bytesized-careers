"""add idempotency keys for user messages

Revision ID: 0035_message_idempotency
Revises: 0034_engagement_reviews
Create Date: 2026-07-11 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0035_message_idempotency"
down_revision = "0034_engagement_reviews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("messages") as batch_op:
        batch_op.add_column(sa.Column("client_message_id", sa.Uuid(), nullable=True))
        batch_op.create_unique_constraint(
            "uq_message_conversation_client_id",
            ["conversation_id", "client_message_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_constraint(
            "uq_message_conversation_client_id",
            type_="unique",
        )
        batch_op.drop_column("client_message_id")
