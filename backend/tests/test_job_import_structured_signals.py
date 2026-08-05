"""A URL import must not ask for what the page already states.

Public job pages publish a schema.org ``JobPosting`` block. Reading it is the
difference between an assistant and a scraper: every fact in there is one the
recruiter should never be asked to retype.
"""

from __future__ import annotations

import json as _json

import pytest

from app.core.job_import_structured_fields import fields_from_structured_context
from app.services.job_url_fetcher import normalize_public_job_html


def test_a_fully_described_page_answers_the_expensive_questions() -> None:
    """The shine-shaped case that prompted this: nothing left worth asking."""

    fields = fields_from_structured_context(
        {
            "job_title": "Video Editor",
            "employment_type": "FULL_TIME",
            "role_location": "Chennai, Tamil Nadu, India",
            "compensation": "INR 25000-35000 per MONTH",
            "experience_requirement": "2–4 years of experience",
            "about_summary": (
                "A school-led education studio creating clear learning videos."
            ),
        }
    )

    # Money is four questions on its own; the page stated all of it.
    assert fields["compensation_mode"] == "range"
    assert fields["budget_amount"] == 25000
    assert fields["budget_max"] == 35000
    assert fields["budget_currency"] == "INR"
    assert fields["budget_unit"] == "per month"
    # And the rest of the expensive ones.
    assert fields["engagement_type"] == "full_time"
    assert fields["work_mode"] == "onsite"
    assert fields["location"] == "Chennai, Tamil Nadu, India"
    assert fields["experience_level"] == "2–4 years"
    assert fields["title"] == "Video Editor"
    assert "about_channel" in fields


def test_a_page_that_declines_to_state_pay_has_still_answered() -> None:
    """"Not disclosed" is a decision, not a gap.

    Treating it as missing produced four money questions about a page that had
    already said it would not name a figure.
    """

    assert fields_from_structured_context({"compensation": "Not disclosed"}) == {
        "compensation_mode": "negotiable"
    }
    for wording in ("Salary not specified", "As per industry standards", "Negotiable"):
        assert (
            fields_from_structured_context({"compensation": wording})["compensation_mode"]
            == "negotiable"
        )


@pytest.mark.parametrize(
    ("employment", "expected"),
    [
        ("FULL_TIME", "full_time"),
        ("PART_TIME", "part_time"),
        ("INTERN", "internship"),
        ("CONTRACTOR", "ongoing_freelance"),
        ("TEMPORARY", "fixed_term"),
        ("FULL_TIME, PART_TIME", "full_time"),
    ],
)
def test_employment_type_is_read_not_guessed(employment: str, expected: str) -> None:
    assert (
        fields_from_structured_context({"employment_type": employment})["engagement_type"]
        == expected
    )


def test_remote_and_hybrid_beat_a_listed_office_address() -> None:
    """A remote job that lists a head office is still remote."""

    remote = fields_from_structured_context(
        {"location_type": "TELECOMMUTE", "role_location": "Bengaluru, India"}
    )
    assert remote["work_mode"] == "remote"
    # A remote role must not carry a city as its work location.
    assert "location" not in remote

    hybrid = fields_from_structured_context({"role_location": "Hybrid - Pune, India"})
    assert hybrid["work_mode"] == "hybrid"


def test_nothing_is_invented_from_an_empty_or_vague_page() -> None:
    """Silence stays silence — the conversation exists for exactly this."""

    assert fields_from_structured_context({}) == {}
    assert fields_from_structured_context({"job_title": "  "}) == {}
    # Too short to satisfy the editor's own minimum, so not worth pre-filling.
    assert "about_channel" not in fields_from_structured_context({"about_summary": "Hi"})
    # A currency the product does not offer is left alone rather than coerced.
    assert "budget_currency" not in fields_from_structured_context(
        {"compensation": "JPY 400000 per MONTH"}
    )


def test_a_year_is_not_mistaken_for_pay() -> None:
    assert "budget_amount" not in fields_from_structured_context(
        {"compensation": "Posted 2026"}
    )


