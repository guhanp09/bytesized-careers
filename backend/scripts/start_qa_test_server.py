from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.seed import seed_full_demo  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.models import User  # noqa: E402

CONTROLLER_ID = uuid.uuid5(uuid.NAMESPACE_DNS, "qa-playwright-controller.creatorjobs.local")


async def prepare() -> None:
    if settings.app_env != "test":
        raise RuntimeError("The QA Playwright server requires APP_ENV=test.")
    if not settings.enable_qa_persona_switcher:
        raise RuntimeError("ENABLE_QA_PERSONA_SWITCHER must be true for the QA harness.")
    if not settings.database_url.startswith("sqlite+aiosqlite:///"):
        raise RuntimeError("The QA Playwright server only accepts a disposable SQLite database.")
    if "qa-playwright" not in settings.database_url:
        raise RuntimeError("QA database path must contain 'qa-playwright'.")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)

    email = os.environ.get("QA_TEST_CONTROLLER_EMAIL", "qa-controller@example.com").strip().lower()
    password = os.environ.get("QA_TEST_CONTROLLER_PASSWORD", "LocalQaController123!")
    async with SessionLocal() as session:
        session.add(
            User(
                id=CONTROLLER_ID,
                email=email,
                username="qa_controller",
                display_name="Guhan QA Controller",
                account_type="BOTH",
                password_hash=hash_password(password),
                email_verified_at=datetime.now(UTC),
            )
        )
        await session.commit()
        await seed_full_demo(session)


if __name__ == "__main__":
    asyncio.run(prepare())
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "8100")),
        log_level="warning",
    )
