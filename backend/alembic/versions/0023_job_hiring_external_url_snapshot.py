"""job hiring external url snapshot

Revision ID: 0023_job_hiring_external_url_snapshot
Revises: 0022_notifications_and_email_outbox
Create Date: 2026-06-17 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0023_job_hiring_external_url_snapshot"
down_revision = "0022_notifications_and_email_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("hiring_external_url_snapshot", sa.String(length=1024), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("jobs", "hiring_external_url_snapshot")
