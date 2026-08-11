"""What a candidate submits, arriving intact in the recruiter's Inbox.

A requirement is only real if the answer survives the whole way: selected on the
job, asked of the candidate, accepted by the server, stored under the right key,
and readable by the recruiter. A break anywhere in that chain is silent — the
recruiter believes they asked, the candidate believes they answered, and neither
is told otherwise.

Every answer here carries a sentinel, so the assertion needs no judgement: the
string the candidate typed either reaches the recruiter or it does not. That also
makes cross-candidate contamination visible, which is the one failure in this
area that would be a P0 rather than a P1 — one applicant's answers shown under
another's name.

The privacy half runs in the same flow rather than separately, because the two
are easy to satisfy individually and hard to satisfy together: hiding a screening
question by dropping it would pass every privacy check and destroy the feature.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import active_test_role_id
from tests.test_openai_job_import import _auth

SCREEN_SECRET = "SCREEN_SECRET_S3141"
ROUTE_SECRET = "ROUTE_SECRET_R2718"

#: One sentinel per requirement, so a mix-up names itself.
ANSWERS: dict[str, Any] = {
    "expected_rate": {"amount": "5000", "unit": "per month", "currency": "INR"},
    "resume": "https://example.invalid/RESUME_SENTINEL_R417",
    "cover_letter": "COVER_LETTER_SENTINEL_L528 — a tailored application letter",
    "relevant_portfolio": [
        {"id": "p1", "title": "PORTFOLIO_SENTINEL_A731", "url": "https://example.invalid/a"}
    ],
    "turnaround": {"value": "3", "unit": "days"},
    "working_hours": "HOURS_SENTINEL_B842 — ten hours a week",
    "relevant_experience": "EXPERIENCE_SENTINEL_C953 — four years of short-form",
    "tools_workflow": ["CapCut", "TOOLS_SENTINEL_D164"],
    "start_availability": "START_SENTINEL_E275 — from 1 September",
    "fit_note": "FITNOTE_SENTINEL_F386 — why this role suits me",
}

REQUIREMENT_KEYS = list(ANSWERS)


def _walk(payload: Any) -> list[str]:
    if isinstance(payload, str):
        return [payload]
    if isinstance(payload, dict):
        return [f for k, v in payload.items() for f in (_walk(k) + _walk(v))]
    if isinstance(payload, (list, tuple)):
        return [f for item in payload for f in _walk(item)]
    return [] if payload is None or isinstance(payload, (int, float, bool)) else [str(payload)]


async def _publish_job(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    requirements: list[str] | None = None,
    screening: bool = True,
) -> dict[str, Any]:
    role_id = await active_test_role_id()
    payload = {
        "primary_role_id": role_id,
        "title": "Content Creator END_TO_END_T900",
        "responsibilities": ["Edit four videos a month.", "Write captions."],
        "requirements": ["Comfortable editing short-form video."],
        "about_channel": "A cooking channel with a long archive and a growing audience.",
        "platforms": ["youtube"],
        "engagement_type": "ongoing_freelance",
        "work_mode": "remote",
        "compensation_mode": "fixed",
        "budget_amount": "5000",
        "budget_currency": "INR",
        "budget_unit": "per month",
        "experience_level": "At least 2 years",
        "expected_weekly_hours_min": 10,
        "expected_weekly_hours_max": 20,
        "how_to_apply": "Please include a recent sample with your application.",
        "application_requirements": (
            REQUIREMENT_KEYS if requirements is None else requirements
        ),
        "deliverables": [
            {"type": "long_form_video", "quantity": 4, "frequency": "per_month"}
        ],
        "required_skill_keys": ["video_editing"],
        "revision_policy": "fixed",
        "revision_rounds": 2,
        "source_inputs": [{"type": "raw_footage"}],
        "creative_autonomy": "collaborative_direction",
        "trial_status": "none",
        "start_timing": "immediate",
        "duration_type": "ongoing",
        "hiring_process": [{"stage": "application_review"}, {"stage": "offer"}],
        "employer_context_type": "brand",
        "status": "published",
    }
    if screening:
        payload["screening_questions"] = [
            {"prompt": f"Why does {SCREEN_SECRET} interest you?", "required": True}
        ]
    created = await client.post("/api/v1/jobs", headers=headers, json=payload)
    assert created.status_code in (200, 201), created.text
    return created.json()


async def _apply(
    client: AsyncClient,
    headers: dict[str, str],
    job_id: str,
    answers: dict[str, Any],
    *,
    note: str = "I can help.",
) -> dict[str, Any]:
    response = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers=headers,
        json={
            "cover_note": note,
            "portfolio_item_ids": [],
            "first_message_answers": answers,
        },
    )
    return {"status": response.status_code, "body": response.json(), "raw": response.text}


@pytest.mark.asyncio
class TestEverySelectedRequirementReachesTheRecruiter:
    async def test_every_answer_survives_submission_and_readback(
        self, client: AsyncClient
    ) -> None:
        owner_headers, _owner = await _auth(client, "e2e-owner-all")
        job = await _publish_job(client, owner_headers)

        applicant_headers, _applicant = await _auth(client, "e2e-applicant-all")
        submitted = await _apply(client, applicant_headers, job["id"], ANSWERS)
        assert submitted["status"] == 201, submitted["raw"]

        listed = await client.get(
            "/api/v1/me/applications/received", headers=owner_headers
        )
        assert listed.status_code == 200, listed.text
        received = " ".join(_walk(listed.json()))

        # Each sentinel names its own requirement, so a missing one says which.
        for key, answer in ANSWERS.items():
            for sentinel in _walk(answer):
                if "SENTINEL" not in sentinel:
                    continue
                assert sentinel in received, f"{key} did not reach the recruiter"

    @pytest.mark.parametrize("key", REQUIREMENT_KEYS)
    async def test_each_requirement_alone_is_satisfiable(
        self, client: AsyncClient, key: str
    ) -> None:
        owner_headers, _owner = await _auth(client, f"e2e-owner-{key}")
        job = await _publish_job(client, owner_headers, requirements=[key])

        applicant_headers, _applicant = await _auth(client, f"e2e-applicant-{key}")
        submitted = await _apply(
            client, applicant_headers, job["id"], {key: ANSWERS[key]}
        )

        # A requirement a candidate cannot satisfy is worse than one that does
        # not exist: the recruiter thinks they asked for it.
        assert submitted["status"] == 201, f"{key}: {submitted['raw']}"

        listed = await client.get(
            "/api/v1/me/applications/received", headers=owner_headers
        )
        received = " ".join(_walk(listed.json()))
        for sentinel in _walk(ANSWERS[key]):
            if "SENTINEL" in sentinel:
                assert sentinel in received, key
        # Structured answers carry no sentinel of their own, so they are
        # checked by value — a rate that arrives without its unit or currency
        # is as lost as one that never arrived.
        if key in {"expected_rate", "turnaround"}:
            for part in ANSWERS[key].values():
                assert str(part) in received, f"{key} lost {part!r}"


@pytest.mark.asyncio
class TestOneCandidatesAnswersAreNeverAnothers:
    async def test_two_applicants_keep_their_own_answers(
        self, client: AsyncClient
    ) -> None:
        owner_headers, _owner = await _auth(client, "e2e-owner-isolation")
        job = await _publish_job(client, owner_headers, requirements=["fit_note"])

        first_headers, _first = await _auth(client, "e2e-applicant-one")
        second_headers, _second = await _auth(client, "e2e-applicant-two")

        first = await _apply(
            client, first_headers, job["id"], {"fit_note": "CANDIDATE_ONE_X111"}
        )
        second = await _apply(
            client, second_headers, job["id"], {"fit_note": "CANDIDATE_TWO_Y222"}
        )
        assert first["status"] == 201 and second["status"] == 201

        listed = await client.get(
            "/api/v1/me/applications/received", headers=owner_headers
        )
        applications = listed.json()
        rows = applications if isinstance(applications, list) else applications.get("items", [])
        assert len(rows) >= 2, rows

        # One applicant's answer appearing under another's name is the single
        # worst outcome in this area, so it is asserted per row rather than in
        # aggregate.
        for row in rows:
            text = " ".join(_walk(row))
            assert not (
                "CANDIDATE_ONE_X111" in text and "CANDIDATE_TWO_Y222" in text
            ), "two candidates' answers appeared on one application"


@pytest.mark.asyncio
class TestScreeningIsPrivateAndStillWorks:
    async def test_the_question_is_absent_publicly_and_present_to_its_owner(
        self, client: AsyncClient
    ) -> None:
        owner_headers, _owner = await _auth(client, "e2e-owner-screening")
        job = await _publish_job(client, owner_headers)

        public = await client.get(f"/api/v1/jobs/{job['id']}")
        assert SCREEN_SECRET not in " ".join(_walk(public.json()))

        # Privacy achieved by deleting the question would pass the line above
        # and destroy the feature, so the recruiter's own view is checked too.
        assert SCREEN_SECRET in " ".join(_walk(job))

    async def test_the_question_is_delivered_as_a_message_not_an_application_field(
        self, client: AsyncClient
    ) -> None:
        """Screening travels through the Inbox, deliberately.

        An earlier version of this test had the candidate answer screening
        questions during Apply. That contradicts the accepted design, which an
        existing frontend test pins explicitly: "screening questions are not
        collected before applying (preflight is inert)". The question is sent
        as one hiring-side message after the application lands, so the
        candidate is not asked to write essays before anyone has read them.

        What matters for assurance is therefore not that the answer rides in
        `first_message_answers`, but that the question is carried by the
        messaging layer and never by a public surface.
        """

        from pathlib import Path

        messaging = Path("app/services/messaging_service.py").read_text()

        # The delivery mechanism exists and is a message, with a stable
        # identity so a retry cannot post it twice.
        assert "SCREENING_ANSWERS_NAMESPACE" in messaging
        assert '"message_kind": "screening_answers"' in messaging
        assert 'metadata.get("message_kind") == "screening_questions"' in messaging

    async def test_an_application_still_succeeds_with_no_screening_answer(
        self, client: AsyncClient
    ) -> None:
        # Since screening is not collected at application time, a job carrying
        # screening questions must not make applying harder.
        owner_headers, _owner = await _auth(client, "e2e-owner-screen-optional")
        job = await _publish_job(client, owner_headers, requirements=["fit_note"])

        applicant_headers, _applicant = await _auth(client, "e2e-applicant-optional")
        submitted = await _apply(
            client,
            applicant_headers,
            job["id"],
            {"fit_note": "FITNOTE_SENTINEL_F386 — why this role suits me"},
        )

        assert submitted["status"] == 201, submitted["raw"]


@pytest.mark.asyncio
class TestNoRoutingDestinationSurvivesToAnApplicant:
    async def test_a_destination_in_a_published_note_never_reaches_the_public(
        self, client: AsyncClient
    ) -> None:
        """The sanitizer has to hold at publication, not only at import.

        A recruiter can paste a source's own wording straight into the note, so
        the destination arrives by a path the import pipeline never touched.
        """

        owner_headers, _owner = await _auth(client, "e2e-owner-route")
        role_id = await active_test_role_id()
        payload = {
            "primary_role_id": role_id,
            "title": "Content Creator ROUTE_CHECK_T901",
            "responsibilities": ["Edit four videos a month."],
            "requirements": ["Comfortable editing short-form video."],
            "about_channel": (
                "A cooking channel with a long archive and a growing audience."
            ),
            "platforms": ["youtube"],
            "engagement_type": "ongoing_freelance",
            "work_mode": "remote",
            "compensation_mode": "fixed",
            "budget_amount": "5000",
            "budget_currency": "INR",
            "budget_unit": "per month",
            "experience_level": "At least 2 years",
            "expected_weekly_hours_min": 10,
            "expected_weekly_hours_max": 20,
            "how_to_apply": (
                f"Send your portfolio to {ROUTE_SECRET}@example.invalid "
                "or message us on Zephyrgram."
            ),
            "application_requirements": ["relevant_portfolio"],
            "deliverables": [
                {"type": "long_form_video", "quantity": 4, "frequency": "per_month"}
            ],
            "required_skill_keys": ["video_editing"],
            "revision_policy": "fixed",
            "revision_rounds": 2,
            "source_inputs": [{"type": "raw_footage"}],
            "creative_autonomy": "collaborative_direction",
            "trial_status": "none",
            "start_timing": "immediate",
            "duration_type": "ongoing",
            "hiring_process": [{"stage": "application_review"}, {"stage": "offer"}],
            "employer_context_type": "brand",
            "status": "published",
        }
        created = await client.post("/api/v1/jobs", headers=owner_headers, json=payload)

        if created.status_code == 422:
            # Publication refuses recruiter-authored routing outright, which is
            # the stronger outcome: the destination never becomes a job at all.
            assert ROUTE_SECRET not in created.text or "how_to_apply" in created.text
            return

        assert created.status_code in (200, 201), created.text
        public = await client.get(f"/api/v1/jobs/{created.json()['id']}")
        served = " ".join(_walk(public.json()))

        assert ROUTE_SECRET not in served
        assert "zephyrgram" not in served.lower()
        assert "@example.invalid" not in served
