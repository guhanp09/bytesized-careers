"""Who may redeem an invitation, and how many times.

An invite-only beta is only as closed as this file. Each test corresponds to a
way the gate is usually got around: forwarding a code to someone it was not
meant for, using one twice, using one after it lapsed, using one that was
withdrawn, or reading a working code out of the database.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.models.beta_invitation import BetaInvitation
from app.models.user import User
from app.services.beta_invitation_service import (
    InvitationError,
    hash_token,
    invitation_problem,
    issue_invitation,
    normalize_email,
    redeem_invitation,
    revoke_invitation,
)

T0 = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)
INVITEE = "invitee@example.test"


@pytest_asyncio.fixture(autouse=True)
async def _isolate(db_session):
    await db_session.execute(delete(BetaInvitation))
    await db_session.flush()
    yield


@pytest_asyncio.fixture
async def redeemer(db_session) -> User:
    """A real user row.

    `redeemed_user_id` is a foreign key, so redemption cannot be tested with an
    invented uuid — which is the constraint doing its job: the column is meant
    to point at the account the invitation actually created.
    """
    user = User(email=f"redeemer-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add(user)
    await db_session.flush()
    return user


class TestTheTokenIsNotRecoverable:
    async def test_the_raw_token_is_never_stored(self, db_session, redeemer) -> None:
        """A database copy is a second place a working credential can leak from."""
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)

        found = await db_session.execute(select(BetaInvitation))
        row = found.scalar_one()
        assert issued.token not in (row.token_hash or "")
        assert row.token_hash == hash_token(issued.token)

    async def test_two_invitations_get_different_tokens(self, db_session, redeemer) -> None:
        first = await issue_invitation(db_session, email=INVITEE, now=T0)
        second = await issue_invitation(db_session, email="other@example.test", now=T0)

        assert first.token != second.token

    async def test_the_token_is_long_enough_not_to_guess(self, db_session, redeemer) -> None:
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)

        # token_urlsafe(32) is 32 bytes of urandom; the encoded form is longer.
        assert len(issued.token) >= 40


class TestBindingToAnAddress:
    async def test_the_invited_address_may_redeem(self, db_session, redeemer) -> None:
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)

        redeemed = await redeem_invitation(
            db_session, token=issued.token, email=INVITEE, user_id=redeemer.id, now=T0
        )

        assert redeemed.redeemed_at is not None

    async def test_a_forwarded_invitation_is_refused(self, db_session, redeemer) -> None:
        """The failure mode that makes 'invite-only' meaningless if unhandled."""
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)

        with pytest.raises(InvitationError):
            await redeem_invitation(
                db_session,
                token=issued.token,
                email="somebody-else@example.test",
                user_id=redeemer.id,
                now=T0,
            )

    async def test_a_wrong_address_is_not_told_the_code_was_real(self, db_session, redeemer) -> None:
        # "Right code, wrong address" confirms the code exists and hands an
        # attacker half the answer.
        await issue_invitation(db_session, email=INVITEE, now=T0)
        invitation = await db_session.execute(select(BetaInvitation))

        wrong_address = invitation_problem(
            invitation.scalar_one(), email="someone@example.test", now=T0
        )
        unknown_token = invitation_problem(None, email=INVITEE, now=T0)

        assert wrong_address == unknown_token

    @pytest.mark.parametrize(
        "variant", ["INVITEE@EXAMPLE.TEST", "  invitee@example.test  ", "Invitee@Example.Test"]
    )
    async def test_case_and_spacing_do_not_change_the_mailbox(
        self, db_session, redeemer, variant: str
    ) -> None:
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)

        redeemed = await redeem_invitation(
            db_session, token=issued.token, email=variant, user_id=redeemer.id, now=T0
        )

        assert redeemed.redeemed_at is not None

    def test_normalization_is_what_the_comparison_uses(self) -> None:
        assert normalize_email("  Person@Example.COM ") == "person@example.com"


class TestSingleUse:
    async def test_a_redeemed_invitation_cannot_be_used_again(self, db_session, redeemer) -> None:
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)
        await redeem_invitation(
            db_session, token=issued.token, email=INVITEE, user_id=redeemer.id, now=T0
        )

        with pytest.raises(InvitationError, match="already been used"):
            await redeem_invitation(
                db_session,
                token=issued.token,
                email=INVITEE,
                user_id=redeemer.id,
                now=T0 + timedelta(minutes=1),
            )

    async def test_redemption_records_who_used_it(self, db_session, redeemer) -> None:
        # Recorded fact, so a second attempt is refused by data rather than by
        # whatever the previous request happened to leave behind.
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)

        redeemed = await redeem_invitation(
            db_session, token=issued.token, email=INVITEE, user_id=redeemer.id, now=T0
        )

        assert redeemed.redeemed_user_id == redeemer.id


class TestExpiry:
    async def test_an_expired_invitation_is_refused(self, db_session, redeemer) -> None:
        issued = await issue_invitation(db_session, email=INVITEE, expires_in_days=1, now=T0)

        with pytest.raises(InvitationError, match="expired"):
            await redeem_invitation(
                db_session,
                token=issued.token,
                email=INVITEE,
                user_id=redeemer.id,
                now=T0 + timedelta(days=1, seconds=1),
            )

    async def test_it_is_still_valid_just_before_expiry(self, db_session, redeemer) -> None:
        issued = await issue_invitation(db_session, email=INVITEE, expires_in_days=1, now=T0)

        redeemed = await redeem_invitation(
            db_session,
            token=issued.token,
            email=INVITEE,
            user_id=redeemer.id,
            now=T0 + timedelta(hours=23),
        )

        assert redeemed.redeemed_at is not None


class TestRevocation:
    async def test_a_revoked_invitation_is_refused(self, db_session, redeemer) -> None:
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)

        await revoke_invitation(db_session, issued.invitation.id, reason="sent in error", now=T0)

        with pytest.raises(InvitationError, match="withdrawn"):
            await redeem_invitation(
                db_session,
                token=issued.token,
                email=INVITEE,
                user_id=redeemer.id,
                now=T0 + timedelta(minutes=1),
            )

    async def test_revocation_keeps_the_reason(self, db_session, redeemer) -> None:
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)

        await revoke_invitation(db_session, issued.invitation.id, reason="wrong address", now=T0)

        assert issued.invitation.revoked_reason == "wrong address"

    async def test_revoking_a_redeemed_invitation_changes_nothing(self, db_session, redeemer) -> None:
        # It would imply the account it created is somehow un-created, which
        # this does not do and should not pretend to.
        issued = await issue_invitation(db_session, email=INVITEE, now=T0)
        await redeem_invitation(
            db_session, token=issued.token, email=INVITEE, user_id=redeemer.id, now=T0
        )

        await revoke_invitation(db_session, issued.invitation.id, reason="too late", now=T0)

        assert issued.invitation.revoked_at is None


class TestUnknownTokens:
    async def test_a_token_that_was_never_issued_is_refused(self, db_session, redeemer) -> None:
        with pytest.raises(InvitationError):
            await redeem_invitation(
                db_session,
                token="not-a-real-token",
                email=INVITEE,
                user_id=redeemer.id,
                now=T0,
            )

    async def test_an_empty_token_is_refused(self, db_session, redeemer) -> None:
        with pytest.raises(InvitationError):
            await redeem_invitation(
                db_session, token="", email=INVITEE, user_id=redeemer.id, now=T0
            )
