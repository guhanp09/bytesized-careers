from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.api.deps import get_job_import_provider
from app.core.job_import_application_signals import explicit_application_requirements
from app.core.job_import_screening_safety import safe_imported_screening_questions
from app.main import app
from app.schemas.job_import import (
    JobImportEvidence,
    JobImportExtractionRequest,
    JobImportExtractionResponse,
    JobImportProviderMetadata,
)
from app.services.job_import_provider import JobImportProviderResult
from app.services.job_import_service import JobImportService
from tests.conftest import valid_published_job_payload

SOURCE_TEXT = """Video Editor
Interested candidates can submit resume and cover letter to jobs@example.com or apply through Indeed.
Why does this editing role interest you?
"""


def _walk(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for key, item in value.items() for text in (_walk(key) + _walk(item))]
    if isinstance(value, list):
        return [text for item in value for text in _walk(item)]
    return []


def _evidence(snippet: str) -> dict[str, object]:
    start = SOURCE_TEXT.index(snippet)
    return {
        "snippet": snippet,
        "location": {"char_start": start, "char_end": start + len(snippet)},
    }


class _Provider:
    def __init__(self) -> None:
        self.calls = 0

    async def extract(
        self, _request: JobImportExtractionRequest
    ) -> JobImportProviderResult:
        self.calls += 1
        extraction = JobImportExtractionResponse.model_validate(
            {
                "extraction_schema_version": 1,
                "target_listing_schema_version": 3,
                "fields": [
                    {
                        "field_path": "title",
                        "value": "Video Editor",
                        "provenance": "extracted_from_source",
                        "evidence": [_evidence("Video Editor")],
                    },
                    {
                        "field_path": "screening_questions",
                        "value": [
                            {
                                "prompt": (
                                    "Email your resume and cover letter to "
                                    "jobs@example.com or apply through Indeed."
                                ),
                                "required": False,
                            },
                            {
                                "prompt": "Why does this editing role interest you?",
                                "required": False,
                                "response_guidance": (
                                    "Keep it under 200 words, then email it to "
                                    "jobs@example.com."
                                ),
                            },
                        ],
                        "provenance": "extracted_from_source",
                        "evidence": [
                            _evidence(
                                "Interested candidates can submit resume and cover letter "
                                "to jobs@example.com or apply through Indeed."
                            ),
                            _evidence("Why does this editing role interest you?"),
                        ],
                    },
                ],
                "conflicts": [],
                "missing_fields": [],
                "warnings": [],
            }
        )
        return JobImportProviderResult(
            extraction=extraction,
            metadata=JobImportProviderMetadata(
                provider_name="fake",
                model_name="fake-luna",
                model_version="test",
                instruction_version="test",
            ),
        )


async def _auth(client: AsyncClient, label: str) -> tuple[dict[str, str], UUID]:
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": f"{label}@example.com",
            "provider_account_id": f"google-{label}",
            "access_token": f"token-{label}",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, UUID(body["user"]["id"])


def test_explicit_application_fallback_is_bounded_to_transmission_requests() -> None:
    result = explicit_application_requirements(
        "\n".join(
            [
                "Candidates should have 1 to 2 years of experience.",
                "Do not submit a portfolio.",
                (
                    "Interested candidates can submit resume and cover letter "
                    "to hiring@studio.test or apply through AcmeBoard."
                ),
            ]
        )
    )

    assert result.keys == ["resume", "cover_letter"]
    assert result.evidence_snippets == [
        (
            "Interested candidates can submit resume and cover letter "
            "to hiring@studio.test or apply through AcmeBoard."
        )
    ]


