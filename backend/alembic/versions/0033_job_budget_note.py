"""job budget note

Revision ID: 0033_job_budget_note
Revises: 0032_admin_panel, 0032_talent_first_message_custom_instruction
Create Date: 2026-07-06 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0033_job_budget_note"
down_revision = ("0032_admin_panel", "0032_talent_first_message_custom_instruction")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("budget_note", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "budget_note")
