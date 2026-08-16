"""The outbox migration, and whether the model still agrees with it.

Migrations cannot be executed locally: the chain includes a JSONB column that
SQLite cannot compile, so the project validates schema against disposable
PostgreSQL, which needs Docker. Docker is unavailable in this environment, so
the *execution* proof is recorded as BLOCKED_ENVIRONMENT elsewhere.

What is worth guarding anyway is the failure this project can actually have
without noticing: a column added to `EmailOutbox` and forgotten in the
migration, or vice versa. Tests run against `Base.metadata.create_all`, so a
model-only column works perfectly in every test and is simply absent in
production. That asymmetry is the whole reason this file exists.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path
from types import ModuleType

import pytest

from app.models import EmailOutbox

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0060_email_outbox_lease.py"
)

#: Everything this migration is responsible for adding.
LEASE_COLUMNS = {
    "leased_by",
    "leased_until",
    "attempts",
    "next_attempt_at",
    "provider_message_id",
}


def _migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("creatorjobs_migration_0060", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def source() -> str:
    return MIGRATION_PATH.read_text(encoding="utf8")


class TestLineage:
    def test_it_parents_the_previous_head(self) -> None:
        module = _migration_module()

        assert module.revision == "0060_email_outbox_lease"
        assert module.down_revision == "0059_oauth_connection_events"
        # A branch label here would create a second head, and the project keeps
        # exactly one.
        assert module.branch_labels is None


#: Columns `email_outbox` already had before 0060. Written out rather than
#: derived, because the point of this test is to notice when the model gains a
#: column that no migration creates — deriving the baseline from the model would
#: make it agree with itself and prove nothing.
PRE_LEASE_COLUMNS = {
    "id",
    "user_id",
    "to_email",
    "event_key",
    "template_key",
    "subject",
    "preview",
    "body",
    "cta_url",
    "metadata_json",
    "dedupe_key",
    "status",
    "error",
    "created_at",
    "processed_at",
}


class TestTheModelAndMigrationAgree:
    def test_the_model_has_exactly_the_columns_some_migration_creates(self, source: str) -> None:
        """The failure this catches is silent in every test run.

        Tests build their schema with `create_all`, so a column added to the
        model and forgotten in a migration works perfectly here and does not
        exist in production. Comparing the whole column set — not a hand-listed
        subset — is what makes that visible.
        """
        added = set(re.findall(r'add_column\(\s*"email_outbox",\s*sa\.Column\(\s*"([a-z_]+)"', source))
        accounted_for = PRE_LEASE_COLUMNS | added
        declared = set(EmailOutbox.__table__.columns.keys())

        unmigrated = declared - accounted_for
        assert not unmigrated, (
            f"EmailOutbox declares {sorted(unmigrated)}, which no migration creates. "
            f"These would exist under create_all in tests and be missing in production."
        )

        undeclared = accounted_for - declared
        assert not undeclared, (
            f"migrations create {sorted(undeclared)} but the model does not declare them"
        )

    def test_this_migration_adds_the_lease_columns(self, source: str) -> None:
        added = set(re.findall(r'add_column\(\s*"email_outbox",\s*sa\.Column\(\s*"([a-z_]+)"', source))

        assert added == LEASE_COLUMNS

    def test_the_migration_drops_exactly_what_it_added(self, source: str) -> None:
        dropped = set(re.findall(r'drop_column\(\s*"email_outbox",\s*"([a-z_]+)"', source))

        assert dropped == LEASE_COLUMNS


class TestItIsExpandOnly:
    """An expand-only migration is what lets schema and consumers ship apart."""

    def test_it_adds_nothing_that_could_reject_an_existing_row(self, source: str) -> None:
        upgrade = source[source.index("def upgrade"):source.index("def downgrade")]

        for match in re.finditer(r"sa\.Column\((.*?)\)\s*,?\s*\n", upgrade, re.S):
            column = match.group(1)
            name = re.search(r'"([a-z_]+)"', column)
            if not name or name.group(1) not in LEASE_COLUMNS:
                continue
            # A NOT NULL column with no server default cannot be added to a table
            # that already has rows.
            if "nullable=False" in column:
                assert "server_default" in column, (
                    f"{name.group(1)} is NOT NULL without a server default, so existing "
                    f"outbox rows would fail the migration"
                )

    def test_it_does_not_touch_the_delivery_record(self, source: str) -> None:
        upgrade = source[source.index("def upgrade"):source.index("def downgrade")]

        # `status`, `processed_at`, `error` and `dedupe_key` carry what actually
        # happened to a message. Delivery bookkeeping is additive beside them.
        for protected in ("status", "processed_at", "error", "dedupe_key"):
            assert f'drop_column("email_outbox", "{protected}")' not in upgrade
            assert f'alter_column("email_outbox", "{protected}"' not in upgrade

    def test_it_changes_no_delivery_behaviour_by_itself(self, source: str) -> None:
        # Applying schema must not move any row's status. The worker that reads
        # these columns arrives separately, which is what lets the two deploy in
        # either order.
        upgrade = source[source.index("def upgrade"):source.index("def downgrade")]

        assert "UPDATE" not in upgrade.upper() or "update(" not in upgrade
        assert "execute(" not in upgrade


class TestTheClaimLookupIsIndexed:
    def test_the_claimable_index_covers_the_claim_predicate(self, source: str) -> None:
        # The worker asks "what may I take next", filtered by status and
        # eligibility time. Without this the claim degrades to a table scan on
        # the one query that runs constantly.
        assert 'sa.Column' in source
        assert '"ix_email_outbox_claimable"' in source
        assert '["status", "next_attempt_at"]' in source

    def test_lease_expiry_is_indexed(self, source: str) -> None:
        # Reclaiming stranded rows scans by lease expiry.
        assert '"ix_email_outbox_leased_until"' in source


class TestDefaults:
    def test_attempts_starts_at_zero_for_existing_rows(self) -> None:
        column = EmailOutbox.__table__.columns["attempts"]

        assert column.nullable is False
        assert column.server_default is not None

    def test_lease_state_starts_empty(self) -> None:
        for name in ("leased_by", "leased_until", "next_attempt_at", "provider_message_id"):
            assert EmailOutbox.__table__.columns[name].nullable is True, name