@pytest.mark.parametrize(
    "source",
    [
        "You are not required to submit a resume.",
        "It is not necessary to submit a resume or cover letter.",
        "You may submit a resume.",
        "You can submit a resume.",
        "Feel free to attach a cover letter.",
        "Optionally, include a cover letter.",
        "If desired, upload your resume.",
        "Submit a resume if available.",
        "If available, submit your resume.",
        "Submit your resume if you have one.",
        "Resume optional: attach if you wish.",
        "Where possible, include a cover letter.",
        "Candidates are encouraged to submit a resume.",
        "We encourage you to submit a resume.",
    ],
)
def test_optional_or_negated_materials_never_become_required_controls(
    source: str,
) -> None:
    result = explicit_application_requirements(source)

    assert result.keys == []
    assert result.evidence_snippets == []


def test_exact_source_materials_complete_a_partial_provider_list() -> None:
    source = type(
        "Source",
        (),
        {
            "original_text": SOURCE_TEXT,
            "retrieval_metadata": {},
        },
    )()
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "application_requirements",
                    "value": ["resume"],
                    "provenance": "extracted_from_source",
                    "evidence": [_evidence("resume")],
                }
            ],
        }
    )

    augmented = JobImportService._with_deterministic_context(response, source)
    materials = next(
        field
        for field in augmented.fields
        if field.field_path == "application_requirements"
    )

    assert materials.value == ["resume", "cover_letter"]
    assert materials.epistemic_status == "normalized_explicit"
    assert materials.inference_type == "application_material_classification"
    assert all(evidence.snippet in SOURCE_TEXT for evidence in materials.evidence)


def test_screening_boundary_reclassifies_routes_without_flattening_real_questions() -> None:
    result = safe_imported_screening_questions(
        [
            {
                "prompt": "Email your resume to jobs@example.com or apply through Indeed.",
                "required": False,
            },
            {
                "prompt": "Why are you right for this role?",
                "required": True,
                "response_guidance": (
                    "Keep it under 200 words, then email it to jobs@example.com."
                ),
            },
            {
                "prompt": "How do you optimize content on Instagram?",
                "required": False,
            },
            {
                "prompt": "Outline the first three edits you would make.",
                "required": False,
            },
            {"prompt": "What is your email address?", "required": True},
            {"prompt": "What is your phone number?", "required": True},
            {
                "prompt": "Where should we contact you on WhatsApp?",
                "required": True,
            },
        ]
    )

    assert result.requirement_keys == ["resume"]
    assert result.questions == [
        {
            "prompt": "Why are you right for this role?",
            "required": True,
            "response_guidance": "Keep it under 200 words.",
        },
        {
            "prompt": "How do you optimize content on Instagram?",
            "required": False,
        },
        {
            "prompt": "Outline the first three edits you would make.",
            "required": False,
        },
    ]
    assert "jobs@example.com" not in " ".join(_walk(result.questions))
    assert "Indeed" not in " ".join(_walk(result.questions))


def test_screening_requiredness_is_bound_to_each_questions_own_evidence() -> None:
    value = [
        {"prompt": "Why this role?", "required": True},
        {"prompt": "What is another thought?", "required": True},
    ]
    evidence = [
        JobImportEvidence(snippet="You must answer: Why this role?"),
        JobImportEvidence(snippet="Optional: What is another thought?"),
    ]

    normalized = JobImportService._provider_screening_questions(value, evidence)

    assert normalized == [
        {"prompt": "Why this role?", "required": True},
        {"prompt": "What is another thought?", "required": False},
    ]


@pytest.mark.parametrize(
    "prompt",
    [
        "What is your email address?",
        "What is your phone number?",
        "Where should we contact you on WhatsApp?",
        "Please provide your social media handle.",
    ],
)
def test_contact_collection_never_becomes_a_screening_question(prompt: str) -> None:
    result = safe_imported_screening_questions(
        [{"prompt": prompt, "required": True}]
    )

    assert result.questions == []


