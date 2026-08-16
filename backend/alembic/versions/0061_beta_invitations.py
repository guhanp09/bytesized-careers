"""Invitations for the closed beta.

Revision ID: 0061_beta_invitations
Revises: 0060_email_outbox_lease

A new table, so nothing existing changes shape. The token column stores a
SHA-256 hash rather than the token itself: the raw value belongs in exactly one
place, the email that carried it, and a database copy is another place it can be
read from without ever being needed.

`email` is indexed but deliberately not unique. Re-inviting the same person after
an invitation lapses is ordinary, and a unique constraint would force either
deleting the earlier row — losing the audit trail — or refusing a legitimate
second invitation.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0061_beta_invitations"
down_revision = "0060_email_outbox_lease"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "beta_invitations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        # Unique so a presented token resolves to at most one invitation and two
        # invitations can never share a secret.
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("invited_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("redeemed_user_id", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        # SET NULL rather than CASCADE: deleting the person who sent an
        # invitation must not delete the record that it was sent.
        sa.ForeignKeyConstraint(["invited_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["redeemed_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_beta_invitations_email", "beta_invitations", ["email"], unique=False)
    op.create_index(
        "ix_beta_invitations_token_hash", "beta_invitations", ["token_hash"], unique=True
    )
    op.create_index(
        "ix_beta_invitations_expires_at", "beta_invitations", ["expires_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_beta_invitations_expires_at", table_name="beta_invitations")
    op.drop_index("ix_beta_invitations_token_hash", table_name="beta_invitations")
    op.drop_index("ix_beta_invitations_email", table_name="beta_invitations")
    op.drop_table("beta_invitations")
