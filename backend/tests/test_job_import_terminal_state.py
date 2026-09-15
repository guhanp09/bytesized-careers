"""An import that starts must always stop somewhere a recruiter can see.

A real import was watched for two minutes and reached nothing — no question, no
draft, no failure. Two defects had to line up, and each was invisible on its own.

The client abandoned ``POST /process`` at 120 seconds while the server allowed
one 90-second extraction *plus* a 90-second retry. So the abandonment was not an
edge case; it was the ordinary outcome of any import that needed its retry.

What the abandonment did is the part that mattered. Cancelling the request
raises ``asyncio.CancelledError`` inside the handler, and ``CancelledError`` is a
``BaseException`` — so the ``except JobImportProviderError`` and ``except
Exception`` clauses that make every other failure truthful never ran. The draft
kept ``processing_status = "processing"`` with nothing left anywhere that would
ever finish it, and every later read faithfully reported work in progress.

Both halves are covered here. The second group covers the case no ``except``
clause can reach at all: a process that dies mid-extraction, leaving the same
row behind with no code running to correct it.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.job_import_attempt_liveness import (
    ATTEMPT_OVERHEAD_SECONDS,
    assess_attempt,
    maximum_attempt_seconds,
)
from app.models import JobImportDraft
from tests.conftest import TestSessionLocal
from tests.test_openai_job_import import (
    FakeProvider,
    _auth,
    _source_and_draft,
    provider_override,  # noqa: F401 - fixture
)


class TestTheAttemptBudgetComesFromTheServersOwnSettings:
    def test_the_ceiling_covers_every_attempt_the_adapter_may_make(self) -> None:
        # One call plus one retry, both at the full timeout, plus the work
        # either side of them, including the actual bounded retry delay.
        assert maximum_attempt_seconds(request_timeout_seconds=90.0, max_retries=1) == (
            182.0 + ATTEMPT_OVERHEAD_SECONDS
        )

    def test_raising_the_provider_timeout_raises_the_ceiling_with_it(self) -> None:
        # Derived rather than configured, so a deployment that allows slower
        # extractions cannot start declaring live attempts dead.
        lower = maximum_attempt_seconds(request_timeout_seconds=45.0, max_retries=1)
        higher = maximum_attempt_seconds(request_timeout_seconds=180.0, max_retries=1)
        assert higher > lower

    def test_more_retries_widen_the_ceiling(self) -> None:
        assert maximum_attempt_seconds(
            request_timeout_seconds=90.0, max_retries=3
        ) > maximum_attempt_seconds(request_timeout_seconds=90.0, max_retries=0)


class TestOnlyAnUnfinishableAttemptIsDeclaredAbandoned:
    NOW = datetime(2026, 8, 8, 12, 0, tzinfo=UTC)

    def _assess(self, *, started_ago: float | None, status: str = "processing"):
        metadata: dict[str, object] = {}
        if started_ago is not None:
            metadata["processing_started_at"] = (
                self.NOW - timedelta(seconds=started_ago)
            ).isoformat()
        return assess_attempt(
            processing_status=status,
            provider_metadata=metadata,
            request_timeout_seconds=90.0,
            max_retries=1,
            now=self.NOW,
        )

    def test_an_attempt_inside_its_budget_is_left_alone(self) -> None:
        # The single most important negative. Failing a live attempt would break
        # imports that were about to succeed.
        assert not self._assess(started_ago=5).abandoned
        assert not self._assess(started_ago=175).abandoned
        assert not self._assess(started_ago=299).abandoned
        assert not self._assess(started_ago=302).abandoned

    def test_an_attempt_past_every_possible_budget_is_abandoned(self) -> None:
        # 90 + 90 + up to2s backoff +120s non-provider overhead.
        assessed = self._assess(started_ago=303)
        assert assessed.abandoned
        assert assessed.age_seconds is not None and assessed.age_seconds > 302

    def test_a_long_dead_attempt_is_abandoned(self) -> None:
        assert self._assess(started_ago=86_400).abandoned

    @pytest.mark.parametrize(
        "status",
        [
            "awaiting_processing",
            "processing_failed",
            "awaiting_recruiter_review",
            "partially_reviewed",
            "ready_to_apply",
            "applied_to_native_draft",
            "discarded",
            "superseded",
        ],
    )
    def test_a_status_that_already_settled_is_never_reassessed(self, status: str) -> None:
        # Re-deciding a settled draft is how a completed import would be
        # overwritten by a stale timestamp.
        assert not self._assess(started_ago=86_400, status=status).abandoned

    def test_a_row_without_a_start_time_is_not_evidence_of_anything(self) -> None:
        assert not self._assess(started_ago=None).abandoned

    @pytest.mark.parametrize("metadata", [None, "", [], {"processing_started_at": "nope"}])
    def test_unreadable_metadata_never_fails_an_import(self, metadata: object) -> None:
        assessed = assess_attempt(
            processing_status="processing",
            provider_metadata=metadata,
            request_timeout_seconds=90.0,
            max_retries=1,
            now=self.NOW,
        )
        assert not assessed.abandoned

    def test_a_start_time_in_the_future_is_clock_skew_not_abandonment(self) -> None:
        assert not self._assess(started_ago=-600).abandoned

    def test_a_naive_timestamp_is_read_as_utc(self) -> None:
        # Older rows were written without an offset. Treating them as local time
        # would shift them by hours and could declare a live attempt dead.
        assessed = assess_attempt(
            processing_status="processing",
            provider_metadata={
                "processing_started_at": (self.NOW - timedelta(seconds=10))
                .replace(tzinfo=None)
                .isoformat()
            },
            request_timeout_seconds=90.0,
            max_retries=1,
            now=self.NOW,
        )
        assert not assessed.abandoned


@pytest.mark.asyncio
class TestAnAbandonedRequestLeavesATruthfulRow:
    async def test_a_cancelled_extraction_settles_the_draft(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        """The reported defect, at the layer that produced it."""

        headers, _owner = await _auth(client, "import-cancelled")
        _source, draft = await _source_and_draft(client, headers, "cancelled")

        class CancellingProvider:
            calls = 0

            async def extract(self, _request):
                CancellingProvider.calls += 1
                raise asyncio.CancelledError()

        provider_override(CancellingProvider())

        # The cancellation is re-raised, so the request never produces a
        # response and the ASGI stack reports that as a transport error. Which
        # exception escapes is the framework's business — what this test is
        # about is the row left behind.
        with pytest.raises((RuntimeError, asyncio.CancelledError)):
            await client.post(
                f"/api/v1/job-imports/drafts/{draft['id']}/process",
                headers=headers,
                json={},
            )

        # The draft must describe what happened rather than claim work that
        # nothing is doing. Before the fix this row stayed "processing" forever.
        async with TestSessionLocal() as session:
            stored = await session.get(JobImportDraft, UUID(str(draft["id"])))
            assert stored is not None
            assert stored.processing_status == "processing_failed"

    async def test_the_recruiter_can_retry_after_an_abandoned_attempt(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        headers, _owner = await _auth(client, "import-cancel-retry")
        _source, draft = await _source_and_draft(client, headers, "cancelretry")
        path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

        class OnceCancelling:
            def __init__(self) -> None:
                self.calls = 0

            async def extract(self, _request):
                self.calls += 1
                raise asyncio.CancelledError()

        provider_override(OnceCancelling())
        with pytest.raises((RuntimeError, asyncio.CancelledError)):
            await client.post(path, headers=headers, json={})

        # A settled failure is retryable; an in-flight one is not. This is the
        # recruiter-visible consequence of writing the status at all.
        provider_override(FakeProvider())
        retried = await client.post(path, headers=headers, json={})
        assert retried.status_code == 200, retried.text
        assert retried.json()["outcome"] == "processed"


@pytest.mark.asyncio
class TestADraftNobodyIsWorkingOnIsSettledWhenItIsRead:
    """The case no ``except`` clause can reach: the process itself died."""

    async def test_a_stale_processing_row_settles_on_the_next_read(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        headers, _owner = await _auth(client, "import-stale")
        _source, draft = await _source_and_draft(client, headers, "stale")
        draft_id = UUID(str(draft["id"]))

        # Exactly the row a killed worker leaves behind: processing, with a
        # start stamp older than any attempt could possibly run for.
        async with TestSessionLocal() as session:
            stored = await session.get(JobImportDraft, draft_id)
            assert stored is not None
            stored.processing_status = "processing"
            stored.provider_metadata = {
                "processing_attempt_id": "00000000-0000-0000-0000-000000000001",
                "processing_started_at": (
                    datetime.now(UTC) - timedelta(hours=6)
                ).isoformat(),
                "processing_outcome": "processing",
            }
            await session.commit()

        read = await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
        )
        assert read.status_code == 200
        assert read.json()["processing_status"] == "processing_failed"

    async def test_a_fresh_processing_row_is_still_reported_as_processing(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        headers, _owner = await _auth(client, "import-fresh")
        _source, draft = await _source_and_draft(client, headers, "fresh")
        draft_id = UUID(str(draft["id"]))

        async with TestSessionLocal() as session:
            stored = await session.get(JobImportDraft, draft_id)
            assert stored is not None
            stored.processing_status = "processing"
            stored.provider_metadata = {
                "processing_started_at": datetime.now(UTC).isoformat(),
                "processing_outcome": "processing",
            }
            await session.commit()

        read = await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
        )
        # A live attempt must survive being read. This is the assertion that
        # stops the reclamation from becoming a second, shorter timeout.
        assert read.json()["processing_status"] == "processing"

    async def test_a_settled_draft_is_never_reopened_by_an_old_timestamp(
        self,
        client: AsyncClient,
        provider_override,  # noqa: F811
    ) -> None:
        headers, _owner = await _auth(client, "import-settled")
        _source, draft = await _source_and_draft(client, headers, "settled")
        provider_override(FakeProvider())

        processed = await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process",
            headers=headers,
            json={},
        )
        assert processed.status_code == 200

        async with TestSessionLocal() as session:
            stored = await session.get(JobImportDraft, UUID(str(draft["id"])))
            assert stored is not None
            settled_status = stored.processing_status
            metadata = dict(stored.provider_metadata or {})
            metadata["processing_started_at"] = (
                datetime.now(UTC) - timedelta(days=2)
            ).isoformat()
            stored.provider_metadata = metadata
            await session.commit()

        read = await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
        )
        assert read.json()["processing_status"] == settled_status


@pytest.mark.asyncio
async def test_no_import_row_can_sit_in_processing_forever(
    client: AsyncClient,
    provider_override,  # noqa: F811
) -> None:
    """The invariant itself, stated once.

    Whatever happened to an attempt — finished, failed, cancelled, or killed
    with the process — a read of the draft eventually reports something other
    than "still working".
    """

    headers, _owner = await _auth(client, "import-invariant")
    _source, draft = await _source_and_draft(client, headers, "invariant")
    draft_id = UUID(str(draft["id"]))

    async with TestSessionLocal() as session:
        stored = await session.get(JobImportDraft, draft_id)
        assert stored is not None
        stored.processing_status = "processing"
        stored.provider_metadata = {
            "processing_started_at": (datetime.now(UTC) - timedelta(days=1)).isoformat()
        }
        await session.commit()

    read = await client.get(f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers)
    assert read.json()["processing_status"] != "processing"

    async with TestSessionLocal() as session:
        rows = (
            await session.execute(
                select(JobImportDraft).where(JobImportDraft.id == draft_id)
            )
        ).scalars()
        for row in rows:
            assert row.processing_status != "processing"
