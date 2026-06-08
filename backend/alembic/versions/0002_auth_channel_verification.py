"""auth and channel verification tables

Revision ID: 0002_auth_channel_verification
Revises: 0001_initial_jobs
Create Date: 2026-02-16 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_auth_channel_verification"
down_revision: str | None = "0001_initial_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "oauth_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("provider_account_id", sa.String(length=255), nullable=False),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.BigInteger(), nullable=True),
        sa.Column("scope", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_account_id", name="uq_oauth_provider_account_id"),
    )
    op.create_index("ix_oauth_accounts_provider", "oauth_accounts", ["provider"])
    op.create_index("ix_oauth_accounts_provider_account_id", "oauth_accounts", ["provider_account_id"])
    op.create_index("ix_oauth_accounts_user_id", "oauth_accounts", ["user_id"])

    op.create_table(
        "youtube_channels",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("thumbnail_url", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel_id"),
    )
    op.create_index("ix_youtube_channels_channel_id", "youtube_channels", ["channel_id"])

    op.create_table(
        "user_youtube_channels",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("youtube_channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["youtube_channel_id"], ["youtube_channels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "youtube_channel_id"),
    )

    op.create_table(
        "email_verification_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_email_verification_tokens_token", "email_verification_tokens", ["token"])
    op.create_index("ix_email_verification_tokens_user_id", "email_verification_tokens", ["user_id"])

    op.add_column("jobs", sa.Column("posted_platform", sa.String(length=32), nullable=True))
    op.add_column("jobs", sa.Column("posted_youtube_channel_id", sa.String(length=255), nullable=True))
    op.add_column("jobs", sa.Column("posted_by_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_jobs_posted_platform", "jobs", ["posted_platform"])
    op.create_index("ix_jobs_posted_youtube_channel_id", "jobs", ["posted_youtube_channel_id"])
    op.create_index("ix_jobs_posted_by_user_id", "jobs", ["posted_by_user_id"])
    op.create_foreign_key(
        "fk_jobs_posted_by_user_id_users",
        "jobs",
        "users",
        ["posted_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_jobs_posted_by_user_id_users", "jobs", type_="foreignkey")
    op.drop_index("ix_jobs_posted_by_user_id", table_name="jobs")
    op.drop_index("ix_jobs_posted_youtube_channel_id", table_name="jobs")
    op.drop_index("ix_jobs_posted_platform", table_name="jobs")
    op.drop_column("jobs", "posted_by_user_id")
    op.drop_column("jobs", "posted_youtube_channel_id")
    op.drop_column("jobs", "posted_platform")

    op.drop_index("ix_email_verification_tokens_user_id", table_name="email_verification_tokens")
    op.drop_index("ix_email_verification_tokens_token", table_name="email_verification_tokens")
    op.drop_table("email_verification_tokens")

    op.drop_table("user_youtube_channels")

    op.drop_index("ix_youtube_channels_channel_id", table_name="youtube_channels")
    op.drop_table("youtube_channels")

    op.drop_index("ix_oauth_accounts_user_id", table_name="oauth_accounts")
    op.drop_index("ix_oauth_accounts_provider_account_id", table_name="oauth_accounts")
    op.drop_index("ix_oauth_accounts_provider", table_name="oauth_accounts")
    op.drop_table("oauth_accounts")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
