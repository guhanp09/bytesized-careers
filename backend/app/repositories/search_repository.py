from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job, TalentListing, User


class SearchRepository:
    """Read-only candidate loading with the marketplace's public invariants."""

    MAX_CANDIDATES = 1000

    def __init__(self, session: AsyncSession):
        self.session = session

    async def public_job_candidates(self) -> list[Job]:
        suspended_owner = (
            select(User.id)
            .where(User.id == Job.posted_by_user_id, User.suspended_at.isnot(None))
            .exists()
        )
        rows = (
            await self.session.execute(
                select(Job)
                .where(
                    Job.status == "published",
                    Job.deleted_at.is_(None),
                    ~suspended_owner,
                )
                .order_by(Job.created_at.desc())
                .limit(self.MAX_CANDIDATES)
            )
        ).scalars().all()
        return list(rows)

    async def public_talent_candidates(self) -> list[tuple[TalentListing, User]]:
        rows = (
            await self.session.execute(
                select(TalentListing, User)
                .join(User, TalentListing.owner_user_id == User.id)
                .where(
                    TalentListing.status.in_(("published", "featured")),
                    TalentListing.deleted_at.is_(None),
                    User.suspended_at.is_(None),
                )
                .order_by(TalentListing.created_at.desc())
                .limit(self.MAX_CANDIDATES)
            )
        ).all()
        return [(listing, owner) for listing, owner in rows]
