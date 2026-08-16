"""What the durable lease adds on top of the read-time staleness assessment.

`job_import_attempt_liveness` already settles a stale `processing` row when
somebody reads it. That covers the recruiter who comes back and refreshes. It
does not cover the row nobody reads again, it does not stop two requests calling
the provider at once, and it does not bound how many times an import may be
started.

So these tests are about the three things ownership actually buys:

* two concurrent requests produce ONE provider call, not two bills;
* an attempt that finishes hands the row back, rather than leaving it looking
  busy to every later sweep;
* a failed attempt says when it may be tried again, and a person asking again
  does not have to wait for that.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.models import JobImportDraft
from tests.conftest import TestSessionLocal
from tests.test_openai_job_import import (
    FakeProvider,
    _auth,
    _source_and_draft,
    provider_override,  # noqa: F401 - fixture
)


async def _stored(draft_id: str) -> JobImportDraft:
    async with TestSessionLocal() as session:
        row = await session.get(JobImportDraft, UUID(str(draft_id)))
        assert row is not None
        return row


@pytest.mark.asyncio
class TestOneImportIsOneProviderCall:
    async def test_a_second_request_while_one_is_running_does_not_call_again(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        """The bill this prevents is the whole point of an atomic claim.

        The provider is held open until both requests are in flight, which is
        the interleaving that a check-then-act claim gets wrong: both read the
        draft as free, both call, and the recruiter pays twice for one import.
        """

        headers, _owner = await _auth(client, "import-lease-concurrent")
        _source, draft = await _source_and_draft(client, headers, "leaseconcurrent")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

        released = asyncio.Event()
        entered = asyncio.Event()

        class BlockingProvider(FakeProvider):
            calls = 0

            async def extract(self, request):
                BlockingProvider.calls += 1
                entered.set()
                await released.wait()
                return await super().extract(request)

        provider_override(BlockingProvider())

        first = asyncio.create_task(client.post(path, headers=headers, json={}))
        await asyncio.wait_for(entered.wait(), timeout=5)

        second = await client.post(path, headers=headers, json={})

        released.set()
        first_response = await asyncio.wait_for(first, timeout=10)

        assert BlockingProvider.calls == 1
        assert first_response.status_code == 200
        # The established contract, deliberately preserved: a second request
        # while one is running is told what is happening rather than refused.
        # What matters is that it did not produce a second provider call.
        assert second.status_code == 200
        assert second.json()["outcome"] == "already_processing"


@pytest.mark.asyncio
class TestTheRowIsHandedBack:
    async def test_a_finished_attempt_holds_no_lease(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        """A lease left behind makes the draft look busy to every later sweep —
        the same "nobody will look at this again" state it exists to end."""

        headers, _owner = await _auth(client, "import-lease-done")
        _source, draft = await _source_and_draft(client, headers, "leasedone")
        provider_override(FakeProvider())

        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process", headers=headers, json={}
        )
        assert response.status_code == 200

        stored = await _stored(draft["id"])
        assert stored.processing_lease_expires_at is None
        assert stored.processing_worker_id is None
        # And it is not owed a retry: it succeeded.
        assert stored.processing_next_attempt_at is None

    async def test_the_attempt_was_counted(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        """Counted at claim, so a process that dies mid-attempt still spent one.

        This is what bounds a crash loop: a failure that reports nothing cannot
        be counted at failure time.
        """

        headers, _owner = await _auth(client, "import-lease-counted")
        _source, draft = await _source_and_draft(client, headers, "leasecounted")
        provider_override(FakeProvider())

        await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process", headers=headers, json={}
        )

        assert (await _stored(draft["id"])).processing_attempts == 1


@pytest.mark.asyncio
class TestAFailedAttemptSaysWhenToTryAgain:
    async def test_a_provider_failure_schedules_a_retry_and_releases_the_row(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        headers, _owner = await _auth(client, "import-lease-failed")
        _source, draft = await _source_and_draft(client, headers, "leasefailed")

        class FailingProvider:
            async def extract(self, _request):
                raise RuntimeError("provider is unreachable")

        provider_override(FailingProvider())
        await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process", headers=headers, json={}
        )

        stored = await _stored(draft["id"])
        assert stored.processing_lease_expires_at is None
        assert stored.processing_next_attempt_at is not None
        assert stored.processing_attempts == 1

    async def test_the_recruiter_may_try_again_immediately(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        """Backoff restrains the machine. A person pressing the button is
        watching, wants it now, and is already bounded by the attempt ceiling
        and the route's rate limit."""

        headers, _owner = await _auth(client, "import-lease-retry")
        _source, draft = await _source_and_draft(client, headers, "leaseretry")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

        class FailingProvider:
            async def extract(self, _request):
                raise RuntimeError("provider is unreachable")

        provider_override(FailingProvider())
        await client.post(path, headers=headers, json={})

        scheduled = (await _stored(draft["id"])).processing_next_attempt_at
        assert scheduled is not None
        assert scheduled > datetime.now(UTC).replace(tzinfo=scheduled.tzinfo)

        provider_override(FakeProvider())
        retried = await client.post(path, headers=headers, json={})

        assert retried.status_code == 200
        assert retried.json()["outcome"] == "processed"


