"""Adversarial coverage for publisher-owned structured job facts."""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID, uuid4

import pytest

from app.core.job_import_body_sections import experience_from_body
from app.core.job_import_compensation import read_pay
from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_structured_fields import fields_from_structured_context
from app.core.job_page_evidence import classify_job_page
from app.models import JobImportSource
from app.schemas.job_import import JobImportExtractionResponse
from app.services.job_import_service import JobImportService
from app.services.job_url_fetcher import normalize_public_job_html


def _html(posting: dict[str, object]) -> str:
    return (
        '<script type="application/ld+json">'
        f"{json.dumps(posting)}"
        "</script><main><h1>Creator job</h1><p>Responsibilities and qualifications "
        "for one specific opening are provided here.</p></main>"
    )


_LABELS = {
    "job_title": "Structured job title",
    "about_summary": "Structured employer summary",
    "responsibilities": "Structured responsibility",
    "qualifications": "Structured qualification",
    "preferred_qualifications": "Structured preferred qualification",
    "employment_type": "Structured employment type",
    "role_location": "Structured role location",
    "role_locations": "Structured role location",
    "remote_eligibility": "Structured remote eligibility",
    "remote_eligibility_areas": "Structured remote eligibility",
    "location_type": "Structured work location type",
    "compensation": "Structured compensation",
    "skills": "Structured skills",
    "experience_requirement": "Structured experience requirement",
    "experience_requirement_conflicts": "Structured conflicting experience requirement",
    "work_hours": "Structured work hours",
    "valid_through": "Structured application valid through",
    "job_start_date": "Structured job start date",
}


def _source(context: dict[str, object]) -> JobImportSource:
    lines: list[str] = []
    for key, value in context.items():
        label = _LABELS.get(key)
        if not label:
            continue
        if isinstance(value, str):
            lines.append(f"{label}: {value}")
        elif isinstance(value, list):
            lines.extend(f"{label}: {item}" for item in value if isinstance(item, str))
    return JobImportSource(
        owner_user_id=uuid4(),
        source_type="public_url",
        original_text="\n".join(lines),
        retrieval_metadata={"structured_context": context},
        content_fingerprint="a" * 64,
    )


def _empty_response(*missing: str) -> JobImportExtractionResponse:
    return JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "missing_fields": [{"field_path": path} for path in missing],
        }
    )


def test_standard_jobposting_properties_survive_html_safely_and_keep_preference() -> None:
    posting = {
        "@type": "JobPosting",
        "title": "Video Editor",
        "responsibilities": "<ul><li>Edit weekly videos.</li><li>Mix clean audio.</li></ul>",
        "qualifications": (
            "<p>Adobe Premiere required.</p>"
            "<p>Adobe After Effects preferred.</p>"
        ),
        "experienceRequirements": "1 to 2 years of experience",
    }

    normalized, _title, metadata = normalize_public_job_html(
        _html(posting), final_url="https://jobs.example/editor"
    )
    context = metadata["structured_context"]
    assert context["responsibilities"] == ["Edit weekly videos.", "Mix clean audio."]
    assert context["qualifications"] == ["Adobe Premiere required."]
    assert context["preferred_qualifications"] == ["Adobe After Effects preferred."]
    assert context["experience_requirement"] == "1–2 years of experience"
    assert "<li>" not in normalized
    assert "Structured preferred qualification: Adobe After Effects preferred." in normalized


def test_requirements_and_qualifications_heading_and_inline_clauses_do_not_contaminate() -> None:
    posting = {
        "@type": "JobPosting",
        "title": "Video Editor",
        "description": (
            "Requirements & Qualifications: Premiere required. "
            "Responsibilities: Edit short videos. Salary: USD 25 per HOUR"
        ),
    }
    _normalized, _title, metadata = normalize_public_job_html(
        _html(posting), final_url="https://jobs.example/editor"
    )
    context = metadata["structured_context"]
    assert context["qualifications"] == ["Premiere required."]
    assert context["responsibilities"] == ["Edit short videos."]
    assert all("Salary" not in item for item in context["responsibilities"])


