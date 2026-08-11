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

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from app.core.brand_identity import resolve_brand_identity
from app.services.brand_enrichment_service import (
    BrandAboutRunner,
    BrandEnrichment,
    BrandEnrichmentService,
    apply_enrichment_result,
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

    async def summarize(
        self, *, brand_name: str, evidence: str, **_context
    ) -> str | None:
        self.calls += 1
        return self.reply


class _Fetcher:
    def __init__(self, text: str = EVIDENCE, *, error: Exception | None = None) -> None:
        self.text = text
        self.error = error
        self.calls = 0
        self.urls: list[str] = []

    async def fetch(self, url: str):
        self.calls += 1
        self.urls.append(url)
        if self.error:
            raise self.error

        class _R:
            normalized_text = self.text
            final_url = "https://brand.example/"

        return _R()


class _Job:
    """The columns the runner reads and writes, without a database."""

    def __init__(self, **overrides) -> None:
        # The claim is now a real UPDATE keyed on the row, so the stub needs an
        # identity the statement can be built against.
        self.id = uuid4()
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
        self.claims = 0

    async def execute(self, statement):
        """Model the conditional claim, including the case where it loses.

        The claim is a single UPDATE guarded by a WHERE, because checking in
        Python and writing afterwards is a lost update — a browser test with two
        tabs proved it by fetching a brand's site twice. This fake applies the
        statement's own bound values so the runner sees exactly what the
        database would give it back, and refuses the claim when a live attempt
        already holds it.
        """

        from datetime import UTC, datetime, timedelta

        job = self.job
        attempted = job.brand_about_attempted_at
        live = (
            job.brand_about_status == "in_progress"
            and attempted is not None
            and datetime.now(UTC) - attempted <= timedelta(seconds=180)
        )

        class _Result:
            rowcount = 0 if live else 1

        if not live:
            self.claims += 1
            for column, value in statement.compile().params.items():
                if column.startswith("brand_about_"):
                    setattr(job, column, value)
        return _Result()

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
    async def test_a_late_recruiter_edit_wins_at_the_final_write_barrier(self) -> None:
        identity_id = uuid4()
        application = apply_enrichment_result(
            BrandEnrichment(
                "success_official_site",
                about=GROUNDED,
                evidence_url="https://financesimplified.example",
            ),
            about_now="My own description written after the model started.",
            identity_now=identity_id,
            identity_attempted=identity_id,
        )

        assert not application.applied
        assert application.about is None
        assert application.status == "recruiter_owned"

    async def test_a_late_identity_switch_wins_at_the_final_write_barrier(self) -> None:
        application = apply_enrichment_result(
            BrandEnrichment(
                "success_official_site",
                about="BRAND_A_DESCRIPTION",
                evidence_url="https://brand-a.example",
            ),
            about_now=None,
            identity_now=uuid4(),
            identity_attempted=uuid4(),
        )

        assert not application.applied
        assert application.about is None
        assert application.status == "not_attempted"

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
        # The host fetched is the one registered on the hiring identity. Nothing
        # a caller sends can redirect retrieval somewhere else — the URL is
        # server-owned, and asserting the fetch target is what makes that true
        # rather than merely intended.
        assert fetcher.urls == ["https://financesimplified.example"]

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

        runner, summarizer, fetcher, _ = _runner(job, on_refresh=types)
        application = await runner.run(job, _Identity())

        assert not application.applied
        assert job.about_channel == "My own description"
        # Marked theirs, so nothing tries again later.
        assert job.brand_about_status == "recruiter_owned"
        assert fetcher.calls == 0 and summarizer.calls == 0

    async def test_a_brand_switch_during_the_attempt_discards_the_result(self) -> None:
        job = _Job()
        other = uuid4()

        def switches(row):
            row.hiring_identity_id = other

        runner, summarizer, fetcher, _ = _runner(job, on_refresh=switches)
        application = await runner.run(job, _Identity())

        # P0 territory: A's description must never appear under B.
        assert not application.applied
        assert job.about_channel is None
        assert job.brand_about_status == "not_attempted"
        assert fetcher.calls == 0 and summarizer.calls == 0

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

    async def test_creating_an_eligible_private_draft_schedules_the_runner(
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

        scheduled: list[tuple] = []

        async def _spy(job, identity_id):
            scheduled.append((job, identity_id))

        monkeypatch.setattr(jobs_router, "_run_brand_about_enrichment", _spy)

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

        # Creating persisted eligible state is the trigger. The browser did not
        # call the compatibility endpoint and has no URL/source parameter it
        # could use to steer the work.
        assert len(scheduled) == 1, "the endpoint claimed the job and enqueued nothing"
        assert str(scheduled[0][0]) == str(job_id)

    async def test_selecting_an_identity_on_an_existing_draft_schedules_the_runner(
        self, client: AsyncClient, db_session, monkeypatch
    ) -> None:
        from app.api.v1.routers import jobs as jobs_router
        from app.models import HiringIdentity
        from tests.conftest import active_test_role_id

        headers, owner = await _auth(client, "brand-identity-trigger")
        identity = HiringIdentity(
            owner_user_id=owner,
            type="brand",
            platform="youtube",
            display_name="Finance Simplified",
            verification_status="VERIFIED",
        )
        db_session.add(identity)
        await db_session.commit()
        created = await client.post(
            "/api/v1/jobs",
            headers=headers,
            json={"title": "Identity later", "primary_role_id": await active_test_role_id()},
        )

        scheduled: list[tuple] = []

        async def _spy(job, identity_id):
            scheduled.append((job, identity_id))

        monkeypatch.setattr(jobs_router, "_run_brand_about_enrichment", _spy)
        updated = await client.patch(
            f"/api/v1/jobs/{created.json()['id']}",
            headers=headers,
            json={"hiring_identity_id": str(identity.id)},
        )

        assert updated.status_code == 200, updated.text
        assert len(scheduled) == 1
        assert str(scheduled[0][0]) == created.json()["id"]
        assert scheduled[0][1] == identity.id

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


@pytest.mark.asyncio
async def test_two_preloaded_sessions_share_one_database_claim(
    client: AsyncClient, db_session, monkeypatch
) -> None:
    """The SQL compare-and-set, not request timing, prevents duplicate search."""

    from app.api.v1.routers import jobs as jobs_router
    from app.models import HiringIdentity, Job
    from tests.conftest import TestSessionLocal, active_test_role_id

    headers, owner = await _auth(client, "brand-atomic-claim")
    identity = HiringIdentity(
        owner_user_id=owner,
        type="brand",
        platform="youtube",
        display_name="Finance Simplified",
        verification_status="VERIFIED",
    )
    db_session.add(identity)
    await db_session.commit()
    await db_session.refresh(identity)
    monkeypatch.setattr(jobs_router, "_run_brand_about_enrichment", _noop_background)
    created = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Atomic brand claim",
            "primary_role_id": await active_test_role_id(),
            "hiring_identity_id": str(identity.id),
        },
    )
    assert created.status_code in {200, 201}, created.text
    job_id = UUID(created.json()["id"])

    class _GatedFinder:
        def __init__(self) -> None:
            self.calls = 0
            self.started = asyncio.Event()
            self.release = asyncio.Event()

        async def find_official_site(self, _context):
            from app.core.brand_discovery import DiscoveryResult

            self.calls += 1
            if self.calls == 1:
                self.started.set()
                await self.release.wait()
            return DiscoveryResult(
                "verified_match", "https://financesimplified.example"
            )

    finder = _GatedFinder()
    summarizer = _Summarizer()
    fetcher = _Fetcher()
    service = BrandEnrichmentService(
        summarizer,
        fetcher=fetcher,
        finder=finder,
    )

    async with TestSessionLocal() as first_session, TestSessionLocal() as second_session:
        first_job = await first_session.get(Job, job_id)
        second_job = await second_session.get(Job, job_id)
        first_identity = await first_session.get(HiringIdentity, identity.id)
        second_identity = await second_session.get(HiringIdentity, identity.id)
        assert first_job is not None and second_job is not None
        assert first_identity is not None and second_identity is not None

        first = asyncio.create_task(
            BrandAboutRunner(first_session, service).run(first_job, first_identity)
        )
        await asyncio.wait_for(finder.started.wait(), timeout=2)
        second = asyncio.create_task(
            BrandAboutRunner(second_session, service).run(second_job, second_identity)
        )
        second_result = await asyncio.wait_for(second, timeout=2)

        assert not second_result.applied
        assert finder.calls == 1
        assert fetcher.calls == 0 and summarizer.calls == 0

        finder.release.set()
        first_result = await asyncio.wait_for(first, timeout=2)
        assert first_result.applied
        assert finder.calls == 1
        assert fetcher.calls == 1 and summarizer.calls == 1


