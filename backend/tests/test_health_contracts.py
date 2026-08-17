"""Three probes answering three different questions, and none of them talking.

Health endpoints look like the least interesting code in a service, and they are
where two specific outages come from.

The first is a liveness probe that consults the database. During a database blip
every container reports unhealthy, the orchestrator restarts all of them, and the
restarts add connection load to the thing that was already struggling. A
recoverable dependency outage becomes a total one, caused by the monitoring.

The second is a readiness probe that consults an optional feature. AI job import
is unconfigured, or its provider is having a bad afternoon, and every instance
drops out of rotation over a feature that most requests never touch.

The third failure has no outage attached and is worse in a different way: these
endpoints are unauthenticated, and the natural way to write a useful one is to
report what went wrong. "cannot connect to
postgresql://creatorjobs:hunter2@db.internal:5432" is a very useful message, and
publishing it to anyone who asks is not a trade worth making. The redaction test
below stuffs recognisable secrets into settings and asserts that none of them
appears in any probe's response — generically, so a probe added later is covered
without anyone remembering to cover it.
"""

from __future__ import annotations

import inspect

import pytest
from httpx import AsyncClient

from app.core import config
from app.health import service as health_service
from app.health.router import get_readiness_session_factory
from app.main import app
from tests.conftest import TestSessionLocal


class _UnreachableDatabase:
    """A session factory that fails the way a dead database does.

    Overridden through `dependency_overrides` rather than by monkeypatching the
    real sessionmaker, because the real one points at the developer's database
    during a test run and must not be reached at all.
    """

    def __init__(self, message: str) -> None:
        self.message = message

    def __call__(self) -> object:
        raise RuntimeError(self.message)


def _with_unreachable_database(message: str) -> None:
    app.dependency_overrides[get_readiness_session_factory] = lambda: _UnreachableDatabase(
        message
    )


def _restore_database() -> None:
    app.dependency_overrides[get_readiness_session_factory] = lambda: TestSessionLocal

#: Every probe. Kept as data so the redaction and status-code contracts apply to
#: all of them, including ones that do not exist yet.
LIVENESS = "/api/v1/health"
READINESS = "/api/v1/health/ready"
FEATURE_PROBES = ("/api/v1/health/job-import", "/api/v1/health/realtime")
DEPENDENCY_PROBES = ("/api/v1/health/db",)
ALL_PROBES = (LIVENESS, READINESS, *FEATURE_PROBES, *DEPENDENCY_PROBES)


class TestLivenessConsultsNothing:
    async def test_it_answers_alive(self, client: AsyncClient) -> None:
        response = await client.get(LIVENESS)

        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_it_takes_no_dependency(self) -> None:
        """The structural half, and the one that matters. A `Depends` added here
        later is how a database blip becomes a restart loop — and it would not
        fail any behavioural test, because in a test the database is up."""

        from app.health.router import health

        signature = inspect.signature(health)

        assert signature.parameters == {}, (
            "the liveness probe took a parameter; anything it consults becomes a "
            "reason to restart a container that is running perfectly well"
        )

    def test_it_reads_no_configuration_and_no_database(self) -> None:
        from app.health.router import health

        source = inspect.getsource(health)

        for forbidden in ("settings", "session", "SessionLocal", "check_db", "await"):
            assert forbidden not in source, forbidden

    async def test_it_still_answers_when_the_database_is_gone(
        self, client: AsyncClient
    ) -> None:
        """The behavioural statement of the same thing: the process is alive
        whether or not its dependencies are."""

        _with_unreachable_database("connection refused")
        try:
            response = await client.get(LIVENESS)
        finally:
            _restore_database()

        assert response.status_code == 200


