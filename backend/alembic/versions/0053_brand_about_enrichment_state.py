"""Persist brand About enrichment state on the job.

Four nullable columns, no backfill, no default beyond NULL. Every existing row
reads as "never attempted", which is exactly what it is, so the migration is
backwards compatible in both directions.

They exist because the trigger has to answer four questions before doing
anything, and answering them from memory would make a refresh, a second tab or a
redeploy repeat the work:

``brand_about_status``        has this been tried, and how did it end
``brand_about_identity_id``   which brand it was tried for
``brand_about_attempt_id``    a compare-and-set claim, so two callers become one
``brand_about_attempted_at``  when, so a lost attempt stops being "in progress"

The last two mirror the mechanism job-import processing already uses. Reusing it
means an enrichment interrupted by a restart becomes eligible again instead of
leaving a job permanently mid-flight.

Revision ID: 0053_brand_about_enrichment_state
Revises: 0052_job_import_conversation_checkpoint
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "0053_brand_about_enrichment_state"
down_revision = "0052_job_import_conversation_checkpoint"
branch_labels = None
depends_on = None

_UUID = sa.Uuid(as_uuid=True).with_variant(UUID(as_uuid=True), "postgresql")


def upgrade() -> None:
    op.add_column("jobs", sa.Column("brand_about_status", sa.String(length=40), nullable=True))
    op.add_column("jobs", sa.Column("brand_about_identity_id", _UUID, nullable=True))
    op.add_column("jobs", sa.Column("brand_about_attempt_id", _UUID, nullable=True))
    op.add_column(
        "jobs",
        sa.Column("brand_about_attempted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("jobs", "brand_about_attempted_at")
    op.drop_column("jobs", "brand_about_attempt_id")
    op.drop_column("jobs", "brand_about_identity_id")
    op.drop_column("jobs", "brand_about_status")
