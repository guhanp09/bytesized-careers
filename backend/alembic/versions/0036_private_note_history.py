"""persist application and hiring-request private note history

Revision ID: 0036_private_note_history
Revises: 0035_message_idempotency
Create Date: 2026-07-11 00:00:00.000000
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa

from alembic import op

revision = "0036_private_note_history"
down_revision = "0035_message_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interaction_private_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=True),
        sa.Column("talent_interest_id", sa.Uuid(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(application_id IS NOT NULL AND talent_interest_id IS NULL) OR "
            "(application_id IS NULL AND talent_interest_id IS NOT NULL)",
            name="ck_private_note_one_source",
        ),
        sa.ForeignKeyConstraint(["application_id"], ["job_applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["talent_interest_id"], ["talent_interests.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_interaction_private_notes_owner_user_id",
        "interaction_private_notes",
        ["owner_user_id"],
    )
    op.create_index(
        "ix_interaction_private_notes_application_id",
        "interaction_private_notes",
        ["application_id"],
    )
    op.create_index(
        "ix_interaction_private_notes_talent_interest_id",
        "interaction_private_notes",
        ["talent_interest_id"],
    )
    op.create_index(
        "ix_interaction_private_notes_created_at",
        "interaction_private_notes",
        ["created_at"],
    )

    bind = op.get_bind()
    application_rows = bind.execute(
        sa.text(
            "SELECT id, job_owner_user_id, manager_note, updated_at, created_at "
            "FROM job_applications "
            "WHERE manager_note IS NOT NULL AND job_owner_user_id IS NOT NULL"
        )
    ).mappings()
    for row in application_rows:
        bind.execute(
            sa.text(
                "INSERT INTO interaction_private_notes "
                "(id, owner_user_id, application_id, body, created_at) "
                "VALUES (:id, :owner_user_id, :application_id, :body, :created_at)"
            ),
            {
                "id": str(uuid.uuid4()),
                "owner_user_id": row["job_owner_user_id"],
                "application_id": row["id"],
                "body": row["manager_note"],
                "created_at": row["updated_at"] or row["created_at"],
            },
        )

    interest_rows = bind.execute(
        sa.text(
            "SELECT id, owner_user_id, manager_note, updated_at, created_at "
            "FROM talent_interests WHERE manager_note IS NOT NULL"
        )
    ).mappings()
    for row in interest_rows:
        bind.execute(
            sa.text(
                "INSERT INTO interaction_private_notes "
                "(id, owner_user_id, talent_interest_id, body, created_at) "
                "VALUES (:id, :owner_user_id, :talent_interest_id, :body, :created_at)"
            ),
            {
                "id": str(uuid.uuid4()),
                "owner_user_id": row["owner_user_id"],
                "talent_interest_id": row["id"],
                "body": row["manager_note"],
                "created_at": row["updated_at"] or row["created_at"],
            },
        )


def downgrade() -> None:
    op.drop_index(
        "ix_interaction_private_notes_created_at",
        table_name="interaction_private_notes",
    )
    op.drop_index(
        "ix_interaction_private_notes_talent_interest_id",
        table_name="interaction_private_notes",
    )
    op.drop_index(
        "ix_interaction_private_notes_application_id",
        table_name="interaction_private_notes",
    )
    op.drop_index(
        "ix_interaction_private_notes_owner_user_id",
        table_name="interaction_private_notes",
    )
    op.drop_table("interaction_private_notes")
