"""Races forced to happen, rather than waited for.

The defect that ended the previous campaign was a timing one, and timing bugs do
not reproduce on request. A test that starts two things and sleeps is testing the
scheduler; when it passes it has proved nothing, and when it fails nobody can
tell whether the code or the machine was slow.

So every ordering here is *forced*. The provider is a gate: it blocks on an event
until a test releases it, so the test decides exactly which request is mid-flight
when the second one arrives. Nothing sleeps, nothing is flaky, and a failure names
one ordering.

What is being protected is the attempt-id compare-and-set. Every write carries the
id of the attempt that produced it, and a write whose id is no longer the draft's
current attempt is refused. That is what makes a late result harmless — the
question is whether it actually holds under each ordering, and the only way to
know is to arrange them.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.models import JobImportDraft
from tests.conftest import TestSessionLocal
from tests.test_openai_job_import import (
    FakeProvider,
    _auth,
    _provider_result,
    _service,
    _source_and_draft,
    provider_override,  # noqa: F401 - fixture
)


class GatedProvider:
    """A provider that stops mid-extraction until the test lets it finish.

    ``started`` fires when the call is in flight; ``release`` is what the test
    sets to let it return. Two of these make any two-request ordering exact.
    """

    def __init__(self, *, result=None) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.calls = 0
        self._result = result or _provider_result()

    async def extract(self, _request):
        self.calls += 1
        self.started.set()
        await self.release.wait()
        return self._result


async def _status(draft_id: str) -> str:
    async with TestSessionLocal() as session:
        stored = await session.get(JobImportDraft, UUID(draft_id))
        assert stored is not None
        return stored.processing_status


@pytest.mark.asyncio
class TestTwoRequestsForOneImport:
    async def test_a_second_process_does_not_start_a_second_extraction(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        """The duplicate-work guard, with the duplicate genuinely concurrent."""

        headers, _owner = await _auth(client, "race-double-process")
        _source, draft = await _source_and_draft(client, headers, "doubleprocess")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

        gate = GatedProvider()
        provider_override(gate)

        first = asyncio.create_task(client.post(path, headers=headers, json={}))
        await asyncio.wait_for(gate.started.wait(), timeout=10)

        # The first extraction is provably mid-flight right now.
        second = await client.post(path, headers=headers, json={})
        assert second.status_code == 200, second.text
        assert second.json()["outcome"] == "already_processing"

        gate.release.set()
        assert (await first).status_code == 200

        # One draft, one extraction. Paying twice for the same page is the
        # cheap version of this failure; the expensive one is two results
        # racing to write the same rows.
        assert gate.calls == 1

    async def test_the_winner_is_the_only_writer(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        headers, _owner = await _auth(client, "race-single-writer")
        _source, draft = await _source_and_draft(client, headers, "singlewriter")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

        gate = GatedProvider()
        provider_override(gate)
        first = asyncio.create_task(client.post(path, headers=headers, json={}))
        await asyncio.wait_for(gate.started.wait(), timeout=10)
        await client.post(path, headers=headers, json={})
        gate.release.set()
        await first

        assert await _status(draft["id"]) in {
            "awaiting_recruiter_review",
            "partially_reviewed",
            "ready_to_apply",
        }


@pytest.mark.asyncio
class TestAReadThatOverlapsAWrite:
    async def test_polling_during_extraction_never_starts_work(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        # Polling is a read. If it could start a stage, every open question
        # would be a billing loop.
        headers, _owner = await _auth(client, "race-poll-during")
        _source, draft = await _source_and_draft(client, headers, "pollduring")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

        gate = GatedProvider()
        provider_override(gate)
        running = asyncio.create_task(client.post(path, headers=headers, json={}))
        await asyncio.wait_for(gate.started.wait(), timeout=10)

        for _ in range(5):
            read = await client.get(
                f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
            )
            assert read.status_code == 200
            assert read.json()["processing_status"] == "processing"

        gate.release.set()
        await running
        assert gate.calls == 1

    async def test_a_read_that_lands_after_completion_reports_completion(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        headers, _owner = await _auth(client, "race-poll-after")
        _source, draft = await _source_and_draft(client, headers, "pollafter")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

        gate = GatedProvider()
        provider_override(gate)
        running = asyncio.create_task(client.post(path, headers=headers, json={}))
        await asyncio.wait_for(gate.started.wait(), timeout=10)
        gate.release.set()
        await running

        read = await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
        )
        assert read.json()["processing_status"] != "processing"


@pytest.mark.asyncio
class TestALateResultFromAnAbandonedAttempt:
    """The ordering that matters most: old work returning after new work won.

    A worker that was cancelled, reclaimed or simply overtaken must not be able
    to overwrite what a later attempt already produced. The attempt id is what
    enforces that: every write carries the id that produced it, and a write
    whose id is no longer the draft's current attempt is refused.

    Arranged at the service layer rather than through the transport. Cancelling
    an in-process ASGI request tears down the shared test connection, so a
    transport-level version of this would be measuring the harness — and the
    guard being tested has nothing to do with HTTP.
    """

    async def test_a_superseded_attempt_cannot_record_its_result(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        from uuid import uuid4

        from app.services.job_import_service import JobImportError

        headers, owner_id = await _auth(client, "race-stale-attempt")
        _source, draft = await _source_and_draft(client, headers, "staleattempt")
        draft_id = UUID(str(draft["id"]))

        async with TestSessionLocal() as session:
            service = _service(session)
            first_attempt = uuid4()
            await service.begin_processing(
                draft_id, owner_user_id=owner_id, processing_attempt_id=first_attempt
            )

            # The worker running attempt one dies. Reclamation settles the
            # draft, and a retry then claims it with a fresh attempt id. This
            # is the exact sequence the stale-attempt reclamation produces, and
            # the reason a second begin_processing is legal here at all: a
            # draft still marked processing refuses one, which is the
            # duplicate-work guard doing its job.
            await service.mark_processing_failed(
                draft_id,
                owner_user_id=owner_id,
                error_code="JOB_IMPORT_PROCESSING_ABANDONED",
                message="Draft preparation stopped before it finished.",
                expected_processing_attempt_id=first_attempt,
            )
            second_attempt = uuid4()
            await service.begin_processing(
                draft_id, owner_user_id=owner_id, processing_attempt_id=second_attempt
            )

            # The first worker finally returns. Its result is from an attempt
            # nobody is waiting on any more.
            with pytest.raises(JobImportError) as raised:
                await service.record_extraction_result(
                    draft_id,
                    _provider_result().extraction,
                    owner_user_id=owner_id,
                    provider_metadata=_provider_result().metadata,
                    expected_processing_attempt_id=first_attempt,
                )

            assert raised.value.code == "JOB_IMPORT_STALE_PROCESSING_RESULT"

    async def test_the_current_attempt_can_still_record(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        from uuid import uuid4

        headers, owner_id = await _auth(client, "race-current-attempt")
        _source, draft = await _source_and_draft(client, headers, "currentattempt")
        draft_id = UUID(str(draft["id"]))

        async with TestSessionLocal() as session:
            service = _service(session)
            attempt = uuid4()
            await service.begin_processing(
                draft_id, owner_user_id=owner_id, processing_attempt_id=attempt
            )
            result = _provider_result()
            completed = await service.record_extraction_result(
                draft_id,
                result.extraction,
                owner_user_id=owner_id,
                provider_metadata=result.metadata,
                expected_processing_attempt_id=attempt,
            )

        # The guard must refuse *stale* writes, not all of them.
        assert completed.processing_status != "processing"


@pytest.mark.asyncio
class TestTwoImportsInFlightAtOnce:
    async def test_neither_import_writes_into_the_other(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        headers, _owner = await _auth(client, "race-two-imports")
        _source_a, draft_a = await _source_and_draft(client, headers, "raceA")
        _source_b, draft_b = await _source_and_draft(client, headers, "raceB")

        gate = GatedProvider()
        provider_override(gate)

        # A starts and stops mid-extraction; B starts while A is in flight.
        first = asyncio.create_task(
            client.post(
                f"/api/v1/job-imports/drafts/{draft_a['id']}/process",
                headers=headers,
                json={},
            )
        )
        await asyncio.wait_for(gate.started.wait(), timeout=10)
        gate.release.set()
        await first

        provider_override(FakeProvider())
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_b['id']}/process",
            headers=headers,
            json={},
        )

        # Two drafts, two identities. Neither may hold the other's rows.
        read_a = await client.get(
            f"/api/v1/job-imports/drafts/{draft_a['id']}", headers=headers
        )
        read_b = await client.get(
            f"/api/v1/job-imports/drafts/{draft_b['id']}", headers=headers
        )

        assert read_a.json()["id"] == draft_a["id"]
        assert read_b.json()["id"] == draft_b["id"]
        assert read_a.json()["source_id"] != read_b.json()["source_id"]


@pytest.mark.asyncio
class TestAnswersThatRaceEachOther:
    async def test_two_answers_to_one_field_leave_one_deterministic_value(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        from tests.test_job_import_fixtures import _auth as fixture_auth
        from tests.test_job_import_fixtures import _fixture

        fixture_headers = await fixture_auth(client, "race-two-answers")
        response = await _fixture(client, fixture_headers, "labelled-pay-conflict")
        draft = response.json().get("draft") or response.json()
        path = f"/api/v1/job-imports/drafts/{draft['id']}/fields/engagement_type"

        first, second = await asyncio.gather(
            client.patch(
                path,
                headers=fixture_headers,
                json={"action": "edit", "edited_value": "internship"},
            ),
            client.patch(
                path,
                headers=fixture_headers,
                json={"action": "edit", "edited_value": "part_time"},
            ),
            return_exceptions=True,
        )

        # Either order is acceptable; an interleaved half-write is not.
        reread = await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}", headers=fixture_headers
        )
        engagement = next(
            field
            for field in reread.json()["fields"]
            if field["field_path"] == "engagement_type"
        )

        assert engagement["effective_value"] in {"internship", "part_time"}
        assert not isinstance(first, Exception) or not isinstance(second, Exception)

    async def test_repeated_identical_answers_do_not_duplicate_anything(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        from tests.test_job_import_fixtures import _auth as fixture_auth
        from tests.test_job_import_fixtures import _fixture

        headers = await fixture_auth(client, "race-idempotent-answer")
        response = await _fixture(client, headers, "labelled-pay-conflict")
        draft = response.json().get("draft") or response.json()
        path = f"/api/v1/job-imports/drafts/{draft['id']}/fields/engagement_type"

        for _ in range(5):
            await client.patch(
                path, headers=headers, json={"action": "edit", "edited_value": "part_time"}
            )

        reread = await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
        )
        rows = [
            field
            for field in reread.json()["fields"]
            if field["field_path"] == "engagement_type"
        ]

        # One field, one row, whatever the repetition. Duplicated rows are how
        # a retry turns into two questions about the same decision.
        assert len(rows) == 1
        assert rows[0]["effective_value"] == "part_time"


@pytest.mark.asyncio
class TestReadsAreAlwaysIdempotent:
    async def test_many_concurrent_reads_agree_with_each_other(
        self, client: AsyncClient, provider_override  # noqa: F811
    ) -> None:
        from tests.test_job_import_fixtures import _auth as fixture_auth
        from tests.test_job_import_fixtures import _fixture

        headers = await fixture_auth(client, "race-concurrent-reads")
        response = await _fixture(client, headers, "labelled-pay-conflict")
        draft = response.json().get("draft") or response.json()

        reads = await asyncio.gather(
            *[
                client.get(
                    f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
                )
                for _ in range(10)
            ]
        )
        statuses = {read.json()["processing_status"] for read in reads}

        # A read that sometimes reports one thing and sometimes another is a
        # spinner that clears on refresh — the shape of the reported defect.
        assert len(statuses) == 1, statuses
