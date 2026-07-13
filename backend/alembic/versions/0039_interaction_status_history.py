"""Add versioned interaction history, archive state, and delivery dedupe.

Revision ID: 0039_interaction_status_history
Revises: 0038_interaction_participant_status
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid


revision = "0039_interaction_status_history"
down_revision = "0038_interaction_participant_status"
branch_labels = None
depends_on = None


def _json_type(bind):
    return postgresql.JSONB(astext_type=sa.Text()) if bind.dialect.name == "postgresql" else sa.JSON()


def _json_default(bind):
    return sa.text("'{}'::jsonb") if bind.dialect.name == "postgresql" else sa.text("'{}'")


def upgrade() -> None:
    bind = op.get_bind()
    bool_false = sa.text("false") if bind.dialect.name == "postgresql" else sa.text("0")

    for table in ("job_applications", "talent_interests"):
        op.add_column(table, sa.Column("status_version", sa.Integer(), nullable=False, server_default="1"))
        op.add_column(
            table,
            sa.Column(
                "legacy_archive_resolution_required",
                sa.Boolean(),
                nullable=False,
                server_default=bool_false,
            ),
        )

    op.add_column("conversations", sa.Column("participant_a_archived_at", sa.DateTime(timezone=True)))
    op.add_column("conversations", sa.Column("participant_b_archived_at", sa.DateTime(timezone=True)))

    op.add_column("notifications", sa.Column("dedupe_key", sa.String(length=255)))
    op.create_index("ix_notifications_dedupe_key", "notifications", ["dedupe_key"], unique=True)
    op.add_column("email_outbox", sa.Column("dedupe_key", sa.String(length=255)))
    op.create_index("ix_email_outbox_dedupe_key", "email_outbox", ["dedupe_key"], unique=True)

    op.create_table(
        "interaction_status_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("interaction_type", sa.String(length=32), nullable=False),
        sa.Column("interaction_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("previous_status", sa.String(length=32), nullable=True),
        sa.Column("new_status", sa.String(length=32), nullable=False),
        sa.Column("status_version", sa.Integer(), nullable=False),
        sa.Column("event_kind", sa.String(length=32), nullable=False),
        sa.Column("audience", sa.String(length=20), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=True),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("outcome_json", _json_type(bind), nullable=False, server_default=_json_default(bind)),
        sa.Column("metadata_json", _json_type(bind), nullable=False, server_default=_json_default(bind)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "interaction_type IN ('application', 'hiring_request')",
            name="ck_status_event_interaction_type",
        ),
        sa.CheckConstraint(
            "audience IN ('manager_only', 'participants')",
            name="ck_status_event_audience",
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key", name="uq_status_event_idempotency"),
        sa.UniqueConstraint(
            "interaction_type",
            "interaction_id",
            "status_version",
            "event_kind",
            "audience",
            name="uq_status_event_transition_audience",
        ),
    )
    op.create_index("ix_status_event_interaction", "interaction_status_events", ["interaction_type", "interaction_id"])
    op.create_index("ix_status_event_created_at", "interaction_status_events", ["created_at"])

    op.create_table(
        "interaction_transition_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("interaction_type", sa.String(length=32), nullable=False),
        sa.Column("interaction_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("requested_status", sa.String(length=32), nullable=False),
        sa.Column("expected_version", sa.Integer(), nullable=False),
        sa.Column("outcome_json", _json_type(bind), nullable=False, server_default=_json_default(bind)),
        sa.Column("status_event_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "interaction_type IN ('application', 'hiring_request')",
            name="ck_transition_request_interaction_type",
        ),
        sa.CheckConstraint(
            "action IN ('transition', 'communicate')",
            name="ck_transition_request_action",
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["status_event_id"], ["interaction_status_events.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_transition_request_idempotency_key",
        "interaction_transition_requests",
        ["idempotency_key"],
        unique=True,
    )
    op.create_index(
        "ix_transition_request_interaction",
        "interaction_transition_requests",
        ["interaction_type", "interaction_id"],
    )
    op.create_index(
        "ix_transition_request_actor_user_id",
        "interaction_transition_requests",
        ["actor_user_id"],
    )
    op.create_index(
        "ix_transition_request_created_at",
        "interaction_transition_requests",
        ["created_at"],
    )

    # Canonicalize Accepted. `contacted` remains accepted only as legacy API input.
    op.execute("UPDATE talent_interests SET status = 'accepted' WHERE status = 'contacted'")
    op.execute("UPDATE talent_interests SET participant_status = 'accepted' WHERE participant_status = 'contacted'")

    # Preserve unknown legacy archive history rather than inventing a previous stage.
    op.execute(
        "UPDATE job_applications SET legacy_archive_resolution_required = true "
        "WHERE status = 'archived' AND participant_status = 'new'"
    )
    op.execute(
        "UPDATE talent_interests SET legacy_archive_resolution_required = true "
        "WHERE status = 'archived' AND participant_status = 'new'"
    )

    # Shared status is reliable evidence for archived historical outcomes.
    op.execute(
        "UPDATE job_applications SET status = participant_status "
        "WHERE status = 'archived' AND participant_status IN "
        "('interviewing', 'hired', 'rejected', 'withdrawn')"
    )
    op.execute(
        "UPDATE talent_interests SET status = participant_status "
        "WHERE status = 'archived' AND participant_status IN ('accepted', 'declined', 'withdrawn')"
    )

    # Reconciliation events are audit history only. They never create chat events,
    # notifications, outbox rows, or unread counts. Consequential historical
    # outcomes are validated against their engagement instead of silently
    # fabricating missing work relationships.
    history = sa.table(
        "interaction_status_events",
        sa.column("id", sa.Uuid()),
        sa.column("interaction_type", sa.String()),
        sa.column("interaction_id", sa.Uuid()),
        sa.column("actor_user_id", sa.Uuid()),
        sa.column("previous_status", sa.String()),
        sa.column("new_status", sa.String()),
        sa.column("status_version", sa.Integer()),
        sa.column("event_kind", sa.String()),
        sa.column("audience", sa.String()),
        sa.column("metadata_json", _json_type(bind)),
    )
    engagements = sa.table(
        "engagements",
        sa.column("id", sa.Uuid()),
        sa.column("source_type", sa.String()),
        sa.column("source_record_id", sa.Uuid()),
        sa.column("application_id", sa.Uuid()),
        sa.column("talent_interest_id", sa.Uuid()),
        sa.column("recruiter_user_id", sa.Uuid()),
        sa.column("talent_user_id", sa.Uuid()),
    )
    historical_rows: list[dict] = []
    sources = (
        (
            "application",
            "job_applications",
            ("reviewing", "shortlisted", "interviewing", "hired", "rejected", "withdrawn", "archived"),
            "job_application",
            "application_id",
            "job_owner_user_id",
            "applicant_user_id",
        ),
        (
            "hiring_request",
            "talent_interests",
            ("reviewing", "accepted", "declined", "withdrawn", "archived"),
            "talent_interest",
            "talent_interest_id",
            "recruiter_user_id",
            "owner_user_id",
        ),
    )
    for (
        interaction_type,
        table_name,
        statuses,
        engagement_source_type,
        engagement_fk,
        recruiter_column,
        talent_column,
    ) in sources:
        source = sa.table(
            table_name,
            sa.column("id", sa.Uuid()),
            sa.column("status", sa.String()),
            sa.column("participant_status", sa.String()),
            sa.column("status_version", sa.Integer()),
            sa.column(recruiter_column, sa.Uuid()),
            sa.column(talent_column, sa.Uuid()),
            sa.column("legacy_archive_resolution_required", sa.Boolean()),
        )
        rows = bind.execute(sa.select(source).where(source.c.status.in_(statuses))).mappings()
        for row in rows:
            interaction_id = row["id"]
            manager_status = row["status"]
            participant_status = row["participant_status"]
            issues: list[str] = []
            if row["legacy_archive_resolution_required"]:
                issues.append("legacy_archive_previous_stage_unknown")

            consequential_status = "hired" if interaction_type == "application" else "accepted"
            if manager_status == consequential_status or participant_status == consequential_status:
                if manager_status != consequential_status or participant_status != consequential_status:
                    issues.append("manager_participant_status_mismatch")
                engagement_rows = bind.execute(
                    sa.select(engagements).where(
                        sa.or_(
                            engagements.c.source_record_id == interaction_id,
                            getattr(engagements.c, engagement_fk) == interaction_id,
                        )
                    )
                ).mappings().all()
                if not engagement_rows:
                    issues.append("consequential_status_missing_engagement")
                elif len(engagement_rows) > 1:
                    issues.append("duplicate_engagements")
                else:
                    engagement = engagement_rows[0]
                    if (
                        engagement["source_type"] != engagement_source_type
                        or engagement[engagement_fk] != interaction_id
                        or engagement["source_record_id"] != interaction_id
                    ):
                        issues.append("engagement_source_mismatch")
                    if (
                        engagement["recruiter_user_id"] != row[recruiter_column]
                        or engagement["talent_user_id"] != row[talent_column]
                    ):
                        issues.append("engagement_participant_mismatch")

            event_kind = "integrity_issue" if issues else "reconciled"
            historical_rows.append(
                {
                    "id": uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"creatorjobs:{event_kind}:{interaction_type}:{interaction_id}",
                    ),
                    "interaction_type": interaction_type,
                    "interaction_id": interaction_id,
                    "actor_user_id": None,
                    "previous_status": None,
                    "new_status": manager_status,
                    "status_version": row["status_version"],
                    "event_kind": event_kind,
                    "audience": "manager_only",
                    "metadata_json": {
                        "historical_backfill": True,
                        "manager_status": manager_status,
                        "participant_status": participant_status,
                        "integrity_codes": issues,
                        "notifications_created": False,
                        "trusted_messages_created": False,
                    },
                }
            )
    if historical_rows:
        op.bulk_insert(history, historical_rows)


def downgrade() -> None:
    op.execute("UPDATE talent_interests SET status = 'contacted' WHERE status = 'accepted'")
    op.execute("UPDATE talent_interests SET participant_status = 'contacted' WHERE participant_status = 'accepted'")
    op.drop_index("ix_transition_request_created_at", table_name="interaction_transition_requests")
    op.drop_index("ix_transition_request_actor_user_id", table_name="interaction_transition_requests")
    op.drop_index("ix_transition_request_interaction", table_name="interaction_transition_requests")
    op.drop_index("ix_transition_request_idempotency_key", table_name="interaction_transition_requests")
    op.drop_table("interaction_transition_requests")
    op.drop_index("ix_status_event_created_at", table_name="interaction_status_events")
    op.drop_index("ix_status_event_interaction", table_name="interaction_status_events")
    op.drop_table("interaction_status_events")
    op.drop_index("ix_email_outbox_dedupe_key", table_name="email_outbox")
    op.drop_column("email_outbox", "dedupe_key")
    op.drop_index("ix_notifications_dedupe_key", table_name="notifications")
    op.drop_column("notifications", "dedupe_key")
    op.drop_column("conversations", "participant_b_archived_at")
    op.drop_column("conversations", "participant_a_archived_at")
    for table in ("talent_interests", "job_applications"):
        op.drop_column(table, "legacy_archive_resolution_required")
        op.drop_column(table, "status_version")
