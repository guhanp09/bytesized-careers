"""talent listing first message custom instruction

Revision ID: 0032_talent_first_message_custom_instruction
Revises: 0031_manager_notes
Create Date: 2026-07-05 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0032_talent_first_message_custom_instruction"
down_revision = "0031_manager_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("talent_listings", sa.Column("first_message_custom_instruction", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("talent_listings", "first_message_custom_instruction")
