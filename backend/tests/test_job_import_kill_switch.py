"""Turning AI job import off, and what "off" is allowed to mean.

There was already a flag before this one: `ENABLE_JOB_IMPORT` in the frontend.
It hides the entry point and leaves the API open, so with only that flag an
incident — a cost spike, a bad prompt, someone driving the endpoints directly —
can be ended no faster than a deploy. These tests are about the switch that
actually closes the door.

They are deliberately written around a provider that counts calls rather than
around status codes. A refusal that returns 503 and still calls the provider has
failed at the only thing it was for, and no assertion on a response body would
notice.

The other half is what must keep working. Off means no NEW provider work; it
does not mean the feature disappears from under whoever was mid-flow. A draft
that is already prepared cost what it cost, and taking it away helps nobody.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

import pytest
from conftest import TestSessionLocal, google_id_token_for_test
from httpx import AsyncClient
from job_import_response_fixtures import scenario

from app.api.deps import get_job_import_provider
from app.core import config
from app.core.job_import_availability import DISABLED_CODE
from app.integrations.openai.job_import_output import JobImportExtractionResponse
from app.main import app
from app.repositories.job_import_repository import JobImportRepository
from app.repositories.job_repository import JobRepository
from app.services.job_import_conversation_service import JobImportConversationService
from app.services.job_import_provider import JobImportProviderError
from app.services.job_import_service import JobImportService
from app.services.job_service import JobService


class CountingProvider:
    """Records every call. Never returns anything useful — it must not be needed."""

    def __init__(self) -> None:
        self.calls = 0

    async def extract(self, request):  # noqa: ANN001 - protocol shape
        self.calls += 1
        raise JobImportProviderError(
            "JOB_IMPORT_PROVIDER_FAILED",
            "The counting fake never extracts.",
            status_code=502,
        )


@pytest.fixture
def counting_provider():
    provider = CountingProvider()
    app.dependency_overrides[get_job_import_provider] = lambda: provider
    yield provider
    app.dependency_overrides.pop(get_job_import_provider, None)


@pytest.fixture
def import_disabled(monkeypatch):
    monkeypatch.setattr(config.settings, "job_import_enabled", False)
    yield


async def _auth(client: AsyncClient, label: str) -> tuple[dict[str, str], UUID]:
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "id_token": google_id_token_for_test(
                email=f"{label}@example.com", subject=f"google-{label}"
            ),
            "access_token": f"token-{label}",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, UUID(body["user"]["id"])


async def _draft(client: AsyncClient, headers: dict[str, str], label: str) -> str:
    """A draft with a source, but no extraction yet."""

    source = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": label,
            "original_text": f"Video editor wanted. Private source for {label}.",
            "idempotency_key": f"src-{label}",
        },
    )
    assert source.status_code == 201, source.text
    draft = await client.post(
        f"/api/v1/job-imports/sources/{source.json()['id']}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": f"drf-{label}",
        },
    )
    assert draft.status_code == 201, draft.text
    return draft.json()["id"]


async def _record_extraction(draft_id: str, owner_id: UUID) -> None:
    """Land an extraction directly, the way the checkpoint suite does."""

    parsed = JobImportExtractionResponse.model_validate(scenario("missing_workload"))
    async with TestSessionLocal() as session:
        from app.db.seed import seed_roles_if_missing

        await seed_roles_if_missing(session)
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(UUID(draft_id), parsed, owner_user_id=owner_id)


class TestNoProviderWorkStarts:
    async def test_processing_is_refused_and_the_provider_is_never_called(
        self, client: AsyncClient, counting_provider, import_disabled
    ) -> None:
        headers, _ = await _auth(client, "killswitch-process")
        draft_id = await _draft(client, headers, "killswitch-process")

        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/process",
            headers=headers,
            json={},
        )

        assert response.status_code == 503
        assert response.json()["error"]["code"] == DISABLED_CODE
        assert counting_provider.calls == 0

    async def test_the_message_says_what_happened_without_naming_the_machinery(
        self, client: AsyncClient, counting_provider, import_disabled
    ) -> None:
        """A recruiter reads this. It must not mention a provider or a flag."""

        headers, _ = await _auth(client, "killswitch-copy")
        draft_id = await _draft(client, headers, "killswitch-copy")

        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/process", headers=headers, json={}
        )
        message = response.json()["error"]["message"].lower()

        assert "paused" in message
        assert "usual way" in message
        for leak in ("openai", "gpt", "provider", "flag", "env", "disabled"):
            assert leak not in message, leak

    @pytest.mark.parametrize("state", ["source_received", "resuming"])
    def test_the_conversation_gate_refuses_a_state_it_would_otherwise_allow(
        self, monkeypatch, state: str
    ) -> None:
        """The second entry point, checked where it actually decides.

        Driving this through HTTP looked convincing and proved nothing: the
        fixture drafts sit in states that never start provider work, so the call
        count stayed at zero with the switch removed. These are the two states
        that DO start work, which is what makes the assertion mean something.
        """

        service = JobImportConversationService(import_service=None)  # type: ignore[arg-type]
        draft = SimpleNamespace(conversation_state=state, continuation_count=0)

        monkeypatch.setattr(config.settings, "job_import_enabled", True)
        assert service.may_call_provider(draft) is True, "precondition: this state starts work"

        monkeypatch.setattr(config.settings, "job_import_enabled", False)
        assert service.may_call_provider(draft) is False

    async def test_every_import_route_leaves_the_provider_untouched(
        self, client: AsyncClient, counting_provider, import_disabled
    ) -> None:
        """Path-independent safety net: whatever a caller drives, nothing is spent.

        Weaker than it looks on its own — these fixture drafts are not in a
        state that starts provider work, so this would pass with the switch
        removed. It is here to catch a NEW route that starts work without
        asking, which is the failure no targeted test can anticipate. The two
        tests above are what prove the switch itself.
        """

        headers, owner_id = await _auth(client, "killswitch-sweep")
        draft_id = await _draft(client, headers, "killswitch-sweep")
        await _record_extraction(draft_id, owner_id)

        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/process", headers=headers, json={}
        )
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
        await client.get(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation", headers=headers
        )
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={"field_path": "work_mode", "value": "remote"},
        )
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)

        assert counting_provider.calls == 0


class TestWorkAlreadyDoneIsNotConfiscated:
    async def test_a_prepared_draft_is_still_readable(
        self, client: AsyncClient, counting_provider, import_disabled
    ) -> None:
        headers, owner_id = await _auth(client, "killswitch-read")
        draft_id = await _draft(client, headers, "killswitch-read")
        await _record_extraction(draft_id, owner_id)

        response = await client.get(
            f"/api/v1/job-imports/drafts/{draft_id}", headers=headers
        )

        assert response.status_code == 200
        assert response.json()["id"] == draft_id
        assert counting_provider.calls == 0

    async def test_the_conversation_can_still_be_read(
        self, client: AsyncClient, counting_provider, import_disabled
    ) -> None:
        """Reading stored state starts no work, so it stays available."""

        headers, owner_id = await _auth(client, "killswitch-convo-read")
        draft_id = await _draft(client, headers, "killswitch-convo-read")
        await _record_extraction(draft_id, owner_id)

        response = await client.get(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation", headers=headers
        )

        assert response.status_code == 200
        assert counting_provider.calls == 0


class TestRecovery:
    async def test_switching_back_on_needs_no_repair(
        self, client: AsyncClient, counting_provider, monkeypatch
    ) -> None:
        """Nothing is written while off, so recovery is the switch itself.

        The provider is reached again — and refused by the counting fake, which
        is the point: the call was allowed to happen.
        """

        headers, _ = await _auth(client, "killswitch-recovery")
        draft_id = await _draft(client, headers, "killswitch-recovery")

        monkeypatch.setattr(config.settings, "job_import_enabled", False)
        refused = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/process", headers=headers, json={}
        )
        assert refused.status_code == 503
        assert counting_provider.calls == 0

        monkeypatch.setattr(config.settings, "job_import_enabled", True)
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/process", headers=headers, json={}
        )

        assert counting_provider.calls == 1

    async def test_the_switch_is_read_at_call_time(self, monkeypatch) -> None:
        """Captured at import time it would need a restart, and a switch that
        needs a restart is not a switch."""

        from app.core.job_import_availability import job_import_is_enabled

        monkeypatch.setattr(config.settings, "job_import_enabled", False)
        assert job_import_is_enabled() is False
        monkeypatch.setattr(config.settings, "job_import_enabled", True)
        assert job_import_is_enabled() is True


def test_import_is_enabled_by_default() -> None:
    """Off by default would silently retire a shipped feature on deploy."""

    assert config.Settings().job_import_enabled is True
