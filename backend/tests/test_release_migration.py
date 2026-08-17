"""Migrations are a release step, not something every instance races to do.

The failure being fixed is specific and does not look like a migration bug when
it happens. Migrations ran from the container's start command, so every instance
executed `alembic upgrade head` on boot. Alembic takes no lock of its own, so two
instances applying the same DDL concurrently either deadlock or one errors — and
the start script is `set -e`, so the loser crash-loops. What an operator sees is
one instance failing with a migration error while another has already succeeded.

So the tests here are mostly about the guarantees rather than about SQL:

  - two heads is caught before any connection is opened, because that is a merge
    accident and finding it on the filesystem is cheaper than finding it in
    production;
  - concurrent runs serialise on a PostgreSQL advisory lock, and the key used to
    take it is the key used to release it — a mismatch there would leak the lock
    for the life of the connection and stall every later deploy;
  - a second run with nothing to do is a no-op that exits 0, which is what every
    instance after the first one does;
  - failure exits non-zero, without a traceback, because a release step that
    half-succeeds is worse than one that stops.

WHAT IS NOT COVERED HERE, stated plainly: the full migration chain requires
PostgreSQL — migration 0001 declares a JSONB column, which SQLite cannot render —
and Docker is unavailable in this environment. A genuine fresh-database upgrade,
the downgrade/seed/upgrade sequence, and real lock contention between two
processes are exercised by the `backend-postgres` CI job, which now runs THIS
release step rather than raw alembic, so the difference between what CI proves and
what a deployment does is nil. That job has never been executed on a GitHub
runner. Do not read these tests as a claim that it has.
"""

from __future__ import annotations

import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import release_migrate

BACKEND_ROOT = Path(__file__).resolve().parents[1]


