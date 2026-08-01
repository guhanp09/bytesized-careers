from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import get_type_hints
from uuid import UUID, uuid4

import httpx
import openai
import pytest
from conftest import TestSessionLocal
from httpx import AsyncClient
from openai.lib._pydantic import to_strict_json_schema
from pydantic import ValidationError
from sqlalchemy import select

from app.api.deps import get_job_import_provider
from app.integrations.openai.job_import_adapter import (
    OPENAI_MAX_OUTPUT_TOKENS,
    OpenAIJobImportAdapter,
    OpenAIJobImportConfig,
)
from app.integrations.openai.job_import_output import (
    OpenAIJobImportExtractionResponse,
)
from app.integrations.openai.job_import_spans import (
    EVIDENCE_SEGMENTATION_VERSION,
    build_evidence_span_set,
)
from app.main import app
from app.models import Job, JobImportDraft, JobImportField
from app.repositories.job_import_repository import JobImportRepository
from app.repositories.job_repository import JobRepository
from app.schemas.job_import import (
    MAX_EXTRACTION_RESPONSE_BYTES,
    JobImportExtractionRequest,
    JobImportExtractionResponse,
    JobImportProviderMetadata,
)
from app.services.job_import_processing_service import JobImportProcessingService
from app.services.job_import_provider import (
    JobImportProviderError,
    JobImportProviderResult,
)
from app.services.job_import_service import JobImportError, JobImportService
from app.services.job_service import JobService

SOURCE_TEXT = "Need a video editor for weekly YouTube videos."
TITLE_TEXT = "video editor"


def _request(source_text: str = SOURCE_TEXT) -> JobImportExtractionRequest:
    return JobImportExtractionRequest.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "source": {
                "source_type": "pasted_text",
                "original_text": source_text,
            },
            "allowed_taxonomies": {"platforms": ["youtube"]},
            "field_definitions": [],
            "inference_restrictions": ["Do not invent values."],
            "output_validation_instructions": ["Return structured data only."],
        }
    )


def _extraction(
    *,
    source_text: str = SOURCE_TEXT,
    field_path: str = "title",
    value: object = TITLE_TEXT,
    evidence_snippet: str = TITLE_TEXT,
) -> JobImportExtractionResponse:
    start = source_text.index(evidence_snippet)
    return JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": field_path,
                    "value": value,
                    "provenance": "extracted_from_source",
                    "evidence": [
                        {
                            "snippet": evidence_snippet,
                            "location": {
                                "char_start": start,
                                "char_end": start + len(evidence_snippet),
                            },
                        }
                    ],
                }
            ],
            "conflicts": [],
            "missing_fields": [],
            "warnings": [],
        }
    )


def _provider_result(
    extraction: JobImportExtractionResponse | None = None,
) -> JobImportProviderResult:
    return JobImportProviderResult(
        extraction=extraction or _extraction(),
        metadata=JobImportProviderMetadata(
            provider_name="openai",
            model_name="gpt-5.6-luna",
            model_version="gpt-5.6-luna-2026-07-01",
            instruction_version="job-import-text-v1",
            metadata={
                "request_id": "req_test",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 20,
                    "total_tokens": 120,
                },
                "retry_count": 0,
                "attempt_number": 1,
                "elapsed_ms": 12,
                "provider_http_status": 200,
            },
        ),
    )


class FakeProvider:
    def __init__(
        self,
        outcomes: list[JobImportProviderResult | JobImportProviderError] | None = None,
        *,
        started: asyncio.Event | None = None,
        release: asyncio.Event | None = None,
    ) -> None:
        self.outcomes = list(outcomes or [_provider_result()])
        self.started = started
        self.release = release
        self.calls = 0
        self.requests: list[JobImportExtractionRequest] = []

    async def extract(
        self,
        request: JobImportExtractionRequest,
    ) -> JobImportProviderResult:
        self.calls += 1
        self.requests.append(request)
        if self.started is not None:
            self.started.set()
        if self.release is not None:
            await self.release.wait()
        outcome = self.outcomes[min(self.calls - 1, len(self.outcomes) - 1)]
        if isinstance(outcome, JobImportProviderError):
            raise outcome
        return outcome


class ExplodingProvider:
    async def extract(
        self,
        _request: JobImportExtractionRequest,
    ) -> JobImportProviderResult:
        raise RuntimeError(f"unexpected failure containing {SOURCE_TEXT}")