@pytest.mark.parametrize(
    "instruction",
    [
        "Use the QR code to apply.",
        "DM @hiring_team on IG.",
        "Reach out to the hiring manager directly.",
        "Call the recruiter to apply.",
        "Apply in person.",
        "Contact John for details.",
        "Scan the code and apply.",
        "Follow the instructions on our website.",
        "Reply to the original post.",
        "Leave a comment to apply.",
        "Connect with us on LinkedIn.",
        "Text the hiring manager.",
        "Complete the Typeform.",
        "Fill out our application form.",
        "Walk in for an interview.",
        "Reach HR for details.",
        "Write to careers at acme dot com.",
        "Click Apply Now.",
        "Use the application link.",
    ],
)
def test_open_grammar_application_routes_never_reach_the_native_payload(
    instruction: str,
) -> None:
    result = JobImportService._safe_application_payload(
        {"how_to_apply": instruction}
    )

    assert result == {"application_mode": "internal"}


def test_bare_domain_is_removed_but_the_requested_material_survives() -> None:
    result = JobImportService._safe_application_payload(
        {"how_to_apply": "Send a 30-second intro at jobs.example.com"}
    )

    assert result["application_mode"] == "internal"
    assert result["how_to_apply"] == (
        "Please include a 30-second intro with your CreatorJobs application."
    )


@pytest.mark.parametrize(
    "instruction",
    [
        "Email careers(at)example(dot)com.",
        "DM hiring dot team on Instagram.",
        "Submit through forms dot gle slash abc.",
        "Send resume to jobs [at] example [dot] com.",
    ],
)
def test_obfuscated_destinations_never_reach_the_native_payload(
    instruction: str,
) -> None:
    result = JobImportService._safe_application_payload(
        {"how_to_apply": instruction}
    )

    assert result["application_mode"] == "internal"
    public_text = str(result).casefold()
    assert "(at)" not in public_text
    assert "[at]" not in public_text
    assert " dot " not in public_text
    assert "forms" not in public_text
    assert "hiring" not in public_text


@pytest.mark.parametrize(
    "question",
    [
        "How do you use Node.js for automation?",
        "Describe your experience with Three.js.",
        "How do you review work in Frame.io?",
    ],
)
def test_dotted_product_names_survive_screening_sanitization(question: str) -> None:
    result = safe_imported_screening_questions(
        [{"prompt": question, "required": False}]
    )

    assert result.questions == [{"prompt": question, "required": False}]


@pytest.mark.parametrize(
    "instruction",
    [
        "Share two Node.js automation samples.",
        "Share two Three.js animation samples.",
        "Share two Frame.io review examples.",
    ],
)
def test_dotted_product_names_survive_material_sanitization(
    instruction: str,
) -> None:
    result = JobImportService._safe_application_payload(
        {"how_to_apply": instruction}
    )

    assert instruction.split()[2] in str(result)


@pytest.mark.parametrize(
    "instruction",
    [
        "Complete a 30-second editing exercise.",
        "Fill in a content calendar sample.",
    ],
)
def test_legitimate_work_sample_verbs_survive_the_fail_closed_boundary(
    instruction: str,
) -> None:
    result = JobImportService._safe_application_payload(
        {"how_to_apply": instruction}
    )

    assert result["application_mode"] == "internal"
    assert "how_to_apply" in result


def test_direct_message_route_is_removed_but_reel_requirement_survives() -> None:
    result = JobImportService._safe_application_payload(
        {"how_to_apply": "Send your reel in a direct message."}
    )

    assert result["application_mode"] == "internal"
    assert result["application_requirements"] == ["relevant_portfolio"]
    assert "direct message" not in str(result).casefold()


@pytest.mark.parametrize(
    ("prompt", "expected"),
    [
        ("Explain your approach in our Slack workspace.", "Explain your approach."),
        ("Put your answer in our Google Form.", None),
        ("DM @hiring on Discord.", None),
        ("Complete the Typeform.", None),
        ("Fill out our application form.", None),
        ("Walk in for an interview.", None),
        ("Reach HR for details.", None),
        ("Write to careers at acme dot com.", None),
        ("Click Apply Now.", None),
        ("Use the application link.", None),
        ("Send your reel in a direct message.", None),
    ],
)
def test_screening_routes_are_removed_even_inside_channels(
    prompt: str,
    expected: str | None,
) -> None:
    result = safe_imported_screening_questions(
        [{"prompt": prompt, "required": True}]
    )

    assert [row["prompt"] for row in result.questions] == (
        [expected] if expected is not None else []
    )


