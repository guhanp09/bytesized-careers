"""Give a deletion request its own hiding state.

Revision ID: 0068_account_deletion_hidden_at
Revises: 0067_account_deletion_requests

Expand only: one nullable column. No data statement, so schema and code may
deploy in either order.

The deletion request previously borrowed `suspended_at` to hide an account, and
two independent lifecycles sharing one column produced a real escape:
`admin_suspend_user` refuses with 409 when `suspended_at` is already set, so an
account that had requested deletion could not be suspended by an administrator
at all. Requesting deletion was a way to become un-moderatable.

One column, one meaning. `suspended_at` is an administrative decision about an
account; `deletion_hidden_at` is the account holder's own request taking effect.
Either hides the account, neither cancels the other.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0068_account_deletion_hidden_at"
down_revision = "0067_account_deletion_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("deletion_hidden_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_deletion_hidden_at", "users", ["deletion_hidden_at"])


def downgrade() -> None:
    op.drop_index("ix_users_deletion_hidden_at", table_name="users")
    op.drop_column("users", "deletion_hidden_at")
