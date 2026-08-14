"""Enforce one account per OAuth provider for each CreatorJobs user.

The verified Google exchange already rejects a second Google subject for one
user in sequential requests. Without a matching database invariant, two
transactions could both pass that check and attach different Google subjects
to the same user. The existing provider/subject constraint protects the inverse
direction; this migration closes the remaining race.

Duplicate rows are security-sensitive and cannot be merged automatically. The
preflight fails with an actionable error so an operator can investigate the
links instead of silently choosing an identity.

Revision ID: 0054_oauth_link_uniqueness
Revises: 0053_brand_about_enrichment_state
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0054_oauth_link_uniqueness"
down_revision = "0053_brand_about_enrichment_state"
branch_labels = None
depends_on = None


def _assert_no_ambiguous_links() -> None:
    duplicate = op.get_bind().execute(
        sa.text(
            """
            SELECT user_id, provider, COUNT(*) AS link_count
            FROM oauth_accounts
            GROUP BY user_id, provider
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    ).first()
    if duplicate is not None:
        raise RuntimeError(
            "OAuth link uniqueness migration refused ambiguous data: a user has "
            "multiple accounts for one provider. Investigate and resolve those "
            "links before retrying migration 0054."
        )


def upgrade() -> None:
    _assert_no_ambiguous_links()
    with op.batch_alter_table("oauth_accounts") as batch_op:
        batch_op.create_unique_constraint(
            "uq_oauth_user_provider",
            ["user_id", "provider"],
        )


def downgrade() -> None:
    with op.batch_alter_table("oauth_accounts") as batch_op:
        batch_op.drop_constraint("uq_oauth_user_provider", type_="unique")