class FakeResponses:
    def __init__(self, outcomes: list[object]) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[dict[str, object]] = []

    async def parse(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeOpenAIClient:
    def __init__(self, outcomes: list[object]) -> None:
        self.responses = FakeResponses(outcomes)


class FakeRawResponse:
    def __init__(self, payload: object | None = None, *, raw_text: str | None = None) -> None:
        self.text = raw_text if raw_text is not None else json.dumps(payload)
        self.request_id = "req_raw_openai_test"
        self.status_code = 200


class FakeRawResponses:
    def __init__(self, outcomes: list[FakeRawResponse]) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[dict[str, object]] = []

    async def parse(self, **kwargs: object) -> FakeRawResponse:
        self.calls.append(kwargs)
        return self.outcomes.pop(0)


class FakeRawOpenAIClient:
    def __init__(self, outcomes: list[FakeRawResponse]) -> None:
        raw_responses = FakeRawResponses(outcomes)
        self.responses = SimpleNamespace(with_raw_response=raw_responses)


def _openai_response(
    *,
    parsed: object | None = None,
    status: str = "completed",
    output: list[object] | None = None,
) -> object:
    return SimpleNamespace(
        status=status,
        output=output or [],
        output_parsed=parsed,
        model="gpt-5.6-luna-2026-07-01",
        _request_id="req_openai_test",
        usage=SimpleNamespace(
            model_dump=lambda **_kwargs: {
                "input_tokens": 101,
                "output_tokens": 21,
                "total_tokens": 122,
                "input_tokens_details": {"cached_tokens": 0},
            }
        ),
    )


def _wire_extraction(
    extraction: JobImportExtractionResponse | None = None,
    *,
    source_text: str = SOURCE_TEXT,
) -> OpenAIJobImportExtractionResponse:
    payload = (extraction or _extraction()).model_dump(mode="json")
    span_set = build_evidence_span_set(source_text)

    def span_ids_for(evidence_group: list[dict[str, object]]) -> list[str]:
        span_ids: list[str] = []
        for evidence in evidence_group:
            location = evidence.get("location")
            if not isinstance(location, dict):
                continue
            start = location.get("char_start")
            end = location.get("char_end")
            if not isinstance(start, int) or not isinstance(end, int):
                continue
            span = next(
                (
                    candidate
                    for candidate in span_set.spans
                    if candidate.char_start <= start and candidate.char_end >= end
                ),
                None,
            )
            if span is None:
                raise AssertionError("test evidence is not covered by a server span")
            if span.span_id not in span_ids:
                span_ids.append(span.span_id)
        return span_ids

    for field in payload["fields"]:
        field["value_json"] = json.dumps(
            field.pop("value"), ensure_ascii=False, separators=(",", ":")
        )
        confidence = field.get("provider_confidence")
        if confidence is not None:
            confidence.pop("metadata", None)
        field["evidence_span_ids"] = span_ids_for(field.pop("evidence"))
    for conflict in payload["conflicts"]:
        confidence = conflict.get("provider_confidence")
        if confidence is not None:
            confidence.pop("metadata", None)
        for alternative in conflict["values"]:
            alternative["value_json"] = json.dumps(
                alternative.pop("value"), ensure_ascii=False, separators=(",", ":")
            )
            alternative["evidence_span_ids"] = span_ids_for(alternative.pop("evidence"))
    for missing in payload["missing_fields"]:
        missing.pop("evidence")
    for warning in payload["warnings"]:
        warning["evidence_span_ids"] = span_ids_for(warning.pop("evidence"))
    return OpenAIJobImportExtractionResponse.model_validate(payload)


def _adapter(
    outcomes: list[object],
    *,
    max_retries: int = 2,
    sleeps: list[float] | None = None,
) -> OpenAIJobImportAdapter:
    async def record_sleep(delay: float) -> None:
        if sleeps is not None:
            sleeps.append(delay)

    return OpenAIJobImportAdapter(
        OpenAIJobImportConfig(
            api_key="test-placeholder-not-a-real-key",
            model="gpt-5.6-luna",
            request_timeout_seconds=30,
            max_retries=max_retries,
            instruction_version="job-import-text-v3",
        ),
        client=FakeOpenAIClient(outcomes),
        sleep=record_sleep,
    )


def _raw_adapter(payload: object) -> OpenAIJobImportAdapter:
    response = {
        "status": "completed",
        "model": "gpt-5.6-luna-2026-07-01",
        "usage": {
            "input_tokens": 101,
            "output_tokens": 21,
            "total_tokens": 122,
        },
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps(payload),
                    }
                ],
            }
        ],
    }
    return _raw_response_adapter(FakeRawResponse(response))


def _raw_response_adapter(raw_response: FakeRawResponse) -> OpenAIJobImportAdapter:
    return OpenAIJobImportAdapter(
        OpenAIJobImportConfig(
            api_key="test-placeholder-not-a-real-key",
            model="gpt-5.6-luna",
            request_timeout_seconds=30,
            max_retries=0,
            instruction_version="job-import-text-v3",
        ),
        client=FakeRawOpenAIClient([raw_response]),
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


async def _source_and_draft(
    client: AsyncClient,
    headers: dict[str, str],
    label: str,
    *,
    source_type: str = "pasted_text",
    source_data: dict[str, object] | None = None,
) -> tuple[dict[str, object], dict[str, object]]:
    payload: dict[str, object] = {
        "source_type": source_type,
        "source_title": label,
        "idempotency_key": f"source-openai-{label}",
    }
    if source_type in {"pasted_text", "rough_description", "external_listing_text"}:
        payload["original_text"] = SOURCE_TEXT
    payload.update(source_data or {})
    source_response = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json=payload,
    )
    assert source_response.status_code == 201, source_response.text
    source = source_response.json()
    draft_response = await client.post(
        f"/api/v1/job-imports/sources/{source['id']}/drafts",
        headers=headers,
        json={"idempotency_key": f"draft-openai-{label}"},
    )
    assert draft_response.status_code == 201, draft_response.text
    return source, draft_response.json()


def _service(session) -> JobImportService:
    return JobImportService(
        JobImportRepository(session),
        JobService(JobRepository(session)),
    )


@pytest.fixture
def provider_override():
    providers: list[FakeProvider] = []

    def install(provider: FakeProvider) -> FakeProvider:
        providers.append(provider)
        app.dependency_overrides[get_job_import_provider] = lambda: provider
        return provider

    yield install
    app.dependency_overrides.pop(get_job_import_provider, None)


@pytest.mark.asyncio
async def test_openai_adapter_builds_server_owned_structured_request() -> None:
    response = _openai_response(parsed=_wire_extraction())
    adapter = _adapter([response])

    result = await adapter.extract(_request())

    assert result.extraction.fields[0].field_path == "title"
    assert result.metadata.provider_name == "openai"
    assert result.metadata.model_name == "gpt-5.6-luna"
    assert result.metadata.model_version == "gpt-5.6-luna-2026-07-01"
    assert result.metadata.instruction_version == "job-import-text-v3"
    assert result.metadata.metadata["request_id"] == "req_openai_test"
    assert result.metadata.metadata["usage"] == {
        "input_tokens": 101,
        "output_tokens": 21,
        "total_tokens": 122,
    }
    assert result.metadata.metadata["retry_count"] == 0
    assert result.metadata.metadata["attempt_number"] == 1
    assert result.metadata.metadata["elapsed_ms"] >= 0
    assert result.metadata.metadata["response_status"] == "completed"
    assert result.metadata.metadata["segmentation_version"] == EVIDENCE_SEGMENTATION_VERSION
    call = adapter._client.responses.calls[0]
    assert call["model"] == "gpt-5.6-luna"
    assert call["text_format"] is OpenAIJobImportExtractionResponse
    assert call["max_output_tokens"] == OPENAI_MAX_OUTPUT_TOKENS
    assert call["store"] is False
    provider_input = call["input"]
    assert isinstance(provider_input, list)
    content = provider_input[0]["content"]
    assert content[-1]["type"] == "input_text"
    span_payload = json.loads(content[-1]["text"].split("\n", 1)[1])
    assert span_payload["segmentation_version"] == EVIDENCE_SEGMENTATION_VERSION
    assert span_payload["evidence_spans"] == [{"span_id": "E0001", "text": SOURCE_TEXT}]
    assert "char_start" not in content[-1]["text"]
    assert "char_end" not in content[-1]["text"]
    assert SOURCE_TEXT not in content[0]["text"]
    assert SOURCE_TEXT not in str(call["instructions"])
    assert "screening_questions" in str(call["instructions"])
    assert "language_requirements" in str(call["instructions"])
    assert "chain-of-thought" in str(call["instructions"])
    assert "never repeat an ID" in str(call["instructions"])


