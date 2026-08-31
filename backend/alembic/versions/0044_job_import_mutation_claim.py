"""Add a transaction-scoped claim for job-import mutations.

Revision ID: 0044_job_import_mutation_claim
Revises: 0043_job_import_readiness
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0044_job_import_mutation_claim"
down_revision = "0043_job_import_readiness"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_import_drafts",
        sa.Column("mutation_claim_token", sa.Uuid(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("job_import_drafts", "mutation_claim_token")
