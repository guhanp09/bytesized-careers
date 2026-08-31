"""Add per-user personal organisation of a conversation.

Purely additive: one new table, no existing table touched, no data backfilled.
Nothing in it is lifecycle state, so an environment that has not yet deployed the
matching application code simply leaves it empty and behaves exactly as before.

Revision ID: 0045_interaction_user_preferences
Revises: 0044_job_import_mutation_claim
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0045_interaction_user_preferences"
down_revision = "0044_job_import_mutation_claim"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interaction_user_preferences",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("starred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_prompt_dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_prompt_trigger_version", sa.Integer(), nullable=True),
        sa.Column("queue_dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # Personal organisation of a deleted user or a deleted thread has no
        # meaning, so both cascade rather than leaving orphaned rows behind.
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        # The guarantee that a concurrent double-write cannot produce two rows
        # for the same person and thread. Enforced by the database, not by
        # application-level checking.
        sa.UniqueConstraint(
            "user_id", "conversation_id", name="uq_interaction_pref_user_conversation"
        ),
    )
    op.create_index("ix_interaction_user_preferences_user_id", "interaction_user_preferences", ["user_id"])
    op.create_index(
        "ix_interaction_user_preferences_conversation_id",
        "interaction_user_preferences",
        ["conversation_id"],
    )
    # Serve "my starred threads" and "what have I snoozed" without a table scan.
    op.create_index("ix_interaction_pref_user_starred", "interaction_user_preferences", ["user_id", "starred_at"])
    op.create_index("ix_interaction_pref_user_snoozed", "interaction_user_preferences", ["user_id", "snoozed_until"])


def downgrade() -> None:
    """Drop the table.

    Safe in the sense that no other table references it and no lifecycle state
    lives here — the marketplace behaves correctly without it. It is lossy in the
    sense that users' stars, snoozes, and dismissals are discarded and cannot be
    reconstructed, since they were never derivable from anything else. Take a
    backup first if a downgrade is ever run against real data.
    """
    op.drop_index("ix_interaction_pref_user_snoozed", table_name="interaction_user_preferences")
    op.drop_index("ix_interaction_pref_user_starred", table_name="interaction_user_preferences")
    op.drop_index("ix_interaction_user_preferences_conversation_id", table_name="interaction_user_preferences")
    op.drop_index("ix_interaction_user_preferences_user_id", table_name="interaction_user_preferences")
    op.drop_table("interaction_user_preferences")
