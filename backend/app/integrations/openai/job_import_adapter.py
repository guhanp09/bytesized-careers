from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import openai
from openai import AsyncOpenAI
from pydantic import ValidationError

from app.integrations.openai.job_import_evidence import EvidenceAnchoringError
from app.integrations.openai.job_import_instructions import (
    build_job_import_instructions,
)
from app.integrations.openai.job_import_output import (
    OpenAIJobImportExtractionResponse,
)
from app.schemas.job_import import (
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
                "Text extraction is temporarily unavailable because OpenAI is not configured.",
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
        if request.source.source_type not in {
            "pasted_text",
            "rough_description",
            "external_listing_text",
        } or not source_text:
            raise self._provider_error(
                "JOB_IMPORT_TEXT_SOURCE_REQUIRED",
                "OpenAI processing currently supports normalized text sources only.",
                status_code=422,
            )

        client = self._client_or_error()
        response: Any | None = None
        retries_used = 0
        request_started = time.perf_counter()
        provider_input = self._provider_input(request, source_text=source_text)
        for attempt in range(self.config.max_retries + 1):
            try:
                response = await client.responses.parse(
                    model=self.config.model,
                    instructions=build_job_import_instructions(
                        version=self.config.instruction_version
                    ),
                    input=provider_input,
                    text_format=OpenAIJobImportExtractionResponse,
                    max_output_tokens=OPENAI_MAX_OUTPUT_TOKENS,
                    store=False,
                )
                retries_used = attempt
                break
            except Exception as exc:
                mapped = self._map_openai_error(exc, retry_count=attempt)
                if not mapped.retryable or attempt >= self.config.max_retries:
                    raise mapped from exc
                retries_used = attempt + 1
                await self._sleep(self._retry_delay(exc, attempt))

        if response is None:
            raise self._provider_error(
                "OPENAI_EMPTY_RESPONSE",
                "OpenAI returned no extraction response.",
                status_code=502,
                retry_count=retries_used,
            )
        response_metadata = self._response_metadata(
            response,
            retries_used=retries_used,
            elapsed_seconds=time.perf_counter() - request_started,
        )
        if getattr(response, "status", None) != "completed":
            raise self._provider_error(
                "OPENAI_INCOMPLETE_RESPONSE",
                "OpenAI did not complete the extraction response.",
                status_code=502,
                retry_count=retries_used,
                metadata=response_metadata,
            )
        if self._contains_refusal(response):
            raise self._provider_error(
                "OPENAI_REFUSED",
                "OpenAI declined to process this source.",
                status_code=422,
                retry_count=retries_used,
                metadata=response_metadata,
            )

        parsed = getattr(response, "output_parsed", None)
        if parsed is None:
            raise self._provider_error(
                "OPENAI_MALFORMED_RESPONSE",
                "OpenAI returned an unreadable extraction response.",
                status_code=502,
                retry_count=retries_used,
                metadata=response_metadata,
            )
        try:
            wire_response = (
                parsed
                if isinstance(parsed, OpenAIJobImportExtractionResponse)
                else OpenAIJobImportExtractionResponse.model_validate(parsed)
            )
            extraction = wire_response.to_domain_response(
                canonical_source=source_text,
            )
        except EvidenceAnchoringError as exc:
            evidence_metadata = response_metadata.model_copy(
                update={
                    "metadata": {
                        **response_metadata.metadata,
                        "evidence_failure_reason": exc.reason,
                    }
                }
            )
            raise self._provider_error(
                "OPENAI_EVIDENCE_INVALID",
                "OpenAI returned evidence that could not be anchored to the normalized text source.",
                status_code=502,
                retry_count=retries_used,
                metadata=evidence_metadata,
            ) from exc
        except (ValidationError, ValueError) as exc:
            raise self._provider_error(
                "OPENAI_SCHEMA_MISMATCH",
                "OpenAI returned an extraction response that failed CreatorJobs validation.",
                status_code=502,
                retry_count=retries_used,
                metadata=response_metadata,
            ) from exc

        return JobImportProviderResult(
            extraction=extraction,
            metadata=response_metadata,
        )

    @staticmethod
    def _provider_input(
        request: JobImportExtractionRequest,
        *,
        source_text: str,
    ) -> list[dict[str, object]]:
        policy_request = request.model_copy(deep=True)
        policy_request.source.original_text = None
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "CreatorJobs extraction policy JSON. The canonical source "
                            "is the next input-text block.\n"
                            f"{policy_request.model_dump_json()}"
                        ),
                    },
                    {"type": "input_text", "text": source_text},
                ],
            }
        ]

    def _response_metadata(
        self,
        response: object,
        *,
        retries_used: int,
        elapsed_seconds: float,
    ) -> JobImportProviderMetadata:
        response_status = self._bounded_text(getattr(response, "status", None), 40)
        return JobImportProviderMetadata(
            provider_name="openai",
            model_name=self.config.model,
            model_version=self._bounded_text(getattr(response, "model", None), 80),
            instruction_version=self.config.instruction_version,
            metadata={
                "request_id": self._bounded_text(
                    getattr(response, "_request_id", None),
                    255,
                ),
                "usage": self._usage_metadata(getattr(response, "usage", None)),
                "retry_count": retries_used,
                "attempt_number": retries_used + 1,
                "elapsed_ms": max(0, round(elapsed_seconds * 1000)),
                "response_status": response_status or "unknown",
            },
        )

    @staticmethod
    def _contains_refusal(response: Any) -> bool:
        for output in getattr(response, "output", ()) or ():
            if getattr(output, "type", None) != "message":
                continue
            for item in getattr(output, "content", ()) or ():
                if getattr(item, "type", None) == "refusal":
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
                },
            ),
        )

    def _map_openai_error(
        self,
        exc: Exception,
        *,
        retry_count: int,
    ) -> JobImportProviderError:
        if isinstance(exc, (ValidationError, openai.APIResponseValidationError)):
            return self._provider_error(
                "OPENAI_SCHEMA_MISMATCH",
                "OpenAI returned an extraction response that failed CreatorJobs validation.",
                status_code=502,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.LengthFinishReasonError):
            return self._provider_error(
                "OPENAI_INCOMPLETE_RESPONSE",
                "OpenAI did not complete the extraction response.",
                status_code=502,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.ContentFilterFinishReasonError):
            return self._provider_error(
                "OPENAI_REFUSED",
                "OpenAI declined to process this source.",
                status_code=422,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.AuthenticationError):
            return self._provider_error(
                "OPENAI_AUTHENTICATION_FAILED",
                "OpenAI authentication failed. Text extraction is temporarily unavailable.",
                status_code=503,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.PermissionDeniedError):
            return self._provider_error(
                "OPENAI_PERMISSION_DENIED",
                "The configured OpenAI project cannot use this extraction model.",
                status_code=503,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.NotFoundError):
            return self._provider_error(
                "OPENAI_MODEL_UNAVAILABLE",
                "The configured OpenAI extraction model is unavailable.",
                status_code=503,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.RateLimitError):
            return self._provider_error(
                "OPENAI_RATE_LIMITED",
                "OpenAI is rate limiting text extraction. Please retry shortly.",
                status_code=429,
                retryable=True,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.APITimeoutError):
            return self._provider_error(
                "OPENAI_TIMEOUT",
                "OpenAI text extraction timed out. Please retry.",
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
                "OpenAI text extraction is temporarily unavailable. Please retry.",
                status_code=503,
                retryable=True,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.APIStatusError) and exc.status_code >= 500:
            return self._provider_error(
                "OPENAI_TEMPORARILY_UNAVAILABLE",
                "OpenAI text extraction is temporarily unavailable. Please retry.",
                status_code=503,
                retryable=True,
                retry_count=retry_count,
            )
        if isinstance(exc, openai.BadRequestError):
            return self._provider_error(
                "OPENAI_REQUEST_REJECTED",
                "OpenAI rejected the server-owned extraction request.",
                status_code=502,
                retry_count=retry_count,
            )
        return self._provider_error(
            "OPENAI_REQUEST_FAILED",
            "OpenAI text extraction failed.",
            status_code=502,
            retry_count=retry_count,
        )
