"""first-message requirements + structured answers

Revision ID: 0022_first_message_requirements
Revises: 0021_hiring_identity_verification_attempts
Create Date: 2026-06-21 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0022_first_message_requirements"
down_revision = "0021_hiring_identity_verification_attempts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column(
            "application_requirements",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "talent_listings",
        sa.Column(
            "first_message_requirements",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "job_applications",
        sa.Column(
            "first_message_answers",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "talent_interests",
        sa.Column(
            "first_message_answers",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("talent_interests", "first_message_answers")
    op.drop_column("job_applications", "first_message_answers")
    op.drop_column("talent_listings", "first_message_requirements")
    op.drop_column("jobs", "application_requirements")
