"""Whether a question is worth interrupting someone for.

Eligibility asks whether the answer is genuinely missing; the corpus already
holds that at zero false questions. This is the second, separate test: given
that it really is absent, is asking now worth stopping the recruiter?

Conflating the two is how an assistant becomes a second form. A source that
omits a publishing detail has not created a problem worth stopping for — the
editor has a proper control for it, more room, and no conversational overhead.
"""

from __future__ import annotations

import pytest

from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
from app.core.job_import_question_value import (
    may_interrupt,
    question_value,
)
from app.core.job_import_questions import (
    MAX_OPTIONAL_SUGGESTIONS,
    conversation_question_kind,
)
from app.core.job_import_title_signals import title_signals


def test_absence_alone_never_earns_an_interruption() -> None:
    """The distinction this module exists for."""

    # Genuinely absent, and genuinely worth asking: a figure nobody can read.
    assert may_interrupt("budget_currency")
    # Genuinely absent, and not worth stopping for.
    assert not may_interrupt("start_timing")
    assert not may_interrupt("revision_policy")
    assert not may_interrupt("hiring_process")


@pytest.mark.parametrize(
    "field_path",
    [
        "budget_currency",
        "budget_unit",
        "compensation_mode",
        "work_mode",
        "location",
        "engagement_type",
        "unpaid_trial_confirmed",
        "trial_work_usage",
    ],
)
def test_interpretation_critical_fields_may_interrupt(field_path: str) -> None:
    """Money, eligibility and unpaid work change what the offer *is*."""

    assert question_value(field_path) == "essential_now"


@pytest.mark.parametrize(
    "field_path",
    ["start_timing", "revision_policy", "creative_autonomy", "reference_videos"],
)
def test_improvements_are_offered_not_demanded(field_path: str) -> None:
    assert question_value(field_path) == "helpful_optional"


def test_the_creator_taxonomy_is_never_a_question() -> None:
    """Thirty internal craft names is a picker, not a conversation.

    On a job outside the marketplace — a financial analyst — there is no honest
    answer at all, so asking guarantees either a wrong tag or a dead end.
    """

    assert question_value("primary_role_key") == "deterministic_fallback"
    assert not may_interrupt("primary_role_key")
    assert (
        conversation_question_kind(
            "primary_role_key",
            JOB_IMPORT_FIELD_POLICIES["primary_role_key"].missing_requirement,
        )
        is None
    )


def test_a_real_conflict_earns_an_interruption_whatever_the_field() -> None:
    """Two evidenced readings mean only a person can say which is right."""

    assert question_value("start_timing", is_conflict=True) == "essential_now"
    assert may_interrupt("revision_policy", is_conflict=True)


def test_start_timing_does_not_block_a_clean_import() -> None:
    assert (
        conversation_question_kind(
            "start_timing",
            JOB_IMPORT_FIELD_POLICIES["start_timing"].missing_requirement,
        )
        == "optional"
    )


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Video Editor", "video-editor"),
        ("YouTube Thumbnail Artist", "thumbnail-designer"),
        ("Short-form Content Editor", "shorts-editor"),
        ("Podcast Post-Production Specialist", "podcast-producer"),
        ("Content Growth Consultant", "content-strategist"),
        ("Social Media Executive", "social-media-manager"),
    ],
)
def test_a_title_that_names_the_craft_resolves_it(title: str, expected: str) -> None:
    """Asking someone to classify a job whose title already said what it is."""

    signals = title_signals(title)
    resolved = signals.settled.get("primary_role_key") or signals.suggested.get(
        "primary_role_key"
    )
    assert resolved == expected


def test_a_job_outside_the_marketplace_is_not_forced_into_a_craft() -> None:
    signals = title_signals("Financial Analyst")
    assert "primary_role_key" not in signals.settled
    assert "primary_role_key" not in signals.suggested
    assert "primary_role_key_options" not in signals.suggested


def test_a_title_naming_two_crafts_offers_both_rather_than_guessing() -> None:
    signals = title_signals("AI Graphics Designer and Video Editor Intern")
    options = signals.suggested.get("primary_role_key_options")
    assert options and len(options) >= 2


