"""Giving someone a copy of their own data, and nobody else's.

The hard part is not gathering rows. It is the word "their".

A conversation is the obvious trap. It sits in this database attached to a user
id, so a naive export walks the relationship and hands over the whole thread —
including everything the person on the other side wrote. That is not their data.
They were present for it, which is not the same as owning it, and the other
participant never agreed to have their messages posted to somebody's download
folder. So messages are filtered to the ones this person sent.

The second trap is credentials. A row-by-row dump of a user record includes the
password hash, and an export of OAuth records includes provider tokens. Those
are not "their data" in any useful sense either: they are the means of being
them, and putting them in a file that gets emailed, stored in Downloads, and
occasionally forwarded is how an account gets taken over by someone who was
trying to be helpful.

So this builds an explicit structure. Nothing is serialised by reflection over a
model, because reflection exports whatever the model gains next — including the
column somebody adds in six months without thinking about this file.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Message
from app.models.job import Job
from app.models.legal_acceptance import LegalAcceptance
from app.models.marketplace import JobApplication
from app.models.notification_preference import NotificationOptOut
from app.models.portfolio_item import PortfolioItem
from app.models.user import User

#: The export format. Bumped when the shape changes, so a file found on a disk
#: two years from now can say what it is.
EXPORT_VERSION = 1


def _moment(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _account_section(user: User) -> dict[str, Any]:
    """Named fields only.

    A loop over the model's columns would export the password hash today and
    whatever sensitive column is added next — the failure would arrive silently,
    in a file already sent to someone.
    """

    return {
        "id": str(user.id),
        "email": user.email,
        "username": user.username,
        "display_name": user.display_name,
        "headline": user.headline,
        "bio": user.bio,
        "location": user.location,
        "timezone": user.timezone,
        "avatar_url": user.avatar_url,
        "banner_url": user.banner_url,
        "skills": user.skills,
        "public_links": user.public_links,
        "created_at": _moment(user.created_at),
    }


async def build_export(session: AsyncSession, user: User) -> dict[str, Any]:
    """Everything this person owns, in one structure.

    Read-only, and deliberately synchronous in shape: an export that mutates
    anything would make "download my data" a state change, which is exactly what
    someone worried enough to ask for it does not want.
    """

    messages = (
        await session.execute(
            select(Message)
            # Their own words only. The other participant's messages are in the
            # same thread and belong to the other participant.
            .where(Message.sender_user_id == user.id)
            .order_by(Message.created_at)
        )
    ).scalars().all()

    jobs = (
        await session.execute(
            select(Job).where(Job.posted_by_user_id == user.id).order_by(Job.created_at)
        )
    ).scalars().all()

    applications = (
        await session.execute(
            select(JobApplication)
            .where(JobApplication.applicant_user_id == user.id)
            .order_by(JobApplication.created_at)
        )
    ).scalars().all()

    portfolio = (
        await session.execute(
            select(PortfolioItem)
            .where(PortfolioItem.user_id == user.id)
            .order_by(PortfolioItem.created_at)
        )
    ).scalars().all()

    acceptances = (
        await session.execute(
            select(LegalAcceptance)
            .where(LegalAcceptance.user_id == user.id)
            .order_by(LegalAcceptance.accepted_at)
        )
    ).scalars().all()

    opt_outs = (
        await session.execute(
            select(NotificationOptOut).where(NotificationOptOut.user_id == user.id)
        )
    ).scalars().all()

    return {
        "export_version": EXPORT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "account": _account_section(user),
        "messages_you_sent": [
            {
                "id": str(message.id),
                "conversation_id": str(message.conversation_id),
                "body": message.body,
                "created_at": _moment(message.created_at),
            }
            for message in messages
        ],
        "jobs_you_posted": [
            {
                "id": str(job.id),
                "title": job.title,
                "status": job.status,
                "created_at": _moment(job.created_at),
            }
            for job in jobs
        ],
        "applications_you_sent": [
            {
                "id": str(application.id),
                "job_id": str(application.job_id),
                "status": application.status,
                "cover_note": application.cover_note,
                "created_at": _moment(application.created_at),
            }
            for application in applications
        ],
        "portfolio": [
            {
                "id": str(item.id),
                "title": item.title,
                "created_at": _moment(item.created_at),
            }
            for item in portfolio
        ],
        "legal_acceptances": [
            {
                "document": acceptance.document_key,
                "version": acceptance.version,
                "accepted_at": _moment(acceptance.accepted_at),
            }
            for acceptance in acceptances
        ],
        "notification_opt_outs": [opt_out.category for opt_out in opt_outs],
    }


async def build_export_for_user_id(
    session: AsyncSession, user_id: uuid.UUID
) -> dict[str, Any] | None:
    user = await session.get(User, user_id)
    if user is None:
        return None
    return await build_export(session, user)
