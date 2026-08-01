from __future__ import annotations

import asyncio
import html
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
) -> OpenAIJobImportExtractionResponse:
    payload = (extraction or _extraction()).model_dump(mode="json")
    evidence_groups: list[list[dict[str, object]]] = []
    for field in payload["fields"]:
        field["value_json"] = json.dumps(
            field.pop("value"), ensure_ascii=False, separators=(",", ":")
        )
        confidence = field.get("provider_confidence")
        if confidence is not None:
            confidence.pop("metadata", None)
        evidence_groups.append(field["evidence"])
    for conflict in payload["conflicts"]:
        confidence = conflict.get("provider_confidence")
        if confidence is not None:
            confidence.pop("metadata", None)
        for alternative in conflict["values"]:
            alternative["value_json"] = json.dumps(
                alternative.pop("value"), ensure_ascii=False, separators=(",", ":")
            )
            evidence_groups.append(alternative["evidence"])
    evidence_groups.extend(item["evidence"] for item in payload["missing_fields"])
    evidence_groups.extend(item["evidence"] for item in payload["warnings"])
    for evidence_group in evidence_groups:
        for evidence in evidence_group:
            evidence["snippet"] = html.unescape(str(evidence["snippet"]))
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
            instruction_version="job-import-text-v1",
        ),
        client=FakeOpenAIClient(outcomes),
        sleep=record_sleep,
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
    assert result.metadata.instruction_version == "job-import-text-v1"
    assert result.metadata.metadata == {
        "request_id": "req_openai_test",
        "usage": {
            "input_tokens": 101,
            "output_tokens": 21,
            "total_tokens": 122,
        },
        "retry_count": 0,
        "response_status": "completed",
    }
    call = adapter._client.responses.calls[0]
    assert call["model"] == "gpt-5.6-luna"
    assert call["text_format"] is OpenAIJobImportExtractionResponse
    assert call["max_output_tokens"] == OPENAI_MAX_OUTPUT_TOKENS
    assert call["store"] is False
    assert SOURCE_TEXT in str(call["input"])
    assert SOURCE_TEXT not in str(call["instructions"])
    assert "screening_questions" in str(call["instructions"])
    assert "language_requirements" in str(call["instructions"])
    assert "chain-of-thought" in str(call["instructions"])


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
    result = await _adapter(
        [_openai_response(parsed=_wire_extraction(extraction))]
    ).extract(_request())

    assert result.extraction.fields[0].value == ["youtube"]


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
        (_openai_response(parsed=_wire_extraction(), status="incomplete"), "OPENAI_INCOMPLETE_RESPONSE"),
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
    invalid = _extraction().model_copy(deep=True)
    invalid.fields[0].evidence[0].location.char_start = 0
    invalid.fields[0].evidence[0].location.char_end = 4

    with pytest.raises(JobImportProviderError) as caught:
        await _adapter([_openai_response(parsed=_wire_extraction(invalid))]).extract(_request())

    assert caught.value.code == "OPENAI_EVIDENCE_INVALID"


@pytest.mark.asyncio
async def test_openai_adapter_treats_html_source_as_data_and_escapes_evidence() -> None:
    source_text = "Need <script>alert('x')</script> editing."
    snippet = "<script>alert('x')</script>"
    extraction = _extraction(
        source_text=source_text,
        value=snippet,
        evidence_snippet=snippet,
    )

    result = await _adapter(
        [_openai_response(parsed=_wire_extraction(extraction))]
    ).extract(_request(source_text))

    assert result.extraction.fields[0].value == snippet
    assert result.extraction.fields[0].evidence[0].snippet.startswith("&lt;script&gt;")


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
    assert body["draft"]["processing_status"] == "awaiting_recruiter_review"
    assert body["draft"]["confirmation_state"] == "unreviewed"
    assert body["draft"]["can_publish_directly"] is False
    assert body["draft"]["target_job_id"] is None
    assert body["draft"]["provider_name"] == "openai"
    assert body["draft"]["provider_metadata"]["request_id"] == "req_test"
    assert "original_text" not in body
    assert SOURCE_TEXT not in response.text
    assert provider.calls == 1
    async with TestSessionLocal() as session:
        assert (
            await session.execute(
                select(Job).where(Job.posted_by_user_id == owner_id)
            )
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
    assert (
        await client.post(path, headers=other_headers, json={})
    ).status_code == 404
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
    assert (
        failed.json()["error"]["message"]
        == "OpenAI text extraction timed out. Please retry."
    )
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
    provider = provider_override(
        FakeProvider(started=started, release=release)
    )
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
    "field_path",
    [
        "status",
        "posted_by_user_id",
        "languages",
        "language_requirements",
        "screening_questions",
        "custom_attacker_field",
    ],
)
async def test_provider_cannot_inject_unsupported_or_creatorjobs_owned_fields(
    client: AsyncClient,
    provider_override,
    field_path: str,
) -> None:
    label = f"openai-policy-{field_path.replace('_', '-')}"
    headers, _owner_id = await _auth(client, label)
    _source, draft = await _source_and_draft(client, headers, label)
    provider_override(
        FakeProvider([_provider_result(_extraction(field_path=field_path))])
    )

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
