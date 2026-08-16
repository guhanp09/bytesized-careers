"""Issuing and redeeming beta invitations.

The one rule worth stating plainly: an invitation is checked here, on the
server, against the address it was issued to. Every weaker arrangement has an
obvious hole — a client-side check is not a check, a code not bound to an
address gets forwarded, and a code that survives redemption gets reused.

Tokens are generated with `secrets`, returned once to the caller, and stored
only as a SHA-256 hash. Nothing in this module can recover a token, which is the
point: an admin screen, a log line, or a database backup cannot leak what is not
there. Lookup by hash is exact, so no scan is needed and no timing signal is
leaked by comparing candidates one at a time.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.beta_invitation import BetaInvitation

#: Long enough that guessing is not a strategy: 32 bytes of urandom.
TOKEN_BYTES = 32

DEFAULT_EXPIRY_DAYS = 14


class InvitationError(Exception):
    """An invitation that may not be redeemed."""


def normalize_email(value: str) -> str:
    """Addresses are compared casefolded and trimmed.

    Without this an invitation to `Person@Example.com` is not redeemable by
    `person@example.com`, which is the same mailbox and the same person.
    """

    return value.strip().casefold()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class IssuedInvitation:
    """The one moment the raw token exists outside an email."""

    invitation: BetaInvitation
    token: str


async def issue_invitation(
    session: AsyncSession,
    *,
    email: str,
    invited_by_user_id: uuid.UUID | None = None,
    expires_in_days: int = DEFAULT_EXPIRY_DAYS,
    now: datetime | None = None,
) -> IssuedInvitation:
    """Create an invitation and return its token exactly once.

    The token is not stored and cannot be retrieved afterwards. A caller that
    loses it must issue a new invitation — which is the correct outcome, because
    the alternative is a system that can hand out working credentials on demand.
    """

    moment = now or _now()
    token = secrets.token_urlsafe(TOKEN_BYTES)
    invitation = BetaInvitation(
        email=normalize_email(email),
        token_hash=hash_token(token),
        expires_at=moment + timedelta(days=expires_in_days),
        invited_by_user_id=invited_by_user_id,
    )
    session.add(invitation)
    await session.flush()
    return IssuedInvitation(invitation=invitation, token=token)


async def find_by_token(session: AsyncSession, token: str) -> BetaInvitation | None:
    found = await session.execute(
        select(BetaInvitation).where(BetaInvitation.token_hash == hash_token(token))
    )
    return found.scalar_one_or_none()


def invitation_problem(
    invitation: BetaInvitation | None,
    *,
    email: str,
    now: datetime | None = None,
) -> str | None:
    """Why this invitation may not be redeemed, or `None` if it may.

    Pure and separate from the database so the rules can be read in one place and
    tested without fixtures. The order matters only for the message; every
    condition is checked.
    """

    moment = now or _now()

    if invitation is None:
        return "This invitation is not valid."
    if invitation.revoked_at is not None:
        return "This invitation was withdrawn."
    if invitation.redeemed_at is not None:
        return "This invitation has already been used."
    expires_at = invitation.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        # SQLite loses tzinfo on timezone-aware columns; the instant is right.
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at is not None and expires_at <= moment:
        return "This invitation has expired."
    if normalize_email(invitation.email) != normalize_email(email):
        # Deliberately the same wording as an unknown token. Telling a caller
        # "right code, wrong address" confirms that the code is real and hands
        # them half the answer.
        return "This invitation is not valid."
    return None


async def redeem_invitation(
    session: AsyncSession,
    *,
    token: str,
    email: str,
    user_id: uuid.UUID,
    now: datetime | None = None,
) -> BetaInvitation:
    """Consume an invitation for a specific address, or refuse.

    Raises `InvitationError` with a message safe to show the caller. Success
    records who redeemed it and when, so a second attempt is refused by stored
    fact rather than by whatever the previous request happened to leave behind.
    """

    moment = now or _now()
    invitation = await find_by_token(session, token)

    problem = invitation_problem(invitation, email=email, now=moment)
    if problem is not None:
        raise InvitationError(problem)

    assert invitation is not None  # narrowed by invitation_problem

    # Single use is enforced by the WRITE, not by the read above. Reading
    # "not yet redeemed" and then writing is two steps, and two requests
    # carrying the same token can both pass the read before either writes —
    # which is exactly how a one-use code gets used twice. The `redeemed_at IS
    # NULL` predicate moves the decision into the statement, so the database
    # picks one winner and the loser gets no row back.
    claimed = await session.execute(
        update(BetaInvitation)
        .where(BetaInvitation.id == invitation.id)
        .where(BetaInvitation.redeemed_at.is_(None))
        .where(BetaInvitation.revoked_at.is_(None))
        .values(redeemed_at=moment, redeemed_user_id=user_id)
        .returning(BetaInvitation.id)
        .execution_options(synchronize_session=False)
    )
    if claimed.scalar_one_or_none() is None:
        raise InvitationError("This invitation has already been used.")

    # `synchronize_session=False` leaves the in-memory copy stale, and the
    # caller is handed this object. Refresh so what it reads is what was
    # written, rather than the snapshot from before the update.
    await session.refresh(invitation)
    return invitation


async def revoke_invitation(
    session: AsyncSession,
    invitation_id: uuid.UUID,
    *,
    reason: str,
    now: datetime | None = None,
) -> None:
    """Withdraw an unredeemed invitation.

    A redeemed one is left alone: revoking it would imply the account it created
    is somehow un-created, which this does not do and should not pretend to.
    """

    moment = now or _now()
    found = await session.execute(
        select(BetaInvitation).where(BetaInvitation.id == invitation_id)
    )
    invitation = found.scalar_one_or_none()
    if invitation is None or invitation.redeemed_at is not None:
        return
    invitation.revoked_at = moment
    invitation.revoked_reason = reason
    await session.flush()


async def require_invitation_for_signup(
    session: AsyncSession,
    *,
    email: str,
    token: str | None,
    now: datetime | None = None,
) -> BetaInvitation | None:
    """The gate every signup path goes through.

    One function rather than a check at each call site, because two copies of an
    access rule drift and the weaker one becomes the way in. Both the password
    and the Google paths call this before an account exists.

    Returns the invitation that was accepted, so the caller can mark it redeemed
    once it knows the user id. Returns `None` when the beta gate is off, which
    is the only case where a missing token is acceptable.
    """

    from app.core.config import settings

    if not settings.invite_only_beta:
        return None

    if not token:
        raise InvitationError("An invitation is required to create an account right now.")

    invitation = await find_by_token(session, token)
    problem = invitation_problem(invitation, email=email, now=now)
    if problem is not None:
        raise InvitationError(problem)
    return invitation
