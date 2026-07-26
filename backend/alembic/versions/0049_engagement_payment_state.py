"""Additive payment state on engagements.

Payment is its own plane. It is recorded on the engagement — the work
relationship — rather than on the application, because it is a property of the
work and not of the hiring decision. Nothing in the application lifecycle reads
it, no transition rule consults it, and no stage becomes reachable or
unreachable because a value is present.

Every column here is nullable with no default, so this migration asserts
nothing about any existing engagement: a row that predates it keeps meaning
exactly what it meant before, which is that nothing has been said about
payment. There is no payment processing behind these columns.

Revision ID: 0049_engagement_payment_state
Revises: 0048_interaction_interviews
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0049_engagement_payment_state"
down_revision = "0048_interaction_interviews"
branch_labels = None
depends_on = None


PAYMENT_STATES = (
    "not_applicable",
    "setup_pending",
    "funding_pending",
    "funded",
    "work_in_progress",
    "release_requested",
    "released",
    "disputed",
    "refunded",
    "expired",
)

_CHECK = "payment_state IS NULL OR payment_state IN ({})".format(
    ", ".join(f"'{state}'" for state in PAYMENT_STATES)
)


def upgrade() -> None:
    op.add_column("engagements", sa.Column("payment_state", sa.String(length=32), nullable=True))
    op.add_column(
        "engagements",
        sa.Column("payment_state_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("engagements", sa.Column("payment_note", sa.Text(), nullable=True))
    op.create_index(
        "ix_engagements_payment_state", "engagements", ["payment_state"], unique=False
    )
    # NULL passes the constraint, so no existing row needs backfilling before it
    # can be applied.
    op.create_check_constraint("ck_engagement_payment_state", "engagements", _CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_engagement_payment_state", "engagements", type_="check")
    op.drop_index("ix_engagements_payment_state", table_name="engagements")
    op.drop_column("engagements", "payment_note")
    op.drop_column("engagements", "payment_state_updated_at")
    op.drop_column("engagements", "payment_state")