@pytest.mark.parametrize(
    "bullet",
    [
        "Apply brand guidelines consistently.",
        "If you spot a continuity issue, correct it.",
        "Please note discrepancies in the edit log.",
        "We encourage experiments with pacing.",
    ],
)
def test_section_stop_logic_keeps_real_work_bullets(bullet: str) -> None:
    posting = {
        "@type": "JobPosting",
        "title": "Video Editor",
        "description": f"<h2>Responsibilities</h2><p>{bullet}</p><p>Export final cuts.</p>",
    }
    _normalized, _title, metadata = normalize_public_job_html(
        _html(posting), final_url="https://jobs.example/editor"
    )
    assert metadata["structured_context"]["responsibilities"] == [
        bullet,
        "Export final cuts.",
    ]


def test_two_explicit_prose_experience_claims_stay_unresolved() -> None:
    description = (
        "Candidates need 1–2 years of editing experience. "
        "Applicants also need 3–5 years of production experience."
    )
    assert experience_from_body(description) is None
    posting = {"@type": "JobPosting", "title": "Editor", "description": description}
    normalized, _title, metadata = normalize_public_job_html(
        _html(posting), final_url="https://jobs.example/editor"
    )
    context = metadata["structured_context"]
    assert "experience_requirement" not in context
    assert context["experience_requirement_conflicts"] == ["1–2 years", "3–5 years"]
    assert normalized.count("Structured conflicting experience requirement:") == 2


@pytest.mark.parametrize("amount", [25, 99, 25.5, "25.50"])
def test_small_and_decimal_structured_hourly_rates_survive(amount: object) -> None:
    posting = {
        "@type": "JobPosting",
        "title": "Video Editor",
        "baseSalary": {
            "currency": "USD",
            "value": {"value": amount, "unitText": "HOUR"},
        },
    }
    _normalized, _title, metadata = normalize_public_job_html(
        _html(posting), final_url="https://jobs.example/editor"
    )
    fields = fields_from_structured_context(metadata["structured_context"])
    assert fields["budget_amount"] == float(amount)
    assert fields["budget_currency"] == "USD"
    assert fields["budget_unit"] == "per hour"


def test_structured_one_sided_bounds_and_inverted_range_are_honest() -> None:
    minimum = fields_from_structured_context(
        {"compensation": "USD minimum 25 per HOUR"}
    )
    maximum = fields_from_structured_context(
        {"compensation": "USD maximum 99 per HOUR"}
    )
    inverted = fields_from_structured_context(
        {"compensation": "INR 50000-30000 per MONTH"}
    )
    assert minimum == {
        "budget_currency": "USD",
        "budget_unit": "per hour",
        "compensation_mode": "range",
        "budget_amount": 25,
    }
    assert maximum == {
        "budget_currency": "USD",
        "budget_unit": "per hour",
        "compensation_mode": "range",
        "budget_max": 99,
    }
    assert inverted == {
        "budget_currency": "INR",
        "budget_unit": "per month",
        "compensation_mode": "range",
    }


def test_inverted_structured_range_cannot_keep_provider_reordered_numbers() -> None:
    compensation = "INR 50000-30000 per MONTH"
    source = _source({"compensation": compensation})
    evidence = [{"snippet": f"Structured compensation: {compensation}"}]
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "budget_amount",
                    "value": 30000,
                    "provenance": "extracted_from_source",
                    "evidence": evidence,
                },
                {
                    "field_path": "budget_max",
                    "value": 50000,
                    "provenance": "extracted_from_source",
                    "evidence": evidence,
                },
            ],
        }
    )
    augmented = JobImportService._with_deterministic_context(response, source)
    fields = {item.field_path: item.value for item in augmented.fields}
    assert "budget_amount" not in fields
    assert "budget_max" not in fields
    assert fields["compensation_mode"] == "range"
    assert any(
        item.code == "structured_compensation_range_inverted"
        for item in augmented.warnings
    )


@pytest.mark.parametrize("currency", ["CAD", "AUD"])
def test_supported_structured_currencies_survive(currency: str) -> None:
    fields = fields_from_structured_context(
        {"compensation": f"{currency} 25 per HOUR"}
    )
    assert fields["budget_currency"] == currency
    assert fields["budget_amount"] == 25


