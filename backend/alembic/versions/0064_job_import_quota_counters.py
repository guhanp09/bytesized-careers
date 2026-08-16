"""Per-user import quota counters.

Revision ID: 0064_job_import_quota_counters
Revises: 0063_job_import_execution_lease

A new table, so nothing existing changes shape and deploy order does not matter.

One row per user rather than a table of usage events. The question this answers —
"may this person start another import right now" — must have a single answer that
two simultaneous requests cannot both read as yes, and counting rows in an events
table is a check followed by an act. A counter can be consumed and checked in one
statement.

The window start is stored rather than derived so a reset is a fact on the row
instead of arithmetic every reader has to agree about.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0064_job_import_quota_counters"
down_revision = "0063_job_import_execution_lease"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_import_quota_counters",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "window_started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("user_id"),
        # CASCADE: the counter describes a person's recent activity and means
        # nothing once the account is gone.
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("job_import_quota_counters")
