from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import openai
from openai import AsyncOpenAI
from pydantic import ValidationError

from app.core.job_import_request_compaction import compact_provider_request
from app.integrations.openai.job_import_instructions import (
    build_job_import_instructions,
)
from app.integrations.openai.job_import_output import (
    OpenAIJobImportExtractionResponse,
    OpenAIJobImportPostParseError,
    wire_validation_failure,
)
from app.integrations.openai.job_import_spans import (
    EVIDENCE_SEGMENTATION_VERSION,
    EvidenceSpanError,
    EvidenceSpanSet,
    build_evidence_span_set,
)
from app.schemas.job_import import (
    MAX_EXTRACTION_RESPONSE_BYTES,
    JobImportExtractionRequest,
    JobImportProviderMetadata,
)
from app.services.job_import_provider import (
    JobImportProviderError,
    JobImportProviderResult,
)

OPENAI_MAX_OUTPUT_TOKENS = 16_000
_MAX_RETRY_DELAY_SECONDS = 2.0
_Sleep = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class OpenAIJobImportConfig:
    api_key: str | None
    model: str
    request_timeout_seconds: float
    max_retries: int
    instruction_version: str


#: Recruiter-facing text for an unusable reply.
#:
#: The provider is an implementation detail. Naming it tells the recruiter
#: nothing they can act on and breaks the rule the rest of the flow keeps —
#: the private diagnostic still carries the real reason.
_UNUSABLE_REPLY_MESSAGE = "The job details could not be read this time."