def test_plain_and_labelled_decimal_rates_are_never_rounded() -> None:
    assert read_pay("$25.50 per hour").minimum == 25.5  # type: ignore[union-attr]
    assert read_pay("$0.50 per hour").minimum == 0.5  # type: ignore[union-attr]
    facts = labelled_facts("Salary: $25.50 per hour")
    assert facts.budget_amount == 25.5


@pytest.mark.parametrize(
    "text",
    [
        "Salary history: USD 25 per hour",
        "Budget experience: USD 25 per hour",
        "Pay transparency: USD 25 per hour",
        "TypeScript: Full-time framework experience",
        "TypeScript internship project",
        "Engagement metrics: Full-time",
        "Employment type preference: Contractor",
    ],
)
def test_label_prefixes_are_not_authoritative_rows(text: str) -> None:
    facts = labelled_facts(text)
    assert facts.engagement_type is None
    assert facts.budget_amount is None


def test_labelled_token_semantics_and_duplicate_conflicts() -> None:
    assert labelled_facts("Job Type: Contractor").engagement_type == "ongoing_freelance"
    assert labelled_facts("Job Type: International").engagement_type is None
    conflicting = labelled_facts(
        "Job Type: Full-time\nEmployment Type: Contractor\n"
        "Salary: USD 25 per hour\nCompensation: USD 30 per hour"
    )
    assert set(conflicting.conflicts or {}) >= {"engagement_type", "budget_amount"}
    assert conflicting.engagement_type is None
    assert conflicting.budget_amount is None


@pytest.mark.parametrize(
    "employment",
    [
        "FULL_TIME, CONTRACTOR",
        "INTERN, CONTRACTOR",
        "PART_TIME, CONTRACTOR",
    ],
)
def test_structured_employment_disagreement_becomes_a_real_conflict(employment: str) -> None:
    response = JobImportService._with_deterministic_context(
        _empty_response("engagement_type"),
        _source({"employment_type": employment}),
    )
    conflict = next(item for item in response.conflicts if item.field_path == "engagement_type")
    assert len(conflict.values) == 2
    assert all(item.field_path != "engagement_type" for item in response.fields)
    assert all(item.field_path != "engagement_type" for item in response.missing_fields)


def test_contractor_alone_maps_consistently() -> None:
    fields = fields_from_structured_context({"employment_type": "CONTRACTOR"})
    assert fields["engagement_type"] == "ongoing_freelance"
    assert labelled_facts("Employment Type: Contractor").engagement_type == (
        "ongoing_freelance"
    )


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("IN", "India"), ("GB", "United Kingdom"), ("CA", "Canada"), ("AU", "Australia")],
)
def test_remote_country_codes_are_normalized(raw: str, expected: str) -> None:
    fields = fields_from_structured_context(
        {
            "location_type": "TELECOMMUTE",
            "remote_eligibility": raw,
            "remote_eligibility_areas": [raw],
        }
    )
    assert fields["location"] == expected


def test_remote_restrictions_and_office_location_do_not_invert_work_mode() -> None:
    for description, expected in (
        ("This is a fully remote role worldwide.", None),
        ("WFH India.", "India"),
    ):
        posting = {
            "@type": "JobPosting",
            "title": "Video Editor",
            "description": description,
            "jobLocation": {
                "address": {
                    "addressLocality": "Chennai",
                    "addressRegion": "Tamil Nadu",
                    "addressCountry": "IN",
                }
            },
        }
        _normalized, _title, metadata = normalize_public_job_html(
            _html(posting), final_url="https://jobs.example/editor"
        )
        fields = fields_from_structured_context(metadata["structured_context"])
        assert fields["work_mode"] == "remote"
        assert fields.get("location") == expected


def test_typed_remote_administrative_areas_are_preserved() -> None:
    posting = {
        "@type": "JobPosting",
        "title": "Video Editor",
        "jobLocationType": "TELECOMMUTE",
        "applicantLocationRequirements": [
            {"@type": "Country", "name": "India"},
            {"@type": "AdministrativeArea", "name": "Tamil Nadu"},
        ],
    }
    _normalized, _title, metadata = normalize_public_job_html(
        _html(posting), final_url="https://jobs.example/editor"
    )
    fields = fields_from_structured_context(metadata["structured_context"])
    assert fields["location"] == "India | Tamil Nadu"


