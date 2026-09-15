from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Protocol

from app.schemas.job_import import (
    JobImportExtractionRequest,
    JobImportExtractionResponse,
    JobImportProviderMetadata,
)


@dataclass(frozen=True)
class JobImportProviderResult:
    """Validated provider output plus bounded private audit metadata."""

    extraction: JobImportExtractionResponse
    metadata: JobImportProviderMetadata


class JobImportExtractionProvider(Protocol):
    """CreatorJobs-owned boundary implemented by provider-specific adapters."""

    async def extract(
        self,
        request: JobImportExtractionRequest,
    ) -> JobImportProviderResult: ...


class JobImportProviderError(Exception):
    """Safe provider failure that can cross into import orchestration."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        retryable: bool = False,
        retry_count: int = 0,
        metadata: JobImportProviderMetadata | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        self.retry_count = retry_count
        self.metadata = metadata


async def extract_with_budget(
    provider: JobImportExtractionProvider,
    request: JobImportExtractionRequest,
    *,
    budget_seconds: float,
) -> JobImportProviderResult:
    """Bound the entire provider operation, including retries and streaming.

    No database work runs inside this scope. Caller cancellation and a provider's
    own timeout keep their identity; only this timer becomes a safe budget error.
    """
    deadline = asyncio.timeout(budget_seconds)
    try:
        async with deadline:
            result = await provider.extract(request)
    except TimeoutError:
        if not deadline.expired():
            raise
    else:
        if not deadline.expired():
            return result
        # A provider may catch cancellation and return a late result. It is
        # still out of budget and must never become a completed draft.
    raise JobImportProviderError(
        "JOB_IMPORT_PROCESSING_TIMEOUT",
        "Draft preparation took too long. Your source is saved; you can retry.",
        status_code=504,
    ) from None