def test_optional_suggestions_stay_capped() -> None:
    """Three is a suggestion; ten is an interrogation."""

    assert MAX_OPTIONAL_SUGGESTIONS <= 3


def test_no_recruiter_facing_copy_uses_internal_field_names() -> None:
    """A recruiter should never read "primary_role_key" or "start_timing"."""

    from pathlib import Path

    options = Path("../lib/jobImportAnswerOptions.ts")
    if not options.exists():
        pytest.skip("frontend copy not reachable from here")
    text = options.read_text()
    for line in text.splitlines():
        stripped = line.strip()
        if not (stripped.startswith("heading:") or stripped.startswith("prompt:")):
            continue
        for internal in ("primary_role_key", "start_timing", "field_path", "_key"):
            assert internal not in stripped, stripped


# ---------------------------------------------------------------------------
# Work mode and location are one decision from a candidate's side.
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_the_workplace_is_settled_in_one_turn(client) -> None:
    """Two turns to describe one arrangement is one turn too many.

    "Remote within the United States" and "on-site in San Francisco" are single
    answers. Asking work mode and location separately made the recruiter take
    two decisions for one fact, and invited the pair to disagree.
    """

    from uuid import UUID, uuid4

    from conftest import TestSessionLocal
    from test_job_import_checkpoint import _auth

    from app.repositories.job_import_repository import JobImportRepository
    from app.repositories.job_repository import JobRepository
    from app.schemas.job_import import JobImportExtractionResponse
    from app.services.job_import_service import JobImportService
    from app.services.job_service import JobService

    headers, owner_id = await _auth(client, "workplace-group")
    source = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": "Video Editor",
            "original_text": "Video Editor. Remote-friendly. San Francisco office.",
            "idempotency_key": uuid4().hex,
        },
    )
    draft = await client.post(
        f"/api/v1/job-imports/sources/{source.json()['id']}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": uuid4().hex,
        },
    )
    draft_id = draft.json()["id"]

    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            UUID(draft_id),
            JobImportExtractionResponse.model_validate(
                {
                    "extraction_schema_version": 1,
                    "target_listing_schema_version": 3,
                    "fields": [],
                    "conflicts": [
                        {
                            "field_path": "work_mode",
                            "values": [
                                {
                                    "value": "remote",
                                    "evidence": [{"snippet": "Remote-friendly"}],
                                },
                                {
                                    "value": "onsite",
                                    "evidence": [{"snippet": "San Francisco office"}],
                                },
                            ],
                        },
                        {
                            "field_path": "location",
                            "values": [
                                {
                                    "value": "San Francisco, CA",
                                    "evidence": [{"snippet": "San Francisco office"}],
                                },
                                {
                                    "value": "Remote, United States",
                                    "evidence": [{"snippet": "Remote-friendly"}],
                                },
                            ],
                        },
                    ],
                    "missing_fields": [],
                    "warnings": [],
                }
            ),
            owner_user_id=owner_id,
        )

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text

    asked: list[str] = []
    grouped: dict | None = None
    question = begun.json().get("active_question")
    for _ in range(15):
        if question is None:
            break
        asked.append(question["field_path"])
        if question.get("grouped_options"):
            grouped = question
            break
        question = None

    assert grouped is not None, f"the workplace was not grouped: {asked}"
    assert set(grouped["grouped_fields"]) == {"work_mode", "location"}
    labels = [option["label"] for option in grouped["grouped_options"]]
    assert any("San Francisco" in label for label in labels), labels

    # One click settles both fields.
    chosen = next(
        option for option in grouped["grouped_options"] if option["value"] == "onsite"
    )
    answered = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={"field_path": "work_mode", "value": chosen["value"]},
    )
    assert answered.status_code == 200, answered.text

    stored = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    settled = {
        item["field_path"]: item["effective_value"] for item in stored["fields"]
    }
    assert settled["work_mode"] == "onsite"
    assert settled["location"], "the grouped answer must settle the place too"

    # And the location is not asked again afterwards.
    follow_up = answered.json().get("active_question")
    assert not follow_up or follow_up["field_path"] != "location"


