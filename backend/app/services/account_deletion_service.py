"""Asking for an account to be deleted, and what happens the moment you do.

The instinct is to delete the row. It is the wrong instinct, and not because
deletion is scary: a person's account is entangled with other people's records.
Their messages are half of somebody else's conversation. Their application is a
decision a recruiter is in the middle of making. Erasing all of it inside the
request that asked for it resolves every one of those questions silently, in
whatever way the query happened to be written, and irreversibly.

So the request is recorded, and three things happen straight away because they
are the parts the person actually asked for and none of them destroys anything:

* they stop being visible to other people;
* their sessions are revoked, so a stolen laptop cannot keep using the account
  during whatever window follows;
* the request itself is on the record, so nothing depends on someone
  remembering.

What is erased and after how long is NOT decided here. That is a legal and
product question — retention obligations, dispute windows, fraud investigation —
and inventing a number would be worse than leaving it open, because a wrong
number looks exactly like a right one.

Cancelling exists because people change their minds, and the window in which
that is possible is precisely the window this request describes.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account_deletion import AccountDeletionRequest
from app.models.user import User
from app.repositories.auth_repository import AuthRepository


async def revoke_auth_sessions_for_user(
    session: AsyncSession, *, user_id: uuid.UUID, revoked_at: datetime, reason: str
) -> int:
    """Reuse the existing revocation rather than writing a second one.

    Two implementations of "end every session" drift, and the weaker one becomes
    the way an ended session keeps working.
    """

    return await AuthRepository(session).revoke_auth_sessions_for_user(
        user_id=user_id, revoked_at=revoked_at, reason=reason
    )


REQUESTED = "requested"
CANCELLED = "cancelled"
COMPLETED = "completed"


class AccountDeletionError(Exception):
    """The request cannot be made or changed in this state."""


async def open_request(
    session: AsyncSession, user_id: uuid.UUID
) -> AccountDeletionRequest | None:
    """The outstanding request for this account, if there is one."""

    found = await session.execute(
        select(AccountDeletionRequest)
        .where(AccountDeletionRequest.user_id == user_id)
        .where(AccountDeletionRequest.status == REQUESTED)
        .order_by(AccountDeletionRequest.requested_at.desc())
    )
    return found.scalars().first()


async def request_deletion(
    session: AsyncSession,
    user: User,
    *,
    reason: str | None = None,
    now: datetime | None = None,
) -> AccountDeletionRequest:
    """Record the request and make the immediate part of it true.

    Asking twice returns the existing request rather than opening a second one.
    Two open requests for one account would mean two answers to "when does this
    happen", and the person asking again is repeating themselves, not asking for
    something new.
    """

    moment = now or datetime.now(UTC)

    existing = await open_request(session, user.id)
    if existing is not None:
        return existing

    request = AccountDeletionRequest(
        user_id=user.id,
        status=REQUESTED,
        reason=(reason or "").strip()[:2000] or None,
        requested_at=moment,
    )
    session.add(request)

    # Hidden immediately, in this lifecycle's OWN column. It was once written to
    # `suspended_at`, and the collision was not theoretical: the suspend endpoint
    # refuses an already-suspended account, so requesting deletion made an
    # account impossible for an administrator to suspend. Asking to be deleted
    # must not be a way to become un-moderatable.
    #
    # Nothing here reads or writes suspension state at all. An administrator's
    # decision is theirs; this is the account holder's.
    user.deletion_hidden_at = moment

    # Every existing login is ended. Between asking and completing there is a
    # window, and a session that survives it is a stolen laptop still using an
    # account whose owner has said they are done with it.
    await revoke_auth_sessions_for_user(
        session, user_id=user.id, revoked_at=moment, reason="account_deletion_requested"
    )

    await session.flush()
    return request


async def cancel_request(
    session: AsyncSession,
    user: User,
    *,
    now: datetime | None = None,
) -> AccountDeletionRequest:
    """Change your mind, and become visible again.

    Only an outstanding request can be cancelled. A completed one cannot be
    undone by this or anything else, and pretending otherwise would be the most
    misleading possible thing to tell someone about their own data.
    """

    moment = now or datetime.now(UTC)
    request = await open_request(session, user.id)
    if request is None:
        raise AccountDeletionError("There is no outstanding deletion request.")

    request.status = CANCELLED
    request.cancelled_at = moment

    # Only this lifecycle's own state is cleared. An account an administrator
    # suspended stays suspended: cancelling a deletion request is not a route
    # out of a suspension, and the two decisions belong to different people.
    user.deletion_hidden_at = None

    await session.flush()
    return request
