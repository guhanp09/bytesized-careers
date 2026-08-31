"""Add the bounded interview arrangement for a conversation.

Purely additive: one new table, no existing table altered, no data backfilled,
no status vocabulary changed. An environment running the previous application
code simply leaves it empty — every conversation, status, message, and queue
behaves exactly as it did before, because nothing outside this table refers to
it and no lifecycle rule requires a row to exist.

Revision ID: 0048_interaction_interviews
Revises: 0047_shortlisted_to_private_star
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0048_interaction_interviews"
down_revision = "0047_shortlisted_to_private_star"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interaction_interviews",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="proposed"),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("meeting_method", sa.String(length=16), nullable=False, server_default="video_call"),
        sa.Column("meeting_detail", sa.String(length=500), nullable=True),
        sa.Column("proposed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("previous_scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reschedule_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("round_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_request_key", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # An arrangement for a conversation that no longer exists has no meaning.
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        # Deleting an account must not delete the other participant's record of
        # when they were meeting, so these detach rather than cascade.
        sa.ForeignKeyConstraint(["proposed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["confirmed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        # The database, not the service, is what makes two tabs unable to create
        # two competing interviews for one relationship.
        sa.UniqueConstraint("conversation_id", name="uq_interaction_interview_conversation"),
        sa.CheckConstraint(
            "status IN ('proposed', 'confirmed', 'completed', 'cancelled')",
            name="ck_interaction_interview_status",
        ),
        sa.CheckConstraint(
            "meeting_method IN ('video_call', 'phone', 'in_person', 'other')",
            name="ck_interaction_interview_method",
        ),
    )
    op.create_index("ix_interaction_interviews_conversation_id", "interaction_interviews", ["conversation_id"])
    op.create_index("ix_interaction_interviews_status", "interaction_interviews", ["status"])
    op.create_index(
        "ix_interaction_interview_status_scheduled",
        "interaction_interviews",
        ["status", "scheduled_at"],
    )


def downgrade() -> None:
    """Drop the table.

    Reversible for the schema and for behaviour: no other table references this
    one, no status depends on it, and the workspace degrades to exactly its
    pre-0048 state — interviews are arranged by message again, and the
    "Interviewing" stage keeps working as it always has.

    It is lossy for content: arranged times, methods, and confirmations are
    discarded and cannot be reconstructed. The conversation still holds the
    messages that announced them, so participants keep a human-readable record
    even though the structured one is gone.
    """
    op.drop_index("ix_interaction_interview_status_scheduled", table_name="interaction_interviews")
    op.drop_index("ix_interaction_interviews_status", table_name="interaction_interviews")
    op.drop_index("ix_interaction_interviews_conversation_id", table_name="interaction_interviews")
    op.drop_table("interaction_interviews")
