"""Giving someone their data, and nobody else's.

Two failures matter here and neither announces itself.

A conversation sits in this database attached to a user id, so the obvious
export walks the relationship and hands over the whole thread — including
everything the other person wrote. They were present for those messages, which
is not the same as owning them, and the counterparty never agreed to appear in
somebody's download folder.

And a row-by-row dump of an account includes the password hash. That is not
"their data" in any useful sense: it is the means of being them, and putting it
in a file that gets emailed, saved to Downloads and occasionally forwarded is
how an account gets taken over by someone who was trying to be helpful.

Both are tested by looking at the serialised output rather than the code,
because the way a secret gets into an export is a field someone adds later
without reading this file.
"""

from __future__ import annotations

import json
import uuid

import pytest_asyncio

from app.models import Conversation, Message, User
from app.services.data_export_service import (
    EXPORT_VERSION,
    build_export,
    build_export_for_user_id,
)


@pytest_asyncio.fixture
async def pair(db_session) -> tuple[User, User]:
    mine = User(
        email=f"export-mine-{uuid.uuid4().hex[:8]}@example.test",
        password_hash="$2b$12$averysecretlookinghashvalue",
    )
    theirs = User(email=f"export-theirs-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add_all([mine, theirs])
    await db_session.flush()
    return mine, theirs


@pytest_asyncio.fixture
async def conversation(db_session, pair) -> Conversation:
    mine, theirs = pair
    row = Conversation(
        context_type="application",
        participant_a_user_id=mine.id,
        participant_b_user_id=theirs.id,
    )
    db_session.add(row)
    await db_session.flush()
    return row


class TestItContainsWhatTheyOwn:
    async def test_their_own_messages_are_included(
        self, db_session, pair, conversation
    ) -> None:
        mine, _theirs = pair
        db_session.add(
            Message(
                conversation_id=conversation.id,
                sender_user_id=mine.id,
                body="Something I wrote.",
            )
        )
        await db_session.flush()

        export = await build_export(db_session, mine)

        bodies = [message["body"] for message in export["messages_you_sent"]]
        assert "Something I wrote." in bodies

    async def test_the_account_section_describes_them(self, db_session, pair) -> None:
        mine, _theirs = pair

        export = await build_export(db_session, mine)

        assert export["account"]["email"] == mine.email
        assert export["export_version"] == EXPORT_VERSION
        assert export["generated_at"]

    async def test_an_empty_account_still_produces_a_complete_shape(
        self, db_session, pair
    ) -> None:
        """A person with nothing gets an export saying so, not a broken file."""

        mine, _theirs = pair

        export = await build_export(db_session, mine)

        for section in (
            "messages_you_sent",
            "jobs_you_posted",
            "applications_you_sent",
            "portfolio",
            "legal_acceptances",
            "notification_opt_outs",
        ):
            assert section in export
            assert export[section] == []

    async def test_it_can_be_built_from_an_id(self, db_session, pair) -> None:
        mine, _theirs = pair

        export = await build_export_for_user_id(db_session, mine.id)

        assert export is not None
        assert export["account"]["id"] == str(mine.id)

    async def test_an_unknown_account_exports_nothing(self, db_session) -> None:
        assert await build_export_for_user_id(db_session, uuid.uuid4()) is None


class TestItContainsNobodyElsesWords:
    async def test_the_other_participants_messages_are_excluded(
        self, db_session, pair, conversation
    ) -> None:
        """The trap: the thread is reachable from this account, so the obvious
        export hands over both halves of it."""

        mine, theirs = pair
        db_session.add_all(
            [
                Message(
                    conversation_id=conversation.id,
                    sender_user_id=mine.id,
                    body="Mine.",
                ),
                Message(
                    conversation_id=conversation.id,
                    sender_user_id=theirs.id,
                    body="Something they wrote in confidence.",
                ),
            ]
        )
        await db_session.flush()

        export = await build_export(db_session, mine)

        serialised = json.dumps(export)
        assert "Mine." in serialised
        assert "Something they wrote in confidence." not in serialised

    async def test_it_does_not_leak_the_other_persons_account(
        self, db_session, pair, conversation
    ) -> None:
        mine, theirs = pair

        serialised = json.dumps(await build_export(db_session, mine))

        assert theirs.email not in serialised


class TestItContainsNoCredentials:
    async def test_the_password_hash_is_not_exported(self, db_session, pair) -> None:
        """It is not their data in any useful sense — it is the means of being
        them, in a file that ends up in Downloads."""

        mine, _theirs = pair
        assert mine.password_hash

        serialised = json.dumps(await build_export(db_session, mine))

        assert mine.password_hash not in serialised
        assert "password" not in serialised.lower()

    async def test_no_obvious_secret_field_appears(self, db_session, pair) -> None:
        mine, _theirs = pair

        serialised = json.dumps(await build_export(db_session, mine)).lower()

        for forbidden in ("token", "secret", "refresh", "credential", "hash"):
            assert forbidden not in serialised, forbidden


class TestTheShapeIsExplicit:
    def test_the_account_section_is_hand_written(self) -> None:
        """Reflection over the model would export whatever column is added next,
        and the failure would arrive silently in a file already sent."""

        import inspect

        from app.services import data_export_service

        source = inspect.getsource(data_export_service._account_section)

        # Every field is named. Reflection would export the next column added.
        assert "user.email" in source
        assert "__table__.columns" not in source
        assert "for column in" not in source

    async def test_it_changes_nothing(self, db_session, pair) -> None:
        """"Download my data" must not be a state change — least of all for
        someone worried enough to ask for it."""

        mine, _theirs = pair
        before = (mine.email, mine.suspended_at, mine.updated_at)

        await build_export(db_session, mine)

        assert (mine.email, mine.suspended_at, mine.updated_at) == before
