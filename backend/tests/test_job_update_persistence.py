"""What pressing save has to actually do to the stored job.

The round-trip suite proves that a job *created* with a meaning still has it
after storage and serialization. That is the first half of a recruiter's life
with a job and not the half they spend most of. The rest is editing: open the
draft, change one thing, save, come back tomorrow.

Mutation testing is what sent this file into existence. Five deliberate defects
in the update path survived the entire accepted suite:

  * ``exclude_none=True`` on the update payload — every field is writable and
    none is *clearable*, so a wrong city imported from a page can be corrected
    but never deleted;
  * ``updates.pop("application_requirements")`` — what applicants must send is
    thrown away on save;
  * ``updates.pop("responsibilities")`` — so is the description of the work;
  * dropping ``effective.update(updates)`` — publication is validated against
    the job as it was *before* the edit, so the edit that fixes a job cannot
    publish it and the edit that breaks one is waved through.

Each of those is silent. Nothing errors, the save returns 200, and the recruiter
finds out when a candidate applies with the wrong thing or the job will not go
live for a reason that is no longer true.

Expected values here are literals chosen by hand, never read back out of the
schema, the registry or the service being tested — an oracle derived from the
code under test cannot see the code under test disappear.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import active_test_role_id
from tests.test_openai_job_import import _auth


def _publishable(role_id: str, *, title: str) -> dict[str, Any]:
    """A complete, publishable job, written out rather than generated.

    Deliberately verbose. A helper that assembled this from the policy or the
    schema would go on producing a valid job after a field stopped existing.
    """

    return {
        "primary_role_id": role_id,
        "title": title,
        "responsibilities": ["Edit four videos a month.", "Write captions."],
        "requirements": ["Comfortable editing short-form video."],
        "about_channel": "A cooking channel with a long archive and a growing audience.",
        "platforms": ["youtube"],
        "engagement_type": "ongoing_freelance",
        "work_mode": "remote",
        "compensation_mode": "fixed",
        "budget_amount": "5000",
        "budget_unit": "per month",
        "budget_currency": "INR",
        "budget_note": "Reviewed after three months.",
        "experience_level": "25 years of professional experience",
        "expected_weekly_hours_min": 10,
        "expected_weekly_hours_max": 20,
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
    }


async def _create(client: AsyncClient, headers: dict[str, str], role_id: str, title: str):
    created = await client.post(
        "/api/v1/jobs", headers=headers, json=_publishable(role_id, title=title)
    )
    assert created.status_code in (200, 201), created.text
    return created.json()


async def _my_job(
    client: AsyncClient, headers: dict[str, str], job_id: str
) -> dict[str, Any]:
    """Reopen a job the way its owner does, drafts included."""

    listed = await client.get("/api/v1/me/jobs", headers=headers)
    assert listed.status_code == 200, listed.text
    for job in listed.json():
        if job["id"] == job_id:
            return job
    raise AssertionError(f"{job_id} is missing from the recruiter's own jobs")


def _same(value: Any, expected: Any) -> bool:
    """Compare by amount rather than by formatting.

    ``"5000"`` and ``"5000.00"`` are the same money; a different number is a
    different job. Everything else compares exactly.
    """

    if isinstance(expected, bool) or not isinstance(expected, (str, int, float)):
        return value == expected
    numeric = isinstance(expected, (int, float)) or expected.replace(".", "", 1).isdigit()
    if numeric:
        # Money and hours come back as decimal strings: 5 reads as "5.0".
        return value is not None and float(value) == float(expected)
    return value == expected


#: One edit per field a recruiter can plausibly make, with the value they would
#: see afterwards. Written by hand so that deleting a field's handling cannot
#: also delete the case that catches it.
EDITS: tuple[tuple[str, Any], ...] = (
    ("title", "A corrected job title"),
    ("responsibilities", ["Storyboard one video a week.", "Cut two Shorts a week."]),
    ("requirements", ["Three years of editing.", "Own colour-grading setup."]),
    ("about_channel", "A rewritten description of the channel and its audience."),
    ("application_requirements", ["relevant_portfolio", "cover_note"]),
    ("experience_level", "Exactly 7 years, no more"),
    ("work_mode", "hybrid"),
    ("location", "Chennai"),
    ("engagement_type", "part_time"),
    ("budget_amount", "9999"),
    ("budget_unit", "per year"),
    ("budget_currency", "USD"),
    ("budget_note", "Negotiable for the right person."),
    ("expected_weekly_hours_min", 5),
    ("expected_weekly_hours_max", 35),
    ("required_skill_keys", ["video_editing", "motion_graphics"]),
    ("revision_rounds", 4),
    ("creative_autonomy", "own_creative_approach"),
    ("start_timing", "within_two_weeks"),
)


@pytest.mark.asyncio
class TestAnEditReachesStorage:
    @pytest.mark.parametrize(("field", "corrected"), EDITS)
    async def test_a_saved_edit_is_there_when_the_job_is_reopened(
        self, client: AsyncClient, field: str, corrected: Any
    ) -> None:
        headers, _owner = await _auth(client, f"upd-{field}")
        role_id = await active_test_role_id()
        job = await _create(client, headers, role_id, f"Edit {field}")

        # Hybrid work happens somewhere; sending the mode without the place
        # would be testing the validator instead of the save.
        body: dict[str, Any] = {field: corrected}
        if field == "work_mode":
            body["location"] = "Pune"

        saved = await client.patch(
            f"/api/v1/jobs/{job['id']}", headers=headers, json=body
        )
        assert saved.status_code == 200, f"{field}: {saved.text}"
        assert _same(saved.json().get(field), corrected), (
            f"{field}: the save responded with {saved.json().get(field)!r}"
        )

        # The response could be an echo of the request. Only a fresh read says
        # whether anything was written.
        reopened = await client.get(f"/api/v1/jobs/{job['id']}", headers=headers)
        assert reopened.status_code == 200, reopened.text
        assert _same(reopened.json().get(field), corrected), (
            f"{field}: saved {corrected!r}, reopened as "
            f"{reopened.json().get(field)!r}"
        )

    @pytest.mark.parametrize(("field", "corrected"), EDITS)
    async def test_editing_one_field_leaves_every_other_alone(
        self, client: AsyncClient, field: str, corrected: Any
    ) -> None:
        headers, _owner = await _auth(client, f"iso-{field}")
        role_id = await active_test_role_id()
        job = await _create(client, headers, role_id, f"Isolation {field}")

        body: dict[str, Any] = {field: corrected}
        if field == "work_mode":
            body["location"] = "Pune"
        saved = await client.patch(
            f"/api/v1/jobs/{job['id']}", headers=headers, json=body
        )
        assert saved.status_code == 200, saved.text

        reopened = (await client.get(f"/api/v1/jobs/{job['id']}", headers=headers)).json()
        moved = [
            other
            for other, _ in EDITS
            if other != field
            and not (field == "work_mode" and other == "location")
            and reopened.get(other) != job.get(other)
        ]
        # A save that sends one step's fields must not disturb the others. This
        # is where an update built from a full model dump destroys a job.
        assert moved == [], f"editing {field} also changed {moved}"


@pytest.mark.asyncio
class TestAValueCanBeRemovedAndNotOnlyReplaced:
    """Correcting an import means deleting things, not only overwriting them."""

    #: Optional fields a recruiter may legitimately want emptied, with what an
    #: emptied one looks like when it is read back.
    #: `requirements` is deliberately absent: a published job must state at
    #: least one, so refusing to empty it is the product working. It is cleared
    #: on a draft instead, in the test below.
    CLEARABLE: tuple[tuple[str, Any, Any], ...] = (
        ("budget_note", None, None),
        ("experience_level", None, None),
        ("location", None, None),
    )

    @pytest.mark.parametrize(("field", "cleared", "expected"), CLEARABLE)
    async def test_clearing_a_field_actually_clears_it(
        self, client: AsyncClient, field: str, cleared: Any, expected: Any
    ) -> None:
        headers, _owner = await _auth(client, f"clr-{field}")
        role_id = await active_test_role_id()
        job = await _create(client, headers, role_id, f"Clear {field}")

        if field == "location":
            # Remote work has no city to begin with, so give it one to remove.
            seeded = await client.patch(
                f"/api/v1/jobs/{job['id']}",
                headers=headers,
                json={"work_mode": "hybrid", "location": "Kolkata"},
            )
            assert seeded.status_code == 200, seeded.text
            # And a hybrid job may not lose its place, so it goes back to remote
            # in the same breath the city is removed.
            body: dict[str, Any] = {"work_mode": "remote", "location": cleared}
        else:
            body = {field: cleared}

        saved = await client.patch(
            f"/api/v1/jobs/{job['id']}", headers=headers, json=body
        )
        assert saved.status_code == 200, f"{field}: {saved.text}"

        reopened = (await client.get(f"/api/v1/jobs/{job['id']}", headers=headers)).json()
        # An update that quietly ignores nulls looks identical to one that
        # works, right up until a recruiter tries to delete something wrong.
        assert reopened.get(field) in (expected, None), (
            f"{field}: cleared, but reopened as {reopened.get(field)!r}"
        )

    async def test_a_cleared_field_stays_cleared_across_a_second_save(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "clr-twice")
        role_id = await active_test_role_id()
        job = await _create(client, headers, role_id, "Clear twice")

        assert (
            await client.patch(
                f"/api/v1/jobs/{job['id']}", headers=headers, json={"budget_note": None}
            )
        ).status_code == 200
        assert (
            await client.patch(
                f"/api/v1/jobs/{job['id']}", headers=headers, json={"title": "Second save"}
            )
        ).status_code == 200

        reopened = (await client.get(f"/api/v1/jobs/{job['id']}", headers=headers)).json()
        assert reopened.get("budget_note") is None, "the removed note came back"
        assert reopened.get("title") == "Second save"


@pytest.mark.asyncio
class TestPublicationJudgesTheJobAsEdited:
    """The edit and the decision about it must be the same job.

    Validating the stored row instead of the row-plus-edit fails in both
    directions, and both are bad: the recruiter who fixes the missing field is
    told it is still missing, and the recruiter who deletes a required one is
    told nothing at all.
    """

    async def test_the_edit_that_completes_a_job_is_allowed_to_publish_it(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "pub-completes")
        role_id = await active_test_role_id()

        draft = _publishable(role_id, title="Completed by the same save")
        draft["status"] = "draft"
        draft.pop("about_channel")
        created = await client.post("/api/v1/jobs", headers=headers, json=draft)
        assert created.status_code in (200, 201), created.text

        # The missing field and the publish arrive together, which is exactly
        # what pressing "Publish" on the last step does.
        published = await client.patch(
            f"/api/v1/jobs/{created.json()['id']}",
            headers=headers,
            json={
                "about_channel": "A cooking channel with a long archive and a growing audience.",
                "status": "published",
            },
        )
        assert published.status_code == 200, (
            f"a job completed by this very save was refused: {published.text}"
        )
        assert published.json()["status"] == "published"

    async def test_the_edit_that_empties_a_required_field_cannot_publish(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "pub-breaks")
        role_id = await active_test_role_id()

        draft = _publishable(role_id, title="Broken by the same save")
        draft["status"] = "draft"
        created = await client.post("/api/v1/jobs", headers=headers, json=draft)
        assert created.status_code in (200, 201), created.text

        broken = await client.patch(
            f"/api/v1/jobs/{created.json()['id']}",
            headers=headers,
            json={"responsibilities": [], "status": "published"},
        )
        # Judged on the stored row this passes, and a job goes live describing
        # no work at all.
        assert broken.status_code == 422, (
            f"published a job whose responsibilities this save removed: {broken.text}"
        )

        # Read through the recruiter's own list rather than the public route: a
        # draft is deliberately 404 to everyone, including its author, and using
        # that route here would have asserted on an error body.
        reopened = await _my_job(client, headers, created.json()["id"])
        assert reopened["status"] == "draft", "a refused publish changed the status anyway"

    async def test_a_draft_may_empty_a_field_publication_would_require(
        self, client: AsyncClient
    ) -> None:
        headers, _owner = await _auth(client, "clr-draft-req")
        role_id = await active_test_role_id()

        draft = _publishable(role_id, title="Emptied while still a draft")
        draft["status"] = "draft"
        created = await client.post("/api/v1/jobs", headers=headers, json=draft)
        assert created.status_code in (200, 201), created.text

        # Half-finished is the normal state of a draft. Refusing to store an
        # empty list here would mean a recruiter cannot delete a wrong imported
        # requirement without inventing a replacement on the spot.
        emptied = await client.patch(
            f"/api/v1/jobs/{created.json()['id']}",
            headers=headers,
            json={"requirements": []},
        )
        assert emptied.status_code == 200, emptied.text

        reopened = await _my_job(client, headers, created.json()["id"])
        assert reopened["requirements"] in ([], None), (
            f"the removed requirement came back as {reopened['requirements']!r}"
        )
