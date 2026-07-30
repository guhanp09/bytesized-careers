from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.models import JobImportSource
from app.schemas.job_import import JobImportSourceCreate, JobImportUrlSourceCreate
from app.services.job_import_service import JobImportError, JobImportService
from app.services.job_url_fetcher import PublicJobUrlFetcher, PublicJobUrlFetchError


class JobImportUrlService:
    def __init__(
        self,
        import_service: JobImportService,
        fetcher: PublicJobUrlFetcher,
    ) -> None:
        self.import_service = import_service
        self.fetcher = fetcher

    async def ingest(
        self,
        payload: JobImportUrlSourceCreate,
        *,
        owner_user_id: UUID,
    ) -> JobImportSource:
        entered_url = str(payload.source_url)
        if payload.idempotency_key:
            existing = await self.import_service.repository.get_source_by_request_id(
                owner_user_id,
                payload.idempotency_key,
            )
            if existing is not None:
                if existing.source_type != "public_url" or existing.source_url != entered_url:
                    raise JobImportError(
                        "JOB_IMPORT_IDEMPOTENCY_CONFLICT",
                        "This idempotency key was already used for a different import source.",
                        status_code=409,
                    )
                return existing

        try:
            retrieval = await self.fetcher.fetch(entered_url)
        except PublicJobUrlFetchError as exc:
            raise JobImportError(
                exc.code,
                exc.message,
                status_code=exc.status_code,
            ) from exc

        normalized_payload = JobImportSourceCreate(
            source_type="public_url",
            source_title=payload.source_title or retrieval.title,
            original_text=retrieval.normalized_text,
            source_url=payload.source_url,
            content_type=retrieval.content_type,
            idempotency_key=payload.idempotency_key,
        )
        fingerprint = self.import_service._source_fingerprint(normalized_payload)
        data = normalized_payload.model_dump(
            mode="json",
            exclude={"idempotency_key"},
        )
        data.update(
            {
                "owner_user_id": owner_user_id,
                "content_fingerprint": fingerprint,
                "client_request_id": payload.idempotency_key,
                "final_source_url": retrieval.final_url,
                "retrieved_at": retrieval.retrieved_at,
                "retrieval_metadata": retrieval.metadata,
            }
        )
        try:
            source = await self.import_service.repository.create_source(data)
            await self.import_service.repository.session.commit()
            return source
        except IntegrityError as exc:
            await self.import_service.repository.session.rollback()
            if payload.idempotency_key:
                existing = (
                    await self.import_service.repository.get_source_by_request_id(
                        owner_user_id,
                        payload.idempotency_key,
                    )
                )
                if (
                    existing is not None
                    and existing.source_type == "public_url"
                    and existing.source_url == entered_url
                ):
                    return existing
            raise JobImportError(
                "JOB_IMPORT_SOURCE_CREATE_CONFLICT",
                "The URL import source could not be created because its request conflicts with an existing record.",
                status_code=409,
            ) from exc
