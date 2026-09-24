from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job, TalentListing, User
from app.repositories.public_visibility import public_job_predicates, public_talent_predicates


class SearchRepository:
    """Read-only candidate loading with the marketplace's public invariants."""

    MAX_CANDIDATES = 1000

    def __init__(self, session: AsyncSession):
        self.session = session

    async def public_job_candidates(self) -> list[Job]:
        rows = (
            await self.session.execute(
                select(Job)
                .where(*public_job_predicates())
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
                .where(*public_talent_predicates())
                .order_by(TalentListing.created_at.desc())
                .limit(self.MAX_CANDIDATES)
            )
        ).all()
        return [(listing, owner) for listing, owner in rows]
