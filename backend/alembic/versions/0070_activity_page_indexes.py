"""Indexes for deterministic activity-summary keyset pagination.

Revision ID: 0070_activity_page_indexes
Revises: 0069_support_tickets

Each branch of the activity feed first constrains one viewer column and then
walks ``updated_at, id`` in reverse order.  The existing single-column viewer
indexes find the account but still sort its complete history; these composites
make the bounded page shape match the index shape.
"""

from __future__ import annotations

from alembic import op

revision = "0070_activity_page_indexes"
down_revision = "0069_support_tickets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_job_applications_applicant_activity",
        "job_applications",
        ["applicant_user_id", "updated_at", "id"],
    )
    op.create_index(
        "ix_job_applications_owner_activity",
        "job_applications",
        ["job_owner_user_id", "updated_at", "id"],
    )
    op.create_index(
        "ix_talent_interests_owner_activity",
        "talent_interests",
        ["owner_user_id", "updated_at", "id"],
    )
    op.create_index(
        "ix_talent_interests_recruiter_activity",
        "talent_interests",
        ["recruiter_user_id", "updated_at", "id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_talent_interests_recruiter_activity", table_name="talent_interests"
    )
    op.drop_index("ix_talent_interests_owner_activity", table_name="talent_interests")
    op.drop_index("ix_job_applications_owner_activity", table_name="job_applications")
    op.drop_index(
        "ix_job_applications_applicant_activity", table_name="job_applications"
    )