@pytest.mark.parametrize(
    ("requirement", "expected"),
    [
        ("2–4 years of experience", "2–4 years"),
        ("At least 30 months of experience", "2–4 years"),
        ("At least 6 months of experience", "0–2 years"),
    ],
)
def test_experience_lands_in_a_band_the_editor_can_parse(
    requirement: str, expected: str
) -> None:
    """A band the editor cannot parse renders as nothing, which is worse than asking."""

    fields = fields_from_structured_context({"experience_requirement": requirement})
    assert fields["experience_level"] == expected
    import re

    assert re.match(r"^\d+–\d+ years$", fields["experience_level"])


@pytest.mark.anyio
async def test_a_structured_page_removes_the_questions_end_to_end(
    client, monkeypatch
) -> None:
    """The user-visible promise: read the page, then stop asking about it.

    Same extraction result both times. The only difference is whether the page
    published structured job data — and that difference must show up as fewer
    questions, not merely as private metadata.
    """

    from uuid import UUID

    from conftest import TestSessionLocal
    from test_job_import_checkpoint import _auth

    from app.db.seed_data_job_import import processed_review_fixture
    from app.repositories.job_import_repository import JobImportRepository
    from app.repositories.job_repository import JobRepository
    from app.services.job_import_service import JobImportService
    from app.services.job_service import JobService

    async def _questions(label: str, structured: dict[str, object] | None) -> list[str]:
        headers, owner_id = await _auth(client, label)
        source = await client.post(
            "/api/v1/job-imports/sources",
            headers=headers,
            json={
                "source_type": "pasted_text",
                "source_title": label,
                "original_text": "A public job page for the structured-signal check.",
                "idempotency_key": f"{label}-source-key",
            },
        )
        assert source.status_code == 201, source.text
        source_id = source.json()["id"]

        if structured is not None:
            async with TestSessionLocal() as session:
                repository = JobImportRepository(session)
                stored = await repository.get_source_for_owner(
                    UUID(source_id), owner_id
                )
                assert stored is not None
                await repository.update_source(
                    stored, {"retrieval_metadata": {"structured_context": structured}}
                )
                await session.commit()

        draft = await client.post(
            f"/api/v1/job-imports/sources/{source_id}/drafts",
            headers=headers,
            json={
                "extraction_schema_version": 1,
                "target_listing_schema_version": 3,
                "idempotency_key": f"{label}-draft-key",
            },
        )
        assert draft.status_code == 201, draft.text
        draft_id = draft.json()["id"]

        async with TestSessionLocal() as session:
            service = JobImportService(
                JobImportRepository(session), JobService(JobRepository(session))
            )
            await service.record_extraction_result(
                UUID(draft_id),
                processed_review_fixture("shine-school-editor"),
                owner_user_id=owner_id,
            )

        begun = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
        )
        assert begun.status_code == 200, begun.text
        asked: list[str] = []
        question = begun.json().get("active_question")
        for _ in range(25):
            if question is None:
                break
            asked.append(question["field_path"])
            shape = question.get("answer") or {}
            if shape.get("choices"):
                value: object = shape["choices"][0]
                if shape.get("is_list"):
                    key = shape.get("item_key")
                    value = [{key: value}] if key else [value]
            elif shape.get("kind") == "number":
                value = 5
            elif shape.get("kind") == "date":
                value = "2027-01-15"
            else:
                value = "Supplied by the structured-signal regression check."
            answered = await client.post(
                f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
                headers=headers,
                json={"field_path": question["field_path"], "value": value},
            )
            if answered.status_code != 200:
                break
            question = answered.json().get("active_question")
        return asked

    bare = await _questions("structured-bare", None)
    rich = await _questions(
        "structured-rich",
        {
            "job_title": "Video Editor",
            "employment_type": "FULL_TIME",
            "role_location": "Chennai, Tamil Nadu, India",
            "compensation": "INR 25000-35000 per MONTH",
            "experience_requirement": "2–4 years of experience",
            "about_summary": "A school-led education studio creating learning videos.",
        },
    )

    assert len(rich) < len(bare), f"structured page asked as much: {rich} vs {bare}"
    # Every fact the page published outright must be gone from the questions.
    for settled in (
        "compensation_mode",
        "budget_amount",
        "budget_currency",
        "budget_unit",
        "about_channel",
    ):
        assert settled in bare, f"{settled} was expected to be asked without the page data"
        assert settled not in rich, f"{settled} was on the page and still asked"


