"""profile username privacy and portfolio

Revision ID: 0003_profile_username
Revises: 77462c28c80d
Create Date: 2026-02-16 08:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_profile_username"
down_revision: str | None = "77462c28c80d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64)")

    op.add_column("users", sa.Column("username", sa.String(length=20), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "username_change_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column("users", sa.Column("username_last_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("display_name", sa.String(length=255), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "avatar_mode",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'generic'"),
        ),
    )
    op.add_column("users", sa.Column("avatar_url", sa.String(length=1024), nullable=True))
    op.add_column("users", sa.Column("avatar_youtube_channel_id", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "skills",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "public_links",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column("users", sa.Column("availability", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("location", sa.String(length=255), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "privacy_settings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text(
                "jsonb_build_object('show_bio', true, 'show_links', true, 'show_skills', true, 'show_location', false, 'show_availability', false, 'show_youtube_badge', true)"
            ),
        ),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "username_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("old_username", sa.String(length=20), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("old_username"),
    )
    op.create_index("ix_username_history_old_username", "username_history", ["old_username"], unique=True)
    op.create_index("ix_username_history_user_id", "username_history", ["user_id"])

    op.create_table(
        "portfolio_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "links",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'now'")),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_portfolio_items_user_id", "portfolio_items", ["user_id"])
    op.create_index("ix_portfolio_items_status", "portfolio_items", ["status"])
    op.create_index("ix_portfolio_items_is_public", "portfolio_items", ["is_public"])


def downgrade() -> None:
    op.drop_index("ix_portfolio_items_is_public", table_name="portfolio_items")
    op.drop_index("ix_portfolio_items_status", table_name="portfolio_items")
    op.drop_index("ix_portfolio_items_user_id", table_name="portfolio_items")
    op.drop_table("portfolio_items")

    op.drop_index("ix_username_history_user_id", table_name="username_history")
    op.drop_index("ix_username_history_old_username", table_name="username_history")
    op.drop_table("username_history")

    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "privacy_settings")
    op.drop_column("users", "location")
    op.drop_column("users", "availability")
    op.drop_column("users", "public_links")
    op.drop_column("users", "skills")
    op.drop_column("users", "bio")
    op.drop_column("users", "avatar_youtube_channel_id")
    op.drop_column("users", "avatar_url")
    op.drop_column("users", "avatar_mode")
    op.drop_column("users", "display_name")
    op.drop_column("users", "username_last_changed_at")
    op.drop_column("users", "username_change_count")
    op.drop_column("users", "username")
