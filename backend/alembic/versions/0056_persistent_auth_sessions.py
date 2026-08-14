"""Add durable rotating backend authentication sessions.

The schema is additive. New application instances can remain in `legacy` mode,
then issue persistent credentials in `migration` mode while accepting old
stateless refresh JWTs, and finally reject legacy refreshes in `persistent`
mode. Refresh credentials remain JWT-shaped for rolling binary compatibility,
but only their SHA-256 digests are persisted.

Revision ID: 0056_persistent_auth_sessions
Revises: 0055_oauth_credential_encryption
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0056_persistent_auth_sessions"
down_revision = "0055_oauth_credential_encryption"
branch_labels = None
depends_on = None


def _assert_downgrade_cannot_reactivate_refresh_credentials() -> None:
    unexpired = op.get_bind().execute(
        sa.text(
            """
            SELECT id
            FROM auth_sessions
            WHERE absolute_expires_at > CURRENT_TIMESTAMP
            LIMIT 1
            """
        )
    ).first()
    if unexpired is not None:
        raise RuntimeError(
            "Persistent auth-session downgrade refused: removing server-side "
            "state would reactivate consumed or revoked refresh credentials. "
            "Wait for every session family to expire or rotate the JWT signing "
            "secret and verify global logout before retrying migration 0056."
        )


def upgrade() -> None:
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("authentication_method", sa.String(length=32), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revocation_reason", sa.String(length=64), nullable=True),
        sa.Column("compromise_detected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_auth_sessions_absolute_expires_at",
        "auth_sessions",
        ["absolute_expires_at"],
    )
    op.create_index("ix_auth_sessions_revoked_at", "auth_sessions", ["revoked_at"])
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])

    op.create_table(
        "auth_refresh_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "issued_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["replaced_by_id"],
            ["auth_refresh_credentials.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["auth_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_auth_refresh_credentials_expires_at",
        "auth_refresh_credentials",
        ["expires_at"],
    )
    op.create_index(
        "ix_auth_refresh_credentials_session_id",
        "auth_refresh_credentials",
        ["session_id"],
    )
    op.create_index(
        "ix_auth_refresh_credentials_token_hash",
        "auth_refresh_credentials",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_auth_refresh_session_issued",
        "auth_refresh_credentials",
        ["session_id", "issued_at"],
    )


def downgrade() -> None:
    _assert_downgrade_cannot_reactivate_refresh_credentials()
    op.drop_index(
        "ix_auth_refresh_session_issued",
        table_name="auth_refresh_credentials",
    )
    op.drop_index(
        "ix_auth_refresh_credentials_token_hash",
        table_name="auth_refresh_credentials",
    )
    op.drop_index(
        "ix_auth_refresh_credentials_session_id",
        table_name="auth_refresh_credentials",
    )
    op.drop_index(
        "ix_auth_refresh_credentials_expires_at",
        table_name="auth_refresh_credentials",
    )
    op.drop_table("auth_refresh_credentials")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_revoked_at", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_absolute_expires_at", table_name="auth_sessions")
    op.drop_table("auth_sessions")
