"""applicant management: private manager notes

Adds `manager_note` to job_applications and talent_interests — a private
annotation written by whoever *manages* the received item (the job owner for
applications, the talent-listing owner for hiring requests). It is never
exposed to the sender; sender-facing endpoints blank it before returning.

Revision ID: 0031_manager_notes
Revises: 0030_portfolio_rich_detail_fields
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0031_manager_notes"
down_revision = "0030_portfolio_rich_detail_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_applications", sa.Column("manager_note", sa.Text(), nullable=True))
    op.add_column("talent_interests", sa.Column("manager_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("talent_interests", "manager_note")
    op.drop_column("job_applications", "manager_note")
