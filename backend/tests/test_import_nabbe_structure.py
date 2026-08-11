"""The structural shape of a listing whose markup contradicts its own copy.

Sanitised from a real import that went wrong in four ways at once: no pay, an
engagement of "internship" for a paid freelance brief, an empty Work section on
a page full of work, and a money question about a page that stated its rate.

None of it was a reasoning failure. The page's syndicated JSON-LD carried no
compensation and declared ``employmentType: INTERN``, while the employer's own
copy said ``Compensation ₹5,000 / mo`` and ``Type Part-time / Freelance``.

The employer names here are invented. What is preserved is the structure that
caused the failure — markup that is silent about one fact and wrong about
another, with both stated plainly in the visible copy.
"""

from __future__ import annotations

import pytest

from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_native_values import convert_to_native
from app.core.job_import_structured_fields import fields_from_structured_context
from app.core.job_page_evidence import classify_job_page
from app.db.seed_data_job_import_labelled import (
    labelled_pay_page,
)


def _page() -> tuple[str, dict]:
    """The same page the browser fixture serves.

    Defined in the seed module rather than here so the deterministic E2E path
    and these tests cannot drift into asserting against different pages — the
    failure this fixture reproduces was reported against what a recruiter saw.
    """

    return labelled_pay_page()


class TestThePageIsReadAsOneJob:
    def test_it_classifies_as_a_single_job(self) -> None:
        text, metadata = _page()
        evidence = classify_job_page(
            text, declared_job_titles=metadata.get("json_ld_job_titles") or []
        )

        assert evidence.classification == "single_job"
        assert evidence.may_extract


class TestLabelledCopyBeatsTheMarkup:
    """The whole point of the fixture."""

    def test_compensation_comes_from_the_label_markup_omitted(self) -> None:
        text, metadata = _page()
        structured = fields_from_structured_context(
            metadata.get("structured_context") or {}
        )
        # Markup said nothing about pay.
        assert "budget_amount" not in structured

        facts = labelled_facts(text)
        assert facts.budget_amount == 5000
        assert facts.budget_currency == "INR"
        assert facts.budget_unit == "per month"
        # One figure is a rate, not a range. No invented ceiling.
        assert facts.compensation_mode == "fixed"

    def test_engagement_comes_from_the_label_markup_got_wrong(self) -> None:
        text, metadata = _page()
        structured = fields_from_structured_context(
            metadata.get("structured_context") or {}
        )
        # The markup really does claim an internship.
        assert structured["engagement_type"] == "internship"

        # The employer's own copy says otherwise, and wins.
        assert labelled_facts(text).engagement_type == "ongoing_freelance"

    def test_a_paid_freelance_brief_is_never_an_internship(self) -> None:
        text, _metadata = _page()
        assert labelled_facts(text).engagement_type != "internship"


class TestTheRestOfThePageSurvives:
    def test_the_work_is_actually_on_the_page(self) -> None:
        text, _metadata = _page()

        # A page this rich must never produce "No work details added yet".
        for work in ("Reels", "carousel", "captions", "community", "UGC", "report"):
            assert work.lower() in text.lower(), work

    def test_platforms_and_tools_survive_normalisation(self) -> None:
        text, _metadata = _page()

        for named in ("Instagram", "YouTube Shorts", "CapCut", "InShot"):
            assert named in text, named

    def test_remote_is_not_turned_into_a_city(self) -> None:
        text, metadata = _page()
        structured = fields_from_structured_context(
            metadata.get("structured_context") or {}
        )

        assert structured["work_mode"] == "remote"
        # Applicant-location requirements are not an office city.  The native
        # remote control uses this field as the candidate geography, so a
        # country restriction remains useful without turning “Remote” into a
        # place name.
        assert structured["location"] == "India"
        assert convert_to_native("location", "Remote-friendly").native_value is None


class TestApplicationInstructionsAreSeparated:
    def test_the_email_destination_is_removed_but_materials_stay(self) -> None:
        from app.core.job_apply_note import compose_public_apply_note

        instruction = (
            "Send your Instagram handle or examples of social work, two caption "
            "examples, and a one-line answer to: which Indian pop-culture moment "
            "would you turn into a Reel? Email everything to hiring@larkfield.invalid."
        )
        note = compose_public_apply_note(source_text=instruction)

        assert note is not None
        assert "@" not in note
        assert "larkfield.invalid" not in note
        # The requested materials survive.
        assert "Instagram" in note or "social work" in note

    def test_the_evaluative_prompt_is_screening_not_a_material(self) -> None:
        from app.core.job_application_classification import (
            classify_application_instructions,
        )

        result = classify_application_instructions(
            "Send your Instagram handle. Which Indian pop-culture moment would "
            "you turn into a Reel?"
        )

        assert any(
            "pop-culture" in prompt for prompt in result.screening_questions
        ), result.screening_questions

    @pytest.mark.parametrize("wording", ["Rolling — apply early", "Rolling basis"])
    def test_a_rolling_deadline_never_becomes_a_date(self, wording: str) -> None:
        from app.core.job_apply_note import compose_public_apply_note

        note = compose_public_apply_note(source_text=f"Deadline {wording}.")

        # Nothing may invent a specific closing date from "rolling".
        assert note is None or not any(
            month in note
            for month in ("January", "February", "August", "December")
        )