@pytest.mark.anyio
async def test_a_labelled_remote_place_choice_persists_both_fields(client) -> None:
    """"Remote, based around …" is one structured answer, not decorative copy."""

    from uuid import UUID, uuid4

    from conftest import TestSessionLocal
    from test_job_import_checkpoint import _auth

    from app.repositories.job_import_repository import JobImportRepository
    from app.repositories.job_repository import JobRepository
    from app.schemas.job_import import JobImportExtractionResponse
    from app.services.job_import_service import JobImportService
    from app.services.job_service import JobService

    headers, owner_id = await _auth(client, "remote-place-group")
    source = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": "Remote editor",
            "original_text": "Remote-friendly role for candidates based in Toronto.",
            "idempotency_key": uuid4().hex,
        },
    )
    draft = await client.post(
        f"/api/v1/job-imports/sources/{source.json()['id']}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": uuid4().hex,
        },
    )
    draft_id = draft.json()["id"]

    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            UUID(draft_id),
            JobImportExtractionResponse.model_validate(
                {
                    "extraction_schema_version": 1,
                    "target_listing_schema_version": 3,
                    "fields": [],
                    "conflicts": [
                        {
                            "field_path": "work_mode",
                            "values": [
                                {
                                    "value": "remote",
                                    "evidence": [{"snippet": "Remote-friendly"}],
                                },
                                {
                                    "value": "hybrid",
                                    "evidence": [{"snippet": "Toronto office"}],
                                },
                            ],
                        },
                        {
                            "field_path": "location",
                            "values": [
                                {
                                    "value": "Toronto, Ontario, Canada",
                                    "evidence": [{"snippet": "based in Toronto"}],
                                },
                                {
                                    "value": "Remote, Canada",
                                    "evidence": [{"snippet": "Remote-friendly"}],
                                },
                            ],
                        },
                    ],
                    "missing_fields": [],
                    "warnings": [],
                }
            ),
            owner_user_id=owner_id,
        )

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text
    question = begun.json()["active_question"]
    assert question["field_path"] == "work_mode"
    assert "grouped_options" in question
    remote = next(
        option
        for option in question["grouped_options"]
        if option["value"] == "remote" and "based around" in option["label"]
    )
    assert remote["applies"]["location"]

    answered = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={"field_path": "work_mode", "value": remote["value"]},
    )
    assert answered.status_code == 200, answered.text

    stored = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    settled = {
        field["field_path"]: field["effective_value"] for field in stored["fields"]
    }
    assert settled["work_mode"] == "remote"
    assert settled["location"] == remote["applies"]["location"]
    assert stored["recruiter_prefill"]["work_mode"] == "remote"
    assert stored["recruiter_prefill"]["location"] == remote["applies"]["location"]


@pytest.mark.parametrize(
    "field_path",
    [
        "external_apply_url",
        "trial_scope",
        "trial_compensation_amount",
        "revision_rounds",
        "start_date",
        "duration_value",
    ],
)
def test_active_post_job_conditionals_remain_deferred(field_path: str) -> None:
    """Activation is relevance, not permission to turn chat into Post Job."""

    from app.core.job_import_questions import deterministic_question_queue

    queued = deterministic_question_queue(
        conflicted_fields=frozenset(),
        missing_fields={field_path: "conditionally_required"},
        answered_fields=frozenset(),
        suppressed_fields=frozenset(),
        active_conditional_fields=frozenset({field_path}),
    )
    assert queued == []


def test_long_form_prose_is_never_a_chat_writing_exercise() -> None:
    """Composing paragraphs in a chat bubble is the fastest way to lose someone.

    These stay required — by Post Job, at publish time, in a textarea with room
    to write and the listing visible beside it.
    """

    for field_path in ("about_channel", "responsibilities", "requirements"):
        assert question_value(field_path) == "leave_for_post_job"
        assert (
            conversation_question_kind(
                field_path, JOB_IMPORT_FIELD_POLICIES[field_path].missing_requirement
            )
            is None
        )
