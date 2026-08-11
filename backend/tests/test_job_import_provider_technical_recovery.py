from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.core.job_import_intelligence_matrix import intelligence_matrix
from app.integrations.openai.job_import_adapter import (
    OpenAIJobImportAdapter,
    OpenAIJobImportConfig,
)
from app.integrations.openai.job_import_output import OpenAIJobImportExtractionResponse
from app.schemas.job_import import (
    JobImportExtractionRequest,
    JobImportExtractionResponse,
    JobImportProviderMetadata,
)
from app.services.job_import_conversation_service import JobImportConversationService
from app.services.job_import_processing_service import JobImportProcessingService
from app.services.job_import_provider import JobImportProviderError
from app.services.job_import_service import JobImportError


def _field_definition(field_path: str) -> dict[str, object]:
    return {
        "field_path": field_path,
        "native_field": field_path,
        "value_schema": {"type": "string"},
        "confirmation_policy": "extract_when_explicit",
        "nested_confirmation_policies": {},
        "allowed_provenance": ["directly_supplied", "extracted_from_source"],
        "evidence_required_for_extraction": True,
        "requires_recruiter_review": False,
        "missing_requirement": "publication_blocker",
        "review_section": "basics",
        "custom_values_allowed": False,
        "inference_risk": "low",
        "allowed_decision_origins": ["explicit"],
        "auto_fill_confidence": "high",
        "suggestion_confidence": None,
    }


def _request() -> JobImportExtractionRequest:
    return JobImportExtractionRequest.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "source": {
                "source_type": "pasted_text",
                "original_text": "Video Editor",
            },
            "allowed_taxonomies": {},
            "field_definitions": [
                _field_definition("title"),
                _field_definition("work_mode"),
            ],
            "inference_restrictions": [],
            "output_validation_instructions": [],
        }
    )


def _request_with_server_owned_routes() -> JobImportExtractionRequest:
    payload = _request().model_dump(mode="json")
    payload["field_definitions"].extend(
        [
            _field_definition("application_mode"),
            _field_definition("external_apply_url"),
        ]
    )
    return JobImportExtractionRequest.model_validate(payload)


def _wire_response(*, include_title: bool, include_work_mode_verdict: bool) -> object:
    return OpenAIJobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": (
                [
                    {
                        "field_path": "title",
                        "value_json": '"Video Editor"',
                        "provenance": "extracted_from_source",
                        "evidence_span_ids": ["E0001"],
                        "explanation": None,
                        "provider_confidence": None,
                        "epistemic_status": "explicit",
                    }
                ]
                if include_title
                else []
            ),
            "conflicts": [],
            "missing_fields": (
                [
                    {
                        "field_path": "work_mode",
                        "explanation": None,
                        "epistemic_status": "absent",
                    }
                ]
                if include_work_mode_verdict
                else []
            ),
            "warnings": [],
        }
    )


def _wire_response_with_coverage(
    *,
    work_mode_coverage: str,
) -> OpenAIJobImportExtractionResponse:
    payload = _wire_response(
        include_title=True,
        include_work_mode_verdict=False,
    ).model_dump(mode="json", exclude={"coverage"})
    payload["coverage"] = {
        field_path: (
            "field"
            if field_path == "title"
            else work_mode_coverage
            if field_path == "work_mode"
            else "missing"
        )
        for field_path, row in intelligence_matrix().items()
        if row.provider_visible
    }
    return OpenAIJobImportExtractionResponse.model_validate(payload)


class _FakeResponses:
    def __init__(self, parsed: object) -> None:
        self.parsed = parsed

    async def parse(self, **_kwargs: object) -> object:
        return SimpleNamespace(
            status="completed",
            output=[],
            output_parsed=self.parsed,
            model="gpt-test",
            _request_id="req_coverage",
            usage=SimpleNamespace(
                model_dump=lambda **_kwargs: {
                    "input_tokens": 10,
                    "output_tokens": 5,
                    "total_tokens": 15,
                }
            ),
        )


