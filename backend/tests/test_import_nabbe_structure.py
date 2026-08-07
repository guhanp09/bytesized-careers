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
from app.services.job_url_fetcher import normalize_public_job_html

URL = "https://example.invalid/jobs/paid-content-creator-social-media-manager"

#: Markup that is silent about pay and wrong about engagement.
JSON_LD = """
{"@context":"https://schema.org","@type":"JobPosting",
 "title":"(Paid) Content Creator & Social Media Manager",
 "hiringOrganization":{"@type":"Organization","name":"Larkfield Studio"},
 "employmentType":"INTERN",
 "jobLocationType":"TELECOMMUTE",
 "applicantLocationRequirements":{"@type":"Country","name":"IN"}}
"""

BODY = """
<h1>(Paid) Content Creator &amp; Social Media Manager</h1>
<p>Larkfield Studio</p>
<dl>
  <dt>Compensation</dt><dd>₹5,000 / mo</dd>
  <dt>Type</dt><dd>Part-time / Freelance</dd>
  <dt>Location</dt><dd>Remote-friendly</dd>
  <dt>Deadline</dt><dd>Rolling — apply early</dd>
</dl>
<h2>About the role</h2>
<p>Own our social presence across Instagram, X and YouTube Shorts.</p>
<h2>Responsibilities</h2>
<ul>
  <li>Concept, shoot and edit 4–6 Reels per month.</li>
  <li>Design static feed and carousel posts.</li>
  <li>Write captions and short-form copy in English and Hinglish.</li>
  <li>Run community management and reply to comments.</li>
  <li>Plan drop campaigns and reshare UGC.</li>
  <li>Maintain hashtag and SEO strategy.</li>
  <li>Send a weekly performance report.</li>
</ul>
<h2>Requirements</h2>
<p>Basic video editing in CapCut or InShot. Flexible hours, creative ownership.</p>
<h2>How to apply</h2>
<p>Send your Instagram handle or examples of social work, two caption examples,
and a one-line answer to: which Indian pop-culture moment would you turn into a
Reel? Email everything to hiring@larkfield.invalid.</p>
"""


def _page() -> tuple[str, dict]:
    html = (
        f"<html><head><title>Content Creator</title>"
        f'<script type="application/ld+json">{JSON_LD}</script></head>'
        f"<body>{BODY}</body></html>"
    )
    text, _title, metadata = normalize_public_job_html(html, final_url=URL)
    return text, metadata


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
        # A remote role carries no city, so the preview cannot print it twice.
        assert "location" not in structured
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
