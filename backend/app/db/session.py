from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings


def _pool_options() -> dict[str, object]:
    """Pool settings for the configured database.

    SQLite is excluded because it has no connection pool worth sizing: the
    driver serialises access anyway, and passing pool arguments to it either
    errors or silently means nothing.

    For PostgreSQL the options are always BOUNDED. Capacity itself comes from
    configuration and production refuses to boot without it, because the right
    number depends on the database plan and the number of processes sharing it —
    a default chosen in this file would exhaust a small plan as soon as several
    instances ran, and the symptom would be a slow application rather than a
    visible misconfiguration.
    """

    if settings.database_url.startswith("sqlite"):
        return {}

    return {
        # A local default only. Production supplies the real numbers; see
        # validate_production_settings, which refuses to start without them.
        "pool_size": settings.db_pool_size if settings.db_pool_size is not None else 5,
        "max_overflow": (
            settings.db_max_overflow if settings.db_max_overflow is not None else 5
        ),
        # Bounded wait. Without it, exhaustion becomes requests hanging until the
        # client gives up — an outage with no error recorded anywhere.
        "pool_timeout": settings.db_pool_timeout_seconds,
        # Replaced by us before a proxy or managed database quietly drops it.
        "pool_recycle": settings.db_pool_recycle_seconds,
    }


engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    echo=settings.debug,
    **_pool_options(),
)


def enable_sqlite_foreign_keys(async_engine: Any) -> None:
    """Make SQLite exercise the same FK deletion actions as production."""

    if async_engine.url.get_backend_name() != "sqlite":
        return

    @event.listens_for(async_engine.sync_engine, "connect")
    def _set_sqlite_pragma(
        dbapi_connection: Any,
        _connection_record: Any,
    ) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


enable_sqlite_foreign_keys(engine)


SessionLocal = async_sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