def test_openai_wire_schema_is_strict_structured_output_compatible() -> None:
    schema = to_strict_json_schema(OpenAIJobImportExtractionResponse)

    def walk(value: object) -> None:
        if isinstance(value, dict):
            assert value, "Structured Outputs cannot constrain an empty schema"
            if value.get("type") == "object":
                assert value.get("additionalProperties") is False
                assert set(value.get("properties", {})) == set(value.get("required", []))
            assert value.get("format") != "uri"
            for nested in value.values():
                walk(nested)
        elif isinstance(value, list):
            for nested in value:
                walk(nested)

    walk(schema)


@pytest.mark.asyncio
async def test_openai_adapter_decodes_wire_values_before_domain_validation() -> None:
    extraction = _extraction(value=["youtube"])
    result = await _adapter([_openai_response(parsed=_wire_extraction(extraction))]).extract(
        _request()
    )

    assert result.extraction.fields[0].value == ["youtube"]


@pytest.mark.asyncio
async def test_openai_adapter_decodes_success_from_owned_raw_http_response() -> None:
    wire = _wire_extraction().model_dump(mode="json")

    result = await _raw_adapter(wire).extract(_request())

    assert result.extraction.fields[0].field_path == "title"
    assert result.metadata.metadata["request_id"] == "req_raw_openai_test"
    assert result.metadata.metadata["provider_http_status"] == 200
    assert result.metadata.metadata["processing_stage"] == "validated_provider_output"
    assert result.metadata.metadata["returned_evidence_id_count"] == 1
    assert result.metadata.metadata["invalid_evidence_id_count"] == 0


@pytest.mark.asyncio
async def test_openai_adapter_classifies_unreadable_raw_http_envelope() -> None:
    with pytest.raises(JobImportProviderError) as caught:
        await _raw_response_adapter(FakeRawResponse(raw_text="{")).extract(_request())

    metadata = caught.value.metadata.metadata
    assert caught.value.code == "OPENAI_MALFORMED_RESPONSE"
    assert metadata["request_id"] == "req_raw_openai_test"
    assert metadata["provider_http_status"] == 200
    assert metadata["processing_stage"] == "provider_response_received"
    assert metadata["failure_subreason"] == "provider_response_json_invalid"
    assert metadata["span_count"] == 1


@pytest.mark.asyncio
async def test_openai_adapter_classifies_invalid_output_text_json() -> None:
    response = {
        "status": "completed",
        "model": "gpt-5.6-luna-2026-07-01",
        "usage": {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12},
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": "{"}],
            }
        ],
    }

    with pytest.raises(JobImportProviderError) as caught:
        await _raw_response_adapter(FakeRawResponse(response)).extract(_request())

    metadata = caught.value.metadata.metadata
    assert caught.value.code == "OPENAI_SCHEMA_MISMATCH"
    assert metadata["request_id"] == "req_raw_openai_test"
    assert metadata["processing_stage"] == "provider_wire_validation"
    assert metadata["failure_subreason"] == "provider_wire_invalid_json"
    assert metadata["usage"]["total_tokens"] == 12


