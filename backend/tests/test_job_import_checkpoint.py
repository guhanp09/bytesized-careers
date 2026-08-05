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
from sqlalchemy import select

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
from app.models import JobImportField
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
    # start_timeframe is superseded and no longer asked; start_timing is the
    # field the editor renders, and start_date follows a specific-date choice.
    "start_timing": "immediate",
    "start_date": "2027-01-15",
    "platforms": ["youtube"],
    "revision_policy": "fixed",
    "revision_rounds": 2,
    "creative_autonomy": "guided_by_references",
    "duration_type": "ongoing",
    "hiring_process": [{"stage": "interview"}],
    "source_inputs": [{"type": "raw_footage"}],
    "deliverables": [{"type": "long_form_video", "quantity": 1, "frequency": "per_month"}],
    "budget_max": 2000,
    "location": "Bengaluru, India",
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
        from app.db.seed import seed_roles_if_missing

        # Roles arrive via a migration; this suite builds schema with
        # create_all, so the catalog has to be seeded explicitly.
        await seed_roles_if_missing(session)
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
        ProposedQuestion("work_mode", "Where?", "because"),
        answered_fields=frozenset({"work_mode"}),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    assert result.rejection == "already_answered"


def test_an_extracted_resolved_field_is_never_asked_again() -> None:
    result = validate_proposed_question(
        ProposedQuestion("requirements", "What experience?", "because"),
        answered_fields=frozenset(),
        resolved_fields=frozenset({"requirements"}),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    assert result.rejection == "already_resolved"


def test_a_suppressed_question_is_never_asked() -> None:
    result = validate_proposed_question(
        ProposedQuestion("trial_scope", "Scope?", "because"),
        answered_fields=frozenset({"trial_status"}),
        suppressed_fields=frozenset({"trial_scope"}),
        active_conditional_fields=frozenset({"trial_scope"}),
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
        missing_fields={"budget_unit": "publication_blocker"},
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


# ---------------------------------------------------------------------------
# The conversational-completion boundary
# ---------------------------------------------------------------------------


def test_completion_is_its_own_rule_not_native_draft_creatability() -> None:
    """The three concepts the boundary depends on being kept apart.

    A private native draft can exist almost from the start. That says nothing
    about whether the assistant has finished the conversation it began, and
    conflating them is what made the handoff fire mid-question.
    """

    from app.core.job_import_questions import (
        QueueCandidate,
        assistant_preparation_complete,
        essential_work_remains,
    )

    essential = [QueueCandidate("budget_currency", "mandatory", 10)]
    optional = [QueueCandidate("revision_policy", "optional", 30)]

    assert not assistant_preparation_complete(essential)
    assert essential_work_remains(essential)

    # Optional work still blocks *completion* — it has been offered and not yet
    # answered or skipped — but it is not essential work.
    assert not assistant_preparation_complete(optional)
    assert not essential_work_remains(optional)

    # Only an empty queue means the assistant is done.
    assert assistant_preparation_complete([])


def test_only_interpretation_critical_fields_are_essential() -> None:
    """Essential is about reading the source, not about publication."""

    from app.core.job_import_questions import conversation_question_kind

    # Money and reach change how a listing reads.
    for path in ("budget_currency", "work_mode", "budget_unit"):
        assert conversation_question_kind(path, "recommended") == "mandatory", path

    # The absence of a trial is not work for the recruiter. Safety details only
    # become questions after an explicit paid/unpaid trial activates them.
    assert conversation_question_kind("trial_status", "recommended") is None
    assert (
        conversation_question_kind("trial_work_usage", "conditionally_required")
        == "mandatory"
    )

    # Application routing is decided by the platform, so it is never a question
    # even though it is a publication blocker.
    for path in ("application_mode", "external_apply_url"):
        assert conversation_question_kind(path, "publication_blocker") is None, path

    # Genuinely useful, but the listing is understandable without them.
    for path in ("revision_policy", "source_inputs", "turnaround_value"):
        assert conversation_question_kind(path, "recommended") == "optional", path

    # Offered, never demanded. Candidates filter hardest on these two and the
    # editor shows them early, so a draft that silently arrives without them
    # loses real information — but the listing still reads correctly, so they
    # must not block the handoff.
    for path in ("experience_level", "content_niches"):
        assert conversation_question_kind(path, "recommended") == "optional", path

    # Neither: these belong in ordinary manual editing, not an interrogation.
    for path in ("content_genres", "tags"):
        assert conversation_question_kind(path, "recommended") is None, path


def test_the_assistant_never_asks_about_most_of_the_field_registry() -> None:
    """A guard against the conversation growing into a second form."""

    from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
    from app.core.job_import_questions import conversation_question_kind

    asked = [
        path
        for path, policy in JOB_IMPORT_FIELD_POLICIES.items()
        if conversation_question_kind(path, policy.missing_requirement) is not None
    ]
    # Far fewer than the ~90 writable fields; the rest are ordinary editing.
    assert len(asked) < 30, sorted(asked)


def test_missing_recommendations_do_not_create_an_optional_interview() -> None:
    from app.core.job_import_questions import deterministic_question_queue

    queue = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields={
            "deliverables": "recommended",
            "source_inputs": "recommended",
            "revision_policy": "recommended",
            "turnaround_value": "recommended",
            "creative_autonomy": "recommended",
            "hiring_process": "recommended",
        },
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    assert queue == []


def test_missing_optional_improvements_never_follow_essential_questions() -> None:
    from app.core.job_import_questions import deterministic_question_queue

    queue = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields={
            "revision_policy": "recommended",
            "budget_unit": "publication_blocker",
        },
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    assert queue[0].field_path == "budget_unit"
    assert queue[0].kind == "mandatory"
    assert len(queue) == 1


def test_a_clean_import_produces_no_questions_at_all() -> None:
    from app.core.job_import_questions import (
        assistant_preparation_complete,
        deterministic_question_queue,
    )

    queue = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields={"content_genres": "recommended", "tags": "optional"},
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    # Nothing here is needed to understand the job or worth suggesting, so the
    # assistant finishes immediately rather than manufacturing work.
    assert queue == []
    assert assistant_preparation_complete(queue)


def test_purely_optional_missing_fields_are_never_questions() -> None:
    from app.core.job_import_questions import deterministic_question_queue

    queue = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields={
            "reference_videos": "optional",
            "content_genres": "optional",
            "tags": "optional",
        },
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    assert queue == []


def test_grounded_optional_suggestions_are_offered_in_a_bounded_queue() -> None:
    from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
    from app.core.job_import_questions import (
        MAX_OPTIONAL_SUGGESTIONS,
        deterministic_question_queue,
    )

    paths = (
        "experience_level",
        "content_niches",
        "revision_policy",
        "creative_autonomy",
        "hiring_process",
        "reference_videos",
    )
    queue = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields={},
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
        suggested_fields={
            path: JOB_IMPORT_FIELD_POLICIES[path].missing_requirement for path in paths
        },
    )
    assert len(queue) == MAX_OPTIONAL_SUGGESTIONS
    assert [candidate.field_path for candidate in queue] == [
        "experience_level",
        "content_niches",
        "revision_policy",
    ]
    assert all(candidate.kind == "optional" for candidate in queue)


def test_trial_details_only_queue_after_an_explicit_trial_is_active() -> None:
    from app.core.job_import_questions import deterministic_question_queue

    missing = {
        "trial_status": "recommended",
        "trial_work_usage": "conditionally_required",
        "trial_portfolio_permission": "conditionally_required",
        "unpaid_trial_confirmed": "conditionally_required",
    }
    inactive = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields=missing,
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    assert inactive == []

    active = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields=missing,
        answered_fields=frozenset({"trial_status"}),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(
            {"trial_work_usage", "trial_portfolio_permission", "unpaid_trial_confirmed"}
        ),
    )
    assert {candidate.field_path for candidate in active} == {
        "trial_work_usage",
        "trial_portfolio_permission",
        "unpaid_trial_confirmed",
    }


