"""Addresses the platform has been told to stop mailing.

Revision ID: 0062_email_suppressions
Revises: 0061_beta_invitations

A new table, so nothing existing changes shape and the deploy order does not
matter: code that does not know about suppressions is simply code that does not
consult them.

`email` is UNIQUE, unlike beta_invitations.email. The difference is what the row
means. An invitation is an event and a person can be invited twice; a
suppression is the current answer to "may we mail this address", and two rows
would create the question of which answer wins.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0062_email_suppressions"
down_revision = "0061_beta_invitations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_suppressions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("provider_message_id", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        # Lifting a suppression sets this rather than deleting the row: a
        # deleted row cannot explain why mail stopped for a fortnight.
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_reason", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_suppressions_email", "email_suppressions", ["email"], unique=True
    )
    op.create_index("ix_email_suppressions_reason", "email_suppressions", ["reason"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_email_suppressions_reason", table_name="email_suppressions")
    op.drop_index("ix_email_suppressions_email", table_name="email_suppressions")
    op.drop_table("email_suppressions")