class TestTheMigrationGraphIsCheckedFirst:
    def test_there_is_exactly_one_head_today(self) -> None:
        """Also the repository's single-head discipline, asserted where it is
        acted on rather than only in a runbook."""

        assert release_migrate.sole_head()

    def test_two_heads_stops_the_release(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A branch merge that leaves both parents as heads makes `upgrade head`
        ambiguous. Refusing here costs a directory listing; not refusing costs a
        failed deploy against a live database."""

        from alembic.script import ScriptDirectory

        monkeypatch.setattr(
            ScriptDirectory, "get_heads", lambda self: ["0069_support_tickets", "0069_other"]
        )

        with pytest.raises(release_migrate.ReleaseMigrationError) as raised:
            release_migrate.sole_head()

        message = str(raised.value)
        assert "one migration head" in message
        # Names both, so whoever reads the deploy log knows what to merge.
        assert "0069_other" in message

    def test_the_head_check_needs_no_database(self) -> None:
        """It runs before a connection exists, which is the point of it running
        first. Reading the source is the only way to assert an ordering that has
        no observable side effect when it passes."""

        import inspect

        source = inspect.getsource(release_migrate.run)
        head_check = source.index("sole_head(")
        engine_creation = source.index("create_async_engine(")

        assert head_check < engine_creation


class TestConcurrentReleasesSerialise:
    def test_the_lock_is_taken_and_released_with_the_same_key(self) -> None:
        """The bug this forbids is quiet: acquire with one key and release with
        another, and the lock is held until the connection dies. Every later
        deploy then waits ten minutes and fails."""

        import inspect

        acquire = inspect.getsource(release_migrate._acquire_advisory_lock)
        release = inspect.getsource(release_migrate._release_advisory_lock)

        assert "MIGRATION_ADVISORY_LOCK_KEY" in acquire
        assert "MIGRATION_ADVISORY_LOCK_KEY" in release
        assert "pg_try_advisory_lock" in acquire
        assert "pg_advisory_unlock" in release

    def test_waiting_for_the_lock_has_a_deadline(self) -> None:
        """A blocking `pg_advisory_lock` behind a process that died holding it
        waits as long as the connection lives, so a deploy hangs with no
        explanation. Polling with a deadline fails instead, and says why."""

        import inspect

        source = inspect.getsource(release_migrate._acquire_advisory_lock)

        assert "deadline" in source
        assert "pg_advisory_lock(" not in source.replace("pg_try_advisory_lock(", "")
        assert release_migrate.DEFAULT_LOCK_WAIT_SECONDS > 0

    def test_the_lock_is_released_even_when_the_upgrade_fails(self) -> None:
        """Otherwise one bad migration blocks every subsequent attempt, and the
        second symptom hides the first."""

        import inspect

        source = inspect.getsource(release_migrate.run)

        assert "finally:" in source
        assert "_release_advisory_lock" in source
        # The release call sits in a finally block, not on the success path.
        assert source.index("finally:") < source.index("_release_advisory_lock(connection)")

    def test_sqlite_is_not_pretended_to_be_locked(self) -> None:
        """Local development has no concurrent deployment to protect against.
        Claiming a lock that does not exist would be worse than skipping one."""

        import inspect

        source = inspect.getsource(release_migrate.run)

        assert 'engine.dialect.name == "postgresql"' in source
        assert "if is_postgres:" in source


def _run_release_step(database_url: str) -> subprocess.CompletedProcess[str]:
    """The release step as a deployment invokes it: a subprocess, judged by its
    exit code. Calling the function in-process would not test the exit code, and
    the exit code is the entire interface a deploy pipeline has."""

    return subprocess.run(
        [sys.executable, "-m", "scripts.release_migrate"],
        cwd=BACKEND_ROOT,
        env={
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "APP_ENV": "test",
            "DATABASE_URL": database_url,
            "PYTHONPATH": str(BACKEND_ROOT),
        },
        capture_output=True,
        text=True,
        timeout=180,
    )


class TestRunningItTwiceIsSafe:
    def test_a_database_already_at_head_applies_nothing(self, tmp_path: Path) -> None:
        """What every instance after the first one does on a deploy. It has to be
        a quiet success, not a second attempt at the same DDL."""

        database = tmp_path / "at-head.db"
        connection = sqlite3.connect(database)
        connection.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        connection.execute(
            "INSERT INTO alembic_version VALUES (?)", (release_migrate.sole_head(),)
        )
        connection.commit()
        connection.close()

        result = _run_release_step(f"sqlite+aiosqlite:///{database}")

        assert result.returncode == 0, result.stderr
        assert "Already at head" in result.stdout
        # Nothing was applied, so alembic never spoke.
        assert "Running upgrade" not in result.stdout + result.stderr


class TestFailureStopsTheRelease:
    def test_an_unmigratable_database_exits_non_zero(self, tmp_path: Path) -> None:
        """Uses a real failure rather than a simulated one: the migration chain
        declares a JSONB column, so a fresh SQLite database genuinely cannot be
        upgraded. What matters is that the process says so and fails."""

        result = _run_release_step(f"sqlite+aiosqlite:///{tmp_path / 'fresh.db'}")

        assert result.returncode == 1
        assert "Migration release step failed" in result.stderr

    def test_it_reports_the_reason_without_a_traceback(self, tmp_path: Path) -> None:
        """A deploy log is read under pressure. One line saying what stopped is
        more use than sixty lines of frames from inside alembic."""

        result = _run_release_step(f"sqlite+aiosqlite:///{tmp_path / 'fresh2.db'}")

        assert "Traceback (most recent call last)" not in result.stderr


class TestItDoesOneJob:
    def test_it_never_seeds_and_never_starts_the_application(self) -> None:
        """A release step that also starts serving cannot be run before traffic
        moves, which is the only position it is useful in."""

        source = (BACKEND_ROOT / "scripts" / "release_migrate.py").read_text(encoding="utf8")

        for forbidden in ("seed_staging_demo", "uvicorn", "app.main"):
            assert forbidden not in source, forbidden

    def test_the_start_script_no_longer_races(self) -> None:
        """The container start command runs on every instance. It must not be the
        thing that applies DDL directly."""

        script = (BACKEND_ROOT / "scripts" / "start_render.sh").read_text(encoding="utf8")
        # Comments in that file explain what it used to do, so only the lines
        # that actually execute are examined.
        commands = [
            line for line in script.splitlines() if not line.strip().startswith("#")
        ]

        assert any("scripts.release_migrate" in line for line in commands)
        assert not any("alembic upgrade head" in line for line in commands)

    def test_continuous_integration_runs_what_a_deployment_runs(self) -> None:
        """If CI proved `alembic upgrade head` while production ran the release
        step, everything this module adds would be untested on a real
        PostgreSQL."""

        workflow = (
            BACKEND_ROOT.parent / ".github" / "workflows" / "ci.yml"
        ).read_text(encoding="utf8")

        assert "python -m scripts.release_migrate" in workflow
        # The downgrade is deliberately still raw alembic: the release step only
        # ever moves forward, and going backwards is not something a deploy does.
        assert "alembic downgrade" in workflow
        assert "run: uv run alembic upgrade head" not in workflow