@pytest.mark.anyio
async def test_extraction_finishing_does_not_end_the_conversation(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    """The correction this whole change exists for."""

    headers, owner_id = await _auth(client, "cb-hold")
    draft_id = await _prepared_draft(client, headers, owner_id, "cb-hold")

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    body = begun.json()

    # Extraction has landed and a native draft is perfectly possible, but the
    # assistant is not finished, so the recruiter must not be handed off.
    draft = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    assert draft["can_apply_to_native_draft"] is True
    assert body["ready_for_draft"] is False
    assert body["active_question"] is not None
    assert body["phase"] == "essential"
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_answering_through_to_completion_never_calls_the_provider(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "cb-through")
    draft_id = await _prepared_draft(client, headers, owner_id, "cb-through")

    state = (
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
    ).json()

    # Answer or skip whatever is asked until the assistant says it is finished.
    for _ in range(25):
        if state["ready_for_draft"]:
            break
        question = state.get("active_question")
        if question is None:
            break
        if question["kind"] == "optional":
            response = await client.post(
                f"/api/v1/job-imports/drafts/{draft_id}/conversation/skip",
                headers=headers,
            )
        else:
            response = await client.post(
                f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
                headers=headers,
                json={
                    "field_path": question["field_path"],
                    "value": _answer_for(question["field_path"]),
                },
            )
        assert response.status_code == 200, response.text
        state = response.json()

    assert state["ready_for_draft"] is True
    assert state["active_question"] is None
    assert state["phase"] == "complete"
    # A whole conversation, answered end to end, for nothing.
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_skip_remaining_finishes_the_optional_phase(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "cb-skip")
    draft_id = await _prepared_draft(client, headers, owner_id, "cb-skip")
    state = (
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
    ).json()

    # Clear the essential questions first; only optional ones may be skipped.
    for _ in range(25):
        question = state.get("active_question")
        if state["ready_for_draft"] or question is None or question["kind"] == "optional":
            break
        state = (
            await client.post(
                f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
                headers=headers,
                json={
                    "field_path": question["field_path"],
                    "value": _answer_for(question["field_path"]),
                },
            )
        ).json()

    if not state["ready_for_draft"]:
        skipped = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/skip?remaining=true",
            headers=headers,
        )
        assert skipped.status_code == 200
        assert skipped.json()["ready_for_draft"] is True

    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_continue_manually_completes_without_answering(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    """The one normal route that hands off with questions still open."""

    headers, owner_id = await _auth(client, "cb-manual")
    draft_id = await _prepared_draft(client, headers, owner_id, "cb-manual")
    begun = (
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
    ).json()
    assert begun["ready_for_draft"] is False

    manual = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/continue-manually",
        headers=headers,
    )
    assert manual.status_code == 200, manual.text
    body = manual.json()
    assert body["ready_for_draft"] is True
    assert body["manual_continuation"] is True
    assert body["active_question"] is None

    # Everything already answered is still on the draft; nothing was discarded.
    draft = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    assert isinstance(draft["recruiter_prefill"], dict)
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_refresh_during_post_extraction_questioning_resumes_the_same_question(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "cb-refresh")
    draft_id = await _prepared_draft(client, headers, owner_id, "cb-refresh")
    begun = (
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
    ).json()
    asked = begun["active_question"]["field_path"]

    for _ in range(4):
        reread = await client.get(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation", headers=headers
        )
        assert reread.status_code == 200
        assert reread.json()["active_question"]["field_path"] == asked
        assert reread.json()["ready_for_draft"] is False

    assert counting_provider.calls == 0