class TestNativeValuesAreValid:
    @pytest.mark.parametrize(
        ("field_path", "value"),
        [
            ("budget_amount", 5000),
            ("budget_currency", "INR"),
            ("budget_unit", "per month"),
            ("compensation_mode", "fixed"),
            ("engagement_type", "ongoing_freelance"),
            ("work_mode", "remote"),
        ],
    )
    def test_every_derived_value_reaches_the_draft(
        self, field_path: str, value: object
    ) -> None:
        conversion = convert_to_native(field_path, value)

        assert conversion.writable, f"{field_path} would be refused by the editor"
        assert conversion.outcome == "exact"


class TestTheWholePipelineOnThisPage:
    """The same page, driven end to end through the deterministic fixture.

    The units above prove each reader in isolation. This proves the draft a
    recruiter would actually receive, which is where the defect was reported and
    where a precedence mistake between correct readers still shows up.
    """

    @staticmethod
    async def _draft(client, label: str) -> dict:
        from tests.test_job_import_fixtures import _auth, _fixture

        headers = await _auth(client, label)
        response = await _fixture(client, headers, "labelled-pay-conflict")
        assert response.status_code in (200, 201), response.text
        body = response.json()
        return body.get("draft") or body

    @staticmethod
    def _value(draft: dict, field_path: str):
        for field in draft["fields"]:
            if field["field_path"] == field_path:
                return field["effective_value"]
        return None

    @pytest.mark.asyncio
    async def test_the_rate_the_employer_printed_reaches_the_draft(self, client) -> None:
        draft = await self._draft(client, "nabbe-e2e-pay")

        assert self._value(draft, "budget_amount") == "5000"
        assert self._value(draft, "budget_currency") == "INR"
        assert self._value(draft, "budget_unit") == "per month"
        # One figure is a rate, not a range. Nothing invents a ceiling.
        assert self._value(draft, "compensation_mode") == "fixed"
        assert self._value(draft, "budget_max") is None

    @pytest.mark.asyncio
    async def test_a_paid_freelance_brief_is_not_an_internship(self, client) -> None:
        """The P1 this fixture caught once it was driven end to end.

        Every reader was already correct. The extraction faithfully read the
        page's syndicated ``employmentType: INTERN``, and a row the extraction
        fills is marked ``confirmed`` — which the precedence rule treated as
        settled, so the labelled row saying "Part-time / Freelance" never
        applied. Machine agreement with the wrong source is not a settled fact,
        and only a recruiter outranks what the employer printed.
        """

        draft = await self._draft(client, "nabbe-e2e-engagement")

        assert self._value(draft, "engagement_type") == "ongoing_freelance"

    @pytest.mark.asyncio
    async def test_the_page_answers_its_own_questions(self, client) -> None:
        from tests.test_job_import_fixtures import _auth

        headers = await _auth(client, "nabbe-e2e-questions")
        draft = await self._draft(client, "nabbe-e2e-questions2")
        conversation = await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}/conversation",
            headers=headers,
        )
        # A different owner cannot read it; the point here is only that the
        # draft itself settled without an open question about stated facts.
        assert conversation.status_code in (200, 403, 404)
        assert draft["processing_status"] == "ready_to_apply"

    @pytest.mark.asyncio
    async def test_the_work_section_is_not_empty_on_a_page_full_of_work(
        self, client
    ) -> None:
        draft = await self._draft(client, "nabbe-e2e-work")
        responsibilities = self._value(draft, "responsibilities")

        assert isinstance(responsibilities, list)
        assert len(responsibilities) >= 5

    @pytest.mark.asyncio
    async def test_remote_friendly_never_becomes_a_city(self, client) -> None:
        draft = await self._draft(client, "nabbe-e2e-location")
        location = self._value(draft, "location")

        assert location is None or "remote-friendly" not in str(location).casefold()


class TestOnlyARecruiterOutranksTheEmployersOwnWords:
    """The belt-and-braces guard, which a mutation showed was untested.

    A labelled fact outranks contradicted markup, and the check that stops it
    outranking a *recruiter* survived being deleted: the merge runs before the
    prefill merge, so the recruiter's answer is reapplied afterwards either way.
    That ordering is the real defence and it is pinned structurally elsewhere —
    but a guard nothing tests is a guard nothing notices losing, and the
    ordering is one refactor away from changing.
    """

    @pytest.mark.asyncio
    async def test_a_recruiter_answer_is_not_overwritten_by_a_labelled_row(
        self, client
    ) -> None:
        from tests.test_job_import_fixtures import _auth, _fixture

        headers = await _auth(client, "nabbe-recruiter-precedence")
        response = await _fixture(client, headers, "labelled-pay-conflict")
        draft = response.json().get("draft") or response.json()

        # The page's own labelled row says freelance. The recruiter says it is
        # an internship, which is their job to know and not ours to correct.
        saved = await client.patch(
            f"/api/v1/job-imports/drafts/{draft['id']}/fields/engagement_type",
            headers=headers,
            json={"action": "edit", "edited_value": "internship"},
        )
        assert saved.status_code in (200, 201), saved.text

        reread = await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}", headers=headers
        )
        engagement = next(
            field
            for field in reread.json()["fields"]
            if field["field_path"] == "engagement_type"
        )

        assert engagement["effective_value"] == "internship"

    def test_the_guard_names_recruiter_authority_rather_than_review_status(self) -> None:
        # Review status is set to "confirmed" by the extraction too, which is
        # exactly why using it here let machine agreement with the wrong source
        # look like a settled decision.
        from pathlib import Path

        source = Path("app/services/job_import_service.py").read_text()
        guard = source[source.index("recruiter_owned = existing.get(") :][:400]

        assert "authority_state" in guard
        assert "confirmed_by_recruiter" in guard
        assert "edited_by_recruiter" in guard
