"""Durable checkpoint state for the conversational import orchestration.

The assistant must be able to stop mid-preparation, ask one question, and wait
indefinitely without consuming provider tokens — surviving refresh, tab close and
backend restart. That needs the pause itself to be durable, not React state.

These columns are additive and deliberately do not touch ``processing_status`` or
its check constraint: the existing lifecycle keeps its exact meaning, and every
reader that predates this migration keeps working. The conversation state is a
second, narrower axis layered on top.

Revision ID: 0052_job_import_conversation_checkpoint
Revises: 0051_job_import_recruiter_prefill
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0052_job_import_conversation_checkpoint"
down_revision = "0051_job_import_recruiter_prefill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_import_drafts",
        sa.Column("conversation_state", sa.String(length=32), nullable=True),
    )
    # The single active question, or NULL when the assistant is not waiting.
    op.add_column(
        "job_import_drafts",
        sa.Column("active_question", sa.JSON(), nullable=True),
    )
    # Bumped on every accepted recruiter answer. A provider result carrying an
    # older version is stale and must not overwrite what the recruiter has said.
    op.add_column(
        "job_import_drafts",
        sa.Column(
            "recruiter_context_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    # Bounded so a pathological loop cannot bill indefinitely.
    op.add_column(
        "job_import_drafts",
        sa.Column(
            "continuation_count", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "job_import_drafts",
        sa.Column("last_completed_stage", sa.String(length=48), nullable=True),
    )
    # Optional suggestions the recruiter has waved off, so they do not return.
    op.add_column(
        "job_import_drafts",
        sa.Column(
            "dismissed_suggestions",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("job_import_drafts", "dismissed_suggestions")
    op.drop_column("job_import_drafts", "last_completed_stage")
    op.drop_column("job_import_drafts", "continuation_count")
    op.drop_column("job_import_drafts", "recruiter_context_version")
    op.drop_column("job_import_drafts", "active_question")
    op.drop_column("job_import_drafts", "conversation_state")
