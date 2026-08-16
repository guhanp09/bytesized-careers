"""Unsubscribing from an email, without being able to unsubscribe anyone else.

The obvious version of this link carries a user id. Anyone who sees one such URL
learns the shape of all of them and can switch off another person's mail by
changing the id — no login, no trace that looks like an attack, and a victim who
only notices when something they wanted stops arriving. By then there is nothing
left to correlate.

So the token is signed, and these tests are mostly about the ways a forged or
altered one must fail.

Two design choices are tested because they look like bugs until the reason is
stated. The token never expires, since an unsubscribe link lives as long as the
email that carries it and the person clearing out a two-year-old inbox is
exactly who should be able to use it. And the endpoint is POST, because mail
clients and scanners follow links to prefetch them — a GET that changes state
gets triggered by software the person never asked for.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from app.core import config
from app.core.notification_consent import ESSENTIAL_CATEGORIES
from app.models import User
from app.notifications.registry import CATEGORY_DIGEST, CATEGORY_LIFECYCLE
from app.repositories.notification_preference_repository import opted_out_categories
from app.services.unsubscribe_tokens import (
    UnsubscribeTokenError,
    issue_unsubscribe_token,
    read_unsubscribe_token,
)
from tests.conftest import TestSessionLocal

SECRET = "an-unsubscribe-signing-secret"
PATH = "/api/v1/unsubscribe"


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setattr(config.settings, "unsubscribe_token_secret", SECRET)
    yield


@pytest_asyncio.fixture
async def person(db_session) -> User:
    user = User(email=f"unsub-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add(user)
    await db_session.commit()
    return user


async def _refused(user_id: uuid.UUID) -> frozenset[str]:
    """Read through a fresh session: the endpoint commits on its own."""

    async with TestSessionLocal() as session:
        return await opted_out_categories(session, user_id)


class TestTheTokenCannotBeForged:
    def test_a_token_round_trips(self) -> None:
        user_id = uuid.uuid4()

        claim = read_unsubscribe_token(issue_unsubscribe_token(user_id, CATEGORY_DIGEST))

        assert claim.user_id == user_id
        assert claim.category == CATEGORY_DIGEST

    def test_someone_elses_id_cannot_be_substituted(self) -> None:
        """The attack the signature exists for: change the id, unsubscribe the
        stranger. Their mail stops and nothing they can see explains it."""

        token = issue_unsubscribe_token(uuid.uuid4(), CATEGORY_DIGEST)
        victim = uuid.uuid4().hex
        forged = f"{victim}.{token.split('.', 1)[1]}"

        with pytest.raises(UnsubscribeTokenError):
            read_unsubscribe_token(forged)

    def test_the_category_cannot_be_widened(self) -> None:
        """A token is for one category. Otherwise the link in a digest could
        switch off everything, which is more than that email offered."""

        user_id = uuid.uuid4()
        token = issue_unsubscribe_token(user_id, CATEGORY_DIGEST)
        widened = token.replace(CATEGORY_DIGEST, CATEGORY_LIFECYCLE, 1)

        with pytest.raises(UnsubscribeTokenError):
            read_unsubscribe_token(widened)

    @pytest.mark.parametrize(
        "token",
        ["", "not-a-token", "a.b.c", "....", "deadbeef.digest.short"],
    )
    def test_rubbish_is_refused(self, token: str) -> None:
        with pytest.raises(UnsubscribeTokenError):
            read_unsubscribe_token(token)

    def test_a_token_from_a_different_secret_is_refused(self, monkeypatch) -> None:
        token = issue_unsubscribe_token(uuid.uuid4(), CATEGORY_DIGEST)
        monkeypatch.setattr(config.settings, "unsubscribe_token_secret", "a-different-secret")

        with pytest.raises(UnsubscribeTokenError):
            read_unsubscribe_token(token)

    def test_an_unset_secret_refuses_rather_than_accepts(self, monkeypatch) -> None:
        """"No secret, so accept anything" would turn a missing environment
        variable into an endpoint that unsubscribes whoever it is asked to."""

        monkeypatch.setattr(config.settings, "unsubscribe_token_secret", None)

        with pytest.raises(UnsubscribeTokenError):
            read_unsubscribe_token("anything")

    def test_every_refusal_says_the_same_thing(self) -> None:
        """Distinguishing "no such user" from "bad signature" hands a caller the
        two halves of the problem separately."""

        messages = set()
        for token in ("rubbish", f"{uuid.uuid4().hex}.digest.0" * 1):
            try:
                read_unsubscribe_token(token)
            except UnsubscribeTokenError as exc:
                messages.add(str(exc))

        assert len(messages) == 1


class TestTheEndpoint:
    async def test_a_valid_link_stops_that_category(self, client, person) -> None:
        token = issue_unsubscribe_token(person.id, CATEGORY_DIGEST)

        response = await client.post(PATH, json={"token": token})

        assert response.status_code == 200
        assert response.json() == {"ok": True, "category": CATEGORY_DIGEST}
        assert CATEGORY_DIGEST in await _refused(person.id)

    async def test_clicking_twice_is_the_same_unsubscribe(self, client, person) -> None:
        """Mail clients prefetch and people double-click. Both mean once."""

        token = issue_unsubscribe_token(person.id, CATEGORY_DIGEST)

        first = await client.post(PATH, json={"token": token})
        second = await client.post(PATH, json={"token": token})

        assert first.status_code == second.status_code == 200
        assert await _refused(person.id) == frozenset({CATEGORY_DIGEST})

    async def test_a_forged_token_changes_nothing(self, client, person) -> None:
        forged = f"{person.id.hex}.{CATEGORY_DIGEST}.{'0' * 32}"

        response = await client.post(PATH, json={"token": forged})

        assert response.status_code == 400
        assert await _refused(person.id) == frozenset()

    async def test_an_essential_category_cannot_be_switched_off(
        self, client, person
    ) -> None:
        """Such a token should never be issued; acting on one would let a link
        switch off a password reset."""

        essential = next(iter(ESSENTIAL_CATEGORIES))
        token = issue_unsubscribe_token(person.id, essential)

        response = await client.post(PATH, json={"token": token})

        assert response.status_code == 400
        assert await _refused(person.id) == frozenset()

    async def test_it_needs_no_login(self, client, person) -> None:
        """The point of the link: it works from an email, months later, with no
        session and no password."""

        token = issue_unsubscribe_token(person.id, CATEGORY_DIGEST)

        response = await client.post(PATH, json={"token": token})

        assert response.status_code == 200

    async def test_a_get_does_not_unsubscribe(self, client, person) -> None:
        """Mail clients and scanners follow links to prefetch them. A GET that
        changes state means being unsubscribed by your own spam filter."""

        token = issue_unsubscribe_token(person.id, CATEGORY_DIGEST)

        response = await client.get(f"{PATH}?token={token}")

        assert response.status_code in {404, 405}
        assert await _refused(person.id) == frozenset()

    async def test_an_unexpected_field_is_refused(self, client, person) -> None:
        token = issue_unsubscribe_token(person.id, CATEGORY_DIGEST)

        response = await client.post(
            PATH, json={"token": token, "user_id": str(uuid.uuid4())}
        )

        assert response.status_code == 422


def test_the_token_carries_no_expiry() -> None:
    """Deliberate, and the opposite of most signed links. An unsubscribe link
    lives as long as the email holding it, and someone clearing a two-year-old
    inbox is exactly who should be able to use it — a link that quietly stopped
    working sends them to support to ask for something promised in writing."""

    import inspect

    from app.services import unsubscribe_tokens

    source = inspect.getsource(unsubscribe_tokens)

    assert "expires" not in source.lower().replace("never expire", "")
    assert "NO EXPIRY" in source
