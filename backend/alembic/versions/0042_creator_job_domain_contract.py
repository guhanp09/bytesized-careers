"""Add the creator-economy domain contract and start schema version 3.

Revision ID: 0042_creator_job_domain_contract
Revises: 0041_job_contract_p0_backfill
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0042_creator_job_domain_contract"
down_revision = "0041_job_contract_p0_backfill"
branch_labels = None
depends_on = None


def _json_type(bind):
    return postgresql.JSONB(astext_type=sa.Text()) if bind.dialect.name == "postgresql" else sa.JSON()


def upgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("jobs") as batch:
        batch.add_column(sa.Column("deliverables", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("required_skill_keys", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("preferred_skill_keys", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("other_required_skills", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("other_preferred_skills", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("required_skills_note", sa.Text(), nullable=True))
        batch.add_column(sa.Column("preferred_skills_note", sa.Text(), nullable=True))
        batch.add_column(sa.Column("revision_policy", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("revision_rounds", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("revision_notes", sa.Text(), nullable=True))
        batch.add_column(sa.Column("source_inputs", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("source_inputs_notes", sa.Text(), nullable=True))
        batch.add_column(sa.Column("creative_autonomy", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("creative_autonomy_notes", sa.Text(), nullable=True))
        batch.add_column(sa.Column("language_requirements", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("trial_status", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("trial_scope", sa.Text(), nullable=True))
        batch.add_column(sa.Column("trial_effort_value", sa.Numeric(6, 1), nullable=True))
        batch.add_column(sa.Column("trial_effort_unit", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("trial_compensation_amount", sa.Numeric(12, 2), nullable=True))
        batch.add_column(sa.Column("trial_compensation_currency", sa.String(length=3), nullable=True))
        batch.add_column(sa.Column("trial_compensation_basis", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("trial_work_usage", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("trial_portfolio_permission", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("trial_attribution", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("unpaid_trial_confirmed", sa.Boolean(), nullable=True))
        batch.add_column(sa.Column("trial_notes", sa.Text(), nullable=True))
        batch.add_column(sa.Column("start_timing", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("start_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("duration_type", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("duration_value", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("duration_unit", sa.String(length=12), nullable=True))
        batch.add_column(sa.Column("engagement_end_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("hiring_process", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("hiring_process_notes", sa.Text(), nullable=True))
        batch.add_column(sa.Column("screening_questions", _json_type(bind), nullable=True))
        batch.add_column(sa.Column("employer_context_type", sa.String(length=24), nullable=True))
        batch.create_check_constraint(
            "ck_jobs_revision_rounds_positive",
            "revision_rounds IS NULL OR revision_rounds > 0",
        )
        batch.create_check_constraint(
            "ck_jobs_trial_effort_positive",
            "trial_effort_value IS NULL OR trial_effort_value > 0",
        )
        batch.create_check_constraint(
            "ck_jobs_trial_compensation_positive",
            "trial_compensation_amount IS NULL OR trial_compensation_amount > 0",
        )
        batch.create_check_constraint(
            "ck_jobs_duration_value_positive",
            "duration_value IS NULL OR duration_value > 0",
        )
        batch.alter_column(
            "listing_schema_version",
            existing_type=sa.SmallInteger(),
            nullable=False,
            server_default="3",
        )

    op.create_index("ix_jobs_employer_context_type", "jobs", ["employer_context_type"])


def downgrade() -> None:
    op.drop_index("ix_jobs_employer_context_type", table_name="jobs")
    with op.batch_alter_table("jobs") as batch:
        batch.alter_column(
            "listing_schema_version",
            existing_type=sa.SmallInteger(),
            nullable=False,
            server_default="2",
        )
        batch.drop_constraint("ck_jobs_duration_value_positive", type_="check")
        batch.drop_constraint("ck_jobs_trial_compensation_positive", type_="check")
        batch.drop_constraint("ck_jobs_trial_effort_positive", type_="check")
        batch.drop_constraint("ck_jobs_revision_rounds_positive", type_="check")
        for column in (
            "employer_context_type",
            "screening_questions",
            "hiring_process_notes",
            "hiring_process",
            "engagement_end_date",
            "duration_unit",
            "duration_value",
            "duration_type",
            "start_date",
            "start_timing",
            "trial_notes",
            "unpaid_trial_confirmed",
            "trial_attribution",
            "trial_portfolio_permission",
            "trial_work_usage",
            "trial_compensation_basis",
            "trial_compensation_currency",
            "trial_compensation_amount",
            "trial_effort_unit",
            "trial_effort_value",
            "trial_scope",
            "trial_status",
            "language_requirements",
            "creative_autonomy_notes",
            "creative_autonomy",
            "source_inputs_notes",
            "source_inputs",
            "revision_notes",
            "revision_rounds",
            "revision_policy",
            "preferred_skills_note",
            "required_skills_note",
            "other_preferred_skills",
            "other_required_skills",
            "preferred_skill_keys",
            "required_skill_keys",
            "deliverables",
        ):
            batch.drop_column(column)
