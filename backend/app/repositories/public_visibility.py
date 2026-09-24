"""Shared SQL eligibility for public marketplace reads (not private history)."""

from sqlalchemy import select
from sqlalchemy.sql.elements import ColumnElement

from app.core.account_state import active_account_clause
from app.models import Job, TalentListing, User


def public_job_predicates() -> tuple[ColumnElement[bool], ...]:
    blocked_owner = (
        select(User.id)
        .where(User.id == Job.posted_by_user_id, ~active_account_clause(User))
        .exists()
    )
    # Preserve the existing legacy ownerless-job contract. This is not the
    # predicate for new applications, which requires a present active owner.
    return Job.status == "published", Job.deleted_at.is_(None), ~blocked_owner


def public_talent_predicates() -> tuple[ColumnElement[bool], ...]:
    """For reads joining TalentListing to its User owner."""
    return (
        TalentListing.status.in_(("published", "featured")),
        TalentListing.deleted_at.is_(None),
        active_account_clause(User),
    )
