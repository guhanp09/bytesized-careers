from __future__ import annotations

import logging

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.schema import CreateColumn

from app.core.config import settings
from app.core.job_taxonomy import CURRENT_LISTING_SCHEMA_VERSION
from app.db.base import Base

logger = logging.getLogger(__name__)


def should_sync_dev_sqlite_schema() -> bool:
    return settings.app_env == "development" and settings.database_url.startswith("sqlite")


async def sync_dev_sqlite_schema(engine: AsyncEngine) -> None:
    """Keep old local SQLite dev databases usable after model changes.

    This is intentionally development-only. Production and staging must continue to use
    Alembic migrations instead of opportunistic schema sync.
    """

    if not should_sync_dev_sqlite_schema():
        return

    # Import model modules before inspecting metadata.
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        if conn.dialect.name == "sqlite":
            await conn.execute(text("PRAGMA foreign_keys=ON"))
        await conn.run_sync(Base.metadata.create_all)

        def add_missing_columns(sync_conn) -> list[str]:
            inspector = inspect(sync_conn)
            preparer = sync_conn.dialect.identifier_preparer
            added: list[str] = []

            for table in Base.metadata.sorted_tables:
                if not inspector.has_table(table.name):
                    continue
                existing_columns = {column["name"] for column in inspector.get_columns(table.name)}
                table_name = preparer.quote(table.name)

                for column in table.columns:
                    if column.name in existing_columns:
                        continue
                    column_sql = str(CreateColumn(column).compile(dialect=sync_conn.dialect)).strip()
                    added_as_nullable = False
                    if (
                        sync_conn.dialect.name == "sqlite"
                        and not column.nullable
                        and column.server_default is None
                    ):
                        column_sql = column_sql.replace(" NOT NULL", "")
                        added_as_nullable = True
                    sync_conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_sql}"))
                    if table.name == "jobs" and column.name == "listing_schema_version":
                        # Every row that predates this additive column is a legacy
                        # version-1 listing. The column's server default remains the
                        # current model version
                        # for any later direct insert.
                        sync_conn.execute(
                            text("UPDATE jobs SET listing_schema_version = 1")
                        )
                    if added_as_nullable and column.default is not None:
                        default_arg = column.default.arg
                        try:
                            default_value = default_arg() if callable(default_arg) else default_arg
                        except TypeError:
                            default_value = None
                        if default_value is not None:
                            sync_conn.execute(
                                table.update()
                                .where(column.is_(None))
                                .values({column.name: default_value})
                            )
                    added.append(f"{table.name}.{column.name}")

            # SQLite cannot relax nullability/defaults with ALTER COLUMN. Batch
            # recreation is development-only and preserves every existing row
            # while bringing old create_all-managed databases in line with 0040.
            job_columns = {
                column["name"]: column
                for column in inspect(sync_conn).get_columns("jobs")
            }
            relaxed_columns = [
                name
                for name in ("category", "budget_currency", "budget_unit")
                if name in job_columns
                and (
                    not job_columns[name].get("nullable", True)
                    or job_columns[name].get("default") is not None
                )
            ]
            schema_version_column = job_columns.get("listing_schema_version")
            raw_schema_default = (
                str(schema_version_column.get("default") or "").strip("'\"() ")
                if schema_version_column
                else ""
            )
            needs_schema_default = bool(
                schema_version_column
                and raw_schema_default != str(CURRENT_LISTING_SCHEMA_VERSION)
            )
            if relaxed_columns or needs_schema_default:
                operations = Operations(MigrationContext.configure(sync_conn))
                with operations.batch_alter_table("jobs") as batch:
                    for name in relaxed_columns:
                        model_column = Base.metadata.tables["jobs"].c[name]
                        batch.alter_column(
                            name,
                            existing_type=model_column.type,
                            nullable=True,
                            server_default=None,
                        )
                    if needs_schema_default:
                        batch.alter_column(
                            "listing_schema_version",
                            existing_type=Base.metadata.tables["jobs"].c.listing_schema_version.type,
                            nullable=False,
                            server_default=str(CURRENT_LISTING_SCHEMA_VERSION),
                        )
                added.extend(f"jobs.{name}.relaxed" for name in relaxed_columns)
                if needs_schema_default:
                    added.append("jobs.listing_schema_version.default")

            # Existing SQLite tables do not get new indexes from create_all(checkfirst=True).
            refreshed_inspector = inspect(sync_conn)
            for table in Base.metadata.sorted_tables:
                if not refreshed_inspector.has_table(table.name):
                    continue
                for index in table.indexes:
                    index.create(sync_conn, checkfirst=True)

            return added

        added_columns = await conn.run_sync(add_missing_columns)

    if added_columns:
        logger.info(
            "dev_sqlite_schema_sync_added_columns",
            extra={"columns": added_columns},
        )
