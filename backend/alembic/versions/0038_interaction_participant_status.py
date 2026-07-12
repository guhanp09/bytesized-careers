"""Separate private pipeline status from participant-visible relationship state.

Revision ID: 0038_interaction_participant_status
Revises: 0037_user_blocks
"""

from alembic import op
import sqlalchemy as sa


revision = "0038_interaction_participant_status"
down_revision = "0037_user_blocks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_applications",
        sa.Column("participant_status", sa.String(length=32), nullable=False, server_default="new"),
    )
    op.create_index(
        "ix_job_applications_participant_status",
        "job_applications",
        ["participant_status"],
        unique=False,
    )
    op.execute(
        """
        UPDATE job_applications
        SET participant_status = status
        WHERE status IN ('interviewing', 'hired', 'rejected', 'withdrawn')
        """
    )

    op.add_column(
        "talent_interests",
        sa.Column("participant_status", sa.String(length=32), nullable=False, server_default="new"),
    )
    op.create_index(
        "ix_talent_interests_participant_status",
        "talent_interests",
        ["participant_status"],
        unique=False,
    )
    op.execute(
        """
        UPDATE talent_interests
        SET participant_status = status
        WHERE status IN ('contacted', 'declined', 'withdrawn')
        """
    )


def downgrade() -> None:
    op.drop_index("ix_talent_interests_participant_status", table_name="talent_interests")
    op.drop_column("talent_interests", "participant_status")
    op.drop_index("ix_job_applications_participant_status", table_name="job_applications")
    op.drop_column("job_applications", "participant_status")