def _adapter(parsed: object) -> OpenAIJobImportAdapter:
    return OpenAIJobImportAdapter(
        OpenAIJobImportConfig(
            api_key="test-placeholder-not-a-real-key",
            model="gpt-test",
            request_timeout_seconds=5,
            max_retries=0,
            instruction_version="job-import-text-v5",
        ),
        client=SimpleNamespace(responses=_FakeResponses(parsed)),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("include_title", "omitted_count", "omitted_paths"),
    [
        (True, 1, ["work_mode"]),
        (False, 2, ["title", "work_mode"]),
    ],
)
async def test_partial_or_empty_success_is_a_technical_provider_failure(
    include_title: bool,
    omitted_count: int,
    omitted_paths: list[str],
) -> None:
    parsed = _wire_response(
        include_title=include_title,
        include_work_mode_verdict=False,
    )

    with pytest.raises(JobImportProviderError) as caught:
        await _adapter(parsed).extract(_request())

    error = caught.value
    assert error.code == "OPENAI_INCOMPLETE_EXTRACTION"
    assert error.retryable is True
    assert error.metadata is not None
    assert error.metadata.metadata["processing_stage"] == "provider_output_coverage"
    assert error.metadata.metadata["failure_subreason"] == "provider_visible_fields_omitted"
    assert error.metadata.metadata["omitted_field_count"] == omitted_count
    assert error.metadata.metadata["omitted_field_paths"] == omitted_paths


@pytest.mark.asyncio
async def test_unreadable_expected_value_is_a_technical_provider_failure() -> None:
    parsed = OpenAIJobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "title",
                    "value_json": "not-json",
                    "provenance": "extracted_from_source",
                    "evidence_span_ids": ["E0001"],
                    "explanation": None,
                    "provider_confidence": None,
                    "epistemic_status": "explicit",
                }
            ],
            "missing_fields": [
                {"field_path": "work_mode", "epistemic_status": "absent"}
            ],
        }
    )

    with pytest.raises(JobImportProviderError) as caught:
        await _adapter(parsed).extract(_request())

    assert caught.value.code == "OPENAI_INCOMPLETE_EXTRACTION"
    assert caught.value.retryable is True
    assert caught.value.metadata is not None
    assert caught.value.metadata.metadata["omitted_field_paths"] == ["title"]


@pytest.mark.asyncio
async def test_explicit_missing_verdict_satisfies_provider_coverage() -> None:
    parsed = _wire_response(
        include_title=True,
        include_work_mode_verdict=True,
    )

    result = await _adapter(parsed).extract(_request())

    assert [field.field_path for field in result.extraction.fields] == ["title"]
    assert [field.field_path for field in result.extraction.missing_fields] == ["work_mode"]


@pytest.mark.asyncio
async def test_machine_coverage_materializes_an_explicit_missing_verdict() -> None:
    parsed = _wire_response_with_coverage(work_mode_coverage="missing")

    result = await _adapter(parsed).extract(_request())

    assert [field.field_path for field in result.extraction.fields] == ["title"]
    assert [field.field_path for field in result.extraction.missing_fields] == ["work_mode"]
    assert result.metadata.metadata["coverage_materialized_missing_count"] == 1


