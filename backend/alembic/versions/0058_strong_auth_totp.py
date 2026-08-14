"""Add encrypted TOTP factors and hash-only recovery codes.

No existing account or session is enrolled or elevated by this migration.

Revision ID: 0058_strong_auth_totp
Revises: 0057_admin_session_assurance
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0058_strong_auth_totp"
down_revision = "0057_admin_session_assurance"
branch_labels = None
depends_on = None


def _assert_downgrade_has_no_factor_state() -> None:
    factor = op.get_bind().execute(
        sa.text("SELECT id FROM strong_auth_totp_credentials LIMIT 1")
    ).first()
    if factor is not None:
        raise RuntimeError(
            "Strong-auth downgrade refused: removing enrolled or pending factor state "
            "would destroy administrator authentication and recovery material. Disable "
            "factors through the audited application flow and verify global session "
            "revocation before retrying migration 0058."
        )


def upgrade() -> None:
    op.create_table(
        "strong_auth_totp_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("secret_ciphertext", sa.Text(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enrollment_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_step", sa.BigInteger(), nullable=True),
        sa.Column("failed_attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(confirmed_at IS NULL AND enrollment_expires_at IS NOT NULL) OR "
            "(confirmed_at IS NOT NULL AND enrollment_expires_at IS NULL)",
            name="ck_strong_auth_totp_lifecycle",
        ),
        sa.CheckConstraint(
            "failed_attempt_count >= 0 AND failed_attempt_count <= 5",
            name="ck_strong_auth_totp_failed_attempts",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_strong_auth_totp_user"),
    )
    op.create_index(
        "ix_strong_auth_totp_credentials_user_id",
        "strong_auth_totp_credentials",
        ["user_id"],
    )

    op.create_table(
        "strong_auth_recovery_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"],
            ["strong_auth_totp_credentials.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "code_hash",
            name="uq_strong_auth_recovery_code_hash",
        ),
    )
    op.create_index(
        "ix_strong_auth_recovery_codes_credential_id",
        "strong_auth_recovery_codes",
        ["credential_id"],
    )


def downgrade() -> None:
    _assert_downgrade_has_no_factor_state()
    op.drop_index(
        "ix_strong_auth_recovery_codes_credential_id",
        table_name="strong_auth_recovery_codes",
    )
    op.drop_table("strong_auth_recovery_codes")
    op.drop_index(
        "ix_strong_auth_totp_credentials_user_id",
        table_name="strong_auth_totp_credentials",
    )
    op.drop_table("strong_auth_totp_credentials")