class OpenAIJobImportAdapter:
    """Text-only OpenAI adapter behind CreatorJobs' provider-neutral boundary."""

    def __init__(
        self,
        config: OpenAIJobImportConfig,
        *,
        client: Any | None = None,
        sleep: _Sleep = asyncio.sleep,
    ) -> None:
        self.config = config
        self._client = client
        self._sleep = sleep

    def _client_or_error(self) -> Any:
        if not self.config.api_key:
            raise self._provider_error(
                "OPENAI_NOT_CONFIGURED",
                "Draft preparation is temporarily unavailable.",
                status_code=503,
            )
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=self.config.api_key,
                timeout=self.config.request_timeout_seconds,
                max_retries=0,
            )
        return self._client

    async def extract(
        self,
        request: JobImportExtractionRequest,
    ) -> JobImportProviderResult:
        source_text = request.source.original_text
        if (
            request.source.source_type
            not in {
                "pasted_text",
                "rough_description",
                "external_listing_text",
            }
            or not source_text
        ):
            raise self._provider_error(
                "JOB_IMPORT_TEXT_SOURCE_REQUIRED",
                "This kind of source cannot be read yet.",
                status_code=422,
            )

        try:
            span_set = build_evidence_span_set(source_text)
        except EvidenceSpanError as exc:
            raise self._provider_error(
                "JOB_IMPORT_EVIDENCE_SPANS_INVALID",
                "This source cannot be represented safely for text extraction.",
                status_code=422,
                metadata=self._span_failure_metadata(exc.reason),
            ) from exc

        client = self._client_or_error()
        response: Any | None = None
        raw_response: Any | None = None
        retries_used = 0
        request_started = time.perf_counter()
        provider_input = self._provider_input(request, span_set=span_set)
        for attempt in range(self.config.max_retries + 1):
            try:
                call_target = getattr(client.responses, "with_raw_response", None)
                parse_method = (
                    call_target.parse if call_target is not None else client.responses.parse
                )
                provider_response = await parse_method(
                    model=self.config.model,
                    instructions=build_job_import_instructions(
                        version=self.config.instruction_version
                    ),
                    input=provider_input,
                    text_format=OpenAIJobImportExtractionResponse,
                    max_output_tokens=OPENAI_MAX_OUTPUT_TOKENS,
                    store=False,
                )
                if call_target is not None:
                    raw_response = provider_response
                else:
                    response = provider_response
                retries_used = attempt
                break
            except Exception as exc:
                mapped = self._map_openai_error(
                    exc,
                    retry_count=attempt,
                    elapsed_seconds=time.perf_counter() - request_started,
                    span_count=len(span_set.spans),
                )
                if not mapped.retryable or attempt >= self.config.max_retries:
                    raise mapped from exc
                retries_used = attempt + 1
                await self._sleep(self._retry_delay(exc, attempt))

        if response is None and raw_response is None:
            raise self._provider_error(
                "OPENAI_EMPTY_RESPONSE",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retries_used,
            )
        elapsed_seconds = time.perf_counter() - request_started
        if raw_response is not None:
            try:
                response = json.loads(raw_response.text)
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                raise self._provider_error(
                    "OPENAI_MALFORMED_RESPONSE",
                    _UNUSABLE_REPLY_MESSAGE,
                    status_code=502,
                    retry_count=retries_used,
                    metadata=self._raw_failure_metadata(
                        raw_response,
                        retries_used=retries_used,
                        elapsed_seconds=elapsed_seconds,
                        span_count=len(span_set.spans),
                        failure_subreason="provider_response_json_invalid",
                    ),
                ) from exc
        assert response is not None
        response_metadata = self._response_metadata(
            response,
            retries_used=retries_used,
            elapsed_seconds=elapsed_seconds,
            span_count=len(span_set.spans),
            request_id_override=(
                self._bounded_text(getattr(raw_response, "request_id", None), 255)
                if raw_response is not None
                else None
            ),
            provider_http_status=(
                getattr(raw_response, "status_code", None) if raw_response is not None else None
            ),
        )
        if self._response_value(response, "status") != "completed":
            incomplete_metadata = self._metadata_with_diagnostics(
                response_metadata,
                {
                    "processing_stage": "provider_response_status",
                    "failure_subreason": "provider_response_incomplete",
                },
            )
            raise self._provider_error(
                "OPENAI_INCOMPLETE_RESPONSE",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retries_used,
                metadata=incomplete_metadata,
            )
        if self._contains_refusal(response):
            refusal_metadata = self._metadata_with_diagnostics(
                response_metadata,
                {
                    "processing_stage": "provider_refusal_validation",
                    "failure_subreason": "provider_refusal",
                },
            )
            raise self._provider_error(
                "OPENAI_REFUSED",
                "The job details could not be read this time.",
                status_code=422,
                retry_count=retries_used,
                metadata=refusal_metadata,
            )

        try:
            parsed = (
                self._wire_payload_from_response(response)
                if raw_response is not None
                else getattr(response, "output_parsed", None)
            )
        except OpenAIJobImportPostParseError as exc:
            mismatch_metadata = self._metadata_with_diagnostics(
                response_metadata,
                {
                    "failure_subreason": exc.reason,
                    **exc.diagnostics,
                },
            )
            raise self._provider_error(
                "OPENAI_SCHEMA_MISMATCH",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retries_used,
                metadata=mismatch_metadata,
            ) from exc
        if parsed is None:
            malformed_metadata = self._metadata_with_diagnostics(
                response_metadata,
                {
                    "processing_stage": "provider_wire_decoding",
                    "failure_subreason": "provider_output_missing",
                },
            )
            raise self._provider_error(
                "OPENAI_MALFORMED_RESPONSE",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retries_used,
                metadata=malformed_metadata,
            )
        try:
            wire_response = (
                parsed
                if isinstance(parsed, OpenAIJobImportExtractionResponse)
                else OpenAIJobImportExtractionResponse.model_validate(parsed)
            )
            evidence_diagnostics = wire_response.evidence_diagnostics(span_set=span_set)
            response_metadata = self._metadata_with_diagnostics(
                response_metadata,
                {
                    **evidence_diagnostics,
                    "processing_stage": "provider_output_decoded",
                },
            )
            extraction = wire_response.to_domain_response(
                span_set=span_set,
            )
            response_metadata = self._metadata_with_diagnostics(
                response_metadata,
                {"processing_stage": "validated_provider_output"},
            )
        except EvidenceSpanError as exc:
            evidence_metadata = self._metadata_with_diagnostics(
                response_metadata,
                {
                    "processing_stage": "evidence_span_resolution",
                    "failure_subreason": exc.reason,
                    "evidence_span_failure_reason": exc.reason,
                    **exc.diagnostics,
                },
            )
            raise self._provider_error(
                "OPENAI_EVIDENCE_INVALID",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retries_used,
                metadata=evidence_metadata,
            ) from exc
        except OpenAIJobImportPostParseError as exc:
            mismatch_metadata = self._metadata_with_diagnostics(
                response_metadata,
                {
                    "failure_subreason": exc.reason,
                    **exc.diagnostics,
                },
            )
            raise self._provider_error(
                "OPENAI_SCHEMA_MISMATCH",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retries_used,
                metadata=mismatch_metadata,
            ) from exc
        except ValidationError as exc:
            classified = wire_validation_failure(
                exc,
                payload=parsed,
                span_set=span_set,
            )
            mismatch_metadata = self._metadata_with_diagnostics(
                response_metadata,
                classified.diagnostics,
            )
            raise self._provider_error(
                "OPENAI_SCHEMA_MISMATCH",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retries_used,
                metadata=mismatch_metadata,
            ) from exc
        except ValueError as exc:
            mismatch_metadata = self._metadata_with_diagnostics(
                response_metadata,
                {
                    "processing_stage": "provider_neutral_validation",
                    "failure_subreason": "provider_neutral_schema_failure",
                },
            )
            raise self._provider_error(
                "OPENAI_SCHEMA_MISMATCH",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retries_used,
                metadata=mismatch_metadata,
            ) from exc

        return JobImportProviderResult(
            extraction=extraction,
            metadata=response_metadata,
        )

    @staticmethod
    def _provider_input(
        request: JobImportExtractionRequest,
        *,
        span_set: EvidenceSpanSet,
    ) -> list[dict[str, object]]:
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "CreatorJobs extraction request JSON. The server-owned "
                            "evidence spans are in the next input-text block.\n"
                            + json.dumps(
                                compact_provider_request(request),
                                ensure_ascii=False,
                                separators=(",", ":"),
                            )
                        ),
                    },
                    {
                        "type": "input_text",
                        "text": (
                            "CreatorJobs canonical evidence spans JSON. Cite only "
                            "the supplied span_id values.\n"
                            + json.dumps(
                                span_set.provider_payload(),
                                ensure_ascii=False,
                                separators=(",", ":"),
                            )
                        ),
                    },
                ],
            }
        ]

    def _span_failure_metadata(self, reason: str) -> JobImportProviderMetadata:
        return JobImportProviderMetadata(
            provider_name="openai",
            model_name=self.config.model,
            instruction_version=self.config.instruction_version,
            metadata={
                "segmentation_version": EVIDENCE_SEGMENTATION_VERSION,
                "evidence_span_failure_reason": reason,
                "failure_subreason": reason,
                "processing_stage": "evidence_span_segmentation",
            },
        )

    @staticmethod
    def _response_value(response: object, key: str) -> object:
        if isinstance(response, dict):
            return response.get(key)
        return getattr(response, key, None)

    @classmethod
    def _wire_payload_from_response(cls, response: object) -> object | None:
        output = cls._response_value(response, "output")
        if not isinstance(output, list):
            return None
        for message in output:
            message_type = (
                message.get("type") if isinstance(message, dict) else getattr(message, "type", None)
            )
            if message_type != "message":
                continue
            content = (
                message.get("content")
                if isinstance(message, dict)
                else getattr(message, "content", None)
            )
            if not isinstance(content, list):
                continue
            for item in content:
                item_type = (
                    item.get("type") if isinstance(item, dict) else getattr(item, "type", None)
                )
                if item_type != "output_text":
                    continue
                text = item.get("text") if isinstance(item, dict) else getattr(item, "text", None)
                if not isinstance(text, str):
                    return None
                if len(text.encode("utf-8")) > MAX_EXTRACTION_RESPONSE_BYTES:
                    raise OpenAIJobImportPostParseError(
                        "response_size_exceeded",
                        diagnostics={
                            "processing_stage": "provider_wire_validation",
                            "failure_subreason": "response_size_exceeded",
                        },
                    )
                try:
                    return json.loads(text)
                except json.JSONDecodeError as exc:
                    raise OpenAIJobImportPostParseError(
                        "provider_wire_invalid_json",
                        diagnostics={
                            "processing_stage": "provider_wire_validation",
                            "failure_subreason": "provider_wire_invalid_json",
                        },
                    ) from exc
        return None

    @staticmethod
    def _metadata_with_diagnostics(
        metadata: JobImportProviderMetadata,
        diagnostics: dict[str, object],
    ) -> JobImportProviderMetadata:
        return metadata.model_copy(
            update={
                "metadata": {
                    **metadata.metadata,
                    **diagnostics,
                }
            }
        )

    def _raw_failure_metadata(
        self,
        raw_response: object,
        *,
        retries_used: int,
        elapsed_seconds: float,
        span_count: int,
        failure_subreason: str,
    ) -> JobImportProviderMetadata:
        status_code = getattr(raw_response, "status_code", None)
        return JobImportProviderMetadata(
            provider_name="openai",
            model_name=self.config.model,
            instruction_version=self.config.instruction_version,
            metadata={
                "request_id": self._bounded_text(
                    getattr(raw_response, "request_id", None),
                    255,
                ),
                "retry_count": retries_used,
                "attempt_number": retries_used + 1,
                "elapsed_ms": max(0, round(elapsed_seconds * 1000)),
                "provider_http_status": (status_code if isinstance(status_code, int) else None),
                "segmentation_version": EVIDENCE_SEGMENTATION_VERSION,
                "span_count": span_count,
                "processing_stage": "provider_response_received",
                "failure_subreason": failure_subreason,
            },
        )

    def _response_metadata(
        self,
        response: object,
        *,
        retries_used: int,
        elapsed_seconds: float,
        span_count: int,
        request_id_override: str | None = None,
        provider_http_status: int | None = None,
    ) -> JobImportProviderMetadata:
        response_status = self._bounded_text(self._response_value(response, "status"), 40)
        return JobImportProviderMetadata(
            provider_name="openai",
            model_name=self.config.model,
            model_version=self._bounded_text(self._response_value(response, "model"), 80),
            instruction_version=self.config.instruction_version,
            metadata={
                "request_id": request_id_override
                or self._bounded_text(getattr(response, "_request_id", None), 255),
                "usage": self._usage_metadata(self._response_value(response, "usage")),
                "retry_count": retries_used,
                "attempt_number": retries_used + 1,
                "elapsed_ms": max(0, round(elapsed_seconds * 1000)),
                "response_status": response_status or "unknown",
                "provider_http_status": (
                    provider_http_status if isinstance(provider_http_status, int) else 200
                ),
                "segmentation_version": EVIDENCE_SEGMENTATION_VERSION,
                "span_count": span_count,
                "processing_stage": "provider_response_received",
            },
        )

    @staticmethod
    def _contains_refusal(response: Any) -> bool:
        outputs = (
            response.get("output", ())
            if isinstance(response, dict)
            else getattr(response, "output", ())
        )
        for output in outputs or ():
            output_type = (
                output.get("type") if isinstance(output, dict) else getattr(output, "type", None)
            )
            if output_type != "message":
                continue
            content = (
                output.get("content", ())
                if isinstance(output, dict)
                else getattr(output, "content", ())
            )
            for item in content or ():
                item_type = (
                    item.get("type") if isinstance(item, dict) else getattr(item, "type", None)
                )
                if item_type == "refusal":
                    return True
        return False

    @staticmethod
    def _bounded_text(value: object, maximum: int) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = " ".join(value.split())
        return normalized[:maximum] or None

    @classmethod
    def _usage_metadata(cls, usage: object) -> dict[str, object] | None:
        if usage is None:
            return None
        raw = usage.model_dump(mode="json") if hasattr(usage, "model_dump") else usage
        if not isinstance(raw, dict):
            return None
        allowed = {
            key: value
            for key, value in raw.items()
            if key in {"input_tokens", "output_tokens", "total_tokens"}
            and isinstance(value, int)
            and value >= 0
        }
        return allowed or None

    @staticmethod
    def _retry_delay(exc: Exception, attempt: int) -> float:
        response = getattr(exc, "response", None)
        headers = getattr(response, "headers", None)
        if headers is not None:
            raw_retry_after = headers.get("retry-after")
            try:
                retry_after = float(raw_retry_after)
            except (TypeError, ValueError):
                retry_after = 0.0
            if retry_after > 0:
                return min(retry_after, _MAX_RETRY_DELAY_SECONDS)
        return min(0.25 * (2**attempt), _MAX_RETRY_DELAY_SECONDS)

    def _provider_error(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        retryable: bool = False,
        retry_count: int = 0,
        metadata: JobImportProviderMetadata | None = None,
    ) -> JobImportProviderError:
        retained = metadata.metadata if metadata is not None else {}
        return JobImportProviderError(
            code,
            message,
            status_code=status_code,
            retryable=retryable,
            retry_count=retry_count,
            metadata=JobImportProviderMetadata(
                provider_name="openai",
                model_name=self.config.model,
                model_version=(metadata.model_version if metadata else None),
                instruction_version=self.config.instruction_version,
                metadata={
                    **retained,
                    "retry_count": retry_count,
                    "processing_outcome": "failed",
                    "failure_code": code,
                    "segmentation_version": EVIDENCE_SEGMENTATION_VERSION,
                },
            ),
        )

    def _map_openai_error(
        self,
        exc: Exception,
        *,
        retry_count: int,
        elapsed_seconds: float = 0,
        span_count: int = 0,
    ) -> JobImportProviderError:
        if isinstance(exc, (ValidationError, openai.APIResponseValidationError)):
            response = getattr(exc, "response", None)
            headers = getattr(response, "headers", None)
            request_id = (
                headers.get("x-request-id") if headers is not None else None
            ) or getattr(exc, "request_id", None)
            status_code = getattr(response, "status_code", None)
            return self._provider_error(
                "OPENAI_SCHEMA_MISMATCH",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retry_count,
                metadata=JobImportProviderMetadata(
                    provider_name="openai",
                    model_name=self.config.model,
                    instruction_version=self.config.instruction_version,
                    metadata={
                        "request_id": self._bounded_text(request_id, 255),
                        "retry_count": retry_count,
                        "attempt_number": retry_count + 1,
                        "elapsed_ms": max(0, round(elapsed_seconds * 1000)),
                        "provider_http_status": (
                            status_code if isinstance(status_code, int) else None
                        ),
                        "segmentation_version": EVIDENCE_SEGMENTATION_VERSION,
                        "span_count": span_count,
                        "processing_stage": "provider_sdk_parse_validation",
                        "failure_subreason": "provider_sdk_parse_failure",
                    },
                ),
            )
        if isinstance(exc, openai.LengthFinishReasonError):
            return self._provider_error(
                "OPENAI_INCOMPLETE_RESPONSE",
                _UNUSABLE_REPLY_MESSAGE,
                status_code=502,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.ContentFilterFinishReasonError):
            return self._provider_error(
                "OPENAI_REFUSED",
                "The job details could not be read this time.",
                status_code=422,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.AuthenticationError):
            return self._provider_error(
                "OPENAI_AUTHENTICATION_FAILED",
                "Draft preparation is temporarily unavailable.",
                status_code=503,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.PermissionDeniedError):
            return self._provider_error(
                "OPENAI_PERMISSION_DENIED",
                "Draft preparation is temporarily unavailable.",
                status_code=503,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.NotFoundError):
            return self._provider_error(
                "OPENAI_MODEL_UNAVAILABLE",
                "Draft preparation is temporarily unavailable.",
                status_code=503,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.RateLimitError):
            return self._provider_error(
                "OPENAI_RATE_LIMITED",
                "Draft preparation is busy right now. Please retry shortly.",
                status_code=429,
                retryable=True,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.APITimeoutError):
            return self._provider_error(
                "OPENAI_TIMEOUT",
                "Reading the job details took too long. Please retry.",
                status_code=504,
                retryable=True,
                retry_count=retry_count,
            )
        if isinstance(
            exc,
            (openai.APIConnectionError, openai.InternalServerError),
        ):
            return self._provider_error(
                "OPENAI_TEMPORARILY_UNAVAILABLE",
                "Draft preparation is temporarily unavailable. Please retry.",
                status_code=503,
                retryable=True,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.APIStatusError) and exc.status_code >= 500:
            return self._provider_error(
                "OPENAI_TEMPORARILY_UNAVAILABLE",
                "Draft preparation is temporarily unavailable. Please retry.",
                status_code=503,
                retryable=True,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.BadRequestError):
            return self._provider_error(
                "OPENAI_REQUEST_REJECTED",
                "The job details could not be read this time.",
                status_code=502,
                retry_count=retry_count,
            )
        return self._provider_error(
            "OPENAI_REQUEST_FAILED",
            "The job details could not be read this time.",
            status_code=502,
            retry_count=retry_count,
        )
