"""Add private URL retrieval metadata to job-import sources.

Revision ID: 0050_job_import_url_retrieval
Revises: 0049_engagement_payment_state
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0050_job_import_url_retrieval"
down_revision = "0049_engagement_payment_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_import_sources",
        sa.Column("final_source_url", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "job_import_sources",
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "job_import_sources",
        sa.Column("retrieval_metadata", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("job_import_sources", "retrieval_metadata")
    op.drop_column("job_import_sources", "retrieved_at")
    op.drop_column("job_import_sources", "final_source_url")