def _post_response_failure_payload(case: str) -> dict[str, object]:
    payload = _wire_extraction().model_dump(mode="json")
    field = payload["fields"][0]
    if case == "unknown_span_id":
        field["evidence_span_ids"] = ["E9999"]
    elif case == "span_from_another_request":
        field["evidence_span_ids"] = ["E0002"]
    elif case == "malformed_span_id":
        field["evidence_span_ids"] = ["E1"]
    elif case == "duplicate_span_id":
        field["evidence_span_ids"] = ["E0001", "E0001"]
    elif case == "excessive_span_ids":
        field["evidence_span_ids"] = [f"E{index:04d}" for index in range(1, 7)]
    elif case == "missing_required_evidence":
        field["evidence_span_ids"] = []
    elif case == "invalid_json_value":
        field["value_json"] = "not-json"
    elif case == "invalid_field_path":
        field["field_path"] = "status.nested"
    elif case == "duplicate_field_path":
        payload["fields"].append(dict(field))
    elif case == "invalid_conflict_evidence":
        payload["fields"] = []
        payload["conflicts"] = [
            {
                "field_path": "budget_amount",
                "values": [
                    {"value_json": "10", "evidence_span_ids": ["E0001"]},
                    {"value_json": "20", "evidence_span_ids": ["E9999"]},
                ],
                "explanation": None,
                "provider_confidence": None,
            }
        ]
    elif case == "invalid_warning_evidence":
        payload["warnings"] = [
            {
                "code": "review.warning",
                "message": "Review this field.",
                "field_path": "title",
                "evidence_span_ids": ["E9999"],
            }
        ]
    elif case == "evidence_not_allowed":
        payload["missing_fields"] = [
            {
                "field_path": "deadline_at",
                "explanation": None,
                "evidence_span_ids": ["E0001"],
            }
        ]
    elif case == "excessive_field_count":
        payload["fields"] = [dict(field) for _ in range(101)]
    elif case == "excessive_conflict_count":
        payload["fields"] = []
        conflict = {
            "field_path": "budget_amount",
            "values": [
                {"value_json": "10", "evidence_span_ids": ["E0001"]},
                {"value_json": "20", "evidence_span_ids": ["E0001"]},
            ],
            "explanation": None,
            "provider_confidence": None,
        }
        payload["conflicts"] = [dict(conflict) for _ in range(31)]
    elif case == "excessive_warning_count":
        warning = {
            "code": "review.warning",
            "message": "Review this field.",
            "field_path": "title",
            "evidence_span_ids": [],
        }
        payload["warnings"] = [dict(warning) for _ in range(31)]
    elif case == "malformed_conflict":
        payload["fields"] = []
        payload["conflicts"] = [
            {
                "field_path": "budget_amount",
                "values": [
                    {"value_json": "10", "evidence_span_ids": ["E0001"]},
                    {"value_json": "10", "evidence_span_ids": ["E0001"]},
                ],
                "explanation": None,
                "provider_confidence": None,
            }
        ]
    elif case == "malformed_missing_field":
        payload["missing_fields"] = [{"field_path": "INVALID.FIELD", "explanation": None}]
    elif case == "excessive_nesting":
        nested: object = "leaf"
        for _ in range(300):
            nested = [nested]
        field["value_json"] = json.dumps(nested)
    elif case == "response_size_exceeded":
        field["value_json"] = json.dumps("x" * MAX_EXTRACTION_RESPONSE_BYTES)
    else:  # pragma: no cover - keeps test fixture additions explicit
        raise AssertionError(f"Unknown diagnostic case: {case}")
    return payload


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("case", "expected_subreason"),
    [
        ("unknown_span_id", "unknown_span_id"),
        ("span_from_another_request", "unknown_span_id"),
        ("malformed_span_id", "malformed_span_id"),
        ("duplicate_span_id", "duplicate_span_id"),
        ("excessive_span_ids", "excessive_span_ids"),
        ("missing_required_evidence", "missing_required_evidence"),
        ("invalid_json_value", "invalid_json_value"),
        ("invalid_field_path", "invalid_field_path"),
        ("duplicate_field_path", "duplicate_field_path"),
        ("invalid_conflict_evidence", "unknown_span_id"),
        ("invalid_warning_evidence", "unknown_span_id"),
        ("evidence_not_allowed", "evidence_not_allowed"),
        ("excessive_field_count", "excessive_field_count"),
        ("excessive_conflict_count", "excessive_conflict_count"),
        ("excessive_warning_count", "excessive_warning_count"),
        ("malformed_conflict", "malformed_conflict"),
        ("malformed_missing_field", "malformed_missing_field"),
        ("excessive_nesting", "excessive_nesting"),
        ("response_size_exceeded", "response_size_exceeded"),
    ],
)
async def test_raw_http_200_post_response_failures_retain_safe_diagnostics(
    case: str,
    expected_subreason: str,
) -> None:
    with pytest.raises(JobImportProviderError) as caught:
        await _raw_adapter(_post_response_failure_payload(case)).extract(_request())

    error = caught.value
    metadata = error.metadata.metadata
    assert error.code in {"OPENAI_EVIDENCE_INVALID", "OPENAI_SCHEMA_MISMATCH"}
    assert metadata["request_id"] == "req_raw_openai_test"
    assert error.metadata.model_version == "gpt-5.6-luna-2026-07-01"
    assert metadata["usage"] == {
        "input_tokens": 101,
        "output_tokens": 21,
        "total_tokens": 122,
    }
    assert metadata["provider_http_status"] == 200
    assert metadata["attempt_number"] == 1
    assert metadata["retry_count"] == 0
    assert metadata["elapsed_ms"] >= 0
    assert metadata["failure_code"] == error.code
    assert metadata["failure_subreason"] == expected_subreason
    assert metadata["processing_stage"] in {
        "provider_wire_validation",
        "provider_value_decoding",
        "provider_neutral_validation",
        "evidence_span_resolution",
    }
    assert metadata["segmentation_version"] == EVIDENCE_SEGMENTATION_VERSION
    assert metadata["span_count"] == 1
    serialized = json.dumps(metadata)
    assert SOURCE_TEXT not in serialized
    assert "test-placeholder-not-a-real-key" not in serialized
    assert "output" not in metadata


@pytest.mark.asyncio
async def test_openai_adapter_rejects_invalid_wire_value_json() -> None:
    wire = _wire_extraction().model_copy(deep=True)
    wire.fields[0].value_json = "not-json"

    with pytest.raises(JobImportProviderError) as caught:
        await _adapter([_openai_response(parsed=wire)]).extract(_request())

    assert caught.value.code == "OPENAI_SCHEMA_MISMATCH"


@pytest.mark.asyncio
async def test_openai_adapter_retries_only_bounded_transient_failures() -> None:
    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    timeout = openai.APITimeoutError(request=request)
    rate_limit = openai.RateLimitError(
        "limited",
        response=httpx.Response(
            429,
            request=request,
            headers={"retry-after": "10"},
        ),
        body=None,
    )
    sleeps: list[float] = []
    adapter = _adapter(
        [timeout, rate_limit, _openai_response(parsed=_wire_extraction())],
        sleeps=sleeps,
    )

    result = await adapter.extract(_request())

    assert result.metadata.metadata["retry_count"] == 2
    assert sleeps == [0.25, 2.0]
    assert len(adapter._client.responses.calls) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("exception", "code", "status_code"),
    [
        (
            openai.AuthenticationError(
                "bad key",
                response=httpx.Response(
                    401,
                    request=httpx.Request(
                        "POST",
                        "https://api.openai.com/v1/responses",
                    ),
                ),
                body=None,
            ),
            "OPENAI_AUTHENTICATION_FAILED",
            503,
        ),
        (
            openai.PermissionDeniedError(
                "model denied",
                response=httpx.Response(
                    403,
                    request=httpx.Request(
                        "POST",
                        "https://api.openai.com/v1/responses",
                    ),
                ),
                body=None,
            ),
            "OPENAI_PERMISSION_DENIED",
            503,
        ),
        (
            openai.NotFoundError(
                "model unavailable",
                response=httpx.Response(
                    404,
                    request=httpx.Request(
                        "POST",
                        "https://api.openai.com/v1/responses",
                    ),
                ),
                body=None,
            ),
            "OPENAI_MODEL_UNAVAILABLE",
            503,
        ),
    ],
)
async def test_openai_adapter_does_not_retry_permanent_access_failures(
    exception: Exception,
    code: str,
    status_code: int,
) -> None:
    adapter = _adapter([exception], max_retries=2)

    with pytest.raises(JobImportProviderError) as caught:
        await adapter.extract(_request())

    assert caught.value.code == code
    assert caught.value.status_code == status_code
    assert len(adapter._client.responses.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response", "code"),
    [
        (
            _openai_response(parsed=_wire_extraction(), status="incomplete"),
            "OPENAI_INCOMPLETE_RESPONSE",
        ),
        (_openai_response(parsed=None), "OPENAI_MALFORMED_RESPONSE"),
        (
            _openai_response(
                parsed=_extraction(),
                output=[
                    SimpleNamespace(
                        type="message",
                        content=[SimpleNamespace(type="refusal")],
                    )
                ],
            ),
            "OPENAI_REFUSED",
        ),
    ],
)
async def test_openai_adapter_rejects_incomplete_malformed_and_refused_output(
    response: object,
    code: str,
) -> None:
    with pytest.raises(JobImportProviderError) as caught:
        await _adapter([response], max_retries=0).extract(_request())
    assert caught.value.code == code