@pytest.mark.asyncio
class TestARepeatNeverSpendsTwice:
    """The property AI-002 is actually about, stated as a call count.

    Creation idempotency already exists and is tested elsewhere: a duplicate
    source or draft request returns the same record. What is asserted here is
    the expensive half — that asking again for a draft that already exists does
    not buy a second one.
    """

    async def test_processing_an_already_processed_draft_calls_nothing(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        headers, _owner = await _auth(client, "import-lease-repeat")
        _source, draft = await _source_and_draft(client, headers, "leaserepeat")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

        class CountingProvider(FakeProvider):
            calls = 0

            async def extract(self, request):
                CountingProvider.calls += 1
                return await super().extract(request)

        provider_override(CountingProvider())

        first = await client.post(path, headers=headers, json={})
        second = await client.post(path, headers=headers, json={})
        third = await client.post(path, headers=headers, json={})

        assert first.json()["outcome"] == "processed"
        assert second.json()["outcome"] == "already_processed"
        assert third.json()["outcome"] == "already_processed"
        assert CountingProvider.calls == 1

    async def test_a_repeat_does_not_consume_another_attempt(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        """Attempts bound spend, so an answer that costs nothing must not spend
        one — otherwise five refreshes would exhaust a working import."""

        headers, _owner = await _auth(client, "import-lease-noattempt")
        _source, draft = await _source_and_draft(client, headers, "leasenoattempt")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"
        provider_override(FakeProvider())

        await client.post(path, headers=headers, json={})
        await client.post(path, headers=headers, json={})
        await client.post(path, headers=headers, json={})

        assert (await _stored(draft["id"])).processing_attempts == 1


@pytest.mark.asyncio
class TestTheQuotaBindsTheRequestPath:
    async def test_an_exhausted_quota_refuses_before_the_provider_is_called(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
        monkeypatch,
    ) -> None:
        """429 rather than a silent success: the person is told, and nothing is
        spent on their behalf."""

        from app.core import config

        monkeypatch.setattr(config.settings, "job_import_daily_quota", 1)

        headers, _owner = await _auth(client, "import-quota-limit")
        _source, first = await _source_and_draft(client, headers, "quotafirst")
        _source_two, second = await _source_and_draft(client, headers, "quotasecond")

        class CountingProvider(FakeProvider):
            calls = 0

            async def extract(self, request):
                CountingProvider.calls += 1
                return await super().extract(request)

        provider_override(CountingProvider())

        allowed = await client.post(
            f"/api/v1/job-imports/drafts/{first['id']}/process", headers=headers, json={}
        )
        refused = await client.post(
            f"/api/v1/job-imports/drafts/{second['id']}/process", headers=headers, json={}
        )

        assert allowed.status_code == 200
        assert refused.status_code == 429
        assert refused.json()["error"]["code"] == "JOB_IMPORT_QUOTA_EXCEEDED"
        assert CountingProvider.calls == 1

    async def test_a_repeat_that_calls_nothing_costs_no_quota(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
        monkeypatch,
    ) -> None:
        """The unit stands for a provider call. Refreshing a finished draft
        makes none, so it must not use one — otherwise reading your own draft
        twice would lock you out of importing."""

        from app.core import config

        monkeypatch.setattr(config.settings, "job_import_daily_quota", 2)

        headers, _owner = await _auth(client, "import-quota-refund")
        _source, draft = await _source_and_draft(client, headers, "quotarefund")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"
        provider_override(FakeProvider())

        assert (await client.post(path, headers=headers, json={})).status_code == 200
        for _ in range(4):
            repeated = await client.post(path, headers=headers, json={})
            assert repeated.json()["outcome"] == "already_processed"

        # One unit left, so a different draft still imports.
        _other_source, other = await _source_and_draft(client, headers, "quotaother")
        second = await client.post(
            f"/api/v1/job-imports/drafts/{other['id']}/process", headers=headers, json={}
        )

        assert second.status_code == 200
