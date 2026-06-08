#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

DEFAULT_DATABASE_URL = "postgresql+asyncpg://creatorjobs:creatorjobs@localhost:5432/creatorjobs"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug or f"role-{uuid.uuid4().hex[:8]}"


def _read_database_url_from_env_file(path: Path) -> str | None:
    if not path.exists():
        return None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "DATABASE_URL":
            return value.strip().strip('"').strip("'")
    return None


def _resolve_database_url() -> str:
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        return env_url

    repo_root = Path(__file__).resolve().parent.parent
    for candidate in (repo_root / "backend" / ".env", repo_root / ".env"):
        file_url = _read_database_url_from_env_file(candidate)
        if file_url:
            return file_url

    return DEFAULT_DATABASE_URL


def _normalize_database_url(url: str) -> str:
    normalized = url.strip()
    if normalized.startswith("postgresql://"):
        normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
    return normalized


async def _create_connected_engine(database_url: str) -> AsyncEngine:
    candidates = [_normalize_database_url(database_url)]
    if "@postgres:" in candidates[0]:
        candidates.append(candidates[0].replace("@postgres:", "@localhost:"))

    last_error: Exception | None = None
    for candidate in candidates:
        engine = create_async_engine(candidate, future=True)
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
            print(f"Connected using: {candidate}")
            return engine
        except Exception as exc:  # pragma: no cover - connection fallback
            last_error = exc
            await engine.dispose()

    raise RuntimeError(f"Could not connect to database. Last error: {last_error}") from last_error


def _load_role_entries(json_path: Path) -> list[dict[str, int | str]]:
    try:
        payload: Any = json.loads(json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in seed file: {exc}") from exc
    if not isinstance(payload, list):
        raise ValueError("Seed file must be a JSON array of role objects.")

    cleaned: list[dict[str, int | str]] = []
    seen: set[str] = set()
    for idx, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Role at index {idx} is not an object.")

        raw_name = item.get("name")
        raw_popularity = item.get("popularity_score")

        if not isinstance(raw_name, str):
            raise ValueError(f"Role at index {idx} has invalid 'name'.")
        name = raw_name.strip()
        if not name:
            raise ValueError(f"Role at index {idx} is empty.")

        if isinstance(raw_popularity, bool) or not isinstance(raw_popularity, int):
            raise ValueError(
                f"Role '{name}' has invalid popularity_score type; expected integer."
            )
        if raw_popularity < 0 or raw_popularity > 1000:
            raise ValueError(
                f"Role '{name}' has out-of-range popularity_score={raw_popularity}; expected 0..1000."
            )

        key = name.lower()
        if key in seen:
            raise ValueError(f"Duplicate role name (case-insensitive): '{name}'")
        seen.add(key)
        cleaned.append({"name": name, "popularity_score": raw_popularity})
    return cleaned


async def seed_roles(json_path: Path, database_url: str) -> None:
    role_entries = _load_role_entries(json_path)

    engine = await _create_connected_engine(database_url)
    inserted = 0
    skipped = 0

    try:
        async with engine.begin() as connection:
            existing_slug_rows = await connection.execute(text("SELECT slug FROM roles"))
            used_slugs = {
                (value or "").strip().lower() for value in existing_slug_rows.scalars().all() if value
            }

            insert_stmt = text(
                """
                INSERT INTO roles (
                  id, name, slug, version, is_active, popularity_score, category, description
                ) VALUES (
                  :id, :name, :slug, :version, :is_active, :popularity_score, :category, :description
                )
                ON CONFLICT DO NOTHING
                """
            )

            for role_entry in role_entries:
                name = str(role_entry["name"])
                popularity_score = int(role_entry["popularity_score"])
                base_slug = _slugify(name)
                slug = base_slug
                suffix = 2
                while slug in used_slugs:
                    slug = f"{base_slug}-{suffix}"
                    suffix += 1

                payload = {
                    "id": str(uuid.uuid4()),
                    "name": name,
                    "slug": slug,
                    "version": 1,
                    "is_active": True,
                    "popularity_score": popularity_score,
                    "category": "General",
                    "description": None,
                }
                result = await connection.execute(insert_stmt, payload)
                if result.rowcount and result.rowcount > 0:
                    inserted += 1
                    used_slugs.add(slug)
                else:
                    skipped += 1

            active_count = int(
                (await connection.execute(text("SELECT COUNT(*) FROM roles WHERE is_active = true"))).scalar_one()
            )

    except SQLAlchemyError as exc:
        raise RuntimeError(f"Failed seeding roles: {exc}") from exc
    finally:
        await engine.dispose()

    print(f"Canonical roles in file: {len(role_entries)}")
    print(f"Inserted this run: {inserted}")
    print(f"Active roles in DB: {active_count}")
    print(f"Skipped roles: {skipped}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed roles into the roles table from a JSON list of {name, popularity_score} objects."
    )
    parser.add_argument(
        "--file",
        default="seed/roles_batch_1.json",
        help="Path to canonical role registry JSON file.",
    )
    args = parser.parse_args()

    json_path = Path(args.file).resolve()
    if not json_path.exists():
        raise FileNotFoundError(f"Seed file not found: {json_path}")

    database_url = _resolve_database_url()
    asyncio.run(seed_roles(json_path=json_path, database_url=database_url))


if __name__ == "__main__":
    main()
