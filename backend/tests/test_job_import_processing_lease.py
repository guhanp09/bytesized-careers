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
