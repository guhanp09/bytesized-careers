from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import JobImportDraft, JobImportField, JobImportSource, Role


class JobImportRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_source(self, data: dict[str, Any]) -> JobImportSource:
        source = JobImportSource(**data)
        self.session.add(source)
        await self.session.flush()
        await self.session.refresh(source)
        return source

    async def get_source_for_owner(
        self,
        source_id: UUID,
        owner_user_id: UUID,
        *,
        include_deleted: bool = False,
        for_update: bool = False,
    ) -> JobImportSource | None:
        query = select(JobImportSource).where(
            JobImportSource.id == source_id,
            JobImportSource.owner_user_id == owner_user_id,
        )
        if not include_deleted:
            query = query.where(JobImportSource.deleted_at.is_(None))
        if for_update:
            query = query.with_for_update()
        return (await self.session.execute(query)).scalar_one_or_none()

    async def get_source_by_request_id(
        self,
        owner_user_id: UUID,
        client_request_id: str,
    ) -> JobImportSource | None:
        query = select(JobImportSource).where(
            JobImportSource.owner_user_id == owner_user_id,
            JobImportSource.client_request_id == client_request_id,
        )
        return (await self.session.execute(query)).scalar_one_or_none()

    async def update_source(
        self,
        source: JobImportSource,
        data: dict[str, Any],
    ) -> JobImportSource:
        for key, value in data.items():
            setattr(source, key, value)
        await self.session.flush()
        await self.session.refresh(source)
        return source

    async def claim_source_mutation(
        self,
        source_id: UUID,
        owner_user_id: UUID,
    ) -> JobImportSource | None:
        result = await self.session.execute(
            update(JobImportSource)
            .where(
                JobImportSource.id == source_id,
                JobImportSource.owner_user_id == owner_user_id,
                JobImportSource.deleted_at.is_(None),
            )
            .values(updated_at=func.now())
            .returning(JobImportSource.id)
        )
        claimed_id = result.scalar_one_or_none()
        if claimed_id is None:
            return None
        return await self.get_source_for_owner(
            claimed_id,
            owner_user_id,
            for_update=True,
        )

    async def create_draft(self, data: dict[str, Any]) -> JobImportDraft:
        draft = JobImportDraft(**data)
        self.session.add(draft)
        await self.session.flush()
        await self.session.refresh(draft)
        return draft

    async def get_draft_for_owner(
        self,
        draft_id: UUID,
        owner_user_id: UUID,
        *,
        include_deleted: bool = False,
        for_update: bool = False,
        refresh: bool = False,
    ) -> JobImportDraft | None:
        query = select(JobImportDraft).where(
            JobImportDraft.id == draft_id,
            JobImportDraft.owner_user_id == owner_user_id,
        )
        if not include_deleted:
            query = query.where(JobImportDraft.deleted_at.is_(None))
        if for_update:
            query = query.with_for_update()
        if refresh:
            # Opt-in for ownership races only. Ordinary repository reads must
            # not overwrite an in-memory mutation that has not been flushed.
            query = query.execution_options(populate_existing=True)
        return (await self.session.execute(query)).scalar_one_or_none()

    async def get_draft_by_request_id(
        self,
        owner_user_id: UUID,
        client_request_id: str,
    ) -> JobImportDraft | None:
        query = select(JobImportDraft).where(
            JobImportDraft.owner_user_id == owner_user_id,
            JobImportDraft.client_request_id == client_request_id,
        )
        return (await self.session.execute(query)).scalar_one_or_none()

    async def get_draft_by_target_job(
        self,
        target_job_id: UUID,
        owner_user_id: UUID,
    ) -> JobImportDraft | None:
        query = select(JobImportDraft).where(
            JobImportDraft.target_job_id == target_job_id,
            JobImportDraft.owner_user_id == owner_user_id,
            JobImportDraft.deleted_at.is_(None),
        )
        return (await self.session.execute(query)).scalar_one_or_none()

    async def list_drafts_for_source(
        self,
        source_id: UUID,
        owner_user_id: UUID,
        *,
        include_deleted: bool = False,
    ) -> list[JobImportDraft]:
        query = select(JobImportDraft).where(
            JobImportDraft.source_id == source_id,
            JobImportDraft.owner_user_id == owner_user_id,
        )
        if not include_deleted:
            query = query.where(JobImportDraft.deleted_at.is_(None))
        query = query.order_by(JobImportDraft.created_at.asc())
        return list((await self.session.execute(query)).scalars().all())

    async def claim_draft_mutation(
        self,
        draft_id: UUID,
        owner_user_id: UUID,
        claim_token: UUID,
        *,
        allowed_statuses: set[str] | None = None,
        require_target_unset: bool = False,
    ) -> JobImportDraft | None:
        """Atomically reserve one draft for a state-changing transaction.

        Unlike ``SELECT .. FOR UPDATE``, the compare-and-set UPDATE also serializes
        writers on SQLite. The caller must clear the token before committing; a
        rollback clears the uncommitted claim automatically.
        """

        conditions = [
            JobImportDraft.id == draft_id,
            JobImportDraft.owner_user_id == owner_user_id,
            JobImportDraft.deleted_at.is_(None),
            JobImportDraft.mutation_claim_token.is_(None),
        ]
        if allowed_statuses is not None:
            conditions.append(JobImportDraft.processing_status.in_(allowed_statuses))
        if require_target_unset:
            conditions.append(JobImportDraft.target_job_id.is_(None))
        result = await self.session.execute(
            update(JobImportDraft)
            .where(*conditions)
            .values(mutation_claim_token=claim_token)
            .returning(JobImportDraft.id)
        )
        claimed_id = result.scalar_one_or_none()
        if claimed_id is None:
            return None
        return await self.get_draft_for_owner(
            claimed_id,
            owner_user_id,
            for_update=True,
        )

    async def update_draft(
        self,
        draft: JobImportDraft,
        data: dict[str, Any],
    ) -> JobImportDraft:
        for key, value in data.items():
            setattr(draft, key, value)
        await self.session.flush()
        await self.session.refresh(draft)
        return draft

    async def create_fields(
        self,
        rows: list[dict[str, Any]],
    ) -> list[JobImportField]:
        fields = [JobImportField(**row) for row in rows]
        self.session.add_all(fields)
        await self.session.flush()
        for field in fields:
            await self.session.refresh(field)
        return fields

    async def list_fields(self, draft_id: UUID) -> list[JobImportField]:
        query = (
            select(JobImportField)
            .where(JobImportField.draft_id == draft_id)
            .order_by(JobImportField.field_path.asc())
        )
        return list((await self.session.execute(query)).scalars().all())

    async def get_field(
        self,
        draft_id: UUID,
        field_path: str,
    ) -> JobImportField | None:
        query = select(JobImportField).where(
            JobImportField.draft_id == draft_id,
            JobImportField.field_path == field_path,
        )
        return (await self.session.execute(query)).scalar_one_or_none()

    async def update_field(
        self,
        field: JobImportField,
        data: dict[str, Any],
    ) -> JobImportField:
        for key, value in data.items():
            setattr(field, key, value)
        await self.session.flush()
        await self.session.refresh(field)
        return field

    async def delete_fields(self, draft_id: UUID) -> None:
        await self.session.execute(
            delete(JobImportField).where(JobImportField.draft_id == draft_id)
        )
        await self.session.flush()

    async def get_active_role_by_key(self, key: str) -> Role | None:
        normalized = key.strip().casefold()
        query = select(Role).where(
            Role.is_active.is_(True),
            func.lower(Role.slug) == normalized,
        )
        return (await self.session.execute(query)).scalar_one_or_none()

    async def list_active_roles(self) -> list[Role]:
        query = select(Role).where(Role.is_active.is_(True)).order_by(Role.name.asc())
        return list((await self.session.execute(query)).scalars().all())
