"""Add private provider-neutral job import readiness records.

Revision ID: 0043_job_import_readiness
Revises: 0042_creator_job_domain_contract
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0043_job_import_readiness"
down_revision = "0042_creator_job_domain_contract"
branch_labels = None
depends_on = None


def _json_type(bind):
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    bind = op.get_bind()
    json_type = _json_type(bind)

    op.create_table(
        "job_import_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("source_title", sa.String(length=255), nullable=True),
        sa.Column("original_text", sa.Text(), nullable=True),
        sa.Column("source_url", sa.String(length=2048), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("content_type", sa.String(length=128), nullable=True),
        sa.Column("storage_references", json_type, nullable=False),
        sa.Column("content_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("client_request_id", sa.String(length=80), nullable=True),
        sa.Column(
            "processing_state",
            sa.String(length=24),
            nullable=False,
            server_default="awaiting_processing",
        ),
        sa.Column(
            "retention_policy",
            sa.String(length=32),
            nullable=False,
            server_default="retain_until_deleted",
        ),
        sa.Column("content_redacted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "processing_state IN "
            "('awaiting_processing','processing','processed','failed','deleted')",
            name="ck_job_import_source_processing_state",
        ),
        sa.CheckConstraint(
            "source_type IN "
            "('pasted_text','rough_description','external_listing_text','public_url',"
            "'screenshot','screenshots','document','pdf','other')",
            name="ck_job_import_source_type",
        ),
        sa.CheckConstraint(
            "retention_policy IN ('retain_until_deleted')",
            name="ck_job_import_source_retention_policy",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_user_id",
            "client_request_id",
            name="uq_job_import_source_owner_request",
        ),
    )
    op.create_index(
        "ix_job_import_sources_owner_user_id",
        "job_import_sources",
        ["owner_user_id"],
    )
    op.create_index(
        "ix_job_import_sources_source_type",
        "job_import_sources",
        ["source_type"],
    )
    op.create_index(
        "ix_job_import_sources_processing_state",
        "job_import_sources",
        ["processing_state"],
    )
    op.create_index(
        "ix_job_import_sources_deleted_at",
        "job_import_sources",
        ["deleted_at"],
    )
    op.create_index(
        "ix_job_import_sources_created_at",
        "job_import_sources",
        ["created_at"],
    )

    op.create_table(
        "job_import_drafts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("supersedes_draft_id", sa.Uuid(), nullable=True),
        sa.Column(
            "extraction_schema_version",
            sa.SmallInteger(),
            nullable=False,
            server_default="1",
        ),
        sa.Column("target_listing_schema_version", sa.SmallInteger(), nullable=False),
        sa.Column(
            "processing_status",
            sa.String(length=32),
            nullable=False,
            server_default="awaiting_processing",
        ),
        sa.Column(
            "validation_status",
            sa.String(length=24),
            nullable=False,
            server_default="not_validated",
        ),
        sa.Column(
            "confirmation_state",
            sa.String(length=16),
            nullable=False,
            server_default="unreviewed",
        ),
        sa.Column(
            "can_apply_to_native_draft",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "can_publish_directly",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("provider_name", sa.String(length=80), nullable=True),
        sa.Column("model_name", sa.String(length=120), nullable=True),
        sa.Column("model_version", sa.String(length=80), nullable=True),
        sa.Column("instruction_version", sa.String(length=80), nullable=True),
        sa.Column("provider_metadata", _json_type(bind), nullable=True),
        sa.Column("machine_output", _json_type(bind), nullable=True),
        sa.Column("processing_warnings", _json_type(bind), nullable=False),
        sa.Column("missing_fields", _json_type(bind), nullable=False),
        sa.Column("validation_errors", _json_type(bind), nullable=False),
        sa.Column("review_sections", _json_type(bind), nullable=False),
        sa.Column("target_job_id", sa.Uuid(), nullable=True),
        sa.Column("client_request_id", sa.String(length=80), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("discarded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "extraction_schema_version > 0",
            name="ck_job_import_draft_extraction_version_positive",
        ),
        sa.CheckConstraint(
            "target_listing_schema_version > 0",
            name="ck_job_import_draft_target_version_positive",
        ),
        sa.CheckConstraint(
            "processing_status IN "
            "('awaiting_processing','processing','processing_failed',"
            "'awaiting_recruiter_review','partially_reviewed','ready_to_apply',"
            "'applied_to_native_draft','discarded','superseded')",
            name="ck_job_import_draft_processing_status",
        ),
        sa.CheckConstraint(
            "validation_status IN ('not_validated','invalid','needs_review','valid')",
            name="ck_job_import_draft_validation_status",
        ),
        sa.CheckConstraint(
            "confirmation_state IN ('unreviewed','partial','confirmed')",
            name="ck_job_import_draft_confirmation_state",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["job_import_sources.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["supersedes_draft_id"],
            ["job_import_drafts.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["target_job_id"],
            ["jobs.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_user_id",
            "client_request_id",
            name="uq_job_import_draft_owner_request",
        ),
    )
    for column in (
        "owner_user_id",
        "source_id",
        "supersedes_draft_id",
        "processing_status",
        "target_job_id",
        "deleted_at",
        "created_at",
    ):
        op.create_index(
            f"ix_job_import_drafts_{column}",
            "job_import_drafts",
            [column],
        )

    op.create_table(
        "job_import_fields",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("field_path", sa.String(length=120), nullable=False),
        sa.Column("proposed_value", _json_type(bind), nullable=True),
        sa.Column("provenance_state", sa.String(length=32), nullable=False),
        sa.Column(
            "review_status",
            sa.String(length=16),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("evidence", _json_type(bind), nullable=False),
        sa.Column("conflicting_values", _json_type(bind), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("provider_confidence", _json_type(bind), nullable=True),
        sa.Column("confirmed_value", _json_type(bind), nullable=True),
        sa.Column("edited_value", _json_type(bind), nullable=True),
        sa.Column("missing_requirement", sa.String(length=28), nullable=False),
        sa.Column(
            "requires_confirmation",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("validation_errors", _json_type(bind), nullable=False),
        sa.Column("selected_conflict_index", sa.Integer(), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "provenance_state IN "
            "('directly_supplied','extracted_from_source','suggested_inference',"
            "'conflicting_source_values','missing')",
            name="ck_job_import_field_provenance",
        ),
        sa.CheckConstraint(
            "review_status IN ('pending','confirmed','edited','rejected')",
            name="ck_job_import_field_review_status",
        ),
        sa.CheckConstraint(
            "missing_requirement IN "
            "('publication_blocker','conditionally_required','recommended','optional')",
            name="ck_job_import_field_missing_requirement",
        ),
        sa.ForeignKeyConstraint(
            ["draft_id"],
            ["job_import_drafts.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "draft_id",
            "field_path",
            name="uq_job_import_field_draft_path",
        ),
    )
    op.create_index(
        "ix_job_import_fields_draft_id",
        "job_import_fields",
        ["draft_id"],
    )
    op.create_index(
        "ix_job_import_fields_field_path",
        "job_import_fields",
        ["field_path"],
    )


def downgrade() -> None:
    op.drop_index("ix_job_import_fields_field_path", table_name="job_import_fields")
    op.drop_index("ix_job_import_fields_draft_id", table_name="job_import_fields")
    op.drop_table("job_import_fields")

    for column in reversed(
        (
            "owner_user_id",
            "source_id",
            "supersedes_draft_id",
            "processing_status",
            "target_job_id",
            "deleted_at",
            "created_at",
        )
    ):
        op.drop_index(
            f"ix_job_import_drafts_{column}",
            table_name="job_import_drafts",
        )
    op.drop_table("job_import_drafts")

    for column in reversed(
        (
            "owner_user_id",
            "source_type",
            "processing_state",
            "deleted_at",
            "created_at",
        )
    ):
        op.drop_index(
            f"ix_job_import_sources_{column}",
            table_name="job_import_sources",
        )
    op.drop_table("job_import_sources")