# ---------------------------------------------------------------------------
# schema.org JobPosting parsing, end to end through the real HTML normaliser.
#
# The reader is only worth trusting if it survives the shapes real pages use:
# arrays, @graph wrappers, malformed blocks, unrelated structured data, and
# markup that would very much like to be executed.
# ---------------------------------------------------------------------------

_URL = "https://boards.example.com/jobs/1"


def _page(payload: object, *, body: str = "<p>Visible body text.</p>") -> str:
    return (
        "<html><head><title>Job</title>"
        f'<script type="application/ld+json">{_json.dumps(payload)}</script>'
        f"</head><body>{body}</body></html>"
    )


_JOB_POSTING = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    "title": "Video Editor",
    "description": "<p>Edit weekly learning videos.</p>",
    "employmentType": "FULL_TIME",
    "datePosted": "2026-07-01",
    "validThrough": "2026-09-01",
    "hiringOrganization": {
        "@type": "Organization",
        "name": "Vidyalaya Studios",
        "description": "A school-led education studio making clear learning videos.",
    },
    "jobLocation": {
        "@type": "Place",
        "address": {
            "@type": "PostalAddress",
            "addressLocality": "Chennai",
            "addressRegion": "Tamil Nadu",
            "addressCountry": "IN",
        },
    },
    "baseSalary": {
        "@type": "MonetaryAmount",
        "currency": "INR",
        "value": {
            "@type": "QuantitativeValue",
            "minValue": 25000,
            "maxValue": 35000,
            "unitText": "MONTH",
        },
    },
    "experienceRequirements": {
        "@type": "OccupationalExperienceRequirements",
        "monthsOfExperience": 30,
    },
}


def test_a_single_job_posting_block_is_read_completely() -> None:
    _text, _title, metadata = normalize_public_job_html(_page(_JOB_POSTING), final_url=_URL)
    assert metadata["json_ld_job_posting"] is True
    fields = fields_from_structured_context(metadata["structured_context"])
    assert fields["engagement_type"] == "full_time"
    assert fields["budget_currency"] == "INR"
    assert fields["budget_amount"] == 25000
    assert fields["budget_max"] == 35000
    assert fields["budget_unit"] == "per month"
    assert fields["work_mode"] == "onsite"
    assert "Chennai" in str(fields["location"])
    assert fields["experience_level"] == "2–4 years"


def test_a_job_posting_inside_an_array_is_found() -> None:
    payload = [{"@type": "WebSite", "name": "Board"}, _JOB_POSTING]
    _text, _title, metadata = normalize_public_job_html(_page(payload), final_url=_URL)
    assert metadata["json_ld_job_posting"] is True
    assert fields_from_structured_context(metadata["structured_context"])["engagement_type"]


def test_a_job_posting_inside_an_at_graph_is_found() -> None:
    payload = {"@context": "https://schema.org", "@graph": [_JOB_POSTING]}
    _text, _title, metadata = normalize_public_job_html(_page(payload), final_url=_URL)
    assert metadata["json_ld_job_posting"] is True
    assert fields_from_structured_context(metadata["structured_context"])["budget_currency"]