def test_multiple_structured_job_locations_surface_a_choice() -> None:
    posting = {
        "@type": "JobPosting",
        "title": "Video Editor",
        "jobLocation": [
            {"address": {"addressLocality": "Chennai", "addressCountry": "IN"}},
            {"address": {"addressLocality": "Mumbai", "addressCountry": "IN"}},
        ],
    }
    normalized, _title, metadata = normalize_public_job_html(
        _html(posting), final_url="https://jobs.example/editor"
    )
    context = metadata["structured_context"]
    assert context["role_locations"] == ["Chennai, IN", "Mumbai, IN"]
    assert "location" not in fields_from_structured_context(context)
    response = JobImportService._with_deterministic_context(
        _empty_response("location"),
        JobImportSource(
            owner_user_id=uuid4(),
            source_type="public_url",
            original_text=normalized,
            retrieval_metadata={"structured_context": context},
            content_fingerprint="b" * 64,
        ),
    )
    conflict = next(item for item in response.conflicts if item.field_path == "location")
    assert {item.value for item in conflict.values} == {"Chennai", "Mumbai"}


def test_work_hours_deadline_and_start_date_map_only_when_valid() -> None:
    fields = fields_from_structured_context(
        {
            "work_hours": "35.5-40 hours per week",
            "valid_through": "2035-12-31",
            "job_start_date": "2035-10-15",
        }
    )
    assert fields["expected_weekly_hours_min"] == 35.5
    assert fields["expected_weekly_hours_max"] == 40
    assert fields["deadline_at"].startswith("2035-12-31T23:59:59")
    assert fields["start_timing"] == "specific_date"
    assert fields["start_date"] == "2035-10-15"
    assert fields_from_structured_context(
        {"work_hours": "about 40 hours", "valid_through": "2020-01-01"}
    ) == {}


def test_partial_provider_lists_merge_remaining_exact_items_and_catalog_tools() -> None:
    context = {
        "responsibilities": ["Edit weekly videos.", "Mix clean audio."],
        "qualifications": ["Premiere required.", "Meet weekly deadlines."],
        "skills": "Adobe Premiere, After Effects, Unknown Suite",
    }
    source = _source(context)
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "responsibilities",
                    "value": ["Edit weekly videos."],
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Structured responsibility: Edit weekly videos."}],
                },
                {
                    "field_path": "requirements",
                    "value": ["Premiere required."],
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Structured qualification: Premiere required."}],
                },
            ],
            "missing_fields": [{"field_path": "required_tool_keys"}],
        }
    )
    augmented = JobImportService._with_deterministic_context(response, source)
    fields = {item.field_path: item for item in augmented.fields}
    assert fields["responsibilities"].value == context["responsibilities"]
    assert fields["requirements"].value == context["qualifications"]
    assert fields["required_tool_keys"].value == ["premiere-pro", "after-effects"]
    assert all(item.field_path != "other_required_tools" for item in augmented.fields)


def test_boilerplate_about_summary_cannot_bypass_the_central_guard() -> None:
    context = {
        "about_summary": (
            "We are an equal opportunity employer and consider all qualified applicants."
        )
    }
    augmented = JobImportService._with_deterministic_context(
        _empty_response("about_channel"), _source(context)
    )
    assert all(item.field_path != "about_channel" for item in augmented.fields)


def test_same_title_distinct_postings_are_not_collapsed() -> None:
    postings = [
        {
            "@type": "JobPosting",
            "title": "Video Editor",
            "hiringOrganization": {"name": "Studio A"},
            "jobLocation": {"address": {"addressLocality": "Chennai"}},
        },
        {
            "@type": "JobPosting",
            "title": "Video Editor",
            "hiringOrganization": {"name": "Studio B"},
            "jobLocation": {"address": {"addressLocality": "Mumbai"}},
        },
    ]
    normalized, _title, metadata = normalize_public_job_html(
        _html({"@context": "https://schema.org", "@graph": postings}),
        final_url="https://jobs.example/search",
    )
    assert metadata["json_ld_job_titles"] == ["Video Editor"]
    assert len(metadata["json_ld_job_identities"]) == 2
    verdict = classify_job_page(
        normalized,
        declared_job_titles=metadata["json_ld_job_titles"],
        declared_job_identities=metadata["json_ld_job_identities"],
    )
    assert verdict.classification == "multi_job_or_index"
    assert verdict.declared_jobs == 2