# ---------------------------------------------------------------------------
# Reading the source rather than only scraping it
# ---------------------------------------------------------------------------


def test_a_conflict_must_still_be_worth_asking_about() -> None:
    """A contradiction is not automatically consequential.

    experience_level is not needed to interpret the source, so a conflict on it
    must not outrank pay or application routing purely for being a conflict.
    It may still be raised afterwards as an offer — being contradicted is a
    reason to mention a field, never a reason to promote it.
    """

    from app.core.job_import_questions import deterministic_question_queue

    queue = deterministic_question_queue(
        conflicted_fields=frozenset({"experience_level"}),
        missing_fields={"budget_unit": "publication_blocker"},
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    paths = [item.field_path for item in queue]
    assert paths[0] == "budget_unit"
    # Present, but demoted to an offer that can be skipped.
    assert [item.kind for item in queue if item.field_path == "experience_level"] == [
        "optional"
    ]


def test_a_conflict_on_an_essential_field_still_leads() -> None:
    from app.core.job_import_questions import deterministic_question_queue

    queue = deterministic_question_queue(
        conflicted_fields=frozenset({"budget_currency"}),
        missing_fields={"budget_unit": "publication_blocker"},
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset({"budget_currency"}),
    )
    assert queue[0].field_path == "budget_currency"
    assert queue[0].kind == "confirmation"


def test_the_title_settles_a_seniority_conflict_as_a_recommendation() -> None:
    """The case that started this: a post titled "... - Fresher".

    The body also said "1+ years" and "college students welcome", so extraction
    correctly reported a conflict. An assistant that reads the title knows which
    answer the job gives itself — and still lets the recruiter choose.
    """

    from app.services.job_import_conversation_service import JobImportConversationService

    class _Draft:
        recruiter_prefill = {"title": "YouTube Video Editor - Fresher"}
        machine_output = None

    service = JobImportConversationService.__new__(JobImportConversationService)
    alternatives = [
        {"value": "Fresher", "evidence": ["YouTube Video Editor - Fresher"]},
        {"value": "1+ years video editing", "evidence": ["1+ years video editing"]},
        {"value": "College students good at editing", "evidence": ["College students"]},
    ]
    assert service._recommended_alternative(_Draft(), alternatives) == "Fresher"


def test_no_seniority_signal_means_no_recommendation() -> None:
    """Silence is not a hint. Without a signal the recruiter simply chooses."""

    from app.services.job_import_conversation_service import JobImportConversationService

    class _Draft:
        recruiter_prefill = {"title": "YouTube Video Editor"}
        machine_output = None

    service = JobImportConversationService.__new__(JobImportConversationService)
    assert (
        service._recommended_alternative(
            _Draft(),
            [{"value": "1+ years", "evidence": []}, {"value": "3+ years", "evidence": []}],
        )
        is None
    )


def test_a_senior_title_recommends_the_senior_alternative() -> None:
    from app.services.job_import_conversation_service import JobImportConversationService

    class _Draft:
        recruiter_prefill = {"title": "Senior Video Editor"}
        machine_output = None

    service = JobImportConversationService.__new__(JobImportConversationService)
    assert (
        service._recommended_alternative(
            _Draft(),
            [{"value": "Fresher", "evidence": []}, {"value": "Senior, 5+ years", "evidence": []}],
        )
        == "Senior, 5+ years"
    )


# ---------------------------------------------------------------------------
# Two figures are a range, not a question
# ---------------------------------------------------------------------------


def test_two_pay_figures_become_the_range_they_describe() -> None:
    """A post saying 30,000 and 35,000 is describing a band, not contradicting
    itself. Making the recruiter pick one discards half of what they wrote."""

    from app.core.job_import_answer_effects import pay_range_from_conflict

    assert pay_range_from_conflict([30000, 35000]) == {
        "compensation_mode": "range",
        "budget_amount": 30000,
        "budget_max": 35000,
    }
    # Formatting in the source must not defeat it.
    assert pay_range_from_conflict(["30,000", "35000"])["budget_max"] == 35000
    # Order does not matter; the band is low to high.
    assert pay_range_from_conflict([35000, 30000])["budget_amount"] == 30000


def test_a_range_is_only_built_from_genuine_numbers() -> None:
    from app.core.job_import_answer_effects import pay_range_from_conflict

    # One figure is not a range.
    assert pay_range_from_conflict([30000]) is None
    assert pay_range_from_conflict([30000, 30000]) is None
    # A worded alternative means the source disagrees about more than the
    # amount, which is a real decision rather than a band.
    assert pay_range_from_conflict([30000, "Negotiable"]) is None
    assert pay_range_from_conflict([]) is None


@pytest.mark.anyio
async def test_a_pay_conflict_is_resolved_instead_of_asked(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "pay-range")
    draft_id = await _prepared_draft(client, headers, owner_id, "pay-range")

    # Give the draft the two-figure conflict the reported job had.
    async with TestSessionLocal() as session:
        from sqlalchemy import select

        from app.models import JobImportField as Field

        row = (
            await session.execute(
                select(Field).where(
                    Field.draft_id == UUID(draft_id),
                    Field.field_path == "budget_amount",
                )
            )
        ).scalar_one_or_none()
        assert row is not None, "fixture should track budget_amount"
        row.provenance_state = "conflicting_source_values"
        row.review_status = "pending"
        row.conflicting_values = [
            {"value": 30000, "evidence": []},
            {"value": 35000, "evidence": []},
        ]
        await session.commit()

    state = (
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
    ).json()

    # The recruiter is never asked to choose between their own two figures.
    seen = []
    for _ in range(12):
        question = state.get("active_question")
        if state["ready_for_draft"] or question is None:
            break
        seen.append(question["field_path"])
        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={
                "field_path": question["field_path"],
                "value": _answer_for(question["field_path"]),
            },
        )
        if response.status_code != 200:
            break
        state = response.json()

    assert "budget_amount" not in seen
    assert "budget_max" not in seen

    draft = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    prefill = draft["recruiter_prefill"]
    assert prefill["compensation_mode"] == "range"
    assert prefill["budget_amount"] == 30000
    assert prefill["budget_max"] == 35000
    # Reading the post is free.
    assert counting_provider.calls == 0


