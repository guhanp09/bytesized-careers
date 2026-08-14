"""Add encrypted OAuth credential storage for an expand/contract rollout.

This migration is intentionally additive and performs no data rewrite. Deploy
the application in `dual` mode, run the idempotent rotation command, verify the
result, then switch to `encrypted_only` and rerun the command to clear legacy
plaintext. The plaintext columns cannot be removed until that contract phase is
complete and independently verified.

Revision ID: 0055_oauth_credential_encryption
Revises: 0054_oauth_link_uniqueness
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0055_oauth_credential_encryption"
down_revision = "0054_oauth_link_uniqueness"
branch_labels = None
depends_on = None


def _assert_plaintext_rollback_safe() -> None:
    encrypted_only_row = (
        op.get_bind()
        .execute(
            sa.text(
                """
            SELECT id
            FROM oauth_accounts
            WHERE (access_token_ciphertext IS NOT NULL AND access_token IS NULL)
               OR (refresh_token_ciphertext IS NOT NULL AND refresh_token IS NULL)
            LIMIT 1
            """
            )
        )
        .first()
    )
    if encrypted_only_row is not None:
        raise RuntimeError(
            "OAuth credential encryption downgrade refused: encrypted-only rows "
            "would lose provider credentials. Restore and verify compatibility "
            "plaintext before retrying downgrade 0055."
        )


def upgrade() -> None:
    with op.batch_alter_table("oauth_accounts") as batch_op:
        batch_op.add_column(sa.Column("access_token_ciphertext", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("refresh_token_ciphertext", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column("credentials_encrypted_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    # Dual mode keeps the legacy columns populated specifically so this schema
    # rollback is data-safe before the encrypted-only contract step. An operator
    # must not downgrade after plaintext has been cleared without first restoring
    # a verified compatibility copy.
    _assert_plaintext_rollback_safe()
    with op.batch_alter_table("oauth_accounts") as batch_op:
        batch_op.drop_column("credentials_encrypted_at")
        batch_op.drop_column("refresh_token_ciphertext")
        batch_op.drop_column("access_token_ciphertext")
