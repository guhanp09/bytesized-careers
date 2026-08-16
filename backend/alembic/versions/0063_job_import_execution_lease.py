"""Durable execution state for a job-import extraction attempt.

Revision ID: 0063_job_import_execution_lease
Revises: 0062_email_suppressions

Expand only: four nullable/defaulted columns and two indexes. No data statement,
no column dropped, no type changed — so schema and code may deploy in either
order, and a rollback of the code leaves a database that still works.

`processing_status = 'processing'` could not distinguish an attempt running now
from one whose process died, so a stranded draft polled forever and nothing
could retry it. A lease answers that on a clock, because a crashed process
announces nothing.

`processing_attempts` is promoted out of provider_metadata JSON deliberately.
A bound that lives in a JSON blob cannot be enforced by a query, and the rows
that need finding — the stranded ones — are exactly the ones nobody is loading.
Existing drafts start at 0, which is correct: an unbounded past is not evidence
of attempts already spent, and starting them at their JSON value would require a
data migration over a column no consumer reads yet.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0063_job_import_execution_lease"
down_revision = "0062_email_suppressions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_import_drafts",
        sa.Column("processing_lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "job_import_drafts",
        sa.Column("processing_worker_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "job_import_drafts",
        sa.Column(
            "processing_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "job_import_drafts",
        sa.Column("processing_next_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )
    # The claim query orders and filters on the lease, and the stranded-draft
    # sweep reads nothing else.
    op.create_index(
        "ix_job_import_drafts_processing_lease_expires_at",
        "job_import_drafts",
        ["processing_lease_expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_job_import_drafts_processing_next_attempt_at",
        "job_import_drafts",
        ["processing_next_attempt_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_job_import_drafts_processing_next_attempt_at", table_name="job_import_drafts"
    )
    op.drop_index(
        "ix_job_import_drafts_processing_lease_expires_at", table_name="job_import_drafts"
    )
    op.drop_column("job_import_drafts", "processing_next_attempt_at")
    op.drop_column("job_import_drafts", "processing_attempts")
    op.drop_column("job_import_drafts", "processing_worker_id")
    op.drop_column("job_import_drafts", "processing_lease_expires_at")
