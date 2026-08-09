"""The caller: ownership, eligibility, and doing the work after replying.

The engine and its safety rules were accepted while nothing called them. This
covers the endpoint that does, and the runner it drives — which the previous
report flagged as shipped-but-unexercised, and which is not something to leave
standing behind a production caller.

Two properties matter most here and neither is about enrichment quality.

**The response does not wait for the work.** Enrichment is a website fetch and a
model call. A recruiter's save must not depend on either, so the endpoint answers
as soon as it knows whether there is work, and the work runs in a background task
afterwards.

**Nothing is taken from the client.** The brand, its official URL and the
eligibility decision all come from persisted state, so no caller can ask for a
different company to be described or point the fetcher somewhere new.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.core.brand_identity import resolve_brand_identity
from app.services.brand_enrichment_service import (
    BrandAboutRunner,
    BrandEnrichmentService,
)
from tests.test_openai_job_import import _auth

EVIDENCE = (
    "Finance Simplified publishes personal finance videos aimed at helping young "
    "adults understand money, budgeting and investing. The channel produces "
    "explainers and short videos across YouTube and Instagram for viewers new to "
    "managing their own finances."
)
GROUNDED = "Finance Simplified publishes personal finance videos for young adults."


class _Summarizer:
    def __init__(self, reply: str | None = GROUNDED) -> None:
        self.reply = reply
        self.calls = 0

    async def summarize(self, *, brand_name: str, evidence: str) -> str | None:
        self.calls += 1
        return self.reply


class _Fetcher:
    def __init__(self, text: str = EVIDENCE, *, error: Exception | None = None) -> None:
        self.text = text
        self.error = error
        self.calls = 0

    async def fetch(self, url: str):
        self.calls += 1
        if self.error:
            raise self.error

        class _R:
            normalized_text = self.text
            final_url = "https://brand.example/"

        return _R()


class _Job:
    """The columns the runner reads and writes, without a database."""

    def __init__(self, **overrides) -> None:
        self.about_channel = None
        self.hiring_identity_id = uuid4()
        self.brand_about_status = None
        self.brand_about_identity_id = None
        self.brand_about_attempt_id = None
        self.brand_about_attempted_at = None
        for key, value in overrides.items():
            setattr(self, key, value)


class _Identity:
    display_name = "Finance Simplified"
    url = "https://financesimplified.example"
    verification_status = "VERIFIED"
    description = None


class _Session:
    """Commits and refreshes, with an optional mutation between them.

    ``on_refresh`` is how the races are staged: it runs while the attempt is
    "in flight", which is exactly when a recruiter types or changes brand.
    """

    def __init__(self, job, on_refresh=None) -> None:
        self.job = job
        self.on_refresh = on_refresh
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, _obj) -> None:
        if self.on_refresh:
            self.on_refresh(self.job)
            self.on_refresh = None


def _runner(job, *, summarizer=None, fetcher=None, on_refresh=None):
    summarizer = summarizer or _Summarizer()
    fetcher = fetcher or _Fetcher()
    service = BrandEnrichmentService(summarizer, fetcher=fetcher)
    session = _Session(job, on_refresh=on_refresh)
    return BrandAboutRunner(session, service), summarizer, fetcher, session


@pytest.mark.asyncio
class TestTheRunnerDirectly:
    async def test_an_eligible_job_is_claimed_run_and_written(self) -> None:
        job = _Job()
        runner, summarizer, fetcher, _ = _runner(job)

        application = await runner.run(job, _Identity())

        assert application.applied
        assert job.about_channel == GROUNDED
        assert job.brand_about_status == "success"
        # The claim records which brand it was for, so a later switch is visible.
        assert job.brand_about_identity_id == job.hiring_identity_id
        assert fetcher.calls == 1 and summarizer.calls == 1

    async def test_an_ineligible_job_does_no_work_at_all(self) -> None:
        job = _Job(about_channel="Already written by the recruiter")
        runner, summarizer, fetcher, _ = _runner(job)

        application = await runner.run(job, _Identity())

        assert not application.applied
        assert fetcher.calls == 0 and summarizer.calls == 0
        assert job.about_channel == "Already written by the recruiter"

    async def test_a_fetch_failure_records_a_retryable_state(self) -> None:
        from app.services.job_url_fetcher import PublicJobUrlFetchError

        job = _Job()
        runner, _, _, _ = _runner(
            job, fetcher=_Fetcher(error=PublicJobUrlFetchError("BLOCKED", "no"))
        )

        application = await runner.run(job, _Identity())

        assert not application.applied
        assert job.brand_about_status == "failed"
        # Not left running: a job stuck in progress can never be retried.
        assert job.brand_about_status != "in_progress"

    async def test_a_declining_model_is_an_ordinary_outcome(self) -> None:
        job = _Job()
        runner, _, _, _ = _runner(job, summarizer=_Summarizer(None))

        await runner.run(job, _Identity())

        assert job.about_channel is None
        assert job.brand_about_status == "insufficient_evidence"

    async def test_text_typed_during_the_attempt_is_not_overwritten(self) -> None:
        job = _Job()

        def types(row):
            row.about_channel = "My own description"

        runner, _, _, _ = _runner(job, on_refresh=types)
        application = await runner.run(job, _Identity())

        assert not application.applied
        assert job.about_channel == "My own description"
        # Marked theirs, so nothing tries again later.
        assert job.brand_about_status == "recruiter_owned"

    async def test_a_brand_switch_during_the_attempt_discards_the_result(self) -> None:
        job = _Job()
        other = uuid4()

        def switches(row):
            row.hiring_identity_id = other

        runner, _, _, _ = _runner(job, on_refresh=switches)
        application = await runner.run(job, _Identity())

        # P0 territory: A's description must never appear under B.
        assert not application.applied
        assert job.about_channel is None
        assert job.brand_about_status == "not_attempted"

    async def test_a_newer_attempt_supersedes_this_one(self) -> None:
        job = _Job()

        def claimed_by_another(row):
            row.brand_about_attempt_id = uuid4()

        runner, _, _, _ = _runner(job, on_refresh=claimed_by_another)
        application = await runner.run(job, _Identity())

        assert not application.applied
        assert job.about_channel is None

    async def test_a_stale_claim_is_reclaimed(self) -> None:
        job = _Job(
            brand_about_status="in_progress",
            brand_about_attempt_id=uuid4(),
            brand_about_attempted_at=datetime.now(UTC) - timedelta(seconds=600),
        )
        job.brand_about_identity_id = job.hiring_identity_id
        runner, _, fetcher, _ = _runner(job)

        application = await runner.run(job, _Identity())

        # Without reclamation a process that died mid-attempt would leave this
        # job unable to enrich for ever.
        assert application.applied
        assert fetcher.calls == 1

    async def test_a_live_claim_is_not_duplicated(self) -> None:
        job = _Job(
            brand_about_status="in_progress",
            brand_about_attempt_id=uuid4(),
            brand_about_attempted_at=datetime.now(UTC),
        )
        job.brand_about_identity_id = job.hiring_identity_id
        runner, summarizer, fetcher, _ = _runner(job)

        await runner.run(job, _Identity())

        assert fetcher.calls == 0 and summarizer.calls == 0

    async def test_a_held_description_costs_no_network_or_model_call(self) -> None:
        job = _Job()

        class _Described(_Identity):
            description = "Finance Simplified makes short explainers about money."

        runner, summarizer, fetcher, _ = _runner(job)
        application = await runner.run(job, _Described())

        assert application.applied
        assert job.about_channel == "Finance Simplified makes short explainers about money."
        assert fetcher.calls == 0 and summarizer.calls == 0

    async def test_an_ambiguous_brand_costs_nothing(self) -> None:
        job = _Job()

        class _Ambiguous(_Identity):
            url = None
            verification_status = "UNVERIFIED"

        runner, summarizer, fetcher, _ = _runner(job)
        await runner.run(job, _Ambiguous())

        assert job.about_channel is None
        assert job.brand_about_status == "no_reliable_identity"
        assert fetcher.calls == 0 and summarizer.calls == 0

    async def test_resolution_never_reads_a_source_employer(self) -> None:
        # Structural: resolution takes only hiring-identity values, so there is
        # no parameter through which a scraped employer could arrive.
        identity = resolve_brand_identity(
            display_name="Finance Simplified",
            official_url="https://financesimplified.example",
            verification_status="VERIFIED",
        )

        assert identity.name == "Finance Simplified"


@pytest.mark.asyncio
class TestTheEndpoint:
    async def test_a_stranger_cannot_enrich_someone_elses_job(
        self, client: AsyncClient
    ) -> None:
        owner, _ = await _auth(client, "brand-owner")
        stranger, _ = await _auth(client, "brand-stranger")
        from tests.conftest import active_test_role_id

        created = await client.post(
            "/api/v1/jobs",
            headers=owner,
            json={"title": "Owned job", "primary_role_id": await active_test_role_id()},
        )
        assert created.status_code in (200, 201), created.text
        job_id = created.json()["id"]

        response = await client.post(
            f"/api/v1/jobs/{job_id}/brand-about/enrich", headers=stranger
        )

        assert response.status_code in (403, 404), response.text

    async def test_an_anonymous_caller_is_refused(self, client: AsyncClient) -> None:
        response = await client.post(f"/api/v1/jobs/{uuid4()}/brand-about/enrich")

        assert response.status_code in (401, 403, 404)

    async def test_an_ineligible_job_is_told_so_without_work(
        self, client: AsyncClient
    ) -> None:
        headers, _ = await _auth(client, "brand-ineligible")
        from tests.conftest import active_test_role_id

        created = await client.post(
            "/api/v1/jobs",
            headers=headers,
            json={
                "title": "No identity job",
                "primary_role_id": await active_test_role_id(),
                "about_channel": "Written by the recruiter already.",
            },
        )
        assert created.status_code in (200, 201), created.text

        response = await client.post(
            f"/api/v1/jobs/{created.json()['id']}/brand-about/enrich", headers=headers
        )

        assert response.status_code == 200, response.text
        assert response.json()["outcome"] == "not_eligible"

    async def test_the_endpoint_accepts_no_client_supplied_brand_or_url(
        self, client: AsyncClient
    ) -> None:
        headers, _ = await _auth(client, "brand-nobody")
        from tests.conftest import active_test_role_id

        created = await client.post(
            "/api/v1/jobs",
            headers=headers,
            json={"title": "Job", "primary_role_id": await active_test_role_id()},
        )
        job_id = created.json()["id"]

        # A caller trying to name the company, its site, or the text to write.
        response = await client.post(
            f"/api/v1/jobs/{job_id}/brand-about/enrich",
            headers=headers,
            json={
                "brand_name": "Somebody Else",
                "official_url": "https://attacker.example",
                "about": "Whatever I want published",
            },
        )

        assert response.status_code == 200, response.text
        # No identity on this job, so nothing was claimed regardless of the body.
        assert response.json()["outcome"] == "not_eligible"


@pytest.mark.asyncio
class TestTheEndpointActuallyEnqueuesTheWork:
    """A claim that never runs is worse than no claim at all.

    Found by mutation: deleting `background.add_task` left every endpoint test
    green. The endpoint would answer "claimed", the job would sit in
    `in_progress` until the stale rule reclaimed it, and nothing would ever be
    written — a feature that looks wired from every angle except the one that
    matters.
    """

    async def test_an_eligible_job_schedules_the_runner(
        self, client: AsyncClient, db_session, monkeypatch
    ) -> None:
        from app.api.v1.routers import jobs as jobs_router
        from app.models import HiringIdentity
        from tests.conftest import active_test_role_id

        headers, owner = await _auth(client, "brand-enqueue")

        identity = HiringIdentity(
            owner_user_id=owner,
            type="brand",
            platform="youtube",
            display_name="Finance Simplified",
            url="https://financesimplified.example",
            verification_status="VERIFIED",
        )
        db_session.add(identity)
        await db_session.commit()

        created = await client.post(
            "/api/v1/jobs",
            headers=headers,
            json={
                "title": "Eligible for enrichment",
                "primary_role_id": await active_test_role_id(),
                "hiring_identity_id": str(identity.id),
            },
        )
        assert created.status_code in (200, 201), created.text
        job_id = created.json()["id"]

        scheduled: list[tuple] = []

        async def _spy(job, identity_id):
            scheduled.append((job, identity_id))

        monkeypatch.setattr(jobs_router, "_run_brand_about_enrichment", _spy)

        response = await client.post(
            f"/api/v1/jobs/{job_id}/brand-about/enrich", headers=headers
        )

        assert response.status_code == 200, response.text
        assert response.json()["outcome"] == "claimed"
        # The work is scheduled, not merely promised.
        assert len(scheduled) == 1, "the endpoint claimed the job and enqueued nothing"
        assert str(scheduled[0][0]) == str(job_id)

    async def test_an_ineligible_job_schedules_nothing(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        from app.api.v1.routers import jobs as jobs_router
        from tests.conftest import active_test_role_id

        headers, _ = await _auth(client, "brand-noenqueue")
        created = await client.post(
            "/api/v1/jobs",
            headers=headers,
            json={"title": "No identity", "primary_role_id": await active_test_role_id()},
        )

        scheduled: list[tuple] = []

        async def _spy(job, identity_id):
            scheduled.append((job, identity_id))

        monkeypatch.setattr(jobs_router, "_run_brand_about_enrichment", _spy)
        await client.post(
            f"/api/v1/jobs/{created.json()['id']}/brand-about/enrich", headers=headers
        )

        assert scheduled == []
