from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

json_type = JSON().with_variant(JSONB, "postgresql")


class JobImportSource(Base):
    __tablename__ = "job_import_sources"
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "client_request_id",
            name="uq_job_import_source_owner_request",
        ),
        CheckConstraint(
            "processing_state IN "
            "('awaiting_processing','processing','processed','failed','deleted')",
            name="ck_job_import_source_processing_state",
        ),
        CheckConstraint(
            "source_type IN "
            "('pasted_text','rough_description','external_listing_text','public_url',"
            "'screenshot','screenshots','document','pdf','other')",
            name="ck_job_import_source_type",
        ),
        CheckConstraint(
            "retention_policy IN ('retain_until_deleted')",
            name="ck_job_import_source_retention_policy",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    original_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    final_source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    retrieved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    retrieval_metadata: Mapped[dict[str, object] | None] = mapped_column(
        json_type, nullable=True
    )
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    storage_references: Mapped[list[str]] = mapped_column(
        json_type, nullable=False, default=list
    )
    content_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    client_request_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    processing_state: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        default="awaiting_processing",
        server_default="awaiting_processing",
        index=True,
    )
    retention_policy: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="retain_until_deleted",
        server_default="retain_until_deleted",
    )
    content_redacted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class JobImportDraft(Base):
    __tablename__ = "job_import_drafts"
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "client_request_id",
            name="uq_job_import_draft_owner_request",
        ),
        CheckConstraint(
            "extraction_schema_version > 0",
            name="ck_job_import_draft_extraction_version_positive",
        ),
        CheckConstraint(
            "target_listing_schema_version > 0",
            name="ck_job_import_draft_target_version_positive",
        ),
        CheckConstraint(
            "processing_status IN "
            "('awaiting_processing','processing','processing_failed',"
            "'awaiting_recruiter_review','partially_reviewed','ready_to_apply',"
            "'applied_to_native_draft','discarded','superseded')",
            name="ck_job_import_draft_processing_status",
        ),
        CheckConstraint(
            "validation_status IN ('not_validated','invalid','needs_review','valid')",
            name="ck_job_import_draft_validation_status",
        ),
        CheckConstraint(
            "confirmation_state IN ('unreviewed','partial','confirmed')",
            name="ck_job_import_draft_confirmation_state",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("job_import_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    supersedes_draft_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("job_import_drafts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    extraction_schema_version: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=1, server_default="1"
    )
    target_listing_schema_version: Mapped[int] = mapped_column(
        SmallInteger, nullable=False
    )
    processing_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="awaiting_processing",
        server_default="awaiting_processing",
        index=True,
    )
    validation_status: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        default="not_validated",
        server_default="not_validated",
    )
    confirmation_state: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="unreviewed",
        server_default="unreviewed",
    )
    can_apply_to_native_draft: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa.false()
    )
    can_publish_directly: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa.false()
    )
    provider_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    instruction_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    provider_metadata: Mapped[dict[str, object] | None] = mapped_column(
        json_type, nullable=True
    )
    machine_output: Mapped[dict[str, object] | None] = mapped_column(
        json_type, nullable=True
    )
    processing_warnings: Mapped[list[dict[str, object]]] = mapped_column(
        json_type, nullable=False, default=list
    )
    missing_fields: Mapped[list[dict[str, object]]] = mapped_column(
        json_type, nullable=False, default=list
    )
    validation_errors: Mapped[dict[str, object]] = mapped_column(
        json_type, nullable=False, default=dict
    )
    review_sections: Mapped[list[dict[str, object]]] = mapped_column(
        json_type, nullable=False, default=list
    )
    target_job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("jobs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Recruiter answers captured before machine output exists, keyed by field path.
    # These are authoritative: extraction merges around them and never over them.
    recruiter_prefill: Mapped[dict[str, object]] = mapped_column(
        json_type, nullable=False, default=dict, server_default=sa.text("'{}'")
    )
    recruiter_prefill_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Internal, transaction-scoped compare-and-set token. It is never serialized.
    # A committed row must normally contain NULL: successful mutations clear it in
    # the same transaction, while failed/crashed transactions roll it back.
    mutation_claim_token: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
    )
    client_request_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    discarded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class JobImportField(Base):
    __tablename__ = "job_import_fields"
    __table_args__ = (
        UniqueConstraint(
            "draft_id",
            "field_path",
            name="uq_job_import_field_draft_path",
        ),
        CheckConstraint(
            "provenance_state IN "
            "('directly_supplied','extracted_from_source','suggested_inference',"
            "'conflicting_source_values','missing')",
            name="ck_job_import_field_provenance",
        ),
        CheckConstraint(
            "review_status IN ('pending','confirmed','edited','rejected')",
            name="ck_job_import_field_review_status",
        ),
        CheckConstraint(
            "missing_requirement IN "
            "('publication_blocker','conditionally_required','recommended','optional')",
            name="ck_job_import_field_missing_requirement",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    draft_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("job_import_drafts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    field_path: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    proposed_value: Mapped[object | None] = mapped_column(json_type, nullable=True)
    provenance_state: Mapped[str] = mapped_column(String(32), nullable=False)
    review_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    evidence: Mapped[list[dict[str, object]]] = mapped_column(
        json_type, nullable=False, default=list
    )
    conflicting_values: Mapped[list[dict[str, object]]] = mapped_column(
        json_type, nullable=False, default=list
    )
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_confidence: Mapped[dict[str, object] | None] = mapped_column(
        json_type, nullable=True
    )
    confirmed_value: Mapped[object | None] = mapped_column(json_type, nullable=True)
    edited_value: Mapped[object | None] = mapped_column(json_type, nullable=True)
    missing_requirement: Mapped[str] = mapped_column(String(28), nullable=False)
    requires_confirmation: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=sa.true()
    )
    validation_errors: Mapped[list[str]] = mapped_column(
        json_type, nullable=False, default=list
    )
    selected_conflict_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
