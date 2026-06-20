"""notification actor/metadata/priority + email outbox

Revision ID: 0022_notifications_and_email_outbox
Revises: 0021_hiring_identity_verification_attempts
Create Date: 2026-06-16 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0022_notifications_and_email_outbox"
down_revision = "0021_hiring_identity_verification_attempts"
branch_labels = None
depends_on = None

json_obj_type = sa.JSON().with_variant(JSONB, "postgresql")


def upgrade() -> None:
    bind = op.get_bind()
    json_default = sa.text("'{}'::jsonb") if bind.dialect.name == "postgresql" else sa.text("'{}'")

    op.add_column(
        "notifications",
        sa.Column("actor_user_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.create_index(
        op.f("ix_notifications_actor_user_id"), "notifications", ["actor_user_id"], unique=False
    )
    op.create_foreign_key(
        "fk_notifications_actor_user_id_users",
        "notifications",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "notifications",
        sa.Column("priority", sa.String(length=16), server_default="normal", nullable=False),
    )
    op.add_column(
        "notifications",
        sa.Column("metadata_json", json_obj_type, nullable=False, server_default=json_default),
    )

    op.create_table(
        "email_outbox",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("to_email", sa.String(length=320), nullable=False, index=True),
        sa.Column("event_key", sa.String(length=64), nullable=False, index=True),
        sa.Column("template_key", sa.String(length=64), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("preview", sa.String(length=600), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("cta_url", sa.String(length=1024), nullable=True),
        sa.Column("metadata_json", json_obj_type, nullable=False, server_default=json_default),
        sa.Column("status", sa.String(length=16), server_default="queued", nullable=False, index=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("email_outbox")
    op.drop_column("notifications", "metadata_json")
    op.drop_column("notifications", "priority")
    op.drop_constraint("fk_notifications_actor_user_id_users", "notifications", type_="foreignkey")
    op.drop_index(op.f("ix_notifications_actor_user_id"), table_name="notifications")
    op.drop_column("notifications", "actor_user_id")
