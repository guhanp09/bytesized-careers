"""Versioned records of who accepted which legal document.

Revision ID: 0065_legal_acceptances
Revises: 0064_job_import_quota_counters

A new table, so nothing existing changes shape and deploy order does not matter.

One row per (user, document, version) rather than a flag on the user. A flag
answers "did they accept" and the question that actually gets asked is "what did
they accept, and when" — which a boolean overwritten at the next version change
cannot answer at all.

The unique constraint makes a repeated accept idempotent. A retry from a client
must record the same agreement once, not suggest two separate ones.

No index on `version` alone: nothing looks up acceptances by version without a
user, and an index that is never used is a write cost with no reader.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0065_legal_acceptances"
down_revision = "0064_job_import_quota_counters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "legal_acceptances",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("document_key", sa.String(length=64), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column(
            "accepted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "user_id", "document_key", "version", name="uq_legal_acceptance_user_document_version"
        ),
    )
    op.create_index("ix_legal_acceptances_user_id", "legal_acceptances", ["user_id"])
    op.create_index("ix_legal_acceptances_document_key", "legal_acceptances", ["document_key"])


def downgrade() -> None:
    op.drop_index("ix_legal_acceptances_document_key", table_name="legal_acceptances")
    op.drop_index("ix_legal_acceptances_user_id", table_name="legal_acceptances")
    op.drop_table("legal_acceptances")
