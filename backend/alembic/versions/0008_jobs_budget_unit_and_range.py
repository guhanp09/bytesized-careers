"""add job budget unit and range

Revision ID: 0008_jobs_budget_unit_and_range
Revises: 0007_roles_popularity_score
Create Date: 2026-05-06 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008_jobs_budget_unit_and_range"
down_revision: str | None = "0007_roles_popularity_score"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("budget_max", sa.Numeric(12, 2), nullable=True))
    op.add_column(
        "jobs",
        sa.Column(
            "budget_unit",
            sa.String(length=32),
            nullable=False,
            server_default="per project",
        ),
    )


def downgrade() -> None:
    op.drop_column("jobs", "budget_unit")
    op.drop_column("jobs", "budget_max")
