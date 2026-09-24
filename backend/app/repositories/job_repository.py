from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import String, case, cast, func, literal, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import HiringIdentity, Job, Role
from app.models.user import User
from app.models.user_youtube_channel import UserYouTubeChannel
from app.models.youtube_channel import YouTubeChannel
from app.repositories.public_visibility import public_job_predicates


class JobRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    def _public_query(self):
        return select(Job).where(*public_job_predicates())

    @staticmethod
    def _escaped_like(value: str) -> str:
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    @classmethod
    def _json_string_member(cls, column: Any, value: str):
        # Matching the JSON-encoded string, including its quotes, keeps values
        # exact ("short" does not match "shorts") while remaining portable
        # across SQLite JSON text and PostgreSQL JSONB text casts.
        encoded = json.dumps(value.casefold(), ensure_ascii=False)
        pattern = f"%{cls._escaped_like(encoded)}%"
        return func.lower(column.cast(String)).like(pattern, escape="\\")

    @classmethod
    def _json_string_members(cls, column: Any, values: list[str]):
        return or_(*(cls._json_string_member(column, value) for value in values))

    def _required_language_match(self, values: list[str]):
        bind = self.session.get_bind()
        dialect_name = bind.dialect.name if bind is not None else ""

        if dialect_name == "postgresql":
            safe_array = case(
                (
                    func.jsonb_typeof(Job.language_requirements) == "array",
                    Job.language_requirements,
                ),
                else_=cast(literal("[]"), JSONB),
            )
            entries = (
                func.jsonb_array_elements(safe_array)
                .table_valued("value")
                .alias("required_language_entry")
            )
            language_value = func.lower(
                func.jsonb_extract_path_text(entries.c.value, "language")
            )
            priority_value = func.jsonb_extract_path_text(entries.c.value, "priority")
        else:
            safe_array = case(
                (func.json_type(Job.language_requirements) == "array", Job.language_requirements),
                else_=literal("[]"),
            )
            entries = (
                func.json_each(safe_array)
                .table_valued("key", "value")
                .alias("required_language_entry")
            )
            language_value = func.lower(func.json_extract(entries.c.value, "$.language"))
            priority_value = func.json_extract(entries.c.value, "$.priority")

        canonical_required = (
            select(1)
            .select_from(entries)
            .where(language_value.in_(values), priority_value == "required")
            .correlate(Job)
            .exists()
        )
        canonical_missing = or_(
            Job.language_requirements.is_(None),
            func.lower(Job.language_requirements.cast(String)) == "null",
        )
        legacy_required = self._json_string_members(Job.languages, values)
        return or_(canonical_required, canonical_missing & legacy_required)

    async def list_public_jobs(
        self,
        *,
        limit: int,
        offset: int,
        q: str | None = None,
        role_slugs: list[str] | None = None,
        platforms: list[str] | None = None,
        formats: list[str] | None = None,
        work_modes: list[str] | None = None,
        engagement_types: list[str] | None = None,
        budget_units: list[str] | None = None,
        required_languages: list[str] | None = None,
        location: str | None = None,
        start_timeframe: str | None = None,
    ) -> tuple[list[Job], int]:
        query = self._public_query()

        if q:
            term = f"%{q.lower()}%"
            query = query.where(
                or_(
                    func.lower(Job.title).like(term),
                    func.lower(Job.category).like(term),
                    func.lower(Job.primary_role_name_snapshot).like(term),
                    func.lower(Job.role_specialization).like(term),
                    func.lower(Job.about_channel).like(term),
                    func.lower(Job.platforms.cast(String)).like(term),
                    func.lower(Job.tags.cast(String)).like(term),
                    func.lower(Job.content_niches.cast(String)).like(term),
                    func.lower(Job.content_genres.cast(String)).like(term),
                    func.lower(Job.formats_hired_for.cast(String)).like(term),
                    func.lower(Job.required_tool_keys.cast(String)).like(term),
                    func.lower(Job.other_required_tools.cast(String)).like(term),
                    func.lower(Job.required_skill_keys.cast(String)).like(term),
                    func.lower(Job.other_required_skills.cast(String)).like(term),
                )
            )

        if role_slugs:
            role_ids = select(Role.id).where(func.lower(Role.slug).in_(role_slugs))
            query = query.where(Job.primary_role_id.in_(role_ids))

        if platforms:
            query = query.where(self._json_string_members(Job.platforms, platforms))

        if formats:
            query = query.where(self._json_string_members(Job.formats_hired_for, formats))

        if work_modes:
            query = query.where(func.lower(Job.work_mode).in_(work_modes))

        if engagement_types:
            query = query.where(func.lower(Job.engagement_type).in_(engagement_types))

        if budget_units:
            query = query.where(func.lower(Job.budget_unit).in_(budget_units))

        if required_languages:
            query = query.where(self._required_language_match(required_languages))

        if location:
            query = query.where(func.lower(Job.location).like(f"%{location.lower()}%"))

        if start_timeframe:
            query = query.where(Job.start_timeframe == start_timeframe)

        count_stmt = select(func.count()).select_from(query.order_by(None).subquery())
        total = int((await self.session.execute(count_stmt)).scalar_one())

        list_stmt = query.order_by(Job.created_at.desc()).limit(limit).offset(offset)
        items = (await self.session.execute(list_stmt)).scalars().all()
        return list(items), total

    async def get_public_by_id(self, job_id: UUID) -> Job | None:
        stmt = self._public_query().where(Job.id == job_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_by_id_internal(self, job_id: UUID) -> Job | None:
        stmt = select(Job).where(Job.id == job_id, Job.deleted_at.is_(None))
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_active_role_by_id(self, role_id: UUID) -> Role | None:
        stmt = select(Role).where(Role.id == role_id, Role.is_active.is_(True))
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_user_by_id(self, user_id: UUID) -> User | None:
        stmt = select(User).where(User.id == user_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_hiring_identity_for_user(
        self, *, user_id: UUID, identity_id: UUID
    ) -> HiringIdentity | None:
        stmt = select(HiringIdentity).where(
            HiringIdentity.owner_user_id == user_id,
            HiringIdentity.id == identity_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_hiring_identities_for_user(
        self, *, user_id: UUID
    ) -> list[HiringIdentity]:
        stmt = (
            select(HiringIdentity)
            .where(HiringIdentity.owner_user_id == user_id)
            .order_by(HiringIdentity.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def create(self, data: dict[str, Any]) -> Job:
        job = Job(**data)
        self.session.add(job)
        await self.session.flush()
        await self.session.refresh(job)
        return job

    async def update(self, job: Job, data: dict[str, Any]) -> Job:
        for key, value in data.items():
            setattr(job, key, value)
        await self.session.flush()
        await self.session.refresh(job)
        return job

    async def soft_delete(self, job: Job) -> Job:
        job.deleted_at = datetime.now(UTC)
        job.status = "archived"
        await self.session.flush()
        await self.session.refresh(job)
        return job

    async def user_has_youtube_channel(self, *, user_id: UUID, channel_id: str) -> bool:
        stmt = (
            select(UserYouTubeChannel.user_id)
            .join(YouTubeChannel, UserYouTubeChannel.youtube_channel_id == YouTubeChannel.id)
            .where(UserYouTubeChannel.user_id == user_id, YouTubeChannel.channel_id == channel_id)
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