# ---------------------------------------------------------------------------
# The interface cannot offer an invalid answer
# ---------------------------------------------------------------------------


def test_the_answer_shape_comes_from_the_job_schema() -> None:
    """One source of truth, so the client cannot hold a stale idea of a field."""

    from app.core.job_import_answer_shapes import answer_shape_for

    work_mode = answer_shape_for("work_mode")
    assert work_mode.kind == "choice"
    assert set(work_mode.choices) == {"remote", "hybrid", "onsite"}

    # Structured rows are pickable, and carry the key each value sits under.
    hiring = answer_shape_for("hiring_process")
    assert hiring.kind == "multi_choice"
    assert hiring.item_key == "stage"
    assert hiring.is_list is True
    assert "interview" in hiring.choices

    start = answer_shape_for("start_timeframe")
    assert start.kind == "choice"
    assert start.is_list is False
    assert start.choices == ["ASAP", "<1mo", "<2mo", "<3mo", "Flexible"]


def test_numeric_fields_carry_their_real_bounds() -> None:
    from app.core.job_import_answer_shapes import answer_shape_for

    # Money is stored as Decimal; a bare int check would have missed every
    # compensation field and left it without a numeric control.
    pay = answer_shape_for("budget_amount")
    assert pay.kind == "number"
    assert pay.minimum == 1

    hours = answer_shape_for("expected_weekly_hours_min")
    assert hours.kind == "number"
    assert hours.maximum == 168


def test_text_fields_carry_their_length_limits() -> None:
    from app.core.job_import_answer_shapes import answer_shape_for

    title = answer_shape_for("title")
    assert title.kind == "text"
    assert title.min_length == 3
    assert title.max_length == 255


def test_candidate_facing_conversation_answers_reject_placeholder_text() -> None:
    from app.core.job_import_answer_shapes import conversation_answer_errors

    assert conversation_answer_errors("requirements", ["Video editing"]) == []
    assert conversation_answer_errors(
        "responsibilities", ["Edit weekly learning videos"]
    ) == []
    for field_path, value in (
        ("requirements", ["a a"]),
        ("responsibilities", ["hi hi"]),
        ("requirements", ["foo bar"]),
        ("requirements", ["Kjkklaamaja"]),
        ("responsibilities", ["Aaaaaaaaaaaa"]),
        ("requirements", ["aaa bbb aaa"]),
        ("responsibilities", ["Provided during QA"]),
        ("requirements", ["I don't know"]),
    ):
        assert conversation_answer_errors(field_path, value), (field_path, value)

    assert conversation_answer_errors("start_timeframe", "ASAP") == []
    assert conversation_answer_errors("start_timeframe", "Aaaaaaaaaaa")


