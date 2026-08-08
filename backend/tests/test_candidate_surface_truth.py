"""What a candidate is actually served, checked against what the job says.

Every campaign before this one stopped at the native draft. That is one boundary
short of the thing that matters: a candidate reads the public payload, and a
value can be perfectly stored and still arrive wrong, duplicated, or — worst —
accompanied by something that was supposed to stay private.

Two oracles here, and neither is derived from the code being tested.

The first is a set of sentinels. Private fields are filled with strings nothing
else could produce, and the entire serialized public payload is walked
recursively looking for them. A screening question hidden by the UI but present
in the JSON is a leak; so is a routing destination behind a CSS rule. Scanning
the payload rather than the render is what makes that visible.

The second is a declared semantic record. The facts a job states are written down
independently, and the public projection is compared against them field by field
— because "the endpoint returned something" is not an assertion, and asking the
serializer what it thinks it produced would be the same self-referential mistake
that let a mutation hide inside a region table.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest
from httpx import AsyncClient

from tests.test_openai_job_import import _auth

#: Strings no ordinary job content could contain. If one of these reaches a
#: public surface, it got there from the field it was planted in.
SCREENING_SENTINEL = "SCREENING_SECRET_Q7X24"
ROUTE_SENTINEL = "ROUTE_SECRET_R6Y81"

#: Facts a candidate is supposed to receive, declared rather than derived.
PUBLIC_MATERIAL = "MATERIAL_M842 sample"
PUBLIC_RESPONSIBILITY = "Produce RESPONSIBILITY_A731 weekly episodes."


@dataclass(frozen=True)
class CandidateTruth:
    """What a candidate must be told, and what must never reach them."""

    title: str
    budget_amount: str
    budget_currency: str
    budget_unit: str
    engagement_type: str
    work_mode: str
    location: str | None
    responsibilities: list[str]
    public_note: str
    private_screening: list[str]
    private_route: str


TRUTH = CandidateTruth(
    title="Content Creator CANDIDATE_TRUTH_T118",
    budget_amount="5000",
    budget_currency="INR",
    budget_unit="per month",
    engagement_type="ongoing_freelance",
    work_mode="remote",
    location=None,
    responsibilities=[PUBLIC_RESPONSIBILITY, "Write captions."],
    public_note=f"Please include a {PUBLIC_MATERIAL} with your application.",
    private_screening=[f"Why does {SCREENING_SENTINEL} interest you?"],
    private_route=f"Email us at {ROUTE_SENTINEL}@example.invalid",
)


def _walk(payload: Any) -> list[str]:
    """Every string anywhere in a serialized payload, however nested."""

    if isinstance(payload, str):
        return [payload]
    if isinstance(payload, dict):
        return [
            found
            for key, value in payload.items()
            for found in (_walk(key) + _walk(value))
        ]
    if isinstance(payload, (list, tuple, set)):
        return [found for item in payload for found in _walk(item)]
    if payload is None or isinstance(payload, (int, float, bool)):
        return []
    return [str(payload)]


async def _publish_job(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    """A job carrying every sentinel, published through the ordinary API."""

    from tests.conftest import active_test_role_id

    role_id = await active_test_role_id()

    payload = {
        "primary_role_id": role_id,
        "title": TRUTH.title,
        "responsibilities": TRUTH.responsibilities,
        "engagement_type": TRUTH.engagement_type,
        "work_mode": TRUTH.work_mode,
        "compensation_mode": "fixed",
        "budget_amount": TRUTH.budget_amount,
        "budget_currency": TRUTH.budget_currency,
        "budget_unit": TRUTH.budget_unit,
        "experience_level": "At least 2 years",
        "how_to_apply": TRUTH.public_note,
        "application_requirements": ["relevant_portfolio"],
        "deliverables": [
            {"type": "long_form_video", "quantity": 4, "frequency": "per_month"}
        ],
        "required_skill_keys": ["video_editing"],
        "requirements": ["Comfortable editing short-form video."],
        "platforms": ["youtube"],
        "about_channel": (
            "A cooking channel with a long archive and a growing short-form audience."
        ),
        "expected_weekly_hours_min": 10,
        "expected_weekly_hours_max": 20,
        "revision_policy": "fixed",
        "revision_rounds": 2,
        "source_inputs": [{"type": "raw_footage"}],
        "creative_autonomy": "collaborative_direction",
        "trial_status": "none",
        "start_timing": "immediate",
        "duration_type": "ongoing",
        "hiring_process": [{"stage": "application_review"}, {"stage": "offer"}],
        # Candidate-facing by design: the job detail renders the hiring
        # process, and knowing the stages is what the field is for.
        "hiring_process_notes": "Most candidates hear back within one week.",
        "screening_questions": [
            {"prompt": prompt, "required": True} for prompt in TRUTH.private_screening
        ],
        "employer_context_type": "brand",
        "status": "published",
    }
    created = await client.post("/api/v1/jobs", headers=headers, json=payload)
    assert created.status_code in (200, 201), created.text
    return created.json()


@pytest.mark.asyncio
class TestNothingPrivateReachesAPublicPayload:
    """Scanned in the payload, not the render. CSS is not a privacy boundary."""

    async def test_a_screening_question_never_appears_publicly(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "candidate-truth-screening")
        job = await _publish_job(client, headers)

        public = await client.get(f"/api/v1/jobs/{job['id']}")
        assert public.status_code == 200, public.text

        strings = _walk(public.json())
        offenders = [value for value in strings if SCREENING_SENTINEL in value]

        assert offenders == [], offenders

    async def test_the_private_field_list_is_declared_rather_than_assumed(
        self, client: AsyncClient
    ) -> None:
        """Which fields are private, written down and checked against the code.

        The first version of this test assumed `hiring_process_notes` was
        recruiter-only. It is not: the candidate job detail renders the hiring
        process, and telling an applicant what the stages are is the point of
        the field. Guessing at the boundary is how a test ends up arguing with
        the product.

        So the boundary is declared here instead. A field added to the private
        set and not stripped by the serializer fails; so does a field the
        serializer strips that nobody declared private, because silently
        withholding something candidate-facing is also a defect.
        """

        from app.schemas.job import JobRead
        from app.services.public_listing_serializer import public_job_read

        private = {"screening_questions", "languages", "language_requirements"}

        headers, _owner = await _auth(client, "candidate-truth-classification")
        job = await _publish_job(client, headers)
        public = (await client.get(f"/api/v1/jobs/{job['id']}")).json()

        for field in private:
            assert not public.get(field), f"{field} reached a candidate"

        # And the serializer strips exactly those, nothing more.
        source = __import__(
            "inspect"
        ).getsource(public_job_read)
        stripped = {
            name
            for name in JobRead.model_fields
            if f"read.{name} =" in source
        }
        assert stripped == private, (
            f"the serializer strips {stripped}, the declared private set is {private}"
        )

    async def test_the_public_payload_carries_no_routing_destination(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "candidate-truth-route")
        job = await _publish_job(client, headers)

        public = await client.get(f"/api/v1/jobs/{job['id']}")
        joined = " ".join(_walk(public.json()))

        assert ROUTE_SENTINEL not in joined
        for banned in ("@example.invalid", "whatsapp", "telegram"):
            assert banned not in joined.lower(), banned

    async def test_the_listing_endpoint_is_as_private_as_the_detail_one(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "candidate-truth-listing")
        await _publish_job(client, headers)

        listed = await client.get("/api/v1/jobs")
        assert listed.status_code == 200, listed.text
        joined = " ".join(_walk(listed.json()))

        # A privacy boundary that holds on one endpoint and not the other is
        # not a boundary.
        assert SCREENING_SENTINEL not in joined
        assert ROUTE_SENTINEL not in joined


@pytest.mark.asyncio
class TestWhatTheCandidateIsToldIsWhatTheJobSays:
    async def test_the_public_facts_match_the_declared_truth(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "candidate-truth-facts")
        job = await _publish_job(client, headers)

        public = (await client.get(f"/api/v1/jobs/{job['id']}")).json()

        assert public["title"] == TRUTH.title
        assert str(public["budget_amount"]).startswith(TRUTH.budget_amount)
        assert public["budget_currency"] == TRUTH.budget_currency
        assert public["budget_unit"] == TRUTH.budget_unit
        assert public["engagement_type"] == TRUTH.engagement_type
        assert public["work_mode"] == TRUTH.work_mode

    async def test_the_public_material_survives_to_the_candidate(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "candidate-truth-material")
        job = await _publish_job(client, headers)

        public = (await client.get(f"/api/v1/jobs/{job['id']}")).json()
        joined = " ".join(_walk(public))

        # Privacy achieved by deleting the requirement is not privacy, it is
        # loss. The material the recruiter asked for has to arrive.
        assert PUBLIC_MATERIAL in joined
        assert "relevant_portfolio" in (public.get("application_requirements") or [])

    async def test_the_responsibilities_survive_intact(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "candidate-truth-work")
        job = await _publish_job(client, headers)

        public = (await client.get(f"/api/v1/jobs/{job['id']}")).json()

        assert public["responsibilities"] == TRUTH.responsibilities

    async def test_a_remote_job_is_not_described_as_being_somewhere(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "candidate-truth-remote")
        job = await _publish_job(client, headers)

        public = (await client.get(f"/api/v1/jobs/{job['id']}")).json()

        # Remote with no stated country must not acquire one.
        assert public["work_mode"] == "remote"
        assert not public.get("city")
        assert not public.get("region")


@pytest.mark.asyncio
class TestTheRecruitersOwnViewStillHasEverything:
    """Privacy must not be achieved by losing the functionality."""

    async def test_the_owner_can_still_read_their_screening_questions(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "candidate-truth-owner")
        job = await _publish_job(client, headers)

        owned = await client.get(f"/api/v1/jobs/{job['id']}/edit", headers=headers)
        if owned.status_code == 404:
            # No separate owner route in this build; the create response is the
            # recruiter's own view and must carry it.
            owned_payload = job
        else:
            assert owned.status_code == 200, owned.text
            owned_payload = owned.json()

        joined = " ".join(_walk(owned_payload))
        assert SCREENING_SENTINEL in joined, (
            "the recruiter cannot see the question they wrote"
        )
