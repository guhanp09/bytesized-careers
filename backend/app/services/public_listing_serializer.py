from __future__ import annotations

from app.models import Job, TalentListing, User
from app.schemas.job import JobRead
from app.schemas.marketplace import TalentListingRead


def public_job_read(job: Job) -> JobRead:
    """Return only public job content, excluding hiring configuration and legacy languages."""
    read = JobRead.model_validate(job)
    read.screening_questions = None
    read.languages = []
    read.language_requirements = None
    return read


def public_talent_read(listing: TalentListing, owner: User) -> TalentListingRead:
    read = TalentListingRead.model_validate(listing)
    read.owner_display_name = owner.display_name
    read.owner_username = owner.username
    read.owner_avatar_url = owner.avatar_url
    return read