@pytest.mark.anyio
async def test_invalid_conversation_answers_leave_the_checkpoint_unchanged(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "answer-integrity")
    draft_id = await _prepared_draft(client, headers, owner_id, "answer-integrity")
    before_response = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert before_response.status_code == 200, before_response.text
    before = before_response.json()

    invalid_answers = (
        ("requirements", ["a a"]),
        ("responsibilities", ["hi hi"]),
        ("requirements", ["foo bar"]),
        ("requirements", ["Kjkklaamaja"]),
        ("responsibilities", ["Aaaaaaaaaaaa"]),
        ("requirements", ["aaa bbb aaa"]),
        ("responsibilities", ["Provided during QA"]),
        ("requirements", ["I don't know"]),
        ("start_timeframe", "Aaaaaaaaaaa"),
    )
    for field_path, value in invalid_answers:
        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={
                "field_path": field_path,
                "value": value,
                "expected_context_version": before["recruiter_context_version"],
            },
        )
        assert response.status_code == 422, (field_path, response.text)
        assert response.json()["error"]["code"] == "JOB_IMPORT_FIELD_INVALID"

        current = await client.get(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation", headers=headers
        )
        assert current.status_code == 200
        assert current.json() == before

    draft = await client.get(
        f"/api/v1/job-imports/drafts/{draft_id}", headers=headers
    )
    assert draft.status_code == 200
    for field_path, _value in invalid_answers:
        assert field_path not in draft.json()["recruiter_prefill"]
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_a_canonical_start_timeframe_advances_the_checkpoint(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "answer-start")
    draft_id = await _prepared_draft(client, headers, owner_id, "answer-start")
    before = (
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
    ).json()

    response = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={
            "field_path": "start_timeframe",
            "value": "<1mo",
            "expected_context_version": before["recruiter_context_version"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["recruiter_context_version"] == (
        before["recruiter_context_version"] + 1
    )
    draft = await client.get(
        f"/api/v1/job-imports/drafts/{draft_id}", headers=headers
    )
    assert draft.json()["recruiter_prefill"]["start_timeframe"] == "<1mo"
    assert counting_provider.calls == 0


def test_conflicting_source_wording_is_mapped_onto_real_values() -> None:
    """Offering the raw phrase back would hand over something the field refuses."""

    from app.core.job_import_answer_shapes import matching_choices

    # A source phrase is longer than the canonical value.
    assert matching_choices("work_mode", ["Remote", "Hybrid within India"]) == [
        "remote",
        "hybrid",
    ]
    # Anything that cannot be matched is dropped rather than shown as a trap.
    assert matching_choices("work_mode", ["Somewhere else entirely"]) == []
    # A free-text field has no choices to map onto.
    assert matching_choices("about_channel", ["anything"]) == []


@pytest.mark.anyio
async def test_every_question_describes_a_control_that_can_answer_it(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    """No question may reach the recruiter without a usable control."""

    headers, owner_id = await _auth(client, "shape-walk")
    draft_id = await _prepared_draft(client, headers, owner_id, "shape-walk")
    state = (
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
    ).json()

    for _ in range(20):
        question = state.get("active_question")
        if state["ready_for_draft"] or question is None:
            break
        shape = question.get("answer")
        assert shape, f"{question['field_path']} arrived without an answer shape"
        assert shape["kind"] != "unknown", (
            f"{question['field_path']} has no usable control, which is how a text "
            "box ends up on a field that cannot accept text"
        )
        if shape["kind"] in {"choice", "multi_choice"}:
            assert shape.get("choices"), question["field_path"]
        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={
                "field_path": question["field_path"],
                "value": _answer_for(question["field_path"]),
            },
        )
        if response.status_code != 200:
            break
        state = response.json()

    assert counting_provider.calls == 0


# ---------------------------------------------------------------------------
# An unusable provider reply must not end the import
# ---------------------------------------------------------------------------


class UnusableReplyProvider:
    """Returns something the schema cannot accept, every time."""

    def __init__(self) -> None:
        self.calls = 0

    async def extract(self, request):  # noqa: ANN001 - protocol shape
        from app.services.job_import_provider import JobImportProviderError

        self.calls += 1
        raise JobImportProviderError(
            "OPENAI_SCHEMA_MISMATCH",
            "The job details could not be read this time.",
            status_code=502,
        )


@pytest.mark.anyio
async def test_an_unusable_reply_fails_rather_than_faking_success(
    client: AsyncClient,
) -> None:
    """A reply the server cannot use is a failed attempt, not a prepared draft.

    This test previously asserted the opposite. Building an empty draft looked
    like resilience and behaved like data loss: the recruiter was shown a
    "prepared" draft containing nothing and an assistant asking about every
    field, while the system reported success. A failure now reads as a failure,
    the private source is kept, and a retry costs the recruiter nothing.
    """

    from app.api.deps import get_job_import_provider

    provider = UnusableReplyProvider()
    app.dependency_overrides[get_job_import_provider] = lambda: provider
    try:
        headers, owner_id = await _auth(client, "unusable")
        source = await client.post(
            "/api/v1/job-imports/sources",
            headers=headers,
            json={
                "source_type": "pasted_text",
                "source_title": "unusable",
                "original_text": "Hiring a video editor for our weekly channel.",
                "idempotency_key": "src-unusable",
            },
        )
        draft = await client.post(
            f"/api/v1/job-imports/sources/{source.json()['id']}/drafts",
            headers=headers,
            json={
                "extraction_schema_version": 1,
                "target_listing_schema_version": 3,
                "idempotency_key": "drf-unusable",
            },
        )
        draft_id = draft.json()["id"]

        processed = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/process",
            headers=headers,
            json={},
        )
        assert processed.status_code >= 400, processed.text

        current = await client.get(
            f"/api/v1/job-imports/drafts/{draft_id}", headers=headers
        )
        assert current.json()["processing_status"] == "processing_failed"
        # No manufactured extraction, so no manufactured questions.
        assert current.json()["fields"] == []

        # The private source survives, so retrying is free for the recruiter.
        retained = await client.get(
            f"/api/v1/job-imports/sources/{source.json()['id']}", headers=headers
        )
        assert retained.status_code == 200
        assert retained.json()["original_text"]
    finally:
        app.dependency_overrides.pop(get_job_import_provider, None)


def test_no_recruiter_facing_message_names_the_provider() -> None:
    """The provider is an implementation detail; naming it tells the recruiter
    nothing they can act on."""

    from pathlib import Path

    adapter = Path("app/integrations/openai/job_import_adapter.py").read_text()
    # Messages are the second positional argument to _provider_error.
    for line in adapter.splitlines():
        stripped = line.strip()
        if stripped.startswith('"') and stripped.endswith('",'):
            assert "OpenAI" not in stripped, stripped
            assert "GPT" not in stripped, stripped


# ---------------------------------------------------------------------------
# Reading the title, and tolerating a late click
# ---------------------------------------------------------------------------


def test_a_title_settles_what_it_plainly_states() -> None:
    """The reported case: everything asked was in the first line of the post."""

    from app.core.job_import_title_signals import title_signals

    signals = title_signals(
        "AI graphics designer and video editor intern - 6 months onsite"
    )
    assert signals.settled["engagement_type"] == "internship"
    assert signals.settled["work_mode"] == "onsite"
    assert signals.settled["duration_type"] == "fixed_period"
    assert signals.settled["duration_value"] == 6
    assert signals.settled["duration_unit"] == "months"

    # Two crafts named, so the role is offered rather than chosen.
    assert signals.suggested["primary_role_key_options"] == [
        "graphic-designer",
        "video-editor",
    ]
    assert "primary_role_key" not in signals.settled


def test_one_exact_named_craft_is_settled_without_another_question() -> None:
    from app.core.job_import_title_signals import title_signals

    signals = title_signals("Scriptwriter for a long-form history channel")
    assert signals.settled["primary_role_key"] == "scriptwriter"
    assert "primary_role_key" not in signals.suggested


def test_exact_video_editor_settles_while_vague_titles_do_not() -> None:
    from app.core.job_import_title_signals import title_signals

    assert title_signals("Video editor").settled["primary_role_key"] == "video-editor"
    assert title_signals("Creative teammate").settled == {}
    assert title_signals("").is_empty()
    assert title_signals(None).is_empty()


def test_every_seeded_role_has_an_exact_title_signal() -> None:
    import re

    from app.core.job_import_title_signals import title_signals
    from app.db.seed_data_roles import ROLE_CATALOG

    for role in ROLE_CATALOG:
        expected_slug = re.sub(r"[^a-z0-9]+", "-", role["name"].lower()).strip("-")
        assert title_signals(role["name"]).settled.get("primary_role_key") == (
            expected_slug
        ), role["name"]


def test_body_mentions_never_settle_title_only_job_terms() -> None:
    from app.core.job_import_title_signals import title_signals

    signals = title_signals(
        "Creative specialist",
        extra_text=(
            "Collaborate with our remote full-time video editor on a six-month "
            "Education campaign."
        ),
    )
    for path in (
        "primary_role_key",
        "engagement_type",
        "work_mode",
        "duration_type",
    ):
        assert path not in signals.settled
    assert signals.suggested["content_niches"] == ["Education"]


@pytest.mark.anyio
async def test_exact_title_role_is_effective_without_becoming_a_recruiter_answer(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "title-role-provenance")
    draft_id = await _prepared_draft(
        client, headers, owner_id, "title-role-provenance"
    )
    async with TestSessionLocal() as session:
        fields = (
            await session.execute(
                select(JobImportField).where(JobImportField.draft_id == UUID(draft_id))
            )
        ).scalars().all()
        title = next(field for field in fields if field.field_path == "title")
        title.proposed_value = "Video Editor"
        title.confirmed_value = "Video Editor"
        await session.commit()

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text
    active = begun.json()["active_question"]
    assert active is None or active["field_path"] != "primary_role_key"

    draft = await client.get(
        f"/api/v1/job-imports/drafts/{draft_id}", headers=headers
    )
    assert draft.status_code == 200
    body = draft.json()
    role = next(
        field for field in body["fields"] if field["field_path"] == "primary_role_key"
    )
    assert role["effective_value"] == "video-editor"
    assert role["review_status"] == "confirmed"
    assert role["provenance_state"] == "suggested_inference"
    assert role["rationale_code"] == "exact_title_signal"
    assert role["reviewed_at"] is None
    assert "primary_role_key" not in body["recruiter_prefill"]
    assert all(
        item["field_path"] != "primary_role_key" for item in body["missing_fields"]
    )
    assert all(
        "primary_role_key" not in section["fields"]
        for section in body["review_sections"]
    )
    assert "primary_role_id" not in body["validation_errors"].get("publication", {})

    reloaded = (
        await client.get(
            f"/api/v1/job-imports/drafts/{draft_id}", headers=headers
        )
    ).json()
    for metadata_key in (
        "missing_fields",
        "review_sections",
        "validation_errors",
        "can_apply_to_native_draft",
    ):
        assert reloaded[metadata_key] == body[metadata_key]

    async with TestSessionLocal() as session:
        stored = (
            await session.execute(
                select(JobImportField).where(
                    JobImportField.draft_id == UUID(draft_id),
                    JobImportField.field_path == "primary_role_key",
                )
            )
        ).scalar_one()
        assert stored.reviewed_by_user_id is None
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_a_medium_required_role_suggestion_is_confirmed_not_dropped(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "medium-role-confirmation")
    draft_id = await _prepared_draft(
        client, headers, owner_id, "medium-role-confirmation"
    )
    async with TestSessionLocal() as session:
        fields = (
            await session.execute(
                select(JobImportField).where(JobImportField.draft_id == UUID(draft_id))
            )
        ).scalars().all()
        title = next(field for field in fields if field.field_path == "title")
        title.proposed_value = "Creative specialist"
        title.confirmed_value = "Creative specialist"
        role = next(field for field in fields if field.field_path == "primary_role_key")
        role.proposed_value = "video-editor"
        role.provenance_state = "suggested_inference"
        role.review_status = "pending"
        role.confirmed_value = None
        role.edited_value = None
        role.evidence = [{"snippet": "The work includes editing weekly videos."}]
        role.provider_confidence = {
            "origin": "semantic_inference",
            "confidence": "medium",
            "needs_review": True,
        }
        await session.commit()

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text
    question = begun.json()["active_question"]
    assert question["field_path"] == "primary_role_key"
    assert question["kind"] == "confirmation"
    assert question["recommended_value"] == "video-editor"
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_a_grounded_experience_suggestion_reaches_the_native_draft(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    headers, owner_id = await _auth(client, "experience-suggestion")
    draft_id = await _prepared_draft(
        client, headers, owner_id, "experience-suggestion"
    )
    async with TestSessionLocal() as session:
        fields = (
            await session.execute(
                select(JobImportField).where(JobImportField.draft_id == UUID(draft_id))
            )
        ).scalars().all()
        # Isolate the grounded optional offer from unrelated publication gaps.
        for field in fields:
            if field.provenance_state == "missing":
                field.review_status = "rejected"
        await JobImportRepository(session).create_fields(
            [
                {
                    "draft_id": UUID(draft_id),
                    "field_path": "experience_level",
                    "proposed_value": "1–3 years",
                    "provenance_state": "suggested_inference",
                    "review_status": "pending",
                    "evidence": [
                        {"snippet": "Structured minimum experience: 12 months"}
                    ],
                    "conflicting_values": [],
                    "explanation": "Twelve months fits the supported 1–3 years band.",
                    "provider_confidence": {
                        "origin": "contextual_inference",
                        "confidence": "medium",
                        "needs_review": True,
                    },
                    "confirmed_value": None,
                    "edited_value": None,
                    "missing_requirement": "optional",
                    "requires_confirmation": True,
                    "validation_errors": [],
                }
            ]
        )
        await session.commit()

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text
    question = begun.json()["active_question"]
    assert begun.json()["phase"] == "optional"
    assert question["field_path"] == "experience_level"
    assert question["kind"] == "optional"
    assert question["recommended_value"] == "1–3 years"

    answered = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={
            "field_path": "experience_level",
            "value": "1–3 years",
            "expected_context_version": begun.json()["recruiter_context_version"],
        },
    )
    assert answered.status_code == 200, answered.text

    converted = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/apply",
        headers=headers,
        json={"mode": "create_new"},
    )
    assert converted.status_code == 200, converted.text
    assert converted.json()["job"]["experience_level"] == "1–3 years"
    assert counting_provider.calls == 0


