"""Knowing AI job import cannot work before a recruiter finds out for us.

Both of these were previously discoverable only by attempting an import and
waiting for it to fail — after the recruiter had pasted a job and watched a
progress bar.

A missing credential is the obvious one. The model is the interesting one:
`OPENAI_MODEL` was a free-form string checked against a character pattern, so a
typo failed every import slowly at the provider, and a name that is valid but
not the one anyone chose succeeded — calling a different model, at whatever that
model costs. A pattern cannot tell those two apart. A list of models the
platform has agreed to call can, and it answers before the request is billed.

The allowlist is checked where the provider is built, not only on the probe.
Reporting a problem on a probe assumes somebody reads it first, and nothing
makes them.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from pydantic import SecretStr

from app.api.deps import get_job_import_provider
from app.core import config
from app.core.job_import_readiness_check import (
    DEFAULT_ALLOWED_MODEL,
    UnsupportedModelError,
    allowed_models,
    check_job_import_readiness,
    require_allowed_model,
)

PROBE = "/api/v1/health/job-import"


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    """A deployment that can work, so each test changes exactly one thing."""

    monkeypatch.setattr(config.settings, "openai_api_key", SecretStr("test-key"))
    monkeypatch.setattr(config.settings, "openai_model", DEFAULT_ALLOWED_MODEL)
    monkeypatch.setattr(config.settings, "openai_model_allowlist", None)
    monkeypatch.setattr(config.settings, "job_import_enabled", True)
    monkeypatch.setattr(config.settings, "job_import_sweeper_in_process", False)
    yield


class TestTheAllowlist:
    def test_the_shipped_default_is_allowed_with_no_configuration(self) -> None:
        assert allowed_models() == frozenset({DEFAULT_ALLOWED_MODEL})

    def test_a_deployment_can_name_its_own_models(self, monkeypatch) -> None:
        monkeypatch.setattr(
            config.settings, "openai_model_allowlist", " model-a , model-b ,, "
        )

        assert allowed_models() == frozenset({"model-a", "model-b"})

    def test_an_unlisted_model_is_refused_before_it_can_be_called(
        self, monkeypatch
    ) -> None:
        monkeypatch.setattr(config.settings, "openai_model", "some-other-model")

        with pytest.raises(UnsupportedModelError):
            require_allowed_model(config.settings.openai_model)

    def test_building_the_provider_refuses_an_unlisted_model(self, monkeypatch) -> None:
        """The check that actually prevents a billed request.

        A typo here used to reach the provider and fail slowly; a valid-but-wrong
        name used to reach it and succeed.
        """

        monkeypatch.setattr(config.settings, "openai_model", "gpt-not-chosen-by-anyone")

        with pytest.raises(UnsupportedModelError):
            get_job_import_provider()

    def test_the_allowed_model_still_builds(self) -> None:
        assert get_job_import_provider() is not None


class TestReadiness:
    def test_a_configured_deployment_is_ready(self) -> None:
        readiness = check_job_import_readiness()

        assert readiness.ready is True
        assert readiness.enabled is True
        assert readiness.problems == []

    def test_a_missing_credential_is_reported(self, monkeypatch) -> None:
        monkeypatch.setattr(config.settings, "openai_api_key", None)

        readiness = check_job_import_readiness()

        assert readiness.ready is False
        assert any("credential" in problem for problem in readiness.problems)

    def test_an_empty_credential_counts_as_missing(self, monkeypatch) -> None:
        """A set-but-blank environment variable is the usual way this happens."""

        monkeypatch.setattr(config.settings, "openai_api_key", SecretStr(""))

        assert check_job_import_readiness().ready is False

    def test_an_unlisted_model_is_reported(self, monkeypatch) -> None:
        monkeypatch.setattr(config.settings, "openai_model", "unlisted-model")

        readiness = check_job_import_readiness()

        assert readiness.ready is False
        assert any("allowlist" in problem for problem in readiness.problems)

    def test_switched_off_reads_as_a_decision_not_a_fault(self, monkeypatch) -> None:
        """Otherwise a deliberately paused feature looks broken on a dashboard."""

        monkeypatch.setattr(config.settings, "job_import_enabled", False)

        readiness = check_job_import_readiness()

        assert readiness.enabled is False
        assert readiness.ready is False
        assert readiness.problems == []


class TestTheProbe:
    async def test_it_answers_without_authentication(self, client: AsyncClient) -> None:
        response = await client.get(PROBE)

        assert response.status_code == 200
        assert response.json()["ready"] is True

    async def test_it_stays_200_when_unready(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        """A probe that 503s takes the process out of rotation over one feature."""

        monkeypatch.setattr(config.settings, "openai_api_key", None)

        response = await client.get(PROBE)

        assert response.status_code == 200
        assert response.json()["ready"] is False
        assert response.json()["problems"]

    async def test_it_does_not_echo_the_configuration(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        """Unauthenticated, so it says what is wrong and not what is set."""

        monkeypatch.setattr(config.settings, "openai_model", "internal-model-name-x")
        monkeypatch.setattr(config.settings, "openai_api_key", SecretStr("sk-secret-value"))

        body = (await client.get(PROBE)).text

        assert "internal-model-name-x" not in body
        assert "sk-secret-value" not in body

    async def test_the_probe_makes_no_provider_call(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        """A probe that asked the provider would bill a request every time a
        load balancer looked."""

        calls: list[int] = []

        class Counting:
            async def extract(self, request):  # noqa: ANN001 - protocol shape
                calls.append(1)
                raise AssertionError("a readiness probe must not call the provider")

        from app.main import app

        app.dependency_overrides[get_job_import_provider] = lambda: Counting()
        try:
            await client.get(PROBE)
        finally:
            app.dependency_overrides.pop(get_job_import_provider, None)

        assert calls == []


class TestQueueRecoveryIsReportedSeparately:
    """An import can be started and finished in-request with no sweeper at all.

    What is missing without one is RECOVERY: the row whose worker died and whom
    nobody comes back to read. Folding that into `ready` would send an operator
    hunting for a broken provider; reporting it separately says what is actually
    absent.
    """

    def test_it_is_reported_and_does_not_make_the_deployment_unready(
        self, monkeypatch
    ) -> None:
        readiness = check_job_import_readiness()

        assert readiness.sweeper_configured is False
        assert readiness.ready is True

    def test_hosting_the_sweep_is_visible(self, monkeypatch) -> None:
        monkeypatch.setattr(config.settings, "job_import_sweeper_in_process", True)

        assert check_job_import_readiness().sweeper_configured is True

    async def test_the_probe_reports_it(self, client: AsyncClient) -> None:
        body = (await client.get(PROBE)).json()

        assert "sweeper_configured" in body