@pytest.mark.parametrize(
    ("instruction", "forbidden_key"),
    [
        ("Provide portfolio management support to creators.", "relevant_portfolio"),
        ("Include cover letter animations in the edit.", "cover_letter"),
        ("Apply your prior experience to create social videos.", "relevant_experience"),
    ],
)
def test_responsibility_vocabulary_never_becomes_an_application_control(
    instruction: str,
    forbidden_key: str,
) -> None:
    result = JobImportService._safe_application_payload(
        {"how_to_apply": instruction}
    )

    assert forbidden_key not in (result.get("application_requirements") or [])


@pytest.mark.asyncio
async def test_provider_route_cannot_reach_native_job_or_candidate_inbox(
    client: AsyncClient,
) -> None:
    owner_headers, _owner_id = await _auth(client, "application-boundary-owner")
    provider = _Provider()
    app.dependency_overrides[get_job_import_provider] = lambda: provider
    try:
        source_response = await client.post(
            "/api/v1/job-imports/sources",
            headers=owner_headers,
            json={
                "source_type": "pasted_text",
                "source_title": "application-boundary",
                "original_text": SOURCE_TEXT,
                "idempotency_key": "source-application-boundary",
            },
        )
        assert source_response.status_code == 201, source_response.text
        source = source_response.json()
        draft_response = await client.post(
            f"/api/v1/job-imports/sources/{source['id']}/drafts",
            headers=owner_headers,
            json={"idempotency_key": "draft-application-boundary"},
        )
        assert draft_response.status_code == 201, draft_response.text
        draft = draft_response.json()

        processed = await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process",
            headers=owner_headers,
            json={},
        )
        assert processed.status_code == 200, processed.text
        assert provider.calls == 1
        fields = {row["field_path"]: row for row in processed.json()["draft"]["fields"]}
        assert fields["application_requirements"]["effective_value"] == [
            "resume",
            "cover_letter",
        ]
        assert fields["application_requirements"]["epistemic_state"] == (
            "normalized_explicit"
        )

        converted = await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/apply",
            headers=owner_headers,
            json={"mode": "create_new"},
        )
        assert converted.status_code == 200, converted.text
        native = converted.json()["job"]
        assert native["application_mode"] == "internal"
        assert native["external_apply_url"] is None
        assert native["application_requirements"] == ["resume", "cover_letter"]
        assert native["screening_questions"] == [
            {
                "prompt": "Why does this editing role interest you?",
                "required": False,
                "response_guidance": "Keep it under 200 words.",
            }
        ]
        native_text = " ".join(_walk(native))
        assert "jobs@example.com" not in native_text
        assert "Indeed" not in native_text

        publication = await client.patch(
            f"/api/v1/jobs/{native['id']}",
            headers=owner_headers,
            json=await valid_published_job_payload(status="published"),
        )
        assert publication.status_code == 200, publication.text

        applicant_headers, _applicant_id = await _auth(
            client, "application-boundary-applicant"
        )
        application = await client.post(
            f"/api/v1/jobs/{native['id']}/applications",
            headers=applicant_headers,
            json={
                "cover_note": "I would like to apply.",
                "portfolio_item_ids": [],
                "first_message_answers": {
                    "resume": "https://example.invalid/resume",
                    "cover_letter": "A concise cover letter.",
                },
            },
        )
        assert application.status_code == 201, application.text
        conversation = await client.get(
            f"/api/v1/me/applications/{application.json()['id']}/conversation",
            headers=applicant_headers,
        )
        assert conversation.status_code == 200, conversation.text
        candidate_text = " ".join(_walk(conversation.json()))
        assert "Why does this editing role interest you?" in candidate_text
        assert "jobs@example.com" not in candidate_text
        assert "Indeed" not in candidate_text
    finally:
        app.dependency_overrides.pop(get_job_import_provider, None)