@pytest.mark.asyncio
async def test_openai_adapter_rejects_structured_schema_mismatch() -> None:
    response = _openai_response(
        parsed={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [{"field_path": "title"}],
        }
    )
    with pytest.raises(JobImportProviderError) as caught:
        await _adapter([response], max_retries=0).extract(_request())
    assert caught.value.code == "OPENAI_SCHEMA_MISMATCH"


@pytest.mark.asyncio
async def test_openai_adapter_maps_sdk_parse_validation_to_schema_mismatch() -> None:
    try:
        JobImportExtractionResponse.model_validate(
            {
                "extraction_schema_version": 1,
                "target_listing_schema_version": 3,
                "fields": [{"field_path": "title"}],
            }
        )
    except ValidationError as validation_error:
        adapter = _adapter([validation_error], max_retries=0)
    else:  # pragma: no cover - the fixture is intentionally invalid
        raise AssertionError("Expected invalid extraction fixture")

    with pytest.raises(JobImportProviderError) as caught:
        await adapter.extract(_request())
    assert caught.value.code == "OPENAI_SCHEMA_MISMATCH"
    assert len(adapter._client.responses.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("exception", "code", "status_code"),
    [
        (
            openai.APITimeoutError(
                request=httpx.Request(
                    "POST",
                    "https://api.openai.com/v1/responses",
                )
            ),
            "OPENAI_TIMEOUT",
            504,
        ),
        (
            openai.RateLimitError(
                "limited",
                response=httpx.Response(
                    429,
                    request=httpx.Request(
                        "POST",
                        "https://api.openai.com/v1/responses",
                    ),
                ),
                body=None,
            ),
            "OPENAI_RATE_LIMITED",
            429,
        ),
        (
            openai.InternalServerError(
                "temporary service failure",
                response=httpx.Response(
                    503,
                    request=httpx.Request(
                        "POST",
                        "https://api.openai.com/v1/responses",
                    ),
                ),
                body=None,
            ),
            "OPENAI_TEMPORARILY_UNAVAILABLE",
            503,
        ),
    ],
)
async def test_openai_adapter_reports_exhausted_transient_failures(
    exception: Exception,
    code: str,
    status_code: int,
) -> None:
    adapter = _adapter([exception], max_retries=0)
    with pytest.raises(JobImportProviderError) as caught:
        await adapter.extract(_request())
    assert caught.value.code == code
    assert caught.value.status_code == status_code


@pytest.mark.asyncio
async def test_openai_adapter_rejects_evidence_outside_normalized_text() -> None:
    invalid = _wire_extraction()
    invalid.fields[0].evidence_span_ids = ["E9999"]

    with pytest.raises(JobImportProviderError) as caught:
        await _adapter([_openai_response(parsed=invalid)]).extract(_request())

    assert caught.value.code == "OPENAI_EVIDENCE_INVALID"
    assert caught.value.metadata is not None
    assert caught.value.metadata.metadata["request_id"] == "req_openai_test"
    assert caught.value.metadata.metadata["usage"]["total_tokens"] == 122
    assert caught.value.metadata.metadata["failure_code"] == "OPENAI_EVIDENCE_INVALID"
    assert caught.value.metadata.metadata["evidence_span_failure_reason"] == "unknown_span_id"


@pytest.mark.asyncio
async def test_post_parse_evidence_failure_persists_only_safe_private_metadata(
    client: AsyncClient,
    provider_override,
) -> None:
    owner_headers, owner_id = await _auth(client, "openai-evidence-audit-owner")
    other_headers, _other_id = await _auth(client, "openai-evidence-audit-other")
    _source, draft = await _source_and_draft(
        client,
        owner_headers,
        "evidence-audit",
    )
    invalid = _wire_extraction()
    invalid.fields[0].evidence_span_ids = ["E9999"]
    provider_override(_adapter([_openai_response(parsed=invalid)], max_retries=0))
    path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

    failed = await client.post(path, headers=owner_headers, json={})

    assert failed.status_code == 502
    api_error = failed.json()["error"]
    assert api_error["code"] == "OPENAI_EVIDENCE_INVALID"
    diagnostic = api_error["details"]["details"]
    assert diagnostic["request_id"] == "req_openai_test"
    assert diagnostic["processing_stage"] == "evidence_span_resolution"
    assert diagnostic["failure_subreason"] == "unknown_span_id"
    assert diagnostic["provider_http_status"] == 200
    assert diagnostic["span_count"] == 1
    assert diagnostic["returned_evidence_id_count"] == 1
    assert diagnostic["unknown_evidence_id_count"] == 1
    assert diagnostic["invalid_evidence_span_ids"] == ["E9999"]
    current = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=owner_headers,
    )
    assert current.status_code == 200
    body = current.json()
    assert body["processing_status"] == "processing_failed"
    assert body["model_name"] == "gpt-5.6-luna"
    assert body["model_version"] == "gpt-5.6-luna-2026-07-01"
    assert body["provider_metadata"]["request_id"] == "req_openai_test"
    assert body["provider_metadata"]["usage"] == {
        "input_tokens": 101,
        "output_tokens": 21,
        "total_tokens": 122,
    }
    assert body["provider_metadata"]["elapsed_ms"] >= 0
    assert body["provider_metadata"]["attempt_number"] == 1
    assert body["provider_metadata"]["retry_count"] == 0
    assert body["provider_metadata"]["provider_http_status"] == 200
    assert body["provider_metadata"]["span_count"] == 1
    assert body["provider_metadata"]["returned_evidence_id_count"] == 1
    assert body["provider_metadata"]["invalid_evidence_id_count"] == 1
    assert body["provider_metadata"]["unknown_evidence_id_count"] == 1
    assert body["provider_metadata"]["duplicate_evidence_id_count"] == 0
    assert body["provider_metadata"]["failure_code"] == "OPENAI_EVIDENCE_INVALID"
    assert body["provider_metadata"]["evidence_span_failure_reason"] == "unknown_span_id"
    assert body["provider_metadata"]["segmentation_version"] == EVIDENCE_SEGMENTATION_VERSION
    serialized_metadata = json.dumps(body["provider_metadata"])
    assert SOURCE_TEXT not in serialized_metadata
    assert "test-placeholder-not-a-real-key" not in serialized_metadata
    assert "output_parsed" not in serialized_metadata
    async with TestSessionLocal() as session:
        stored = await session.get(JobImportDraft, UUID(str(draft["id"])))
        assert stored is not None and stored.owner_user_id == owner_id
        assert stored.machine_output is None
    cross_account = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=other_headers,
    )
    assert cross_account.status_code == 404