def test_title_signals_only_ever_describe_the_job() -> None:
    """The guardrail: nothing here may express anything about a person."""

    from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
    from app.core.job_import_title_signals import title_signals

    signals = title_signals(
        "Senior remote full-time video editor intern 3 months hybrid onsite"
    )
    for path in signals.settled:
        assert path in JOB_IMPORT_FIELD_POLICIES, path


def test_catalog_backed_fields_are_picked_with_readable_labels() -> None:
    """platforms is list[str] in the schema, which is how it got a text box that
    accepted nonsense."""

    from app.core.job_import_answer_shapes import answer_shape_for

    platforms = answer_shape_for("platforms")
    assert platforms.kind == "multi_choice"
    assert "youtube" in platforms.choices
    # A slug identifies; a name reads.
    assert platforms.labels["youtube"] == "YouTube"

    # Values already written for people are left exactly as they are.
    formats = answer_shape_for("formats_hired_for")
    assert formats.labels["Shorts/Reels"] == "Shorts/Reels"


@pytest.mark.anyio
async def test_a_late_answer_is_accepted_rather_than_refused(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    """A click can land after the poll moved the conversation on. Refusing it
    blames the recruiter for the delay."""

    headers, owner_id = await _auth(client, "late-click")
    draft_id = await _prepared_draft(client, headers, owner_id, "late-click")
    first = (
        await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
    ).json()
    asked = first["active_question"]["field_path"]

    # Answer it, so the conversation moves to the next question.
    await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={"field_path": asked, "value": _answer_for(asked)},
    )

    # The same click arriving a moment late is a no-op, not an error.
    late = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={"field_path": asked, "value": _answer_for(asked)},
    )
    assert late.status_code == 200, late.text

    # And an answer to a different pending field is simply accepted.
    other = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={"field_path": "work_mode", "value": "remote"},
    )
    assert other.status_code == 200, other.text
    assert counting_provider.calls == 0


