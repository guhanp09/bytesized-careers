"""Add credential-free OAuth connection audit history.

Revision ID: 0059_oauth_connection_events
Revises: 0058_strong_auth_totp
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0059_oauth_connection_events"
down_revision = "0058_strong_auth_totp"
branch_labels = None
depends_on = None


def _assert_no_connection_history() -> None:
    row = op.get_bind().execute(
        sa.text("SELECT id FROM oauth_connection_events LIMIT 1")
    ).first()
    if row is not None:
        raise RuntimeError(
            "OAuth connection-event downgrade refused: dropping append-only "
            "authorization or revocation history would destroy security audit data."
        )


def upgrade() -> None:
    op.create_table(
        "oauth_connection_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("oauth_account_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("provider_revocation_status", sa.String(length=32), nullable=True),
        sa.Column(
            "channel_links_removed",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "channel_links_removed >= 0",
            name="ck_oauth_connection_events_channel_links_removed",
        ),
        sa.ForeignKeyConstraint(
            ["oauth_account_id"], ["oauth_accounts.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_oauth_connection_events_action",
        "oauth_connection_events",
        ["action"],
    )
    op.create_index(
        "ix_oauth_connection_events_created_at",
        "oauth_connection_events",
        ["created_at"],
    )
    op.create_index(
        "ix_oauth_connection_events_oauth_account_id",
        "oauth_connection_events",
        ["oauth_account_id"],
    )
    op.create_index(
        "ix_oauth_connection_events_user_created",
        "oauth_connection_events",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_oauth_connection_events_user_id",
        "oauth_connection_events",
        ["user_id"],
    )


def downgrade() -> None:
    _assert_no_connection_history()
    op.drop_index(
        "ix_oauth_connection_events_user_id",
        table_name="oauth_connection_events",
    )
    op.drop_index(
        "ix_oauth_connection_events_user_created",
        table_name="oauth_connection_events",
    )
    op.drop_index(
        "ix_oauth_connection_events_oauth_account_id",
        table_name="oauth_connection_events",
    )
    op.drop_index(
        "ix_oauth_connection_events_created_at",
        table_name="oauth_connection_events",
    )
    op.drop_index(
        "ix_oauth_connection_events_action",
        table_name="oauth_connection_events",
    )
    op.drop_table("oauth_connection_events")
