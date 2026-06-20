"""hiring identity verification attempts

Revision ID: 0021_hiring_identity_verification_attempts
Revises: 0020_user_banner_url
Create Date: 2026-06-13 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0021_hiring_identity_verification_attempts"
down_revision = "0020_user_banner_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hiring_identities",
        sa.Column("verification_code_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "hiring_identities",
        sa.Column("verification_attempt_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "hiring_identities",
        sa.Column("verification_last_checked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "hiring_identities",
        sa.Column("verification_last_error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("hiring_identities", "verification_last_error")
    op.drop_column("hiring_identities", "verification_last_checked_at")
    op.drop_column("hiring_identities", "verification_attempt_count")
    op.drop_column("hiring_identities", "verification_code_expires_at")
