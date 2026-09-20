"""Scale existing canonical QA records, only in the harness-owned SQLite file."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import uuid
from pathlib import Path

EXPECTED_URL = "sqlite+aiosqlite:///./.local-data/qa-playwright.db"
DATABASE = Path(__file__).resolve().parents[1] / ".local-data" / "qa-playwright.db"
TABLES = ("jobs", "talent_listings")
COUNT = 105


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("create", "update", "remove"))
    parser.add_argument("namespace", type=uuid.UUID)
    parser.add_argument("--job", type=uuid.UUID)
    parser.add_argument("--talent", type=uuid.UUID)
    args = parser.parse_args()
    if os.environ.get("APP_ENV") != "test" or os.environ.get("DATABASE_URL") != EXPECTED_URL:
        raise SystemExit("Refusing anything except the explicit disposable QA database.")
    if DATABASE.is_symlink() or not DATABASE.is_file() or DATABASE.parent.is_symlink():
        raise SystemExit("The QA harness must initialize its non-symlink database first.")
    ids = {
        table: [uuid.uuid5(args.namespace, f"{table}:{index}") for index in range(COUNT + 1)]
        for table in TABLES
    }
    # mode=rw refuses to create a database on a misspelled/uninitialized path.
    with sqlite3.connect(f"{DATABASE.as_uri()}?mode=rw", uri=True, timeout=5) as db:
        db.execute("PRAGMA foreign_keys=ON")
        for table, template in zip(TABLES, (args.job, args.talent), strict=True):
            if args.action == "remove":
                db.executemany(f'DELETE FROM "{table}" WHERE id = ?', [(id.hex,) for id in ids[table]])
            elif args.action == "update":
                db.execute(
                    f'UPDATE "{table}" SET updated_at = ? WHERE id = ?',
                    ("2026-02-03 04:05:06.000000", ids[table][0].hex),
                )
            else:
                if template is None:
                    raise ValueError("Both public canonical template IDs are required.")
                columns = [row[1] for row in db.execute(f'PRAGMA table_info("{table}")')]
                quoted = ", ".join(f'"{column}"' for column in columns)
                overridden = {"id", "status", "created_at", "updated_at"}
                selection = ", ".join("?" if column in overridden else f'"{column}"' for column in columns)
                for index, id in enumerate(ids[table]):
                    values = {
                        "id": id.hex,
                        "status": "published" if index < COUNT else "draft",
                        "created_at": "2026-01-01 00:00:00.000000",
                        "updated_at": "2026-01-02 00:00:00.000000",
                    }
                    params = [values[column] for column in columns if column in overridden]
                    cursor = db.execute(
                        f'INSERT INTO "{table}" ({quoted}) SELECT {selection} FROM "{table}" '
                        "WHERE id = ? AND status = 'published' AND deleted_at IS NULL",
                        [*params, template.hex],
                    )
                    if cursor.rowcount != 1:
                        raise ValueError("The supplied public canonical template was not found.")
    print(json.dumps({table: [str(id) for id in values] for table, values in ids.items()}))


if __name__ == "__main__":
    main()
