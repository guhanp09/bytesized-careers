from __future__ import annotations

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
