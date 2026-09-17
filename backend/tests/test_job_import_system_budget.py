"""Global admissions use the existing limiter, not a second Redis algorithm."""

import asyncio
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.core import rate_limit as limits
from app.core.config import Settings, settings
from app.models import JobImportDraft
from app.models.job_import_quota import JobImportQuotaCounter
from app.services.job_import_processing_service import JobImportProcessingService
from app.services.job_import_service import JobImportError
from app.services.job_import_system_budget import (
    SYSTEM_ATTEMPT_WINDOW_SECONDS,
    reserve_system_import_attempt,
)
from tests.conftest import TestSessionLocal
from tests.test_openai_job_import import (
    FakeProvider,
    _auth,
    _service,
    _source_and_draft,
    provider_override,  # noqa: F401 - fixture
)
from tests.test_rate_limit import _AtomicEvalClient, _redis_backend


@pytest.fixture
def enforced_budget(monkeypatch):
    # Most API tests bypass request limits; these exercise real enforcement.
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "job_import_system_attempt_limit", 2)
    backend = limits.InMemoryRateLimitBackend()
    monkeypatch.setattr(limits, "_limiter", backend)
    return backend


async def test_shared_redis_protocol_caps_concurrent_callers(enforced_budget, monkeypatch):
    client = _AtomicEvalClient()
    monkeypatch.setattr(limits, "_limiter", _redis_backend(client))
    results = await asyncio.gather(
        *(reserve_system_import_attempt() for _ in range(20)), return_exceptions=True
    )
    assert sum(result is None for result in results) == 2
    refused = [result for result in results if isinstance(result, JobImportError)]
    assert len(refused) == 18
    assert all(error.code == "JOB_IMPORT_SYSTEM_BUDGET_EXHAUSTED" for error in refused)
    assert client.eval_calls == 20
    assert len(client._members["rate_limit:job_import_system_attempts_v1:system"]) == 2


async def test_window_and_limit_changes_do_not_reset_history(enforced_budget, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(limits.time, "monotonic", lambda: clock[0])
    await reserve_system_import_attempt()
    await reserve_system_import_attempt()
    monkeypatch.setattr(settings, "job_import_system_attempt_limit", 1)
    clock[0] += SYSTEM_ATTEMPT_WINDOW_SECONDS - 1
    with pytest.raises(JobImportError, match="shared allowance"):
        await reserve_system_import_attempt()
    clock[0] += 1
    await reserve_system_import_attempt()


async def test_backend_failure_is_closed_and_does_not_leak(enforced_budget, monkeypatch):
    class BrokenBackend:
        async def hit(self, **kwargs):
            raise RuntimeError("secret redis password and account contents")

    monkeypatch.setattr(limits, "_limiter", BrokenBackend())
    with pytest.raises(JobImportError) as caught:
        await reserve_system_import_attempt()
    assert caught.value.code == "JOB_IMPORT_SYSTEM_BUDGET_UNAVAILABLE"
    assert caught.value.status_code == 503
    assert "secret" not in caught.value.message


@pytest.mark.parametrize("value", [0, -1, 100_001])
def test_system_limit_rejects_unbounded_values(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, APP_ENV="test", JOB_IMPORT_SYSTEM_ATTEMPT_LIMIT=value)


async def _stored_unspent(draft_id, owner):
    async with TestSessionLocal() as session:
        draft = await session.get(JobImportDraft, UUID(draft_id))
        assert draft.processing_status == "awaiting_processing"
        assert draft.processing_attempts == 0
        assert draft.processing_worker_id is None
        assert draft.processing_lease_expires_at is None
        quota = await session.get(JobImportQuotaCounter, owner)
        assert quota is None or quota.used == 0


async def test_accounts_share_allowance_and_completed_reads_remain_free(
    client, provider_override, monkeypatch  # noqa: F811
):
    accounts = []
    for label in ["system-a", "system-b", "system-c"]:
        headers, owner = await _auth(client, label)
        _source, draft = await _source_and_draft(client, headers, label)
        accounts.append((headers, owner, draft))
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "job_import_system_attempt_limit", 2)
    backend = limits.InMemoryRateLimitBackend()
    monkeypatch.setattr(limits, "_limiter", backend)
    provider = FakeProvider()
    provider_override(provider)
    for headers, _owner, draft in accounts[:2]:
        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process", headers=headers, json={}
        )
        assert response.status_code == 200, response.text
    headers, owner, draft = accounts[2]
    refused = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/process", headers=headers, json={}
    )
    assert refused.status_code == 429, refused.text
    assert "JOB_IMPORT_SYSTEM_BUDGET_EXHAUSTED" in refused.text
    await _stored_unspent(draft["id"], owner)
    assert provider.calls == 2
    # Completed draft reads must not consult the exhausted global bucket.
    first_headers, _owner, first = accounts[0]
    repeated = await client.post(
        f"/api/v1/job-imports/drafts/{first['id']}/process", headers=first_headers, json={}
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["outcome"] == "already_processed"
    assert len(backend._buckets["job_import_system_attempts_v1:system"]) == 2

    async def unavailable(**kwargs):
        raise ConnectionError("private broker details")

    monkeypatch.setattr(backend, "hit", unavailable)
    # Owned reads remain available. Mutations retain the existing mandatory
    # HTTP safeguard; a global-budget exemption must not bypass that boundary.
    readable = await client.get(
        f"/api/v1/job-imports/drafts/{first['id']}", headers=first_headers
    )
    assert readable.status_code == 200, readable.text
    # This complete deterministic extraction is ready to enter Post Job; it
    # remains a private import draft, not an automatically published listing.
    assert readable.json()["processing_status"] == "ready_to_apply"
    blocked_mutation = await client.post(
        f"/api/v1/job-imports/drafts/{first['id']}/process", headers=first_headers, json={}
    )
    assert blocked_mutation.status_code == 503, blocked_mutation.text
    assert "private" not in blocked_mutation.text
    assert provider.calls == 2


@pytest.mark.parametrize("cancel", [False, True])
async def test_uncertain_reservation_rolls_back_local_admission_but_is_not_refunded(
    client, provider_override, monkeypatch, cancel  # noqa: F811
):
    headers, owner = await _auth(client, f"uncertain-{cancel}")
    _source, draft = await _source_and_draft(client, headers, f"uncertain-{cancel}")
    monkeypatch.setattr(settings, "app_env", "development")
    backend = limits.InMemoryRateLimitBackend()
    monkeypatch.setattr(limits, "_limiter", backend)
    original_hit = backend.hit

    async def uncertain_hit(*, key, rule):
        result = await original_hit(key=key, rule=rule)
        if rule.name == "job_import_system_attempts_v1":
            if cancel:
                raise asyncio.CancelledError()
            raise TimeoutError("private Redis URL")
        return result

    monkeypatch.setattr(backend, "hit", uncertain_hit)
    provider = FakeProvider()
    provider_override(provider)
    if cancel:
        # Starlette's BaseHTTPMiddleware translates a synthetic child-task
        # cancellation into 'No response returned'. Assert cancellation identity
        # where the admission transaction is actually owned instead.
        async with TestSessionLocal() as session:
            service = JobImportProcessingService(_service(session), provider)
            with pytest.raises(asyncio.CancelledError):
                await service.process(UUID(draft["id"]), owner_user_id=owner)
    else:
        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process", headers=headers, json={}
        )
        assert response.status_code == 503, response.text
        assert "JOB_IMPORT_SYSTEM_BUDGET_UNAVAILABLE" in response.text
        assert "private" not in response.text
    assert provider.calls == 0
    await _stored_unspent(draft["id"], owner)
    assert len(backend._buckets["job_import_system_attempts_v1:system"]) == 1