def test_safe_native_payload_preserves_future_deadline_without_duplicate_prose() -> None:
    payload = JobImportService._safe_application_payload(
        {
            "deadline_at": "2035-12-31T23:59:59Z",
            "how_to_apply": "Submit a portfolio.",
        }
    )
    assert isinstance(payload["deadline_at"], datetime)
    assert payload["deadline_at"].tzinfo is not None
    assert "deadline" not in str(payload.get("how_to_apply", "")).casefold()


@pytest.mark.anyio
@pytest.mark.parametrize(
    "employment",
    ["FULL_TIME, CONTRACTOR", "INTERN, CONTRACTOR", "PART_TIME, CONTRACTOR"],
)
async def test_structured_employment_conflict_is_stored_pending(
    client,
    employment: str,
) -> None:
    from conftest import TestSessionLocal
    from test_job_import_checkpoint import _auth

    from app.repositories.job_import_repository import JobImportRepository
    from app.repositories.job_repository import JobRepository
    from app.services.job_service import JobService

    headers, owner_id = await _auth(client, f"employment-conflict-{employment[:4]}")
    original_text = f"Structured employment type: {employment}"
    source_response = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": "Video Editor",
            "original_text": original_text,
            "idempotency_key": uuid4().hex,
        },
    )
    source_id = UUID(source_response.json()["id"])
    async with TestSessionLocal() as session:
        repository = JobImportRepository(session)
        stored = await repository.get_source_for_owner(source_id, owner_id)
        assert stored is not None
        await repository.update_source(
            stored,
            {"retrieval_metadata": {"structured_context": {"employment_type": employment}}},
        )
        await session.commit()

    draft_response = await client.post(
        f"/api/v1/job-imports/sources/{source_id}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": uuid4().hex,
        },
    )
    draft_id = UUID(draft_response.json()["id"])
    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            draft_id,
            _empty_response("engagement_type"),
            owner_user_id=owner_id,
        )

    draft = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    engagement = next(
        item for item in draft["fields"] if item["field_path"] == "engagement_type"
    )
    assert engagement["provenance_state"] == "conflicting_source_values"
    assert engagement["review_status"] == "pending"
    assert engagement["requires_confirmation"] is True
    assert len(engagement["conflicting_values"]) == 2


@pytest.mark.anyio
async def test_inverted_labelled_compensation_is_stored_for_review(client) -> None:
    from conftest import TestSessionLocal
    from test_job_import_checkpoint import _auth

    from app.repositories.job_import_repository import JobImportRepository
    from app.repositories.job_repository import JobRepository
    from app.services.job_service import JobService

    headers, owner_id = await _auth(client, "inverted-labelled-compensation")
    source_response = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": "Video Editor",
            "original_text": "Salary: INR 50000-30000 per month",
            "idempotency_key": uuid4().hex,
        },
    )
    source_id = UUID(source_response.json()["id"])
    draft_response = await client.post(
        f"/api/v1/job-imports/sources/{source_id}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": uuid4().hex,
        },
    )
    draft_id = UUID(draft_response.json()["id"])
    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            draft_id,
            _empty_response(
                "budget_amount",
                "budget_max",
                "budget_currency",
                "budget_unit",
                "compensation_mode",
            ),
            owner_user_id=owner_id,
        )

    draft = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    by_path = {item["field_path"]: item for item in draft["fields"]}
    for field_path in ("budget_amount", "budget_max", "compensation_mode"):
        field = by_path[field_path]
        assert field["review_status"] == "pending"
        assert field["confirmed_value"] is None
        assert field["requires_confirmation"] is True
        assert field["needs_review"] is True
        assert field["rationale_code"] == "inverted_labelled_compensation_range"
        assert any("lower bound above its upper bound" in error for error in field["validation_errors"])

    assert by_path["budget_currency"]["effective_value"] == "INR"
    assert by_path["budget_unit"]["effective_value"] == "per month"