@pytest.mark.asyncio
async def test_machine_coverage_cannot_claim_a_field_without_returning_it() -> None:
    parsed = _wire_response_with_coverage(work_mode_coverage="field")

    with pytest.raises(JobImportProviderError) as caught:
        await _adapter(parsed).extract(_request())

    assert caught.value.code == "OPENAI_INCOMPLETE_EXTRACTION"
    assert caught.value.metadata is not None
    assert caught.value.metadata.metadata["omitted_field_paths"] == ["work_mode"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("collection_name", "server_owned_path"),
    [
        ("fields", "application_mode"),
        ("fields", "status"),
        ("conflicts", "external_apply_url"),
        ("missing_fields", "application_mode"),
        ("warnings", "external_apply_url"),
    ],
)
async def test_server_owned_paths_are_rejected_at_the_provider_adapter_boundary(
    collection_name: str,
    server_owned_path: str,
) -> None:
    payload = _wire_response(
        include_title=True,
        include_work_mode_verdict=True,
    ).model_dump(mode="json")
    if collection_name == "fields":
        payload[collection_name].append(
            {
                "field_path": server_owned_path,
                "value_json": '"internal"',
                "provenance": "extracted_from_source",
                "evidence_span_ids": ["E0001"],
                "explanation": None,
                "provider_confidence": None,
                "epistemic_status": "explicit",
                "inference_type": None,
            }
        )
    elif collection_name == "conflicts":
        payload[collection_name].append(
            {
                "field_path": server_owned_path,
                "values": [
                    {"value_json": '"https://one.invalid"', "evidence_span_ids": ["E0001"]},
                    {"value_json": '"https://two.invalid"', "evidence_span_ids": ["E0001"]},
                ],
                "explanation": "Two destinations were stated.",
                "provider_confidence": None,
                "epistemic_status": "conflicting",
            }
        )
    elif collection_name == "missing_fields":
        payload[collection_name].append(
            {
                "field_path": server_owned_path,
                "explanation": None,
                "epistemic_status": "absent",
            }
        )
    else:
        payload[collection_name].append(
            {
                "code": "provider.route",
                "message": "A route was present.",
                "field_path": server_owned_path,
                "evidence_span_ids": ["E0001"],
            }
        )

    with pytest.raises(JobImportProviderError) as caught:
        await _adapter(payload).extract(_request_with_server_owned_routes())

    assert caught.value.code == "OPENAI_SCHEMA_MISMATCH"
    assert caught.value.metadata.metadata["processing_stage"] == (
        "provider_output_path_validation"
    )
    assert caught.value.metadata.metadata["failure_subreason"] == (
        "provider_field_path_not_allowed"
    )
    assert caught.value.metadata.metadata["unexpected_field_paths"] == [
        server_owned_path
    ]


def test_completeness_excludes_routes_deliberately_hidden_from_the_provider() -> None:
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "title",
                    "value": "Video Editor",
                    "provenance": "directly_supplied",
                    "evidence": [{"snippet": "Video Editor"}],
                }
            ],
            "missing_fields": [{"field_path": "work_mode"}],
        }
    )

    assert (
        OpenAIJobImportAdapter._missing_provider_visible_field_paths(
            _request_with_server_owned_routes(),
            response,
        )
        == []
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error_code",
    [
        "OPENAI_INCOMPLETE_EXTRACTION",
        "OPENAI_TIMEOUT",
        "OPENAI_RATE_LIMITED",
        "JOB_IMPORT_PROVIDER_FAILED",
    ],
)
async def test_technical_failure_never_degrades_to_structured_partial_success(
    error_code: str,
) -> None:
    service = JobImportProcessingService(SimpleNamespace(), SimpleNamespace())
    service._mark_failed_if_current = AsyncMock()  # type: ignore[method-assign]

    with pytest.raises(JobImportError) as caught:
        await service._fail_or_fall_back(
            uuid4(),
            owner_user_id=uuid4(),
            processing_attempt_id=uuid4(),
            error_code=error_code,
            message="The job details were only partially read. Please retry.",
            metadata=JobImportProviderMetadata(
                provider_name="openai",
                metadata={"omitted_field_count": 2},
            ),
        )

    assert caught.value.code == error_code
    service._mark_failed_if_current.assert_awaited_once()


@pytest.mark.asyncio
async def test_failed_processing_cannot_begin_or_answer_a_conversation() -> None:
    draft = SimpleNamespace(processing_status="processing_failed")
    import_service = SimpleNamespace(
        get_draft=AsyncMock(return_value=draft),
    )
    service = JobImportConversationService(import_service)

    with pytest.raises(JobImportError) as begin_error:
        await service.begin(uuid4(), owner_user_id=uuid4())
    with pytest.raises(JobImportError) as answer_error:
        await service.answer_active_question(
            uuid4(),
            "title",
            "Video Editor",
            owner_user_id=uuid4(),
        )

    assert begin_error.value.code == "JOB_IMPORT_INVALID_TRANSITION"
    assert begin_error.value.status_code == 409
    assert answer_error.value.code == "JOB_IMPORT_INVALID_TRANSITION"
    assert answer_error.value.status_code == 409
    assert vars(draft) == {"processing_status": "processing_failed"}
