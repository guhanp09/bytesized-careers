"""Add recruiter prefill answers to job-import drafts.

Recruiter answers collected while provider extraction is still running need a
durable home that is not a ``job_import_fields`` row: ``record_extraction_result``
refuses to write machine output when any field row already exists, and that
immutability rule is worth keeping. Storing early answers on the draft keeps the
recruiter's decision authoritative across refresh without weakening it.

Revision ID: 0051_job_import_recruiter_prefill
Revises: 0050_job_import_url_retrieval
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0051_job_import_recruiter_prefill"
down_revision = "0050_job_import_url_retrieval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_import_drafts",
        sa.Column(
            "recruiter_prefill",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.add_column(
        "job_import_drafts",
        sa.Column("recruiter_prefill_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("job_import_drafts", "recruiter_prefill_updated_at")
    op.drop_column("job_import_drafts", "recruiter_prefill")
