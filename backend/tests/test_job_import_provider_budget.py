"""One owned provider deadline; leases and recovery must outlive that work."""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.core.config import settings
from app.core.job_import_attempt_liveness import (
    ATTEMPT_OVERHEAD_SECONDS,
    maximum_attempt_seconds,
    maximum_provider_seconds,
)
from app.models import JobImportDraft, JobImportSource
from app.services import job_import_processing_service as processing_module
from app.services.job_import_provider import JobImportProviderError, extract_with_budget
from tests.conftest import TestSessionLocal
from tests.test_openai_job_import import (
    FakeProvider,
    _auth,
    _source_and_draft,
    provider_override,  # noqa: F401 - fixture
)


@pytest.mark.parametrize("timeout", [5, 45, 90, 180])
@pytest.mark.parametrize("retries", [0, 1, 2, 3])
def test_budget_covers_viable_floor_every_retry_and_actual_backoff(timeout, retries):
    provider = maximum_provider_seconds(request_timeout_seconds=timeout, max_retries=retries)
    assert provider == max(45, timeout) * (retries + 1) + 2 * retries
    attempt = maximum_attempt_seconds(request_timeout_seconds=timeout, max_retries=retries)
    assert attempt == provider + ATTEMPT_OVERHEAD_SECONDS
    assert 165 <= attempt <= 846


async def test_owned_deadline_cancels_provider_once_and_waits_for_cleanup():
    cleaned = asyncio.Event()
    calls = 0

    async def extract(_request):
        nonlocal calls
        calls += 1
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.set()

    outer = asyncio.timeout(5)
    async with outer:
        with pytest.raises(JobImportProviderError) as caught:
            await extract_with_budget(
                SimpleNamespace(extract=extract), None, budget_seconds=0.02
            )
    assert not outer.expired()
    assert caught.value.code == "JOB_IMPORT_PROCESSING_TIMEOUT"
    assert caught.value.status_code == 504
    assert calls == 1
    assert cleaned.is_set()


async def test_result_returned_after_provider_swallows_deadline_cancellation_is_refused():
    async def extract(_request):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            return object()

    with pytest.raises(JobImportProviderError) as caught:
        await extract_with_budget(SimpleNamespace(extract=extract), None, budget_seconds=0.02)
    assert caught.value.code == "JOB_IMPORT_PROCESSING_TIMEOUT"


async def test_caller_cancellation_remains_cancellation():
    entered = asyncio.Event()
    cleaned = asyncio.Event()

    async def extract(_request):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.set()

    task = asyncio.create_task(
        extract_with_budget(SimpleNamespace(extract=extract), None, budget_seconds=20)
    )
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cleaned.is_set()
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("error", [TimeoutError("provider-owned"), RuntimeError("provider-owned")])
async def test_provider_failure_identity_is_not_relabelled_as_owned_expiry(error):
    async def extract(_request):
        raise error

    with pytest.raises(type(error)) as caught:
        await extract_with_budget(SimpleNamespace(extract=extract), None, budget_seconds=20)
    assert caught.value is error


async def test_success_returns_the_identical_provider_result():
    result = object()

    async def extract(_request):
        return result

    assert await extract_with_budget(
        SimpleNamespace(extract=extract), None, budget_seconds=20
    ) is result


async def test_budget_expiry_is_saved_as_retryable_failure_without_losing_source(
    client, provider_override, monkeypatch  # noqa: F811
):
    headers, _owner = await _auth(client, "provider-budget-expiry")
    source, draft = await _source_and_draft(client, headers, "providerbudget")
    path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

    class StalledProvider:
        calls = 0

        async def extract(self, _request):
            self.calls += 1
            await asyncio.Event().wait()

    provider = StalledProvider()
    provider_override(provider)
    with monkeypatch.context() as scoped:
        scoped.setattr(processing_module, "maximum_provider_seconds", lambda **_kwargs: 0.02)
        response = await client.post(path, headers=headers, json={})
    assert response.status_code == 504, response.text
    assert "JOB_IMPORT_PROCESSING_TIMEOUT" in response.text
    assert provider.calls == 1
    async with TestSessionLocal() as session:
        stored = await session.get(JobImportDraft, UUID(draft["id"]))
        saved_source = await session.get(JobImportSource, UUID(source["id"]))
        assert stored.processing_status == "processing_failed"
        assert stored.processing_attempts == 1
        assert stored.processing_worker_id is None
        assert stored.processing_lease_expires_at is None
        assert stored.processing_next_attempt_at is not None
        assert saved_source.original_text
    provider_override(FakeProvider())
    retried = await client.post(path, headers=headers, json={})
    assert retried.status_code == 200, retried.text
    assert retried.json()["outcome"] == "processed"


@pytest.mark.parametrize(("timeout", "retries", "lease"), [(5, 0, 165), (90, 1, 302), (180, 3, 846)])
async def test_real_process_claim_uses_the_same_budget_as_liveness(
    client, provider_override, monkeypatch, timeout, retries, lease  # noqa: F811
):
    headers, _owner = await _auth(client, f"provider-budget-{timeout}-{retries}")
    _source, draft = await _source_and_draft(client, headers, f"budget{timeout}{retries}")
    monkeypatch.setattr(settings, "openai_request_timeout_seconds", timeout)
    monkeypatch.setattr(settings, "openai_max_retries", retries)

    class InspectLeaseProvider(FakeProvider):
        async def extract(self, request):
            async with TestSessionLocal() as session:
                stored = await session.get(JobImportDraft, UUID(draft["id"]))
                remaining = (
                    stored.processing_lease_expires_at.replace(tzinfo=UTC) - datetime.now(UTC)
                ).total_seconds()
                assert lease - 5 < remaining <= lease
                assert stored.processing_status == "processing"
            return await super().extract(request)

    provider_override(InspectLeaseProvider())
    response = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/process", headers=headers, json={}
    )
    assert response.status_code == 200, response.text
