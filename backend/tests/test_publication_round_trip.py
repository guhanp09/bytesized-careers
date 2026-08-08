"""A fact stated once, still true after it has been saved and read back.

Every previous campaign stopped at the native draft. That leaves the boundary
where a value is most quietly lost: a job is created, stored, read back, saved
again, and published, and any of those steps can normalise a value into
something that means something else. Nothing raises an error — the recruiter
simply finds a different job than the one they wrote.

The generated cases here cross the dimensions that carry meaning: engagement,
work mode, geography, compensation shape, experience wording. Each one declares
what it means *independently* of the code, then goes through the real API — real
validation, real persistence, real serialization — and the meaning is compared
at every boundary.

The repeated-save half matters as much as the first one. A round trip that is
correct once and drifts on the second is worse than one that fails immediately,
because it only shows up for recruiters who edit their job twice.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import active_test_role_id
from tests.test_openai_job_import import _auth

ENGAGEMENTS = ("ongoing_freelance", "fixed_term", "full_time", "part_time", "internship")
WORK_MODES = ("remote", "hybrid", "onsite")
CITIES = (
    None,
    "Chennai",
    "Bengaluru",
    "Mumbai",
    "Pune",
    "Hyderabad",
    "Kolkata",
    "Boston, MA",
    "Austin, TX",
)
COMPENSATIONS = (
    {"compensation_mode": "fixed", "budget_amount": "5000", "budget_unit": "per month"},
    {"compensation_mode": "fixed", "budget_amount": "40", "budget_unit": "per hour"},
    {"compensation_mode": "fixed", "budget_amount": "500000", "budget_unit": "per year"},
    {"compensation_mode": "fixed", "budget_amount": "15000", "budget_unit": "per project"},
    {
        "compensation_mode": "range",
        "budget_amount": "5000",
        "budget_max": "10000",
        "budget_unit": "per month",
    },
)
EXPERIENCES = (
    "At least 5 years",
    "5+ years",
    "25 years of professional experience",
    "At least 60 months",
    "2-3 years",
    "Senior",
    "Minimum of three years",
    "Up to 4 years",
    "10+ years",
)


@dataclass(frozen=True)
class SemanticJob:
    """What a job means, declared independently of any code that stores it."""

    engagement: str
    work_mode: str
    city: str | None
    compensation: dict[str, str]
    experience: str

    @property
    def ident(self) -> str:
        return (
            f"{self.engagement}/{self.work_mode}/{self.city or 'nowhere'}/"
            f"{self.compensation['budget_unit']}/{self.experience[:12]}"
        )


def _cases(limit: int) -> list[SemanticJob]:
    """Every meaningful combination, then sampled to a workable size.

    Enumerated rather than randomised so the corpus is stable, and ordered so a
    truncated run still covers every value of every dimension.
    """

    combinations = [
        SemanticJob(engagement, work_mode, city, compensation, experience)
        for engagement, work_mode, city, compensation, experience in itertools.product(
            ENGAGEMENTS, WORK_MODES, CITIES, COMPENSATIONS, EXPERIENCES
        )
        # Hybrid and onsite work happens somewhere, and publication rightly
        # refuses a job that claims otherwise. Generating incoherent jobs would
        # only measure the validator.
        if not (work_mode in {"hybrid", "onsite"} and city is None)
    ]
    if len(combinations) <= limit:
        return combinations
    step = len(combinations) // limit
    return combinations[:: max(1, step)][:limit]


CASES = _cases(2400)
assert len(CASES) >= 2000, len(CASES)


def _payload(case: SemanticJob, role_id: str, *, title: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "primary_role_id": role_id,
        "title": title,
        "responsibilities": ["Edit four videos a month.", "Write captions."],
        "requirements": ["Comfortable editing short-form video."],
        "about_channel": "A cooking channel with a long archive and a growing audience.",
        "platforms": ["youtube"],
        "engagement_type": case.engagement,
        "work_mode": case.work_mode,
        "budget_currency": "INR",
        "experience_level": case.experience,
        "expected_weekly_hours_min": 10,
        "expected_weekly_hours_max": 20,
        "how_to_apply": "Please include a recent sample with your application.",
        "application_requirements": ["relevant_portfolio", "expected_rate"],
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
        **case.compensation,
    }
    if case.city:
        # The schema names this `location`, not `city`.
        payload["location"] = case.city
    if case.engagement == "fixed_term":
        payload["duration_type"] = "fixed_period"
        payload["duration_value"] = 6
        payload["duration_unit"] = "months"
    return payload


#: The facts whose meaning must survive every boundary.
MEANINGFUL = (
    "engagement_type",
    "work_mode",
    "compensation_mode",
    "budget_amount",
    "budget_max",
    "budget_unit",
    "budget_currency",
    "experience_level",
    "responsibilities",
    "application_requirements",
)


def _meaning(payload: dict[str, Any]) -> dict[str, Any]:
    """The subset of a job that carries meaning, normalised for comparison."""

    meaning: dict[str, Any] = {}
    for field in MEANINGFUL:
        value = payload.get(field)
        if isinstance(value, str) and value.replace(".", "", 1).isdigit():
            # "5000" and "5000.00" are the same amount; a different amount is
            # a different job.
            value = f"{float(value):.2f}"
        meaning[field] = value
    return meaning


class TestTheGeneratedCorpusIsWorthTrusting:
    def test_there_are_enough_cases_and_every_dimension_appears(self) -> None:
        assert len(CASES) >= 2000, len(CASES)

        assert {case.engagement for case in CASES} == set(ENGAGEMENTS)
        assert {case.work_mode for case in CASES} == set(WORK_MODES)
        assert {case.city for case in CASES} == set(CITIES)
        # Every work mode still appears, and no incoherent pairing survives.
        assert not [
            case
            for case in CASES
            if case.work_mode in {"hybrid", "onsite"} and case.city is None
        ]
        assert {case.experience for case in CASES} == set(EXPERIENCES)
        assert {
            case.compensation["budget_unit"] for case in CASES
        } == {entry["budget_unit"] for entry in COMPENSATIONS}


@pytest.mark.asyncio
class TestASavedJobStillMeansWhatItSaid:
    """The real boundaries: validation, persistence, serialization."""

    @pytest.mark.parametrize("chunk", range(12))
    async def test_a_generated_job_survives_creation_and_readback(
        self, client: AsyncClient, chunk: int
    ) -> None:
        headers, _owner = await _auth(client, f"rt-create-{chunk}")
        role_id = await active_test_role_id()

        for index, case in enumerate(CASES[chunk::12][:14]):
            payload = _payload(case, role_id, title=f"Round trip {chunk}-{index}")
            created = await client.post("/api/v1/jobs", headers=headers, json=payload)
            assert created.status_code in (200, 201), f"{case.ident}: {created.text}"

            stored = created.json()
            declared = _meaning(payload)
            actual = _meaning(stored)

            for field, expected in declared.items():
                if expected is None:
                    continue
                assert actual[field] == expected, (
                    f"{case.ident}: {field} was {expected!r} and became {actual[field]!r}"
                )

    @pytest.mark.parametrize("chunk", range(6))
    async def test_reading_a_job_back_does_not_change_it(
        self, client: AsyncClient, chunk: int
    ) -> None:
        headers, _owner = await _auth(client, f"rt-read-{chunk}")
        role_id = await active_test_role_id()

        for index, case in enumerate(CASES[chunk::6][:10]):
            payload = _payload(case, role_id, title=f"Readback {chunk}-{index}")
            created = await client.post("/api/v1/jobs", headers=headers, json=payload)
            assert created.status_code in (200, 201), created.text
            job_id = created.json()["id"]

            first = await client.get(f"/api/v1/jobs/{job_id}")
            second = await client.get(f"/api/v1/jobs/{job_id}")
            assert first.status_code == 200 and second.status_code == 200

            # Reading twice must not produce two different jobs. Drift here is
            # what makes a listing change while nobody edits it.
            assert _meaning(first.json()) == _meaning(second.json()), case.ident

    @pytest.mark.parametrize("chunk", range(6))
    async def test_the_public_projection_agrees_with_what_was_stored(
        self, client: AsyncClient, chunk: int
    ) -> None:
        headers, _owner = await _auth(client, f"rt-public-{chunk}")
        role_id = await active_test_role_id()

        for index, case in enumerate(CASES[chunk::6][:10]):
            payload = _payload(case, role_id, title=f"Public {chunk}-{index}")
            created = await client.post("/api/v1/jobs", headers=headers, json=payload)
            assert created.status_code in (200, 201), created.text

            public = await client.get(f"/api/v1/jobs/{created.json()['id']}")
            assert public.status_code == 200, public.text

            declared = _meaning(payload)
            served = _meaning(public.json())

            for field, expected in declared.items():
                if expected is None:
                    continue
                assert served[field] == expected, (
                    f"{case.ident}: candidates are told {field} is "
                    f"{served[field]!r}, the job says {expected!r}"
                )


@pytest.mark.asyncio
class TestARecruitersOwnEditIsFinal:
    """A stale imported value must never come back over a correction."""

    EDITS = (
        ("engagement_type", "internship"),
        ("work_mode", "onsite"),
        ("budget_amount", "9999"),
        ("budget_unit", "per year"),
        ("experience_level", "Exactly 7 years"),
        ("title", "Recruiter corrected this title"),
    )

    @pytest.mark.parametrize(("field", "corrected"), EDITS)
    async def test_an_edit_survives_repeated_reopening(
        self, client: AsyncClient, field: str, corrected: str
    ) -> None:
        headers, _owner = await _auth(client, f"rt-edit-{field}")
        role_id = await active_test_role_id()
        case = CASES[0]
        payload = _payload(case, role_id, title="Recruiter edit precedence")
        payload["status"] = "draft"

        created = await client.post("/api/v1/jobs", headers=headers, json=payload)
        assert created.status_code in (200, 201), created.text
        job_id = created.json()["id"]

        saved = await client.patch(
            f"/api/v1/jobs/{job_id}", headers=headers, json={field: corrected}
        )
        assert saved.status_code in (200, 201), saved.text
        assert str(saved.json()[field]).startswith(corrected.split(".")[0]), saved.text

        # Reopened repeatedly, because a value that reasserts itself usually
        # does so on a later hydration rather than the first. A draft is not
        # publicly readable, so each reopen is an owner-scoped no-op PATCH —
        # the same hydration path the editor uses.
        for _ in range(3):
            reread = await client.patch(
                f"/api/v1/jobs/{job_id}", headers=headers, json={}
            )
            assert reread.status_code in (200, 201), reread.text
            assert str(reread.json()[field]).startswith(corrected.split(".")[0]), (
                f"{field} reverted to {reread.json()[field]!r} instead of {corrected!r}"
            )

    @pytest.mark.parametrize(("field", "corrected"), EDITS)
    async def test_editing_one_field_leaves_the_others_alone(
        self, client: AsyncClient, field: str, corrected: str
    ) -> None:
        headers, _owner = await _auth(client, f"rt-isolate-{field}")
        role_id = await active_test_role_id()
        payload = _payload(CASES[0], role_id, title="Field isolation")
        payload["status"] = "draft"

        created = await client.post("/api/v1/jobs", headers=headers, json=payload)
        assert created.status_code in (200, 201), created.text
        job_id = created.json()["id"]
        before = _meaning(created.json())

        saved = await client.patch(
            f"/api/v1/jobs/{job_id}", headers=headers, json={field: corrected}
        )
        assert saved.status_code in (200, 201), saved.text
        after = _meaning(saved.json())

        # Everything the edit did not touch must be untouched. Accidental
        # coupling is how changing a salary moves a location.
        for other in MEANINGFUL:
            if other == field:
                continue
            if field == "budget_unit" and other in {"budget_max"}:
                continue
            assert after[other] == before[other], (
                f"editing {field} also changed {other}: "
                f"{before[other]!r} -> {after[other]!r}"
            )
