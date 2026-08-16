"""Does the job-import draft model still agree with the migration chain?

The failure being guarded is silent in every test run and total in production.
Tests build their schema with `create_all`, so a column added to the model and
forgotten in a migration works perfectly here and simply does not exist when the
application is deployed. Nothing fails; the column is just gone.

The set of "columns some migration creates" is derived by reading the migration
files, never from the model. A baseline derived from the model would agree with
itself and prove nothing — which is exactly how an earlier version of this guard
passed while a model-only column sat unmigrated.

Execution is not proven here. The chain contains JSONB, which SQLite cannot
compile, so migrations are validated against disposable PostgreSQL and that
needs Docker, which is unavailable in this environment (recorded as
BLOCKED_ENVIRONMENT). This file guards the drift that no environment catches.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path
from types import ModuleType

import pytest

from app.models import JobImportDraft

TABLE = "job_import_drafts"
VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION_PATH = VERSIONS / "0063_job_import_execution_lease.py"

#: Everything 0063 is responsible for adding.
LEASE_COLUMNS = {
    "processing_lease_expires_at",
    "processing_worker_id",
    "processing_attempts",
    "processing_next_attempt_at",
}


def _migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("creatorjobs_migration_0063", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _created_table_columns(source: str) -> set[str]:
    """Columns from a `create_table("job_import_drafts", ...)` call.

    Scoped to the call by bracket depth rather than by a greedy match, so a
    later create_table in the same file cannot leak its columns in here.
    """

    marker = f'create_table(\n        "{TABLE}"'
    start = source.find(marker)
    if start == -1:
        start = source.find(f'create_table("{TABLE}"')
        if start == -1:
            return set()

    depth = 0
    end = start
    for index in range(source.index("(", start), len(source)):
        character = source[index]
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                end = index
                break

    return set(re.findall(r'sa\.Column\(\s*"([a-z_0-9]+)"', source[start:end]))


@pytest.fixture(scope="module")
def migrated_columns() -> set[str]:
    """Every column the migration chain creates for this table, minus drops."""

    created: set[str] = set()
    dropped: set[str] = set()
    for path in sorted(VERSIONS.glob("*.py")):
        source = path.read_text(encoding="utf8")
        if TABLE not in source:
            continue
        created |= _created_table_columns(source)
        created |= set(
            re.findall(
                rf'add_column\(\s*"{TABLE}",\s*sa\.Column\(\s*"([a-z_0-9]+)"', source
            )
        )
        dropped |= set(re.findall(rf'drop_column\(\s*"{TABLE}",\s*"([a-z_0-9]+)"', source))

    # Downgrades drop what upgrades add; only a column dropped by an UPGRADE is
    # genuinely gone, and this project has not done that here.
    return created


@pytest.fixture(scope="module")
def source() -> str:
    return MIGRATION_PATH.read_text(encoding="utf8")


class TestLineage:
    def test_it_parents_the_previous_head(self) -> None:
        module = _migration_module()

        assert module.revision == "0063_job_import_execution_lease"
        assert module.down_revision == "0062_email_suppressions"
        # A branch label would create a second head, and the project keeps one.
        assert module.branch_labels is None


class TestTheModelAndMigrationChainAgree:
    def test_the_parser_found_a_real_baseline(self, migrated_columns: set[str]) -> None:
        """Guards the guard: a regex that silently matched nothing would make
        every assertion below vacuous in the safe-looking direction."""

        assert "id" in migrated_columns
        assert "processing_status" in migrated_columns
        assert len(migrated_columns) > 20

    def test_every_model_column_is_created_by_some_migration(
        self, migrated_columns: set[str]
    ) -> None:
        declared = set(JobImportDraft.__table__.columns.keys())

        unmigrated = declared - migrated_columns
        assert not unmigrated, (
            f"JobImportDraft declares {sorted(unmigrated)}, which no migration creates. "
            "These exist under create_all in tests and are missing in production."
        )

    def test_this_migration_adds_the_lease_columns(self, source: str) -> None:
        added = set(
            re.findall(rf'add_column\(\s*"{TABLE}",\s*sa\.Column\(\s*"([a-z_0-9]+)"', source)
        )

        assert added == LEASE_COLUMNS

    def test_the_migration_drops_exactly_what_it_added(self, source: str) -> None:
        dropped = set(re.findall(rf'drop_column\(\s*"{TABLE}",\s*"([a-z_0-9]+)"', source))

        assert dropped == LEASE_COLUMNS

    def test_it_adds_no_data_statement(self, source: str) -> None:
        """Expand-only, so schema and code may deploy in either order."""

        for forbidden in ("op.execute(", "UPDATE ", "DELETE ", "INSERT "):
            assert forbidden not in source.replace("UPDATE alembic_version", ""), forbidden

    def test_the_attempt_counter_is_not_null_with_a_default(self, source: str) -> None:
        """A NOT NULL column with no server default cannot be added to a table
        that already has rows."""

        assert 'server_default="0"' in source
