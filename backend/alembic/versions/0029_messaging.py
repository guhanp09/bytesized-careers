"""messaging: conversations + messages

Adds real user-to-user messaging. A conversation is a one-to-one thread anchored to
a job application or a talent interest; messages belong to a conversation. Additive
and safe — no existing tables are modified. Existing applications/interests get a
conversation lazily on first access (see app.services.messaging_service).

Revision ID: 0029_messaging
Revises: 0028_talent_creator_context_fields
Create Date: 2026-06-27 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0029_messaging"
down_revision = "0028_talent_creator_context_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_obj = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    obj_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "conversations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("context_type", sa.String(length=32), nullable=False),
        sa.Column(
            "application_id",
            sa.Uuid(),
            sa.ForeignKey("job_applications.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "talent_interest_id",
            sa.Uuid(),
            sa.ForeignKey("talent_interests.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("job_id", sa.Uuid(), nullable=True),
        sa.Column("talent_listing_id", sa.Uuid(), nullable=True),
        sa.Column(
            "participant_a_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "participant_b_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("participant_a_last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("participant_b_last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata_json", json_obj, nullable=False, server_default=obj_default),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("application_id", name="uq_conversation_application"),
        sa.UniqueConstraint("talent_interest_id", name="uq_conversation_talent_interest"),
    )
    op.create_index("ix_conversations_context_type", "conversations", ["context_type"])
    op.create_index("ix_conversations_application_id", "conversations", ["application_id"])
    op.create_index("ix_conversations_talent_interest_id", "conversations", ["talent_interest_id"])
    op.create_index("ix_conversations_participant_a_user_id", "conversations", ["participant_a_user_id"])
    op.create_index("ix_conversations_participant_b_user_id", "conversations", ["participant_b_user_id"])
    op.create_index("ix_conversations_last_message_at", "conversations", ["last_message_at"])

    op.create_table(
        "messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Uuid(),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sender_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("metadata_json", json_obj, nullable=False, server_default=obj_default),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("ix_messages_sender_user_id", "messages", ["sender_user_id"])


def downgrade() -> None:
    op.drop_table("messages")
    op.drop_table("conversations")
