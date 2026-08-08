"""Every question the assistant asks, judged against what the page already said.

Recruiter time is the product's own measure of itself, so a question is not free.
Each one is worth asking only if the answer is genuinely unknown, genuinely
needed, and genuinely the recruiter's to give. The failure modes have names:

``SOURCE_KNOWN_FALSE``
    Asking about something the page stated plainly. The worst kind, because it
    tells the recruiter the assistant did not read their job.
``TECHNICAL_FAILURE_LEAK``
    A question that exists because something broke — an internal field name, a
    validation code, an enum — handed to the recruiter as though it were a
    decision.
``REDUNDANT``
    The same decision asked twice, or asked after an earlier answer resolved it.
``PREMATURE``
    Asked before the thing it depends on was settled.

The first two have a target of zero and are asserted as such. Rather than
enumerate questions by hand, this walks every processed development fixture and
holds each one to the same rule, so a new fixture is covered the day it is added
and a regression in one shows up as a failure rather than as a slower import.
"""

from __future__ import annotations

import re

import pytest
from httpx import AsyncClient

from app.core.job_import_questions import deterministic_question_queue
from app.db.seed_data_job_import import (
    DEVELOPMENT_IMPORT_SCENARIOS,
    IN_FLIGHT_IMPORT_SCENARIOS,
)
from tests.test_job_import_fixtures import _auth, _fixture

#: Scenarios that land with a prepared draft rather than mid-flight or failed.
PROCESSED = [
    scenario
    for scenario in DEVELOPMENT_IMPORT_SCENARIOS
    if scenario not in IN_FLIGHT_IMPORT_SCENARIOS and scenario != "processing-failure"
]

#: Vocabulary that belongs to the implementation, never to a recruiter.
_ENGINEERING_WORDS = re.compile(
    r"\b(?:field_path|budget_amount|budget_unit|engagement_type|work_mode|"
    r"primary_role_key|compensation_mode|provenance|enum|literal|null|none|"
    r"validation|schema|payload|serializ|nullable|str|int|uuid|"
    r"traceback|exception|openai|gpt|provider)\b",
    re.IGNORECASE,
)


async def _draft_and_questions(client: AsyncClient, scenario: str, label: str):
    headers = await _auth(client, label)
    response = await _fixture(client, headers, scenario)
    assert response.status_code in (200, 201), response.text
    body = response.json()
    draft = body.get("draft") or body

    conversation = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}/conversation",
        headers=headers,
    )
    questions = []
    if conversation.status_code == 200:
        payload = conversation.json()
        if payload.get("active_question"):
            questions.append(payload["active_question"])
        questions.extend(payload.get("pending_questions") or [])
    return draft, questions


