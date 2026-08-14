"""Add database-backed strong-auth assurance to durable sessions.

The columns are nullable so application instances can deploy before any factor
enrollment or challenge traffic is enabled. A session is never elevated by the
migration. Production policy separately fails closed until the enforcement
gate is enabled.

Revision ID: 0057_admin_session_assurance
Revises: 0056_persistent_auth_sessions
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0057_admin_session_assurance"
down_revision = "0056_persistent_auth_sessions"
branch_labels = None
depends_on = None


def _assert_downgrade_has_no_assurance_state() -> None:
    elevated = op.get_bind().execute(
        sa.text(
            """
            SELECT id
            FROM auth_sessions
            WHERE strong_auth_method IS NOT NULL
               OR strong_auth_verified_at IS NOT NULL
               OR strong_auth_expires_at IS NOT NULL
            LIMIT 1
            """
        )
    ).first()
    if elevated is not None:
        raise RuntimeError(
            "Administrator assurance downgrade refused: removing used strong-auth "
            "state would let an old binary bypass the elevation boundary. Revoke "
            "every affected session and verify global administrator logout before "
            "retrying migration 0057."
        )


def upgrade() -> None:
    op.add_column(
        "auth_sessions",
        sa.Column("strong_auth_method", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "auth_sessions",
        sa.Column("strong_auth_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "auth_sessions",
        sa.Column("strong_auth_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_auth_sessions_strong_auth_complete",
        "auth_sessions",
        "(strong_auth_method IS NULL AND strong_auth_verified_at IS NULL "
        "AND strong_auth_expires_at IS NULL) OR "
        "(strong_auth_method IN ('recovery_code', 'totp', 'webauthn') "
        "AND strong_auth_verified_at IS NOT NULL "
        "AND strong_auth_expires_at IS NOT NULL "
        "AND strong_auth_expires_at > strong_auth_verified_at)",
    )


def downgrade() -> None:
    _assert_downgrade_has_no_assurance_state()
    op.drop_constraint(
        "ck_auth_sessions_strong_auth_complete",
        "auth_sessions",
        type_="check",
    )
    op.drop_column("auth_sessions", "strong_auth_expires_at")
    op.drop_column("auth_sessions", "strong_auth_verified_at")
    op.drop_column("auth_sessions", "strong_auth_method")
