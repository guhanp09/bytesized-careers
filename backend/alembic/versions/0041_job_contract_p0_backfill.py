"""Version legacy jobs and seed P0 creator roles.

Revision ID: 0041_job_contract_p0_backfill
Revises: 0040_job_contract_p0_fields
"""

from __future__ import annotations

import re
import uuid

import sqlalchemy as sa
from alembic import op


revision = "0041_job_contract_p0_backfill"
down_revision = "0040_job_contract_p0_fields"
branch_labels = None
depends_on = None

ROLE_SEED_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "creatorjobs.role-catalog")
P0_ROLES = (
    ("Researcher", "Strategy", "Researches topics, sources, and evidence for creator-led content."),
    (
        "Voice Over Artist",
        "Production",
        "Records polished narration and character voice work for creator content.",
    ),
    ("Other Creator Role", "Other", "A creator-economy role not yet represented in the catalog."),
)


def _role_id(name: str) -> uuid.UUID:
    return uuid.uuid5(ROLE_SEED_NAMESPACE, name.strip().lower())


def _slug(name: str) -> str:
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("UPDATE jobs SET listing_schema_version = 1 WHERE listing_schema_version IS NULL")
    op.execute(
        "UPDATE jobs SET compensation_mode = 'range' "
        "WHERE compensation_mode IS NULL AND budget_amount > 0 AND budget_max > 0"
    )
    op.execute(
        "UPDATE jobs SET compensation_mode = 'fixed' "
        "WHERE compensation_mode IS NULL AND budget_amount > 0 AND budget_max IS NULL"
    )
    op.execute(
        "UPDATE jobs SET compensation_mode = 'negotiable' "
        "WHERE compensation_mode IS NULL AND budget_amount IS NULL AND budget_max IS NULL "
        "AND lower(trim(coalesce(budget_note, ''))) = 'contact for pricing'"
    )

    roles = sa.table(
        "roles",
        sa.column("id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("slug", sa.String()),
        sa.column("version", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
        sa.column("popularity_score", sa.Integer()),
        sa.column("category", sa.String()),
        sa.column("description", sa.Text()),
    )
    existing = {
        str(name).strip().lower()
        for name in bind.execute(sa.select(roles.c.name)).scalars().all()
    }
    rows = [
        {
            "id": _role_id(name),
            "name": name,
            "slug": _slug(name),
            "version": 1,
            "is_active": True,
            "popularity_score": 0,
            "category": category,
            "description": description,
        }
        for name, category, description in P0_ROLES
        if name.lower() not in existing
    ]
    if rows:
        op.bulk_insert(roles, rows)

    with op.batch_alter_table("jobs") as batch:
        batch.alter_column(
            "listing_schema_version",
            existing_type=sa.SmallInteger(),
            nullable=False,
            server_default="2",
        )


def downgrade() -> None:
    with op.batch_alter_table("jobs") as batch:
        batch.alter_column(
            "listing_schema_version",
            existing_type=sa.SmallInteger(),
            nullable=True,
            server_default=None,
        )

    bind = op.get_bind()
    jobs = sa.table("jobs", sa.column("primary_role_id", sa.Uuid()))
    roles = sa.table("roles", sa.column("id", sa.Uuid()))
    for name, _category, _description in P0_ROLES:
        role_id = _role_id(name)
        referenced = bind.execute(
            sa.select(jobs.c.primary_role_id).where(jobs.c.primary_role_id == role_id).limit(1)
        ).first()
        if referenced is None:
            bind.execute(sa.delete(roles).where(roles.c.id == role_id))
