"""Give the email outbox the state a durable worker needs.

Revision ID: 0060_email_outbox_lease
Revises: 0059_oauth_connection_events

The outbox already records what the platform intends to send, and `dedupe_key`
already prevents the same intent being enqueued twice. What it cannot express is
delivery *in progress*: which worker owns a row, when that ownership lapses, how
many provider attempts a row has survived, when it may next be tried, and what
the provider called the message once it accepted it.

Expand-only on purpose. Every column is nullable or carries a server default, so
rows written before this migration stay valid and readable, and nothing about
delivery behaviour changes merely by applying it — the worker that uses these
columns arrives in a later slice. That ordering is deliberate: schema first,
consumers second, so neither half depends on the other being deployed.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0060_email_outbox_lease"
down_revision = "0059_oauth_connection_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Who holds the row and until when. Two columns rather than one because
    # "leased" and "leased by whom" answer different questions: expiry decides
    # reclaimability, identity makes a stuck worker traceable.
    op.add_column("email_outbox", sa.Column("leased_by", sa.String(length=128), nullable=True))
    op.add_column(
        "email_outbox", sa.Column("leased_until", sa.DateTime(timezone=True), nullable=True)
    )

    # Attempts are provider attempts, not enqueues. A retry must never create a
    # second row, so the count lives with the intent.
    op.add_column(
        "email_outbox",
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "email_outbox",
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Recorded on success so a later bounce or complaint webhook can be matched
    # back to the message that caused it (EMAIL-004).
    op.add_column(
        "email_outbox",
        sa.Column("provider_message_id", sa.String(length=255), nullable=True),
    )

    # The claim query filters on status and orders by eligibility, so those two
    # together are what needs to be cheap. `status` is already indexed alone;
    # this covers the "what may I take next" lookup.
    op.create_index(
        "ix_email_outbox_claimable",
        "email_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_index(
        "ix_email_outbox_leased_until", "email_outbox", ["leased_until"], unique=False
    )


def downgrade() -> None:
    # Safe to reverse: these columns carry delivery bookkeeping, not the record
    # of what was sent. `status`, `processed_at` and `error` keep that, so a
    # downgrade loses retry scheduling rather than any evidence of an email
    # having gone out.
    op.drop_index("ix_email_outbox_leased_until", table_name="email_outbox")
    op.drop_index("ix_email_outbox_claimable", table_name="email_outbox")
    op.drop_column("email_outbox", "provider_message_id")
    op.drop_column("email_outbox", "next_attempt_at")
    op.drop_column("email_outbox", "attempts")
    op.drop_column("email_outbox", "leased_until")
    op.drop_column("email_outbox", "leased_by")