def _settled_values(draft: dict) -> dict[str, object]:
    """Fields that already hold a usable value, by path."""

    settled: dict[str, object] = {}
    for field in draft.get("fields", []):
        value = field.get("effective_value")
        if value in (None, "", [], {}):
            continue
        if field.get("provenance_state") == "conflicting_source_values":
            # A genuine conflict is exactly what a recruiter should decide.
            continue
        settled[field["field_path"]] = value
    return settled


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario", PROCESSED)
async def test_no_question_asks_about_a_fact_the_draft_already_holds(
    client: AsyncClient, scenario: str
) -> None:
    """SOURCE_KNOWN_FALSE, target zero.

    The interruption this product refuses to make. A page that printed its rate
    and then produced "How is pay measured?" is the reported failure in its
    purest form.
    """

    draft, questions = await _draft_and_questions(
        client, scenario, f"qq-known-{scenario}"
    )
    settled = _settled_values(draft)

    for question in questions:
        path = question.get("field_path")
        assert path not in settled, (
            f"{scenario}: asked about {path}, which already holds "
            f"{settled.get(path)!r}"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario", PROCESSED)
async def test_no_question_shows_the_recruiter_the_implementation(
    client: AsyncClient, scenario: str
) -> None:
    """TECHNICAL_FAILURE_LEAK, target zero."""

    _draft, questions = await _draft_and_questions(
        client, scenario, f"qq-tech-{scenario}"
    )

    for question in questions:
        for surface in (question.get("prompt"), question.get("help_text")):
            if not surface:
                continue
            assert not _ENGINEERING_WORDS.search(str(surface)), (
                f"{scenario}: {surface!r}"
            )


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario", PROCESSED)
async def test_no_decision_is_put_to_the_recruiter_twice(
    client: AsyncClient, scenario: str
) -> None:
    """REDUNDANT, target zero."""

    _draft, questions = await _draft_and_questions(
        client, scenario, f"qq-dupe-{scenario}"
    )
    paths = [question.get("field_path") for question in questions]

    assert len(paths) == len(set(paths)), f"{scenario}: {paths}"


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario", PROCESSED)
async def test_a_question_reads_as_a_question_about_the_job(
    client: AsyncClient, scenario: str
) -> None:
    _draft, questions = await _draft_and_questions(
        client, scenario, f"qq-read-{scenario}"
    )

    for question in questions:
        prompt = str(question.get("prompt") or "")
        assert prompt.strip(), f"{scenario}: a question with no prompt"
        # A form label templated into a question — "Budget amount?" — is the
        # shape this catches: no verb, no sentence, just a field name with a
        # question mark after it.
        assert len(prompt.split()) >= 3, f"{scenario}: {prompt!r}"
        assert prompt[0].isupper() or prompt[0].isdigit(), f"{scenario}: {prompt!r}"


class TestTheQueueItselfNeverAsksWhatIsAlreadyKnown:
    """The rule underneath, without a fixture in the way."""

    def test_an_answered_field_leaves_the_queue(self) -> None:
        queue = deterministic_question_queue(
            conflicted_fields=frozenset(),
            missing_fields={"budget_amount": "publication_blocker"},
            answered_fields=frozenset({"budget_amount"}),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset(),
        )

        assert [candidate.field_path for candidate in queue] == []

    def test_a_suppressed_field_leaves_the_queue(self) -> None:
        # An earlier answer made this question meaningless. Asking anyway is the
        # stale follow-up that makes an assistant feel like a form.
        queue = deterministic_question_queue(
            conflicted_fields=frozenset(),
            missing_fields={"trial_scope": "conditionally_required"},
            answered_fields=frozenset(),
            suppressed_fields=frozenset({"trial_scope"}),
            active_conditional_fields=frozenset(),
        )

        assert [candidate.field_path for candidate in queue] == []

    def test_a_dismissed_suggestion_is_not_offered_again(self) -> None:
        queue = deterministic_question_queue(
            conflicted_fields=frozenset(),
            missing_fields={},
            answered_fields=frozenset(),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset(),
            suggested_fields={"revision_rounds": "recommended"},
            dismissed_fields=frozenset({"revision_rounds"}),
        )

        assert [candidate.field_path for candidate in queue] == []

    def test_a_genuine_conflict_still_reaches_the_recruiter(self) -> None:
        # The one case where asking is the right answer: the page said two
        # different things and only the recruiter knows which is true.
        queue = deterministic_question_queue(
            conflicted_fields=frozenset({"budget_amount"}),
            missing_fields={},
            answered_fields=frozenset(),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset(),
        )

        assert "budget_amount" in [candidate.field_path for candidate in queue]

    def test_a_conflict_comes_before_an_optional_suggestion(self) -> None:
        # Order is about the recruiter's attention: a contradiction the source
        # cannot resolve is worth more of it than a nicety.
        queue = deterministic_question_queue(
            conflicted_fields=frozenset({"location"}),
            missing_fields={},
            answered_fields=frozenset(),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset(),
            suggested_fields={"content_niches": "optional"},
        )
        paths = [candidate.field_path for candidate in queue]

        assert paths.index("location") < paths.index("content_niches")

    def test_a_field_the_platform_decides_is_never_asked(self) -> None:
        # Application routing and mode are platform decisions. Asking about them
        # would offer the recruiter a choice that does not exist.
        queue = deterministic_question_queue(
            conflicted_fields=frozenset(),
            missing_fields={
                "application_mode": "publication_blocker",
                "external_apply_url": "publication_blocker",
            },
            answered_fields=frozenset(),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset(),
        )

        assert [candidate.field_path for candidate in queue] == []

    def test_an_inactive_conditional_is_never_asked(self) -> None:
        """PREMATURE, target zero.

        A trial's scope only matters once there is a trial. Asking first is
        asking about something that may never exist.
        """

        queue = deterministic_question_queue(
            conflicted_fields=frozenset(),
            missing_fields={"trial_scope": "conditionally_required"},
            answered_fields=frozenset(),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset(),
        )

        assert [candidate.field_path for candidate in queue] == []

    def test_the_same_field_is_never_queued_twice(self) -> None:
        queue = deterministic_question_queue(
            conflicted_fields=frozenset({"location"}),
            missing_fields={"location": "publication_blocker"},
            answered_fields=frozenset(),
            suppressed_fields=frozenset(),
            active_conditional_fields=frozenset(),
            suggested_fields={"location": "recommended"},
        )
        paths = [candidate.field_path for candidate in queue]

        assert len(paths) == len(set(paths))
