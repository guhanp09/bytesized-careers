from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import settings  # noqa: E402
from app.db.seed import reset_dev_seed_data, seed_full_demo  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402

ALLOWED_ENVIRONMENTS = {"development", "staging", "test"}


class SeedEnvironmentError(RuntimeError):
    pass


def validate_seed_environment(app_env: str, confirm: str) -> None:
    normalized_env = app_env.strip().lower()
    normalized_confirm = confirm.strip().lower()

    if normalized_env == "production":
        raise SeedEnvironmentError("Refusing to seed demo data when APP_ENV=production.")
    if normalized_env not in ALLOWED_ENVIRONMENTS:
        raise SeedEnvironmentError(
            f"APP_ENV must be one of {sorted(ALLOWED_ENVIRONMENTS)} for demo seeding."
        )
    if normalized_confirm != normalized_env:
        raise SeedEnvironmentError(
            f"Confirmation mismatch: pass --confirm {normalized_env} for APP_ENV={normalized_env}."
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed deterministic CreatorJobs demo data for local/test/staging environments."
    )
    parser.add_argument(
        "--confirm",
        required=True,
        help="Must exactly match APP_ENV, for example --confirm staging.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete only deterministic seed-owned rows before recreating the demo baseline.",
    )
    return parser.parse_args()


def fail(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(2)


async def run_seed(reset: bool) -> dict[str, object]:
    async with SessionLocal() as session:
        if reset:
            return await reset_dev_seed_data(session)
        return await seed_full_demo(session)


async def main() -> None:
    args = parse_args()
    try:
        validate_seed_environment(settings.app_env, args.confirm)
    except SeedEnvironmentError as error:
        fail(str(error))

    try:
        result = await run_seed(args.reset)
    finally:
        await engine.dispose()

    print(json.dumps(result, indent=2, sort_keys=True, default=str))


if __name__ == "__main__":
    asyncio.run(main())

