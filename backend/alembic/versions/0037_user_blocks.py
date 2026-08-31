"""add user-to-user interaction blocks

Revision ID: 0037_user_blocks
Revises: 0036_private_note_history
Create Date: 2026-07-12 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0037_user_blocks"
down_revision = "0036_private_note_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_blocks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("blocker_user_id", sa.Uuid(), nullable=False),
        sa.Column("blocked_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["blocker_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocked_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("blocker_user_id", "blocked_user_id", name="uq_user_blocks_direction"),
        sa.CheckConstraint("blocker_user_id <> blocked_user_id", name="ck_user_blocks_not_self"),
    )
    op.create_index("ix_user_blocks_blocker_user_id", "user_blocks", ["blocker_user_id"])
    op.create_index("ix_user_blocks_blocked_user_id", "user_blocks", ["blocked_user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_blocks_blocked_user_id", table_name="user_blocks")
    op.drop_index("ix_user_blocks_blocker_user_id", table_name="user_blocks")
    op.drop_table("user_blocks")
