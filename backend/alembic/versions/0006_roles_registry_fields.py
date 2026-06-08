"""add role registry fields to roles

Revision ID: 0006_roles_registry_fields
Revises: 0005_creator_profile_phase1
Create Date: 2026-02-21 00:00:00.000000
"""

from __future__ import annotations

import re
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_roles_registry_fields"
down_revision: str | None = "0005_creator_profile_phase1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug or "role"


def upgrade() -> None:
    op.add_column("roles", sa.Column("slug", sa.String(length=160), nullable=True))
    op.add_column("roles", sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")))
    op.add_column(
        "roles",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    bind = op.get_bind()
    role_table = sa.table(
        "roles",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("name", sa.String(length=120)),
        sa.column("slug", sa.String(length=160)),
    )
    rows = bind.execute(sa.select(role_table.c.id, role_table.c.name)).fetchall()

    seen_slugs: set[str] = set()
    for row in rows:
        base = _slugify(row.name or "")
        candidate = base
        if candidate in seen_slugs:
            candidate = f"{base}-{str(row.id)[:8].lower()}"
        seen_slugs.add(candidate)
        bind.execute(
            sa.update(role_table).where(role_table.c.id == row.id).values(slug=candidate)
        )

    op.alter_column("roles", "slug", existing_type=sa.String(length=160), nullable=False)
    op.create_index("ix_roles_slug", "roles", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_roles_slug", table_name="roles")
    op.drop_column("roles", "is_active")
    op.drop_column("roles", "version")
    op.drop_column("roles", "slug")
