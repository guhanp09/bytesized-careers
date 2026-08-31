"""Record when the managing side first deliberately reviewed an interaction.

Additive and nullable. NULL means "never deliberately opened", which is exactly
what the New queue needs to stay truthful — existing rows correctly read as
unreviewed until someone opens them.

Revision ID: 0046_interaction_review_started_at
Revises: 0045_interaction_user_preferences
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0046_interaction_review_started_at"
down_revision = "0045_interaction_user_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("job_applications", "talent_interests"):
        op.add_column(
            table,
            sa.Column("review_started_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    """Drop the columns.

    Lossy but safe: nothing references them and no lifecycle state depends on
    them. After a downgrade every record reads as never-reviewed again, so the
    New queue over-reports rather than hiding anything.
    """
    for table in ("job_applications", "talent_interests"):
        op.drop_column(table, "review_started_at")
