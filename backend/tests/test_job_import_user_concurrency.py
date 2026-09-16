"""User admission spans drafts and rolls back work that never reaches a provider."""

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from app.core.config import Settings, settings
from app.models import JobImportDraft
from app.models.job_import_quota import JobImportQuotaCounter
from app.services import job_import_processing_service as processing_module
from tests.conftest import TestSessionLocal
from tests.test_openai_job_import import (
    FakeProvider,
    _auth,
    _service,
    _source_and_draft,
    provider_override,  # noqa: F401 - fixture
)


async def test_six_different_drafts_admit_exactly_two_calls_and_refusals_spend_nothing(
    client, provider_override, monkeypatch  # noqa: F811
):
    monkeypatch.setattr(settings, "job_import_concurrency_limit", 2)
    headers, owner = await _auth(client, "user-concurrency-six")
    drafts = [
        (await _source_and_draft(client, headers, f"concurrency{i}"))[1]
        for i in range(6)
    ]
    release = asyncio.Event()
    four_finished = asyncio.Event()
    finished = []

    class BlockingProvider(FakeProvider):
        calls = 0

        async def extract(self, request):
            self.calls += 1
            await release.wait()
            return await super().extract(request)

    provider = BlockingProvider()
    provider_override(provider)

    async def submit(draft):
        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process", headers=headers, json={}
        )
        finished.append((draft, response))
        if len(finished) >= 4:
            four_finished.set()
        return response

    tasks = [asyncio.create_task(submit(draft)) for draft in drafts]
    try:
        await asyncio.wait_for(four_finished.wait(), timeout=10)
        assert provider.calls == 2
        assert len(finished) == 4
        for draft, response in finished:
            assert response.status_code == 429, response.text
            assert "JOB_IMPORT_CONCURRENCY_LIMIT" in response.text
            async with TestSessionLocal() as session:
                stored = await session.get(JobImportDraft, UUID(draft["id"]))
                assert stored.processing_status == "awaiting_processing"
                assert stored.processing_attempts == 0
                assert stored.processing_worker_id is None
                assert stored.processing_lease_expires_at is None
    finally:
        release.set()
        responses = await asyncio.wait_for(asyncio.gather(*tasks), timeout=10)
    assert sorted(response.status_code for response in responses) == [200, 200, 429, 429, 429, 429]
    async with TestSessionLocal() as session:
        quota = await session.get(JobImportQuotaCounter, owner)
        assert quota.used == 2
    # Finishing releases capacity; the refused draft was not damaged or charged.
    retry_draft = next(draft for draft, response in finished if response.status_code == 429)
    provider_override(FakeProvider())
    retried = await client.post(
        f"/api/v1/job-imports/drafts/{retry_draft['id']}/process", headers=headers, json={}
    )
    assert retried.status_code == 200, retried.text


async def test_another_account_has_independent_capacity(
    client, provider_override, monkeypatch  # noqa: F811
):
    monkeypatch.setattr(settings, "job_import_concurrency_limit", 1)
    accounts = []
    for label in ["independent-a", "independent-b"]:
        headers, _owner = await _auth(client, label)
        _source, draft = await _source_and_draft(client, headers, label)
        accounts.append((headers, draft))
    release = asyncio.Event()
    both_entered = asyncio.Event()

    class BlockingProvider(FakeProvider):
        calls = 0

        async def extract(self, request):
            self.calls += 1
            if self.calls == 2:
                both_entered.set()
            await release.wait()
            return await super().extract(request)

    provider_override(BlockingProvider())
    tasks = [
        asyncio.create_task(client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process", headers=headers, json={}
        ))
        for headers, draft in accounts
    ]
    try:
        await asyncio.wait_for(both_entered.wait(), timeout=10)
    finally:
        release.set()
        responses = await asyncio.wait_for(asyncio.gather(*tasks), timeout=10)
    assert all(response.status_code == 200 for response in responses)


@pytest.mark.parametrize(("status", "deleted"), [
    ("processing", False), ("discarded", False), ("discarded", True),
    ("awaiting_recruiter_review", False),
])
async def test_live_lease_counts_even_if_draft_is_hidden_and_expiry_restores_capacity(
    client, provider_override, monkeypatch, status, deleted  # noqa: F811
):
    monkeypatch.setattr(settings, "job_import_concurrency_limit", 1)
    headers, owner = await _auth(client, f"hidden-{status}-{deleted}")
    _source, occupied = await _source_and_draft(client, headers, "occupied")
    _source, waiting = await _source_and_draft(client, headers, "waiting")
    async with TestSessionLocal() as session:
        live = await session.get(JobImportDraft, UUID(occupied["id"]))
        live.processing_status = status
        live.deleted_at = datetime.now(UTC) if deleted else None
        live.processing_lease_expires_at = datetime.now(UTC) + timedelta(minutes=5)
        live.processing_worker_id = "owned-live-attempt"
        await session.commit()
    provider_override(FakeProvider())
    path = f"/api/v1/job-imports/drafts/{waiting['id']}/process"
    refused = await client.post(path, headers=headers, json={})
    assert refused.status_code == 429, refused.text
    async with TestSessionLocal() as session:
        quota = await session.get(JobImportQuotaCounter, owner)
        assert quota is None or quota.used == 0
        live = await session.get(JobImportDraft, UUID(occupied["id"]))
        live.processing_lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()
    retried = await client.post(path, headers=headers, json={})
    assert retried.status_code == 200, retried.text


async def test_quota_claim_and_capacity_share_one_transaction_and_provider_holds_none(
    client, monkeypatch
):
    headers, owner = await _auth(client, "capacity-transaction")
    _source, draft = await _source_and_draft(client, headers, "capacity-transaction")
    transactions = []
    for name in ["consume_import_quota", "claim_draft_for_processing", "count_live_owner_leases"]:
        original = getattr(processing_module, name)

        async def observed(session, *args, _original=original, **kwargs):
            result = await _original(session, *args, **kwargs)
            transactions.append(session.sync_session.get_transaction())
            return result

        monkeypatch.setattr(processing_module, name, observed)
    async with TestSessionLocal() as session:
        class InspectProvider(FakeProvider):
            async def extract(self, request):
                assert not session.in_transaction()
                return await super().extract(request)

        service = processing_module.JobImportProcessingService(_service(session), InspectProvider())
        result = await service.process(UUID(draft["id"]), owner_user_id=owner)
        assert result.outcome == "processed"
    assert len(transactions) == 3
    assert transactions[0] is not None
    assert all(transaction is transactions[0] for transaction in transactions)


@pytest.mark.parametrize("value", [0, -1, 11, float("inf")])
def test_user_concurrency_configuration_is_bounded(value):
    with pytest.raises(ValueError):
        Settings(_env_file=None, JOB_IMPORT_CONCURRENCY_LIMIT=value)