def test_malformed_structured_data_is_ignored_rather_than_fatal() -> None:
    """A broken block must cost the recruiter nothing."""

    html = (
        "<html><head>"
        '<script type="application/ld+json">{"@type": "JobPosting", oops</script>'
        "</head><body><p>Readable job text still here.</p></body></html>"
    )
    text, _title, metadata = normalize_public_job_html(html, final_url=_URL)
    assert metadata["json_ld_job_posting"] is False
    assert "Readable job text" in text
    assert fields_from_structured_context(metadata.get("structured_context") or {}) == {}


def test_unrelated_structured_data_produces_no_job_fields() -> None:
    payload = {"@context": "https://schema.org", "@type": "Recipe", "name": "Dosa"}
    _text, _title, metadata = normalize_public_job_html(_page(payload), final_url=_URL)
    assert metadata["json_ld_job_posting"] is False
    assert fields_from_structured_context(metadata.get("structured_context") or {}) == {}


def test_structured_markup_is_data_and_is_never_executed() -> None:
    """The block is parsed as data; nothing inside it may reach the page text."""

    hostile = dict(_JOB_POSTING)
    hostile["description"] = "<script>alert('x')</script><p>Edit videos.</p>"
    hostile["title"] = "<img src=x onerror=alert(1)>Video Editor"
    text, _title, metadata = normalize_public_job_html(_page(hostile), final_url=_URL)
    fields = fields_from_structured_context(metadata["structured_context"])
    assert "alert(" not in text
    assert "<script" not in _json.dumps(fields)
    assert "onerror" not in _json.dumps(fields)


def test_structured_values_stay_bounded() -> None:
    """A hostile page must not be able to inflate a draft field without limit."""

    huge = dict(_JOB_POSTING)
    huge["title"] = "V" * 5000
    huge["hiringOrganization"] = {"@type": "Organization", "description": "D" * 50000}
    _text, _title, metadata = normalize_public_job_html(_page(huge), final_url=_URL)
    fields = fields_from_structured_context(metadata["structured_context"])
    assert len(str(fields.get("title", ""))) <= 120
    assert len(str(fields.get("about_channel", ""))) <= 2000


def test_structured_data_never_overrides_a_recruiter_answer() -> None:
    """Precedence, stated as a test rather than assumed from call order.

    The enrichment merge only fills fields the machine left missing, and the
    recruiter-prefill merge runs after it. A page cannot overwrite a person.
    """

    import inspect

    from app.services.job_import_service import JobImportService

    source = inspect.getsource(JobImportService._merge_structured_page_signals)
    assert 'existing.get("provenance_state") != "missing"' in source
    ordering = inspect.getsource(JobImportService._record_extraction_result_claimed)
    assert ordering.index("_merge_structured_page_signals") < ordering.index(
        "_merge_recruiter_prefill"
    )


# ---------------------------------------------------------------------------
# Employer context: present in the page, or not claimed at all.
# ---------------------------------------------------------------------------


def test_a_clear_company_description_is_read_from_metadata() -> None:
    fields = fields_from_structured_context(
        {"about_summary": "A school-led education studio making calm learning videos."}
    )
    assert "school-led education studio" in fields["about_channel"]


def test_no_company_description_claims_nothing() -> None:
    assert "about_channel" not in fields_from_structured_context({})
    assert "about_channel" not in fields_from_structured_context({"about_summary": ""})


@pytest.mark.parametrize(
    "boilerplate",
    [
        "We are an equal opportunity employer and consider all qualified applicants.",
        "Powered by Greenhouse. Apply for this job. View all jobs.",
        "Read our privacy policy and terms of service before applying.",
    ],
)
def test_job_board_boilerplate_never_becomes_employer_context(boilerplate: str) -> None:
    """Pre-filling furniture is worse than asking: the recruiter must delete it."""

    fields = fields_from_structured_context({"about_summary": boilerplate})
    assert "about_channel" not in fields


def test_a_too_short_blurb_is_left_for_the_recruiter() -> None:
    assert "about_channel" not in fields_from_structured_context(
        {"about_summary": "We hire."}
    )


