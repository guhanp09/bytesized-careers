"""initial jobs table

Revision ID: 0001_initial_jobs
Revises:
Create Date: 2026-02-15 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial_jobs"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False, server_default="Editing"),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("budget_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("budget_currency", sa.String(length=3), nullable=False, server_default="INR"),
        sa.Column("experience_level", sa.String(length=64), nullable=True),
        sa.Column("platforms", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("start_timeframe", sa.String(length=32), nullable=True),
        sa.Column("about_channel", sa.Text(), nullable=True),
        sa.Column("responsibilities", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("requirements", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("how_to_apply", sa.Text(), nullable=True),
        sa.Column("reference_videos", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("youtube_channel_id", sa.String(length=255), nullable=True),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("channel_name", sa.String(length=255), nullable=True),
        sa.Column("channel_logo_url", sa.String(length=1024), nullable=True),
        sa.Column("channel_subscribers", sa.Integer(), nullable=True),
        sa.Column("channel_profile_slug", sa.String(length=255), nullable=True),
        sa.Column("posted_by_agency", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("agency_profile_slug", sa.String(length=255), nullable=True),
        sa.Column("views", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("applicants", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("response_rate", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_index("ix_jobs_title", "jobs", ["title"])
    op.create_index("ix_jobs_location", "jobs", ["location"])
    op.create_index("ix_jobs_start_timeframe", "jobs", ["start_timeframe"])
    op.create_index("ix_jobs_status", "jobs", ["status"])
    op.create_index("ix_jobs_created_at", "jobs", ["created_at"])
    op.create_index("ix_jobs_deleted_at", "jobs", ["deleted_at"])
    op.create_index("ix_jobs_channel_profile_slug", "jobs", ["channel_profile_slug"])


def downgrade() -> None:
    op.drop_index("ix_jobs_channel_profile_slug", table_name="jobs")
    op.drop_index("ix_jobs_deleted_at", table_name="jobs")
    op.drop_index("ix_jobs_created_at", table_name="jobs")
    op.drop_index("ix_jobs_status", table_name="jobs")
    op.drop_index("ix_jobs_start_timeframe", table_name="jobs")
    op.drop_index("ix_jobs_location", table_name="jobs")
    op.drop_index("ix_jobs_title", table_name="jobs")
    op.drop_table("jobs")