async def test_ongoing_duplicate_does_not_reserve_twice(
    client, provider_override, monkeypatch  # noqa: F811
):
    headers, _owner = await _auth(client, "global-duplicate")
    _source, draft = await _source_and_draft(client, headers, "global-duplicate")
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "job_import_system_attempt_limit", 1)
    backend = limits.InMemoryRateLimitBackend()
    monkeypatch.setattr(limits, "_limiter", backend)
    release = asyncio.Event()
    started = asyncio.Event()
    provider = FakeProvider(started=started, release=release)
    provider_override(provider)
    path = f"/api/v1/job-imports/drafts/{draft['id']}/process"
    task = asyncio.create_task(client.post(path, headers=headers, json={}))
    try:
        await asyncio.wait_for(started.wait(), timeout=10)
        repeated = await client.post(path, headers=headers, json={})
        assert repeated.status_code == 200, repeated.text
        assert repeated.json()["outcome"] == "already_processing"
    finally:
        release.set()
        first = await asyncio.wait_for(task, timeout=10)
    assert first.status_code == 200, first.text
    assert provider.calls == 1
    assert len(backend._buckets["job_import_system_attempts_v1:system"]) == 1


async def test_processing_commit_failure_does_not_refund_global_unit(
    client, provider_override, monkeypatch  # noqa: F811
):
    headers, owner = await _auth(client, "global-commit-failure")
    _source, draft = await _source_and_draft(client, headers, "global-commit-failure")
    monkeypatch.setattr(settings, "app_env", "development")
    backend = limits.InMemoryRateLimitBackend()
    monkeypatch.setattr(limits, "_limiter", backend)
    provider = FakeProvider()

    async with TestSessionLocal() as session:
        imports = _service(session)

        async def failed_commit(*args, **kwargs):
            raise RuntimeError("database unavailable before commit")

        monkeypatch.setattr(imports, "begin_processing", failed_commit)
        service = JobImportProcessingService(imports, provider)
        with pytest.raises(RuntimeError, match="before commit"):
            await service.process(UUID(draft["id"]), owner_user_id=owner)

    assert provider.calls == 0
    await _stored_unspent(draft["id"], owner)
    assert len(backend._buckets["job_import_system_attempts_v1:system"]) == 1
