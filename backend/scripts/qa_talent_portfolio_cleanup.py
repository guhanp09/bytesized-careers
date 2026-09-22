"""Remove one namespace of talent/portfolio records from the owned QA SQLite file."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import uuid
from pathlib import Path

EXPECTED_URL = "sqlite+aiosqlite:///./.local-data/qa-playwright.db"
DATABASE = Path(__file__).resolve().parents[1] / ".local-data" / "qa-playwright.db"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("namespace", type=uuid.UUID)
    parser.add_argument(
        "--scenario",
        choices=("portfolio", "compensation"),
        default="portfolio",
        help="Select one fixed QA title namespace; arbitrary deletion targets are not accepted.",
    )
    args = parser.parse_args()
    if os.environ.get("APP_ENV") != "test" or os.environ.get("DATABASE_URL") != EXPECTED_URL:
        raise SystemExit("Refusing anything except the explicit disposable QA database.")
    if DATABASE.is_symlink() or not DATABASE.is_file() or DATABASE.parent.is_symlink():
        raise SystemExit("The QA harness must initialize its non-symlink database first.")

    listing_title = (
        f"Portfolio provenance {args.namespace}"
        if args.scenario == "portfolio"
        else f"USD compensation truth {args.namespace}"
    )
    portfolio_titles = (
        (
            f"Selected owned work {args.namespace}",
            f"Unselected owned work {args.namespace}",
        )
        if args.scenario == "portfolio"
        else ()
    )
    deleted = {"notifications": 0, "talent_listings": 0, "portfolio_items": 0}
    with sqlite3.connect(f"{DATABASE.as_uri()}?mode=rw", uri=True, timeout=5) as db:
        db.execute("PRAGMA foreign_keys=ON")
        listing_ids = [row[0] for row in db.execute(
            "SELECT id FROM talent_listings WHERE title = ?", (listing_title,)
        )]
        if len(listing_ids) > 1:
            raise ValueError("The unique QA namespace matched more than one talent listing.")
        if listing_ids:
            listing_id = uuid.UUID(hex=listing_ids[0])
            cursor = db.execute(
                "DELETE FROM notifications WHERE resource_type = ? AND resource_id IN (?, ?)",
                ("talent_listing", str(listing_id), listing_id.hex),
            )
            deleted["notifications"] = cursor.rowcount
        cursor = db.execute("DELETE FROM talent_listings WHERE title = ?", (listing_title,))
        deleted["talent_listings"] = cursor.rowcount
        if portfolio_titles:
            cursor = db.execute(
                "DELETE FROM portfolio_items WHERE title IN (?, ?)", portfolio_titles
            )
            deleted["portfolio_items"] = cursor.rowcount
            remaining = db.execute(
                "SELECT "
                "(SELECT COUNT(*) FROM talent_listings WHERE title = ?), "
                "(SELECT COUNT(*) FROM portfolio_items WHERE title IN (?, ?))",
                (listing_title, *portfolio_titles),
            ).fetchone()
        else:
            remaining = (
                db.execute(
                    "SELECT COUNT(*) FROM talent_listings WHERE title = ?",
                    (listing_title,),
                ).fetchone()[0],
                0,
            )
        if remaining != (0, 0):
            raise RuntimeError("Owned QA portfolio cleanup was incomplete.")
    print(json.dumps(deleted, sort_keys=True))


if __name__ == "__main__":
    main()