def test_an_oversized_description_is_bounded() -> None:
    fields = fields_from_structured_context({"about_summary": "A studio. " * 5000})
    assert len(fields["about_channel"]) <= 2000


def test_employer_context_from_a_full_page_survives_the_secure_fetch_path() -> None:
    """End to end through the real normaliser, not the parser in isolation."""

    payload = dict(_JOB_POSTING)
    payload["hiringOrganization"] = {
        "@type": "Organization",
        "name": "Vidyalaya Studios",
        "description": "A school-led studio producing calm, clear learning videos.",
    }
    _text, _title, metadata = normalize_public_job_html(
        _page(payload), final_url=_URL
    )
    fields = fields_from_structured_context(metadata["structured_context"])
    assert "learning videos" in fields["about_channel"]


# ---------------------------------------------------------------------------
# The whole secure path, not just the parser.
#
#   HTTP retrieval -> content checks -> normalization -> JSON-LD extraction
#   -> deterministic field merge -> question suppression
#
# Served locally so it proves the pipeline rather than the availability of some
# third-party website.
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_a_structured_page_suppresses_questions_through_the_whole_path(
    client,
) -> None:
    from uuid import UUID, uuid4

    from conftest import TestSessionLocal
    from test_job_import_checkpoint import _auth

    from app.db.seed_data_job_import import processed_review_fixture
    from app.repositories.job_import_repository import JobImportRepository
    from app.repositories.job_repository import JobRepository
    from app.services.job_import_service import JobImportService
    from app.services.job_service import JobService

    headers, owner_id = await _auth(client, "structured-e2e")

    # A real page body, normalised by the same code the fetcher uses.
    html = _page(_JOB_POSTING, body="<p>Edit weekly learning videos for students.</p>")
    normalized, title, metadata = normalize_public_job_html(html, final_url=_URL)
    assert metadata["json_ld_job_posting"] is True

    source = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": title or "Structured job page",
            "original_text": normalized,
            "idempotency_key": uuid4().hex,
        },
    )
    assert source.status_code == 201, source.text
    source_id = source.json()["id"]

    # Attach the retrieval metadata exactly as the URL path stores it.
    async with TestSessionLocal() as session:
        repository = JobImportRepository(session)
        stored = await repository.get_source_for_owner(UUID(source_id), owner_id)
        assert stored is not None
        await repository.update_source(stored, {"retrieval_metadata": metadata})
        await session.commit()

    draft = await client.post(
        f"/api/v1/job-imports/sources/{source_id}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": uuid4().hex,
        },
    )
    assert draft.status_code == 201, draft.text
    draft_id = draft.json()["id"]

    # A provider result that knows nothing, so anything present can only have
    # come from the page's own structured data.
    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            UUID(draft_id),
            processed_review_fixture("shine-school-editor"),
            owner_user_id=owner_id,
        )

    current = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    settled = {
        item["field_path"]
        for item in current["fields"]
        if item["provenance_state"] != "missing"
    }
    for field_path in ("engagement_type", "budget_currency", "budget_amount"):
        assert field_path in settled, f"{field_path} was on the page and not read"

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text

    asked: list[str] = []
    question = begun.json().get("active_question")
    for _ in range(25):
        if question is None:
            break
        asked.append(question["field_path"])
        shape = question.get("answer") or {}
        if shape.get("choices"):
            value: object = shape["choices"][0]
            if shape.get("is_list"):
                key = shape.get("item_key")
                value = [{key: value}] if key else [value]
        elif shape.get("kind") == "number":
            value = 5
        elif shape.get("kind") == "date":
            value = "2027-01-15"
        else:
            value = "Supplied by the structured end-to-end check."
        answered = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={"field_path": question["field_path"], "value": value},
        )
        if answered.status_code != 200:
            break
        question = answered.json().get("active_question")

    # The whole point: a page that states these is never asked about them.
    for field_path in ("engagement_type", "budget_currency", "budget_amount", "about_channel"):
        assert field_path not in asked, f"{field_path} was on the page and still asked"