@pytest.mark.anyio
async def test_an_answer_reaches_the_native_draft(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    """The bug this pins: answers were collected and then silently dropped.

    Conversion builds the job from field rows. An answer that only landed in the
    recruiter-prefill map therefore never arrived — the recruiter typed a city in
    the conversation, the editor opened without it, and nothing reported a
    failure. Every answered field must exist as a field row whose effective
    value is what the recruiter said.
    """

    headers, owner_id = await _auth(client, "cp-carry")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-carry")
    begin = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )

    answered: dict[str, object] = {}
    question = begin.json()["active_question"]
    # Walk the conversation rather than answering one field: the guarantee is
    # about every answer, not the first one.
    for _ in range(12):
        if question is None:
            break
        field_path = question["field_path"]
        value = _answer_for(field_path)
        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={"field_path": field_path, "value": value},
        )
        assert response.status_code == 200, response.text
        answered[field_path] = value
        question = response.json().get("active_question")

    assert answered, "the conversation asked nothing, so this proves nothing"

    async with TestSessionLocal() as session:
        rows = {
            row.field_path: row
            for row in (
                await session.execute(
                    select(JobImportField).where(
                        JobImportField.draft_id == UUID(draft_id)
                    )
                )
            )
            .scalars()
            .all()
        }

    for field_path, value in answered.items():
        row = rows.get(field_path)
        assert row is not None, f"{field_path} was answered but never stored as a field"
        effective = row.edited_value if row.edited_value is not None else row.confirmed_value
        # Money is stored as a JSON-safe string because the column is Decimal;
        # comparing by value keeps that from reading as a lost answer.
        if isinstance(value, list):
            assert effective == value, field_path
        else:
            assert str(effective) == str(value), field_path
        # A recruiter-supplied value is not a machine proposal awaiting review.
        assert row.review_status == "edited", field_path
        assert row.validation_errors == [], field_path