@pytest.mark.asyncio
async def test_openai_adapter_treats_html_source_as_data_and_keeps_exact_evidence() -> None:
    source_text = "Need <script>alert('x')</script> editing."
    snippet = "<script>alert('x')</script>"
    extraction = _extraction(
        source_text=source_text,
        value=snippet,
        evidence_snippet=snippet,
    )

    result = await _adapter(
        [_openai_response(parsed=_wire_extraction(extraction, source_text=source_text))]
    ).extract(_request(source_text))

    assert result.extraction.fields[0].value == snippet
    evidence = result.extraction.fields[0].evidence[0]
    assert snippet in evidence.snippet
    assert evidence.location is not None
    assert (
        source_text[evidence.location.char_start : evidence.location.char_end] == evidence.snippet
    )


@pytest.mark.asyncio
async def test_openai_adapter_fails_safely_without_configuration() -> None:
    adapter = OpenAIJobImportAdapter(
        OpenAIJobImportConfig(
            api_key=None,
            model="gpt-5.6-luna",
            request_timeout_seconds=30,
            max_retries=2,
            instruction_version="job-import-text-v1",
        )
    )
    with pytest.raises(JobImportProviderError) as caught:
        await adapter.extract(_request())
    assert caught.value.code == "OPENAI_NOT_CONFIGURED"
    assert caught.value.status_code == 503
    assert "key" not in caught.value.message.casefold()


@pytest.mark.asyncio
async def test_private_process_endpoint_persists_validated_machine_output_only(
    client: AsyncClient,
    provider_override,
) -> None:
    headers, owner_id = await _auth(client, "openai-success")
    source, draft = await _source_and_draft(client, headers, "success")
    provider = provider_override(FakeProvider())

    response = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/process",
        headers=headers,
        json={},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "processed"
    assert body["draft"]["processing_status"] == "ready_to_apply"
    assert body["draft"]["confirmation_state"] == "confirmed"
    assert body["draft"]["can_apply_to_native_draft"] is True
    assert body["draft"]["can_publish_directly"] is False
    assert body["draft"]["target_job_id"] is None
    assert body["draft"]["provider_name"] == "openai"
    assert body["draft"]["provider_metadata"]["request_id"] == "req_test"
    assert "original_text" not in body
    assert SOURCE_TEXT not in response.text
    assert provider.calls == 1
    async with TestSessionLocal() as session:
        assert (
            await session.execute(select(Job).where(Job.posted_by_user_id == owner_id))
        ).scalars().all() == []
        stored = await session.get(JobImportDraft, UUID(str(draft["id"])))
        assert stored is not None
        assert stored.machine_output is not None
        assert stored.source_id == UUID(str(source["id"]))
        assert stored.provider_metadata["processing_outcome"] == "processed"
        assert "api_key" not in str(stored.provider_metadata).casefold()


@pytest.mark.asyncio
async def test_process_endpoint_requires_auth_owner_and_server_owned_options(
    client: AsyncClient,
    provider_override,
) -> None:
    owner_headers, _owner_id = await _auth(client, "openai-owner")
    other_headers, _other_id = await _auth(client, "openai-other")
    _source, draft = await _source_and_draft(client, owner_headers, "authorization")
    provider = provider_override(FakeProvider())
    path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

    assert (await client.post(path, json={})).status_code == 401
    assert (await client.post(path, headers=other_headers, json={})).status_code == 404
    for payload in (
        {"model": "attacker-selected-model"},
        {"provider_name": "attacker"},
        {"provider_metadata": {"api_key": "secret"}},
    ):
        response = await client.post(path, headers=owner_headers, json=payload)
        assert response.status_code == 422
    assert provider.calls == 0