@pytest.mark.asyncio
class TestPrivateStateAndRecruiterOwnership:
    async def _identity(self, db_session, owner, name: str):
        from app.models import HiringIdentity

        identity = HiringIdentity(
            owner_user_id=owner,
            type="brand",
            platform="youtube",
            display_name=name,
            verification_status="VERIFIED",
        )
        db_session.add(identity)
        await db_session.commit()
        await db_session.refresh(identity)
        return identity

    async def _job(self, client, headers, identity_id, monkeypatch):
        from app.api.v1.routers import jobs as jobs_router
        from tests.conftest import active_test_role_id

        monkeypatch.setattr(jobs_router, "_run_brand_about_enrichment", _noop_background)
        created = await client.post(
            "/api/v1/jobs",
            headers=headers,
            json={
                "title": "Brand ownership draft",
                "primary_role_id": await active_test_role_id(),
                "hiring_identity_id": str(identity_id),
            },
        )
        assert created.status_code in (200, 201), created.text
        return created.json()

    async def test_background_state_is_private_and_contains_no_provenance(
        self, client: AsyncClient, db_session, monkeypatch
    ) -> None:
        headers, owner = await _auth(client, "brand-state-owner")
        stranger_headers, _ = await _auth(client, "brand-state-stranger")
        identity = await self._identity(db_session, owner, "Finance Simplified")
        job = await self._job(client, headers, identity.id, monkeypatch)

        state = await client.get(
            f"/api/v1/jobs/{job['id']}/brand-about/state", headers=headers
        )
        forbidden = await client.get(
            f"/api/v1/jobs/{job['id']}/brand-about/state", headers=stranger_headers
        )
        anonymous = await client.get(f"/api/v1/jobs/{job['id']}/brand-about/state")

        assert state.status_code == 200
        assert set(state.json()) == {"status", "about_channel"}
        assert forbidden.status_code in {403, 404}
        assert anonymous.status_code in {401, 403, 404}

    async def test_editing_and_then_deleting_generated_copy_remains_settled(
        self, client: AsyncClient, db_session, monkeypatch
    ) -> None:
        from app.models import Job

        headers, owner = await _auth(client, "brand-edit-owner")
        identity = await self._identity(db_session, owner, "Finance Simplified")
        created = await self._job(client, headers, identity.id, monkeypatch)
        job = await db_session.get(Job, UUID(created["id"]))
        job.about_channel = GROUNDED
        job.brand_about_status = "success"
        job.brand_about_identity_id = identity.id
        await db_session.commit()

        edited = "Recruiter-authored description, kept exactly as they wrote it."
        response = await client.patch(
            f"/api/v1/jobs/{created['id']}",
            headers=headers,
            json={"about_channel": edited},
        )
        assert response.status_code == 200, response.text
        assert response.json()["about_channel"] == edited
        state = await client.get(
            f"/api/v1/jobs/{created['id']}/brand-about/state", headers=headers
        )
        assert state.json()["status"] == "recruiter_owned"

        deleted = await client.patch(
            f"/api/v1/jobs/{created['id']}",
            headers=headers,
            json={"about_channel": None},
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["about_channel"] is None
        reopened = await client.get(
            f"/api/v1/jobs/{created['id']}/brand-about/state", headers=headers
        )
        assert reopened.json() == {
            "status": "recruiter_owned",
            "about_channel": None,
        }
        retrigger = await client.post(
            f"/api/v1/jobs/{created['id']}/brand-about/enrich", headers=headers
        )
        assert retrigger.status_code == 200
        assert retrigger.json()["outcome"] == "not_eligible"

    async def test_identity_switch_clears_generated_copy_but_preserves_recruiter_copy(
        self, client: AsyncClient, db_session, monkeypatch
    ) -> None:
        from app.models import Job

        headers, owner = await _auth(client, "brand-switch-owner")
        identity_a = await self._identity(db_session, owner, "Brand A")
        identity_b = await self._identity(db_session, owner, "Brand B")
        created = await self._job(client, headers, identity_a.id, monkeypatch)
        job = await db_session.get(Job, UUID(created["id"]))
        job.about_channel = "Brand A makes carefully researched creator videos."
        job.brand_about_status = "success"
        job.brand_about_identity_id = identity_a.id
        await db_session.commit()

        switched = await client.patch(
            f"/api/v1/jobs/{created['id']}",
            headers=headers,
            json={"hiring_identity_id": str(identity_b.id)},
        )
        assert switched.status_code == 200, switched.text
        assert switched.json()["about_channel"] is None

        recruiter_copy = "The recruiter owns this description across identity changes."
        owned = await client.patch(
            f"/api/v1/jobs/{created['id']}",
            headers=headers,
            json={"about_channel": recruiter_copy},
        )
        assert owned.status_code == 200, owned.text
        switched_back = await client.patch(
            f"/api/v1/jobs/{created['id']}",
            headers=headers,
            json={"hiring_identity_id": str(identity_a.id)},
        )
        assert switched_back.status_code == 200, switched_back.text
        assert switched_back.json()["about_channel"] == recruiter_copy

    async def test_full_form_identity_switch_does_not_reclassify_generated_copy(
        self, client: AsyncClient, db_session, monkeypatch
    ) -> None:
        """Echoing generated A copy in a full save still clears it for B."""

        from app.models import Job

        headers, owner = await _auth(client, "brand-switch-full-form")
        identity_a = await self._identity(db_session, owner, "Brand A")
        identity_b = await self._identity(db_session, owner, "Brand B")
        created = await self._job(client, headers, identity_a.id, monkeypatch)
        generated = "Brand A makes carefully researched creator videos."
        job = await db_session.get(Job, UUID(created["id"]))
        job.about_channel = generated
        job.brand_about_status = "success"
        job.brand_about_identity_id = identity_a.id
        await db_session.commit()

        switched = await client.patch(
            f"/api/v1/jobs/{created['id']}",
            headers=headers,
            json={
                "hiring_identity_id": str(identity_b.id),
                # This is what an ordinary complete form payload sends even
                # though the recruiter did not edit the generated paragraph.
                "about_channel": generated,
            },
        )

        assert switched.status_code == 200, switched.text
        assert switched.json()["about_channel"] is None
        state = await client.get(
            f"/api/v1/jobs/{created['id']}/brand-about/state", headers=headers
        )
        assert state.json() == {"status": "not_attempted", "about_channel": None}


async def _noop_background(_job_id, _identity_id) -> None:
    return None