def test_the_assistant_never_asks_for_a_field_the_editor_cannot_show() -> None:
    """The rule behind the start-window bug: ask only what the recruiter can edit.

    ``start_timeframe`` was a publication blocker, so it was asked as mandatory.
    The answer was stored, carried into the native job, and then rendered
    nowhere: on a v3 listing that field survives only as a read-only note for
    older listings. To the recruiter that is indistinguishable from the
    assistant ignoring them.

    Superseded fields must therefore be unaskable by every route, and their
    living successor must be the field that gets asked.
    """

    from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
    from app.core.job_import_questions import (
        SUPERSEDED_QUESTION_FIELDS,
        conversation_question_kind,
        deterministic_question_queue,
    )

    assert "start_timeframe" in SUPERSEDED_QUESTION_FIELDS

    for path in SUPERSEDED_QUESTION_FIELDS:
        policy = JOB_IMPORT_FIELD_POLICIES[path]
        # Unaskable even though the requirement alone would have promoted it.
        assert conversation_question_kind(path, policy.missing_requirement) is None, path
        # And unreachable through the deterministic fallback queue.
        queue = deterministic_question_queue(
            conflicted_fields=frozenset({path}),
            missing_fields={path: "publication_blocker"},
            answered_fields=frozenset(),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset({path}),
        )
        assert [item.field_path for item in queue] == [], path

    # The successor is the one that gets asked.
    assert (
        conversation_question_kind(
            "start_timing", JOB_IMPORT_FIELD_POLICIES["start_timing"].missing_requirement
        )
        == "mandatory"
    )


def test_a_superseded_field_cannot_be_reintroduced_by_a_model_proposal() -> None:
    from app.core.job_import_questions import (
        SUPERSEDED_QUESTION_FIELDS,
        ProposedQuestion,
        validate_proposed_question,
    )

    for path in SUPERSEDED_QUESTION_FIELDS:
        result = validate_proposed_question(
            ProposedQuestion(path, "When should this start?", "Because."),
            answered_fields=frozenset(),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset({path}),
        )
        assert not result.ok, path
        assert result.rejection == "prohibited_field", path


def test_a_specific_start_date_is_asked_only_after_that_choice() -> None:
    """start_date follows start_timing, and never appears on its own."""

    from app.core.job_import_questions import deterministic_question_queue

    inactive = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields={"start_date": "conditionally_required"},
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset(),
    )
    assert [item.field_path for item in inactive] == []

    active = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields={"start_date": "conditionally_required"},
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset({"start_date"}),
    )
    assert [item.field_path for item in active] == ["start_date"]


def test_every_askable_field_has_somewhere_to_land() -> None:
    """An answer with no native field is collected and then dropped.

    Conversion writes ``policy.native_field``; a question whose field has none
    would be answered, stored, and silently lost on the way to Post Job.
    ``primary_role_key`` is the one deliberate exception — it resolves through
    the roles catalog into ``primary_role_id``.
    """

    from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
    from app.core.job_import_questions import conversation_question_kind

    unmapped = [
        path
        for path, policy in JOB_IMPORT_FIELD_POLICIES.items()
        if conversation_question_kind(path, policy.missing_requirement)
        and policy.native_field is None
        and path != "primary_role_key"
    ]
    assert unmapped == [], f"asked but cannot be carried into the job: {unmapped}"


@pytest.mark.anyio
async def test_every_answer_reaches_the_created_job(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    """The end-to-end guarantee, asserted on the job rather than on field rows.

    The earlier regression test stops at the field row, which is one link short:
    a row can exist and still not reach the editor if the policy has no native
    field for it. This walks the whole conversation and then reads the job the
    recruiter actually opens.
    """

    headers, owner_id = await _auth(client, "cp-tojob")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-tojob")
    begin = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )

    answered: dict[str, object] = {}
    question = begin.json().get("active_question")
    for _ in range(25):
        if question is None:
            break
        field_path = question["field_path"]
        value = _answer_for(field_path)
        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={"field_path": field_path, "value": value},
        )
        assert response.status_code == 200, response.text
        answered[field_path] = value
        question = response.json().get("active_question")

    assert answered, "the conversation asked nothing, so this proves nothing"

    applied = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/apply",
        headers=headers,
        json={"mode": "create_new"},
    )
    assert applied.status_code == 200, applied.text
    job = applied.json()["job"]

    from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES

    for field_path, value in answered.items():
        native = JOB_IMPORT_FIELD_POLICIES[field_path].native_field
        if native is None:
            # primary_role_key resolves through the catalog instead.
            assert job.get("primary_role_id"), field_path
            continue
        actual = job.get(native, "<<absent>>")
        if isinstance(value, list):
            assert actual == value, f"{field_path}: {actual!r} != {value!r}"
        elif isinstance(value, (int, float)):
            # Money is a Decimal column, so 1200 comes back as "1200.00".
            assert float(str(actual)) == float(value), (
                f"{field_path}: {actual!r} != {value!r}"
            )
        else:
            assert str(actual) == str(value), f"{field_path}: {actual!r} != {value!r}"


@pytest.mark.anyio
async def test_the_start_question_is_the_one_the_editor_renders(
    client: AsyncClient, counting_provider: CountingProvider
) -> None:
    """The user-reported bug, end to end.

    Choosing a start in the conversation used to write ``start_timeframe``,
    which a v3 listing renders only as a read-only note for older listings — so
    the editor opened with the start blank and the answer apparently ignored.
    """

    headers, owner_id = await _auth(client, "cp-start")
    draft_id = await _prepared_draft(client, headers, owner_id, "cp-start")
    begin = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )

    asked: list[str] = []
    question = begin.json().get("active_question")
    for _ in range(25):
        if question is None:
            break
        field_path = question["field_path"]
        asked.append(field_path)
        response = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={"field_path": field_path, "value": _answer_for(field_path)},
        )
        assert response.status_code == 200, response.text
        question = response.json().get("active_question")

    assert "start_timing" in asked, asked
    assert "start_timeframe" not in asked, asked

    applied = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/apply",
        headers=headers,
        json={"mode": "create_new"},
    )
    assert applied.status_code == 200, applied.text
    # The value lands on the field the Post Job editor hydrates and renders.
    assert applied.json()["job"]["start_timing"] == "immediate"