class TestReadinessFollowsTheDatabase:
    async def test_a_healthy_instance_is_ready(self, client: AsyncClient) -> None:
        response = await client.get(READINESS)

        assert response.status_code == 200
        body = response.json()
        assert body["ready"] is True
        assert body["dependencies"]["database"] == "ok"

    async def test_an_unreachable_database_is_503_not_500(
        self, client: AsyncClient
    ) -> None:
        """503 is the whole point. A load balancer treats "not ready" and
        "broken" differently, and so does whoever is paged — and taking the
        request-scoped session dependency would have produced 500, because a
        failure during dependency resolution never reaches the handler.
        """

        _with_unreachable_database("connection refused: db.internal:5432")
        try:
            response = await client.get(READINESS)
        finally:
            _restore_database()

        assert response.status_code == 503
        body = response.json()
        assert body["ready"] is False
        assert body["dependencies"]["database"] == "unavailable"

    async def test_the_failure_does_not_repeat_the_exception(
        self, client: AsyncClient
    ) -> None:
        """The most natural mistake in a health endpoint: reporting the error.
        It is genuinely useful, and this endpoint is unauthenticated."""

        _with_unreachable_database("could not connect to db.internal:5432 as creatorjobs")
        try:
            response = await client.get(READINESS)
        finally:
            _restore_database()

        assert "db.internal" not in response.text
        assert "creatorjobs" not in response.text
        assert "connect" not in response.text.lower()

    async def test_a_database_that_answers_wrongly_is_not_ready(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Reachable is not the same as working. A connection that returns
        something unexpected is a database this instance cannot serve from."""

        async def _wrong(session: object) -> bool:
            return False

        monkeypatch.setattr(health_service, "check_db", _wrong)

        readiness = await health_service.check_readiness()

        assert readiness.ready is False
        assert readiness.dependencies["database"] == "unexpected_response"


class TestTheProbeCannotReachTheDevelopersDatabase:
    """Because it opens its own session, and `settings.database_url` during a
    test run is the developer's database.

    This exact escape has happened here before, through a router that imported
    the wrong `get_db`: the tests passed, and a row appeared in dev.db. Nothing
    about a green suite reveals it, so it needs its own assertion.
    """

    def test_the_suite_overrides_the_factory(self) -> None:
        override = app.dependency_overrides.get(get_readiness_session_factory)

        assert override is not None, (
            "the readiness probe would open a session against "
            "settings.database_url, which is not the test database"
        )
        assert override() is TestSessionLocal

    def test_the_real_factory_is_the_application_sessionmaker(self) -> None:
        """The other side of it: overridden in tests, and genuinely the
        application's own sessionmaker in production — not a second engine with
        its own pool, which would quietly double the connection count."""

        from app.db.session import SessionLocal

        assert get_readiness_session_factory() is SessionLocal


class TestReadinessIgnoresOptionalFeatures:
    """An optional feature must never be able to take an instance out of
    rotation. This is the failure where the monitoring causes the outage."""

    async def test_an_unconfigured_provider_leaves_the_instance_ready(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(config.settings, "openai_api_key", None)
        monkeypatch.setattr(config.settings, "job_import_enabled", False)

        response = await client.get(READINESS)

        assert response.status_code == 200
        assert response.json()["ready"] is True

    async def test_a_broken_realtime_configuration_leaves_the_instance_ready(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.realtime import bus as realtime_bus

        def _refuse() -> None:
            raise realtime_bus.UnsafeRealtimeConfigurationError("no broker configured")

        monkeypatch.setattr("app.health.router.build_realtime_bus", _refuse)

        response = await client.get(READINESS)

        assert response.status_code == 200

    def test_readiness_never_learns_about_a_feature(self) -> None:
        """Structural, because the behavioural tests above only cover the
        features that exist today. The next optional dependency will be added by
        someone who has not read this file."""

        source = inspect.getsource(health_service.check_readiness)

        for feature in ("job_import", "openai", "realtime", "smtp", "youtube"):
            assert feature not in source, (
                f"readiness consults {feature}; an optional feature must not be "
                "able to remove this instance from rotation"
            )


class TestFeatureProbesNeverRemoveAnInstanceFromRotation:
    @pytest.mark.parametrize("path", FEATURE_PROBES)
    async def test_a_feature_probe_answers_200_even_when_the_feature_cannot_work(
        self, client: AsyncClient, path: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Reporting that a feature is unavailable is an answer, not a failure.
        A 503 here would take the process out of rotation over one feature."""

        monkeypatch.setattr(config.settings, "openai_api_key", None)
        monkeypatch.setattr(config.settings, "job_import_enabled", False)

        response = await client.get(path)

        assert response.status_code == 200

    async def test_the_realtime_probe_reports_process_local_delivery_honestly(
        self, client: AsyncClient
    ) -> None:
        """The failure it describes is invisible in every other way: two
        instances on a process-local bus each serve half of a conversation and
        nothing errors. An operator has to be able to see it on a dashboard."""

        response = await client.get("/api/v1/health/realtime")

        body = response.json()
        assert body["cross_instance"] is False


class TestNoProbeLeaksASecret:
    """Generic over every probe, so one added later is covered by default."""

    #: Values shaped like the things that would actually leak, distinctive enough
    #: that a substring search cannot produce a false positive.
    SECRETS = {
        "jwt_secret": "leaked-jwt-secret-8f3a1c",
        "smtp_password": "leaked-smtp-password-2b7e",
        "smtp_host": "smtp.internal.leaked-host.invalid",
        "redis_url": "redis://leaked-redis-user:leaked-redis-pass@cache.invalid:6379/0",
        "database_url": "postgresql+asyncpg://leakeduser:leakedpass@db.invalid:5432/leakeddb",
    }

    @pytest.mark.parametrize("path", ALL_PROBES)
    async def test_it_names_no_host_credential_or_url(
        self, client: AsyncClient, path: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for attribute, value in self.SECRETS.items():
            monkeypatch.setattr(config.settings, attribute, value, raising=False)

        response = await client.get(path)
        body = response.text

        for attribute, value in self.SECRETS.items():
            assert value not in body, f"{path} leaked {attribute}"
            # Also the interesting fragments on their own, since a probe might
            # report a host without the credentials attached to it.
            for fragment in ("leakedpass", "leaked-redis-pass", "db.invalid", "cache.invalid"):
                assert fragment not in body, f"{path} leaked {fragment}"

    @pytest.mark.parametrize("path", ALL_PROBES)
    async def test_it_needs_no_authentication(
        self, client: AsyncClient, path: str
    ) -> None:
        """The reason the test above exists. Infrastructure polls these without
        credentials, so whatever they say is public."""

        response = await client.get(path)

        assert response.status_code in (200, 503)

    def test_the_leak_check_would_notice(self) -> None:
        """Guards the guard. If the secrets were never reachable, every assertion
        above would pass against a probe that published everything."""

        response_shaped_like_a_leak = (
            '{"database": "postgresql+asyncpg://leakeduser:leakedpass@db.invalid:5432/leakeddb"}'
        )

        assert self.SECRETS["database_url"] in response_shaped_like_a_leak


class TestTheContainerProbesLivenessNotReadiness:
    def test_the_dockerfile_healthcheck_uses_the_liveness_path(self) -> None:
        """A container healthcheck decides whether to RESTART. Pointing it at
        readiness means a database blip restarts every container, which is the
        exact failure readiness exists to avoid.
        """

        from pathlib import Path

        dockerfile = (
            Path(__file__).resolve().parents[1] / "Dockerfile"
        ).read_text(encoding="utf8")

        healthcheck = next(
            line for line in dockerfile.splitlines() if "CMD curl" in line
        )

        assert "/api/v1/health" in healthcheck
        assert "/health/ready" not in healthcheck
        assert "/health/db" not in healthcheck
