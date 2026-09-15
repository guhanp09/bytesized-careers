"""Read-only timeout/recovery drill for the owned disposable PostgreSQL harness.

Run from backend with POSTGRES_TEST_DATABASE_URL set to the harness database.
Never accepts hosted URLs, URL query overrides, or arbitrary database names.
No schema, user row, credential or server configuration is modified.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import os

from sqlalchemy.engine import make_url


def validated_test_url(raw: str) -> str:
    try:
        url = make_url(raw)
        if (
            url.drivername != "postgresql+asyncpg"
            or not ipaddress.ip_address(url.host or "").is_loopback
            or url.database != "creatorjobs_interaction_test"
            or url.username != "creatorjobs_test"
            or url.port is None
            or bool(url.query)
        ):
            raise ValueError
    except Exception:
        raise ValueError("Only the owned loopback PostgreSQL test database is allowed") from None
    return raw


async def exercise() -> None:
    # Import only after main has validated/rebound the database environment.
    from sqlalchemy import text

    from app.db.session import engine

    try:
        async with asyncio.timeout(10):
            async with engine.connect() as connection:
                try:
                    await connection.execute(text("SELECT pg_sleep(1)"))
                except TimeoutError:
                    pass
                else:
                    raise AssertionError("Expected the configured command timeout")
                # The driver owns cancellation. Explicit rollback restores the
                # read-only failed transaction; it is not a write retry.
                await connection.rollback()
                assert (await connection.execute(text("SELECT 1"))).scalar_one() == 1
            async with engine.connect() as connection:
                assert (await connection.execute(text("SELECT 1"))).scalar_one() == 1
    finally:
        await engine.dispose()


def main() -> int:
    try:
        url = validated_test_url(os.environ.get("POSTGRES_TEST_DATABASE_URL", ""))
    except ValueError:
        print("Refusing database drill: set the owned loopback POSTGRES_TEST_DATABASE_URL.")
        return 2
    # Isolated process settings before importing the application's engine. The
    # URL cannot be changed by .env or default to a developer/hosted database.
    os.environ["APP_ENV"] = "test"
    os.environ["DATABASE_URL"] = url
    os.environ["DB_CONNECT_TIMEOUT_SECONDS"] = "2"
    os.environ["DB_COMMAND_TIMEOUT_SECONDS"] = "0.05"
    try:
        asyncio.run(exercise())
    except Exception as exc:
        # Driver exception text can include connection details. Report only a
        # finite class name, never a URL/password/server-provided message.
        print(json.dumps({"passed": False, "error_type": type(exc).__name__}))
        return 1
    print(json.dumps({"passed": True, "query_timeout": True, "rollback_and_recovery": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
