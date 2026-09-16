"""Owned-loopback database proof of import quota/claim/capacity transactions.

No provider, schema, credentials, server settings or pre-existing rows are changed.
The CLI refuses non-harness databases before importing the application engine.
Fixture rows belong to fresh UUIDs and are removed even when an assertion fails.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from scripts.exercise_database_timeouts import validated_test_url


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


async def _admit(factory, owner, draft, *, barrier=None) -> str:
    from app.repositories.job_import_execution_repository import (
        claim_draft_for_processing,
        count_live_owner_leases,
    )
    from app.repositories.job_import_quota_repository import consume_import_quota

    if barrier is not None:
        await barrier.wait()
    async with factory() as session:
        now = datetime.now(UTC)
        quota = await consume_import_quota(
            session, owner, limit=20, window=timedelta(hours=24), now=now
        )
        _require(quota.allowed, "Fixture unexpectedly exhausted daily allowance")
        claimed = await claim_draft_for_processing(
            session, draft, worker_id=f"drill-{uuid4().hex}", now=now
        )
        if claimed is None:
            await session.rollback()
            return "already_claimed"
        if await count_live_owner_leases(session, owner, now=now) > 2:
            await session.rollback()
            return "capacity"
        # This exercise proves the repository transaction on real connections;
        # application tests separately assert begin_processing commits here and
        # that no provider operation holds the admission transaction open.
        await session.commit()
        return "admitted"


async def _race(factory, owner, drafts) -> list[str]:
    barrier = asyncio.Barrier(len(drafts))
    tasks = [
        asyncio.create_task(_admit(factory, owner, draft, barrier=barrier)) for draft in drafts
    ]
    try:
        return await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def exercise(factory) -> dict[str, int | bool]:
    """Injected session factory permits local deterministic validation, not a DB fallback."""
    from sqlalchemy import delete, func, select

    from app.models import JobImportDraft, JobImportSource, User
    from app.models.job_import_quota import JobImportQuotaCounter
    from app.repositories.job_import_execution_repository import settle_finished_attempt

    owners = tuple(uuid4() for _ in range(3))
    drafts = [[], [], []]
    result: dict[str, int | bool] = {}
    try:
        async with factory() as session:
            for index, owner in enumerate(owners):
                session.add(User(id=owner, email=f"import-drill-{owner.hex}@example.test"))
                await session.flush()
                source = JobImportSource(
                    owner_user_id=owner,
                    source_type="pasted_text",
                    original_text="Disposable import admission fixture. No customer data.",
                    content_fingerprint=uuid4().hex,
                )
                session.add(source)
                await session.flush()
                for _ in range(8 if index == 0 else 1):
                    draft = JobImportDraft(
                        id=uuid4(),
                        owner_user_id=owner,
                        source_id=source.id,
                        target_listing_schema_version=3,
                        processing_status="awaiting_processing",
                    )
                    session.add(draft)
                    drafts[index].append(draft.id)
            await session.commit()

        outcomes = await _race(factory, owners[0], drafts[0])
        _require(outcomes.count("admitted") == 2, "Wrong cross-draft admission count")
        _require(outcomes.count("capacity") == 6, "Wrong cross-draft refusal count")
        async with factory() as session:
            counter = await session.get(JobImportQuotaCounter, owners[0])
            _require(counter.used == 2, "Refused work consumed daily quota")
            rows = list(
                (
                    await session.scalars(
                        select(JobImportDraft).where(JobImportDraft.owner_user_id == owners[0])
                    )
                ).all()
            )
            _require(
                sorted(row.processing_attempts for row in rows) == [0] * 6 + [1] * 2,
                "Refused work retained an attempt",
            )
            active = [row for row in rows if row.processing_worker_id is not None]
            _require(len(active) == 2, "Refused work retained a lease")
            released = active[0]
            await settle_finished_attempt(
                session, released.id, worker_id=released.processing_worker_id
            )
            await session.commit()
        refused_draft = next(
            draft
            for draft, outcome in zip(drafts[0], outcomes, strict=True)
            if outcome == "capacity"
        )
        _require(
            await _admit(factory, owners[0], refused_draft) == "admitted",
            "Released capacity was not reusable",
        )
        _require(
            await _admit(factory, owners[1], drafts[1][0]) == "admitted",
            "Account capacity leaked across owners",
        )
        duplicates = await _race(factory, owners[2], drafts[2] * 8)
        _require(
            duplicates.count("admitted") == 1 and duplicates.count("already_claimed") == 7,
            "Duplicate claims were not idempotent",
        )
        async with factory() as session:
            counter = await session.get(JobImportQuotaCounter, owners[2])
            _require(counter.used == 1, "Duplicate claims consumed extra quota")
        result = {
            "passed": True,
            "contenders": 8,
            "admitted": 2,
            "refused": 6,
            "quota_used": 2,
            "owner_isolation": True,
            "capacity_reusable": True,
            "duplicate_admitted": 1,
            "duplicate_refused": 7,
        }
    finally:
        # Exact fresh UUIDs only, never a table-wide delete or a selector based
        # on an email prefix that might match somebody else's test/customer row.
        async with factory() as session:
            await session.execute(delete(User).where(User.id.in_(owners)))
            await session.commit()
            for model, key in [
                (User, User.id),
                (JobImportSource, JobImportSource.owner_user_id),
                (JobImportDraft, JobImportDraft.owner_user_id),
                (JobImportQuotaCounter, JobImportQuotaCounter.user_id),
            ]:
                remaining = await session.scalar(
                    select(func.count()).select_from(model).where(key.in_(owners))
                )
                _require(remaining == 0, "Owned fixture cleanup was incomplete")
    result["cleanup_verified"] = True
    return result


async def _run_owned() -> dict[str, int | bool]:
    from app.db.session import SessionLocal, engine

    try:
        async with asyncio.timeout(30):
            return await exercise(SessionLocal)
    finally:
        await engine.dispose()


def main() -> int:
    try:
        url = validated_test_url(os.environ.get("POSTGRES_TEST_DATABASE_URL", ""))
    except ValueError:
        print("Refusing import drill: set the owned loopback POSTGRES_TEST_DATABASE_URL.")
        return 2
    os.environ.update(
        {
            "APP_ENV": "test",
            "DATABASE_URL": url,
            "DB_POOL_SIZE": "8",
            "DB_MAX_OVERFLOW": "0",
            "DB_POOL_TIMEOUT_SECONDS": "5",
            "DB_CONNECT_TIMEOUT_SECONDS": "2",
            "DB_COMMAND_TIMEOUT_SECONDS": "10",
        }
    )
    try:
        result = asyncio.run(_run_owned())
    except Exception as exc:
        print(json.dumps({"passed": False, "error_type": type(exc).__name__}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
