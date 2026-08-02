"""The pause guarantee, proved with a counting provider.

The claim this file exists to defend: **while a question is open, nothing calls
the provider.** Not polling, not refresh, not reopening the tab, not walking
away. A counting fake sits in the provider dependency for the whole test, so any
call from any code path — including one nobody intended — shows up as a number.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from conftest import TestSessionLocal
from httpx import AsyncClient
from job_import_response_fixtures import scenario

from app.api.deps import get_job_import_provider
from app.core.job_import_answer_effects import effects_for_answer, suppressed_by_answers
from app.core.job_import_conversation import (
    MAX_PROVIDER_CONTINUATIONS,
    can_transition,
    is_waiting,
    may_start_provider_stage,
    resume_state_for,
)
from app.core.job_import_questions import (
    ProposedQuestion,
    next_question_field,
    validate_proposed_question,
)
from app.main import app
from app.repositories.job_import_repository import JobImportRepository
from app.repositories.job_repository import JobRepository
from app.schemas.job_import import JobImportExtractionResponse
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


async def _auth(client: AsyncClient, label: str) -> tuple[dict[str, str], UUID]:
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": f"{label}@example.com",
            "provider_account_id": f"google-{label}",
            "access_token": f"token-{label}",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, UUID(body["user"]["id"])


#: Valid answers for the fields these fixtures can ask about. Keyed so a test
#: never has to guess a value, and a new question field fails loudly instead of
#: quietly skipping the assertion.
_VALID_ANSWERS: dict[str, object] = {
    "about_channel": "A creator-led finance channel publishing weekly explainers.",
    "application_mode": "internal",
    "expected_weekly_hours_min": 20,
    "turnaround_value": 3,
    "trial_status": "none",
    "work_mode": "remote",
    "compensation_mode": "fixed",
    "budget_currency": "INR",
    "employer_context_type": "creator",
    "title": "Video editor for a finance channel",
    "primary_role_key": "video-editor",
    "engagement_type": "ongoing_freelance",
    "responsibilities": ["Edit one polished video each week"],
    "requirements": ["Strong pacing judgement"],
    "budget_amount": 1200,
    "budget_unit": "per video",
    "start_timeframe": "ASAP",
    "platforms": ["youtube"],
}


def _answer_for(field_path: str) -> object:
    assert field_path in _VALID_ANSWERS, (
        f"No test answer defined for {field_path!r}. Add one rather than skipping: "
        "a silent skip would hide a broken checkpoint."
    )
    return _VALID_ANSWERS[field_path]


async def _prepared_draft(
    client: AsyncClient, headers: dict[str, str], owner_id: UUID, label: str
) -> str:
    """A draft whose extraction has already landed, ready for the conversation."""

    source = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": label,
            "original_text": f"Private source for {label}.",
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
    draft_id = draft.json()["id"]

    parsed = JobImportExtractionResponse.model_validate(scenario("missing_workload"))
    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            UUID(draft_id), parsed, owner_user_id=owner_id
        )
    return draft_id


# ---------------------------------------------------------------------------
# The state machine, in isolation
# ---------------------------------------------------------------------------


def test_waiting_states_can_never_start_a_provider_stage() -> None:
    """The gate every provider call passes through."""

    assert is_waiting("waiting_for_recruiter")
    assert is_waiting("optional_improvements")
    assert not may_start_provider_stage("waiting_for_recruiter", continuation_count=0)
    assert not may_start_provider_stage("optional_improvements", continuation_count=0)
    # Only two states may ever begin work.
    assert may_start_provider_stage("source_received", continuation_count=0)
    assert may_start_provider_stage("resuming", continuation_count=0)
    for blocked in ("preparing", "validating", "converted", "processing_failed", "abandoned"):
        assert not may_start_provider_stage(blocked, continuation_count=0), blocked


def test_the_continuation_ceiling_stops_a_runaway_loop() -> None:
    assert may_start_provider_stage(
        "resuming", continuation_count=MAX_PROVIDER_CONTINUATIONS - 1
    )
    assert not may_start_provider_stage(
        "resuming", continuation_count=MAX_PROVIDER_CONTINUATIONS
    )


def test_illegal_transitions_are_refused() -> None:
    # A converted draft is finished; nothing reopens it.
    assert not can_transition("converted", "preparing")
    # Waiting cannot silently become working.
    assert not can_transition("waiting_for_recruiter", "preparing")
    # But an answer may resume it.
    assert can_transition("waiting_for_recruiter", "resuming")


def test_returning_lands_on_the_question_that_was_left_open() -> None:
    assert resume_state_for("abandoned") == "waiting_for_recruiter"
    assert resume_state_for("waiting_for_recruiter") == "waiting_for_recruiter"
    assert resume_state_for(None) == "source_received"


# ---------------------------------------------------------------------------
# Provider call counting
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_entering_the_conversation_and_waiting_costs_nothing(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "cp-waiting")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-waiting")

    begin = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begin.status_code == 200, begin.text
    body = begin.json()
    assert body["waiting"] is True
    assert body["active_question"] is not None
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_polling_the_conversation_never_starts_work(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "cp-poll")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-poll")
    await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )

    # Stand in for many polling cycles while the recruiter reads the question.
    for _ in range(12):
        poll = await client.get(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation", headers=headers
        )
        assert poll.status_code == 200
        assert poll.json()["waiting"] is True

    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_refresh_and_reopen_never_start_work(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "cp-refresh")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-refresh")
    await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )

    # A refresh is a draft read plus a conversation read. Neither may work.
    for _ in range(3):
        assert (
            await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
        ).status_code == 200
        assert (
            await client.get(
                f"/api/v1/job-imports/drafts/{draft_id}/conversation", headers=headers
            )
        ).status_code == 200

    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_walking_away_and_coming_back_costs_nothing(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "cp-abandon")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-abandon")
    begin = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    asked = begin.json()["active_question"]["field_path"]

    paused = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/pause", headers=headers
    )
    assert paused.status_code == 200

    # Time passes. Nothing is scheduled, so nothing runs.
    for _ in range(5):
        await client.get(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation", headers=headers
        )

    reopened = await client.get(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation", headers=headers
    )
    # The very same question is still open, restored from the database.
    assert reopened.json()["active_question"]["field_path"] == asked
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_answering_advances_without_spending_a_continuation(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    """Most answers apply deterministically, so the usual cost is zero."""

    headers, owner_id = await _auth(client, "cp-answer")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-answer")
    begin = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    question = begin.json()["active_question"]

    answer = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={
            "field_path": question["field_path"],
            "value": _answer_for(question["field_path"]),
        },
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()

    # The answer was accepted and the conversation moved on.
    assert body["recruiter_context_version"] == 1
    # At most one continuation per answer; here, none was needed at all.
    assert counting_provider.calls <= 1
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_a_duplicate_answer_does_not_advance_twice(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "cp-dupe")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-dupe")
    begin = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    body = begin.json()
    question = body["active_question"]
    version = body["recruiter_context_version"]

    payload = {
        "field_path": question["field_path"],
        "value": _answer_for(question["field_path"]),
        "expected_context_version": version,
    }
    first = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json=payload,
    )
    assert first.status_code == 200, first.text
    after_first = first.json()["recruiter_context_version"]
    assert after_first == version + 1

    # The same submission again — a double click, or a retried request.
    second = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json=payload,
    )
    assert second.status_code in {200, 409}
    if second.status_code == 200:
        # Recognised as already applied, so the version did not move again.
        assert second.json()["recruiter_context_version"] == after_first

    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_the_conversation_is_owner_private(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "cp-owner")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-owner")
    intruder, _ = await _auth(client, "cp-intruder")

    for path in ("", "/answer", "/begin", "/pause"):
        method = client.get if path == "" else client.post
        response = await method(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation{path}",
            headers=intruder,
            **({"json": {"field_path": "application_mode", "value": "internal"}}
               if path == "/answer" else {}),
        )
        assert response.status_code == 404, path

    unknown = await client.get(
        f"/api/v1/job-imports/drafts/{uuid4()}/conversation", headers=headers
    )
    assert unknown.status_code == 404
    assert counting_provider.calls == 0


# ---------------------------------------------------------------------------
# Question safety
# ---------------------------------------------------------------------------


def test_prohibited_and_owned_fields_can_never_become_questions() -> None:
    empty = frozenset()
    for path in ("languages", "language_requirements", "screening_questions"):
        result = validate_proposed_question(
            ProposedQuestion(path, "Q?", "why"),
            answered_fields=empty,
            suppressed_fields=empty,
            active_conditional_fields=empty,
        )
        assert result.rejection == "prohibited_field", path

    unknown = validate_proposed_question(
        ProposedQuestion("not_a_field", "Q?", "why"),
        answered_fields=empty,
        suppressed_fields=empty,
        active_conditional_fields=empty,
    )
    assert unknown.rejection == "unknown_field"


def test_an_already_answered_question_is_never_asked_again() -> None:
    result = validate_proposed_question(
        ProposedQuestion("application_mode", "Where?", "because"),
        answered_fields=frozenset({"application_mode"}),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    assert result.rejection == "already_answered"


def test_a_suppressed_question_is_never_asked() -> None:
    result = validate_proposed_question(
        ProposedQuestion("external_apply_url", "URL?", "because"),
        answered_fields=frozenset({"application_mode"}),
        suppressed_fields=frozenset({"external_apply_url"}),
        active_conditional_fields=frozenset({"external_apply_url"}),
    )
    assert result.rejection == "suppressed_by_answer"


def test_an_inactive_conditional_is_never_asked() -> None:
    result = validate_proposed_question(
        ProposedQuestion("trial_scope", "Scope?", "because"),
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    assert result.rejection == "inactive_conditional"


def test_the_deterministic_queue_keeps_the_conversation_alive() -> None:
    """The workflow must not depend on the model proposing anything valid."""

    candidate = next_question_field(
        conflicted_fields=frozenset({"budget_currency"}),
        missing_fields={"application_mode": "publication_blocker"},
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset({"budget_currency"}),
    )
    assert candidate is not None
    # A contradiction that could mislead a candidate outranks a blocker.
    assert candidate.field_path == "budget_currency"


# ---------------------------------------------------------------------------
# Answer intelligence
# ---------------------------------------------------------------------------


def test_no_trial_suppresses_every_trial_question() -> None:
    effect = effects_for_answer("trial_status", "none")
    assert "trial_compensation_amount" in effect.suppressed_fields
    assert "trial_work_usage" in effect.suppressed_fields
    assert "unpaid_trial_confirmed" in effect.suppressed_fields
    # Nothing is silently set as a side effect.
    assert effect.direct_values == {}


def test_creatorjobs_routing_suppresses_the_external_url_question() -> None:
    effect = effects_for_answer("application_mode", "internal")
    assert effect.suppressed_fields == frozenset({"external_apply_url"})

    external = effects_for_answer("application_mode", "external")
    assert external.suppressed_fields == frozenset()


def test_a_location_answer_suggests_currency_and_never_sets_it() -> None:
    effect = effects_for_answer(
        "location", "Bengaluru, India", canonical_values={"budget_amount": 60000}
    )
    assert effect.direct_values == {}, "currency is consequential; it must be confirmed"
    assert len(effect.suggestions) == 1
    suggestion = effect.suggestions[0]
    assert suggestion.field_path == "budget_currency"
    assert suggestion.value == "INR"
    # The explanation quotes the recruiter and asks rather than asserts.
    assert "India" in suggestion.explanation
    assert suggestion.explanation.strip().endswith("?")


def test_a_currency_the_recruiter_already_chose_is_not_second_guessed() -> None:
    effect = effects_for_answer(
        "location",
        "Bengaluru, India",
        canonical_values={"budget_amount": 60000, "budget_currency": "USD"},
    )
    assert effect.suggestions == []


def test_no_pay_figure_means_no_currency_question() -> None:
    effect = effects_for_answer("location", "Bengaluru, India", canonical_values={})
    assert effect.is_empty()


def test_suppression_accumulates_across_answers() -> None:
    suppressed = suppressed_by_answers(
        {"trial_status": "none", "application_mode": "internal", "work_mode": "remote"}
    )
    assert "trial_scope" in suppressed
    assert "external_apply_url" in suppressed
    assert "location" in suppressed


def test_answer_effects_can_only_touch_supported_job_fields() -> None:
    """The guardrail against inferring anything about a person."""

    from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES

    for field_path, value in (
        ("trial_status", "none"),
        ("application_mode", "internal"),
        ("work_mode", "remote"),
        ("compensation_mode", "negotiable"),
        ("revision_policy", "unlimited"),
        ("duration_type", "ongoing"),
        ("start_timing", "asap"),
    ):
        effect = effects_for_answer(field_path, value)
        for touched in effect.suppressed_fields:
            assert touched in JOB_IMPORT_FIELD_POLICIES, touched
        for suggestion in effect.suggestions:
            assert suggestion.field_path in JOB_IMPORT_FIELD_POLICIES
