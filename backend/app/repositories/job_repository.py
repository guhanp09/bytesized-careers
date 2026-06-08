from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import String, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import HiringIdentity, Job
from app.models.user import User
from app.models.user_youtube_channel import UserYouTubeChannel
from app.models.youtube_channel import YouTubeChannel


class JobRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    def _base_query(self):
        return select(Job).where(Job.deleted_at.is_(None))

    async def list_jobs(
        self,
        *,
        limit: int,
        offset: int,
        q: str | None = None,
        platform: str | None = None,
        location: str | None = None,
        start_timeframe: str | None = None,
        status: str | None = None,
    ) -> tuple[list[Job], int]:
        query = self._base_query()

        if q:
            term = f"%{q.lower()}%"
            query = query.where(func.lower(Job.title).like(term))

        if platform:
            bind = self.session.get_bind()
            dialect_name = bind.dialect.name if bind is not None else ""
            if dialect_name == "postgresql":
                query = query.where(Job.platforms.contains([platform]))
            else:
                query = query.where(func.lower(Job.platforms.cast(String)).like(f"%{platform.lower()}%"))

        if location:
            query = query.where(func.lower(Job.location).like(f"%{location.lower()}%"))

        if start_timeframe:
            query = query.where(Job.start_timeframe == start_timeframe)

        if status:
            query = query.where(Job.status == status)

        count_stmt = select(func.count()).select_from(query.order_by(None).subquery())
        total = int((await self.session.execute(count_stmt)).scalar_one())

        list_stmt = query.order_by(Job.created_at.desc()).limit(limit).offset(offset)
        items = (await self.session.execute(list_stmt)).scalars().all()
        return list(items), total

    async def get_by_id(self, job_id: UUID) -> Job | None:
        stmt = self._base_query().where(Job.id == job_id)
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
