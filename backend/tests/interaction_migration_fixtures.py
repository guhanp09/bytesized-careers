from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


NAMESPACE = uuid.UUID("8ecac1e2-df33-4d55-a90c-8a178d94c3b7")


def fixture_id(key: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, key)


VALID_HIRED = fixture_id("application:valid-hired")
MISSING_ENGAGEMENT = fixture_id("application:missing-engagement")
MISMATCHED_ENGAGEMENT = fixture_id("application:mismatched-engagement")
HISTORICAL_INTERVIEWING = fixture_id("application:historical-interviewing")
LEGACY_UNKNOWN_ARCHIVED = fixture_id("application:legacy-unknown-archived")
LEGACY_ACCEPTED = fixture_id("interest:legacy-contacted")


async def _table_columns(connection, table_name: str) -> list[dict]:
    return list(
        (
            await connection.execute(
                text(
                    """
                    SELECT column_name, data_type, udt_name, is_nullable, column_default
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = :table_name
                    ORDER BY ordinal_position
                    """
                ),
                {"table_name": table_name},
            )
        ).mappings()
    )


def _fallback_value(column: dict, table_name: str):
    name = column["column_name"]
    data_type = column["data_type"]
    udt_name = column["udt_name"]
    if name == "id":
        return uuid.uuid4()
    if data_type in {"json", "jsonb"}:
        return {} if any(token in name for token in ("settings", "snapshot", "answers", "metadata")) else []
    if data_type == "boolean":
        return False
    if data_type in {"smallint", "integer", "bigint", "numeric", "real", "double precision"}:
        return 0
    if "timestamp" in data_type:
        return datetime.now(UTC)
    if data_type == "uuid" or udt_name == "uuid":
        return uuid.uuid4()
    if name == "email":
        return f"migration-{uuid.uuid4()}@example.com"
    if name == "title":
        return f"Migration fixture {table_name}"
    return "qa"


async def _insert(connection, table_name: str, **overrides) -> None:
    columns_info = await _table_columns(connection, table_name)
    required = [
        column
        for column in columns_info
        if column["is_nullable"] == "NO" and column["column_default"] is None
    ]
    values = {column["column_name"]: _fallback_value(column, table_name) for column in required}
    values.update(overrides)
    column_types = {column["column_name"]: column["data_type"] for column in columns_info}
    for name, value in list(values.items()):
        if column_types.get(name) in {"json", "jsonb"} and not isinstance(value, str):
            values[name] = json.dumps(value)
    columns = ", ".join(f'"{name}"' for name in values)
    parameters = ", ".join(f":{name}" for name in values)
    await connection.execute(
        text(f'INSERT INTO "{table_name}" ({columns}) VALUES ({parameters})'), values
    )


async def prepare() -> None:
    database_url = os.environ["DATABASE_URL"]
    engine = create_async_engine(database_url)
    async with engine.begin() as connection:
        owner = fixture_id("user:owner")
        other_owner = fixture_id("user:other-owner")
        talent = fixture_id("user:talent")
        recruiter = fixture_id("user:recruiter")
        for user_id, label in (
            (owner, "owner"),
            (other_owner, "other-owner"),
            (talent, "talent"),
            (recruiter, "recruiter"),
        ):
            await _insert(
                connection,
                "users",
                id=user_id,
                email=f"migration-{label}@example.com",
                username=f"m_{label.replace('-', '_')}",
            )

        jobs: dict[uuid.UUID, uuid.UUID] = {}
        for application_id in (
            VALID_HIRED,
            MISSING_ENGAGEMENT,
            MISMATCHED_ENGAGEMENT,
            HISTORICAL_INTERVIEWING,
            LEGACY_UNKNOWN_ARCHIVED,
        ):
            job_id = fixture_id(f"job:{application_id}")
            jobs[application_id] = job_id
            await _insert(
                connection,
                "jobs",
                id=job_id,
                title=f"Historical job {application_id}",
                category="Editing",
                posted_by_user_id=owner,
                status="published",
            )

        for application_id, status in (
            (VALID_HIRED, "hired"),
            (MISSING_ENGAGEMENT, "hired"),
            (MISMATCHED_ENGAGEMENT, "hired"),
            (HISTORICAL_INTERVIEWING, "interviewing"),
            (LEGACY_UNKNOWN_ARCHIVED, "archived"),
        ):
            await _insert(
                connection,
                "job_applications",
                id=application_id,
                job_id=jobs[application_id],
                applicant_user_id=talent,
                job_owner_user_id=owner,
                applicant_snapshot={},
                status=status,
                participant_status="new" if status == "archived" else status,
            )

        for application_id, engagement_owner in (
            (VALID_HIRED, owner),
            (MISMATCHED_ENGAGEMENT, other_owner),
        ):
            await _insert(
                connection,
                "engagements",
                id=fixture_id(f"engagement:{application_id}"),
                source_type="job_application",
                source_record_id=application_id,
                application_id=application_id,
                recruiter_user_id=engagement_owner,
                talent_user_id=talent,
                context_snapshot={},
                status="ready_to_start",
            )

        listing_id = fixture_id("listing:legacy-contacted")
        await _insert(
            connection,
            "talent_listings",
            id=listing_id,
            owner_user_id=talent,
            title="Legacy accepted request",
            status="published",
        )
        await _insert(
            connection,
            "talent_interests",
            id=LEGACY_ACCEPTED,
            talent_listing_id=listing_id,
            recruiter_user_id=recruiter,
            owner_user_id=talent,
            status="contacted",
            participant_status="contacted",
        )
        await _insert(
            connection,
            "engagements",
            id=fixture_id("engagement:legacy-contacted"),
            source_type="talent_interest",
            source_record_id=LEGACY_ACCEPTED,
            talent_interest_id=LEGACY_ACCEPTED,
            recruiter_user_id=recruiter,
            talent_user_id=talent,
            context_snapshot={},
            status="ready_to_start",
        )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(prepare())
