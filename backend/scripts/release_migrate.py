"""Apply migrations once, as a release step, and then get out of the way.

    python -m scripts.release_migrate

Until this existed, migrations ran from the container's start command. That is
fine with one instance and wrong with two, for a reason that does not announce
itself: every instance runs `alembic upgrade head` at the same time on boot.
Alembic takes no lock of its own, so two concurrent runs of the same DDL either
deadlock or one of them errors — and because the start script is `set -e`, the
instance that lost crash-loops. The service comes up degraded, or does not come
up, and the logs show a migration error on an instance that had nothing to do.

Three things happen here, in this order, because the order is the point.

The head check comes first and touches no database. Two heads means a merge went
wrong, and `upgrade head` would fail against production with an ambiguity error
after having already opened a connection. Failing on the filesystem is cheaper and
clearer.

Then a PostgreSQL advisory lock, so concurrent runs serialise instead of racing.
The instance holding it migrates; the others wait and then find there is nothing
to do. This is the whole reason the module exists.

Then the upgrade, with the revision reported before and after — so a release log
says what actually happened, including the common and boring case where the answer
is "already at head, nothing applied".

It never seeds, never starts the application, and exits non-zero on anything it
did not expect.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from alembic import command

BACKEND_ROOT = Path(__file__).resolve().parents[1]

#: One fixed key so every deployment competes for the same lock. Advisory locks
#: are per-database and cost nothing when uncontended, which is the normal case —
#: this is insurance against the deploy where it is not.
MIGRATION_ADVISORY_LOCK_KEY = 0x43524A5F4D494752  # "CRJ_MIGR"

#: How long an instance waits for whoever is migrating. Long enough for a real
#: migration on a real dataset; short enough that a stuck holder fails the deploy
#: instead of hanging it indefinitely.
DEFAULT_LOCK_WAIT_SECONDS = 600.0


class ReleaseMigrationError(RuntimeError):
    """Something that must stop the release rather than be logged and ignored."""


def alembic_config() -> Config:
    return Config(str(BACKEND_ROOT / "alembic.ini"))


def sole_head(config: Config | None = None) -> str:
    """The single revision to upgrade to, or a refusal.

    Deliberately the first thing that runs. Multiple heads is a merge accident,
    and finding it here costs a directory listing instead of a failed deploy.
    """

    script = ScriptDirectory.from_config(config or alembic_config())
    heads = list(script.get_heads())

    if len(heads) != 1:
        raise ReleaseMigrationError(
            f"expected exactly one migration head, found {len(heads)}: "
            f"{sorted(heads)}. Two heads means a branch merge left both parents "
            "as heads; resolve it with a merge revision before releasing."
        )
    return heads[0]


async def _current_revision(connection: object) -> str:
    """What the database says it is at, or that it has never been migrated."""

    try:
        result = await connection.execute(  # type: ignore[attr-defined]
            text("SELECT version_num FROM alembic_version")
        )
    except SQLAlchemyError:
        # A fresh database has no version table yet. Not an error — it is the
        # first deploy, and reporting it as one would be alarming and wrong.
        return "none (fresh database)"

    rows = [row[0] for row in result]
    return ", ".join(rows) if rows else "none (empty version table)"


async def _acquire_advisory_lock(connection: object, *, wait_seconds: float) -> None:
    """Serialise concurrent releases, or fail the deploy trying.

    Polled rather than blocking: a blocking `pg_advisory_lock` behind a stuck
    holder waits for as long as the connection survives, which turns one bad
    migration into a deploy that never finishes and never says why.
    """

    deadline = time.monotonic() + wait_seconds
    attempt = 0
    while True:
        acquired = await connection.execute(  # type: ignore[attr-defined]
            text("SELECT pg_try_advisory_lock(:key)"),
            {"key": MIGRATION_ADVISORY_LOCK_KEY},
        )
        if acquired.scalar() is True:
            return

        attempt += 1
        if time.monotonic() >= deadline:
            raise ReleaseMigrationError(
                "another process has held the migration lock for longer than "
                f"{wait_seconds:.0f}s. Either a migration is genuinely still "
                "running, or a previous release died holding it; do not force "
                "past this without looking."
            )
        if attempt == 1:
            print("Another instance is migrating. Waiting for it to finish...")
        await asyncio.sleep(1.0)


async def _release_advisory_lock(connection: object) -> None:
    await connection.execute(  # type: ignore[attr-defined]
        text("SELECT pg_advisory_unlock(:key)"),
        {"key": MIGRATION_ADVISORY_LOCK_KEY},
    )


async def run(*, wait_seconds: float = DEFAULT_LOCK_WAIT_SECONDS) -> str:
    """Bring the database to the sole head. Returns the revision it ends at."""

    from app.core.config import settings

    config = alembic_config()
    target = sole_head(config)

    engine = create_async_engine(
        settings.database_url,
        poolclass=NullPool,
        # Advisory locks and version reads both want to see committed state
        # immediately, including what the upgrade running in another thread has
        # just written.
        isolation_level="AUTOCOMMIT",
    )
    is_postgres = engine.dialect.name == "postgresql"

    try:
        async with engine.connect() as connection:
            if is_postgres:
                await _acquire_advisory_lock(connection, wait_seconds=wait_seconds)
            else:
                # SQLite has no advisory locks and no concurrent deployment to
                # protect against. Skipping is correct; pretending to lock would
                # be worse than not locking.
                print("Not PostgreSQL — skipping the migration advisory lock.")

            try:
                before = await _current_revision(connection)
                print(f"At: {before}")
                print(f"Target: {target}")

                if before == target:
                    print("Already at head. Nothing to apply.")
                    return target

                # Alembic's env.py calls asyncio.run() itself, so it cannot be
                # invoked from inside this event loop. A worker thread has no
                # running loop, which is exactly what it needs.
                await asyncio.to_thread(command.upgrade, config, "head")

                after = await _current_revision(connection)
                print(f"Now at: {after}")
                if after != target:
                    raise ReleaseMigrationError(
                        f"upgrade finished but the database reports {after!r} "
                        f"rather than {target!r}"
                    )
                return after
            finally:
                if is_postgres:
                    await _release_advisory_lock(connection)
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lock-wait-seconds",
        type=float,
        default=DEFAULT_LOCK_WAIT_SECONDS,
        help="how long to wait for another instance's migration to finish",
    )
    arguments = parser.parse_args(argv)

    try:
        asyncio.run(run(wait_seconds=arguments.lock_wait_seconds))
    except ReleaseMigrationError as exc:
        print(f"Migration release step failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - a release step must not half-succeed
        # Deliberately broad, and deliberately not re-raised as a traceback:
        # whatever went wrong, the answer is that this release does not proceed.
        print(f"Migration release step failed: {exc!r}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - operator entry point
    raise SystemExit(main())