@pytest.mark.asyncio
async def test_process_endpoint_rejects_non_text_and_terminal_drafts(
    client: AsyncClient,
    provider_override,
) -> None:
    headers, owner_id = await _auth(client, "openai-terminal")
    _source, url_draft = await _source_and_draft(
        client,
        headers,
        "url",
        source_type="public_url",
        source_data={"source_url": "https://example.com/jobs/editor"},
    )
    provider = provider_override(FakeProvider())

    unsupported = await client.post(
        f"/api/v1/job-imports/drafts/{url_draft['id']}/process",
        headers=headers,
        json={},
    )
    assert unsupported.status_code == 422
    assert unsupported.json()["error"]["code"] == "JOB_IMPORT_TEXT_SOURCE_REQUIRED"

    _source, terminal = await _source_and_draft(client, headers, "discarded")
    discarded = await client.post(
        f"/api/v1/job-imports/drafts/{terminal['id']}/discard",
        headers=headers,
    )
    assert discarded.status_code == 200
    response = await client.post(
        f"/api/v1/job-imports/drafts/{terminal['id']}/process",
        headers=headers,
        json={},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "JOB_IMPORT_INVALID_TRANSITION"

    async with TestSessionLocal() as session:
        stored = await session.get(JobImportDraft, UUID(str(terminal["id"])))
        assert stored is not None and stored.owner_user_id == owner_id
        stored.processing_status = "applied_to_native_draft"
        await session.commit()
    applied = await client.post(
        f"/api/v1/job-imports/drafts/{terminal['id']}/process",
        headers=headers,
        json={},
    )
    assert applied.status_code == 409
    assert provider.calls == 0


@pytest.mark.asyncio
async def test_process_failure_is_private_recoverable_and_retryable(
    client: AsyncClient,
    provider_override,
) -> None:
    headers, _owner_id = await _auth(client, "openai-retry")
    _source, draft = await _source_and_draft(client, headers, "retry")
    failure = JobImportProviderError(
        "OPENAI_TIMEOUT",
        "OpenAI text extraction timed out. Please retry.",
        status_code=504,
        retryable=True,
        retry_count=2,
        metadata=JobImportProviderMetadata(
            provider_name="openai",
            model_name="gpt-5.6-luna",
            instruction_version="job-import-text-v1",
            metadata={"retry_count": 2, "processing_outcome": "failed"},
        ),
    )
    provider = provider_override(FakeProvider([failure, _provider_result()]))
    path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

    failed = await client.post(path, headers=headers, json={})
    assert failed.status_code == 504
    assert failed.json()["error"]["code"] == "OPENAI_TIMEOUT"
    assert failed.json()["error"]["message"] == "OpenAI text extraction timed out. Please retry."
    current = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert current.json()["processing_status"] == "processing_failed"
    assert current.json()["validation_errors"]["processing"]["code"] == "OPENAI_TIMEOUT"
    retried = await client.post(path, headers=headers, json={})
    assert retried.status_code == 200, retried.text
    assert retried.json()["outcome"] == "processed"
    assert provider.calls == 2


@pytest.mark.asyncio
async def test_unexpected_provider_failure_is_sanitized_and_recoverable(
    client: AsyncClient,
    provider_override,
    caplog: pytest.LogCaptureFixture,
) -> None:
    headers, _owner_id = await _auth(client, "openai-unexpected")
    _source, draft = await _source_and_draft(client, headers, "unexpected")
    provider_override(ExplodingProvider())

    response = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/process",
        headers=headers,
        json={},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "JOB_IMPORT_PROVIDER_FAILED"
    assert SOURCE_TEXT not in response.text
    current = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert current.json()["processing_status"] == "processing_failed"
    assert SOURCE_TEXT not in str(current.json()["validation_errors"])
    assert SOURCE_TEXT not in caplog.text


@pytest.mark.asyncio
async def test_sequential_duplicate_processing_returns_existing_private_result(
    client: AsyncClient,
    provider_override,
) -> None:
    headers, _owner_id = await _auth(client, "openai-idempotent")
    _source, draft = await _source_and_draft(client, headers, "idempotent")
    provider = provider_override(FakeProvider())
    path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

    first = await client.post(path, headers=headers, json={})
    second = await client.post(path, headers=headers, json={})

    assert first.status_code == second.status_code == 200
    assert first.json()["outcome"] == "processed"
    assert second.json()["outcome"] == "already_processed"
    assert provider.calls == 1


@pytest.mark.asyncio
async def test_concurrent_duplicate_processing_observes_current_claim(
    client: AsyncClient,
    provider_override,
) -> None:
    headers, _owner_id = await _auth(client, "openai-concurrent")
    _source, draft = await _source_and_draft(client, headers, "concurrent")
    started = asyncio.Event()
    release = asyncio.Event()
    provider = provider_override(FakeProvider(started=started, release=release))
    path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

    first_task = asyncio.create_task(client.post(path, headers=headers, json={}))
    await asyncio.wait_for(started.wait(), timeout=2)
    second = await client.post(path, headers=headers, json={})
    release.set()
    first = await asyncio.wait_for(first_task, timeout=5)

    assert first.status_code == second.status_code == 200
    assert first.json()["outcome"] == "processed"
    assert second.json()["outcome"] == "already_processing"
    assert provider.calls == 1


@pytest.mark.asyncio
async def test_redaction_during_provider_call_prevents_result_persistence(
    client: AsyncClient,
    provider_override,
) -> None:
    headers, _owner_id = await _auth(client, "openai-redaction")
    source, draft = await _source_and_draft(client, headers, "redaction")
    started = asyncio.Event()
    release = asyncio.Event()
    provider_override(FakeProvider(started=started, release=release))
    path = f"/api/v1/job-imports/drafts/{draft['id']}/process"

    process_task = asyncio.create_task(client.post(path, headers=headers, json={}))
    await asyncio.wait_for(started.wait(), timeout=2)
    redacted = await client.delete(
        f"/api/v1/job-imports/sources/{source['id']}",
        headers=headers,
    )
    assert redacted.status_code == 204
    release.set()
    processing = await asyncio.wait_for(process_task, timeout=5)

    assert processing.status_code == 409
    assert SOURCE_TEXT not in processing.text
    current = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert current.status_code == 200
    assert current.json()["processing_status"] == "discarded"
    assert current.json()["provider_metadata"] is None
    async with TestSessionLocal() as session:
        stored = await session.get(JobImportDraft, UUID(str(draft["id"])))
        assert stored is not None
        assert stored.machine_output is None
        assert (
            await session.execute(
                select(JobImportField).where(JobImportField.draft_id == stored.id)
            )
        ).scalars().all() == []


@pytest.mark.asyncio
async def test_stale_provider_result_cannot_overwrite_newer_attempt(
    client: AsyncClient,
) -> None:
    headers, owner_id = await _auth(client, "openai-stale")
    _source, draft = await _source_and_draft(client, headers, "stale")
    first_attempt = uuid4()
    second_attempt = uuid4()

    async with TestSessionLocal() as session:
        service = _service(session)
        await service.begin_processing(
            UUID(str(draft["id"])),
            owner_user_id=owner_id,
            processing_attempt_id=first_attempt,
        )
        await service.mark_processing_failed(
            UUID(str(draft["id"])),
            owner_user_id=owner_id,
            error_code="OPENAI_TIMEOUT",
            message="OpenAI text extraction timed out.",
            expected_processing_attempt_id=first_attempt,
        )
        await service.begin_processing(
            UUID(str(draft["id"])),
            owner_user_id=owner_id,
            processing_attempt_id=second_attempt,
        )
        with pytest.raises(JobImportError) as caught:
            await service.record_extraction_result(
                UUID(str(draft["id"])),
                _extraction(),
                owner_user_id=owner_id,
                provider_metadata=_provider_result().metadata,
                expected_processing_attempt_id=first_attempt,
            )
        assert caught.value.code == "JOB_IMPORT_STALE_PROCESSING_RESULT"

    async with TestSessionLocal() as session:
        stored = await session.get(JobImportDraft, UUID(str(draft["id"])))
        assert stored is not None
        assert stored.processing_status == "processing"
        assert stored.machine_output is None
        assert stored.provider_metadata["processing_attempt_id"] == str(second_attempt)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field_path", "expected_subreason"),
    [
        ("status", "creatorjobs_owned_field"),
        ("posted_by_user_id", "creatorjobs_owned_field"),
        ("languages", "prohibited_language_field"),
        ("language_requirements", "prohibited_language_field"),
        ("custom_attacker_field", "unsupported_field"),
    ],
)
async def test_provider_cannot_inject_unsupported_or_creatorjobs_owned_fields(
    client: AsyncClient,
    provider_override,
    field_path: str,
    expected_subreason: str,
) -> None:
    label = f"openai-policy-{field_path.replace('_', '-')}"
    headers, _owner_id = await _auth(client, label)
    _source, draft = await _source_and_draft(client, headers, label)
    provider_override(FakeProvider([_provider_result(_extraction(field_path=field_path))]))

    response = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/process",
        headers=headers,
        json={},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "JOB_IMPORT_UNSUPPORTED_FIELD"
    current = await client.get(
        f"/api/v1/job-imports/drafts/{draft['id']}",
        headers=headers,
    )
    assert current.json()["processing_status"] == "processing_failed"
    assert current.json()["fields"] == []
    metadata = current.json()["provider_metadata"]
    assert metadata["failure_code"] == "JOB_IMPORT_UNSUPPORTED_FIELD"
    assert metadata["failure_subreason"] == expected_subreason
    assert metadata["processing_stage"] == "field_policy_validation"
    assert metadata["affected_field_path"] == field_path
    assert metadata["request_id"] == "req_test"
    assert metadata["elapsed_ms"] == 12


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("case", "expected_code", "expected_stage", "expected_subreason"),
    [
        (
            "unsupported_nested_field",
            "JOB_IMPORT_UNSUPPORTED_NESTED_FIELD",
            "field_policy_validation",
            "unsupported_nested_field",
        ),
        (
            "owned_source_evidence_mismatch",
            "JOB_IMPORT_EVIDENCE_REFERENCE_INVALID",
            "evidence_validation",
            "invalid_evidence_reference",
        ),
    ],
)
async def test_post_response_service_validation_retains_safe_failure_stage(
    client: AsyncClient,
    provider_override,
    case: str,
    expected_code: str,
    expected_stage: str,
    expected_subreason: str,
) -> None:
    headers, owner_id = await _auth(client, f"openai-service-audit-{case}")
    _source, draft = await _source_and_draft(
        client,
        headers,
        f"service-audit-{case}",
    )
    if case == "unsupported_nested_field":
        extraction = _extraction(
            field_path="source_inputs",
            value=[{"type": "raw_footage", "attacker_key": True}],
        )
    else:
        payload = _extraction().model_dump(mode="json")
        payload["fields"][0]["evidence"][0]["location"] = {
            "char_start": 0,
            "char_end": len(TITLE_TEXT),
        }
        extraction = JobImportExtractionResponse.model_validate(payload)
    provider_override(FakeProvider([_provider_result(extraction)]))

    response = await client.post(
        f"/api/v1/job-imports/drafts/{draft['id']}/process",
        headers=headers,
        json={},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == expected_code
    current = (
        await client.get(
            f"/api/v1/job-imports/drafts/{draft['id']}",
            headers=headers,
        )
    ).json()
    metadata = current["provider_metadata"]
    assert current["processing_status"] == "processing_failed"
    assert current["fields"] == []
    assert metadata["failure_code"] == expected_code
    assert metadata["processing_stage"] == expected_stage
    assert metadata["failure_subreason"] == expected_subreason
    assert metadata["request_id"] == "req_test"
    assert SOURCE_TEXT not in json.dumps(metadata)
    async with TestSessionLocal() as session:
        jobs = (
            (await session.execute(select(Job).where(Job.posted_by_user_id == owner_id)))
            .scalars()
            .all()
        )
        assert jobs == []


def test_extraction_schema_rejects_duplicates_depth_and_oversized_output() -> None:
    field = _extraction().fields[0].model_dump(mode="json")
    with pytest.raises(ValidationError):
        JobImportExtractionResponse.model_validate(
            {
                "extraction_schema_version": 1,
                "target_listing_schema_version": 3,
                "fields": [field, field],
            }
        )

    nested: object = "leaf"
    for _ in range(300):
        nested = {"next": nested}
    with pytest.raises((ValidationError, ValueError, RecursionError)):
        JobImportExtractionResponse.model_validate(
            {
                "extraction_schema_version": 1,
                "target_listing_schema_version": 3,
                "fields": [
                    {
                        **field,
                        "value": nested,
                    }
                ],
            }
        )

    with pytest.raises(ValidationError):
        JobImportExtractionResponse.model_validate(
            {
                "extraction_schema_version": 1,
                "target_listing_schema_version": 3,
                "fields": [
                    {
                        **field,
                        "value": "x" * (MAX_EXTRACTION_RESPONSE_BYTES + 1),
                    }
                ],
            }
        )


def test_openai_provider_types_do_not_leak_into_core_contract() -> None:
    annotations = get_type_hints(JobImportProcessingService.__init__)
    assert annotations["provider"].__name__ == "JobImportExtractionProvider"
    assert "openai" not in JobImportExtractionRequest.__module__
    assert "openai" not in JobImportExtractionResponse.__module__
