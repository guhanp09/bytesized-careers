"""Who agreed to what, and when.

The reason this is a table rather than a checkbox on the user is that the
question asked later is never "did they accept". It is "what did they accept,
and when" — usually by someone who needs to know whether a particular person saw
a particular clause. A boolean that gets overwritten when the terms change
cannot answer that, and it cannot be reconstructed afterwards.

The other property under test is the one that makes versioning mean anything:
someone who accepted last year's terms must be treated exactly like someone who
accepted nothing. Anything softer lets a change to the terms take effect without
anyone agreeing to it.

There is deliberately no legal text here and none in the module. Writing the
wording and having it reviewed is external work; this is the machinery that will
carry whatever the wording turns out to be.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.legal_documents import (
    CURRENT_DOCUMENTS,
    PRIVACY,
    REQUIRED_DOCUMENTS,
    TERMS,
    current_version,
    outstanding_documents,
)
from app.models import LegalAcceptance, User
from app.services.legal_acceptance_service import (
    accepted_versions,
    documents_awaiting_acceptance,
    record_acceptance,
)

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)


@pytest_asyncio.fixture
async def person(db_session) -> User:
    user = User(email=f"legal-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add(user)
    await db_session.flush()
    return user


class TestTheRule:
    def test_a_new_person_owes_every_required_document(self) -> None:
        assert outstanding_documents({}) == REQUIRED_DOCUMENTS

    def test_accepting_the_current_version_settles_it(self) -> None:
        accepted = {key: current_version(key) for key in REQUIRED_DOCUMENTS}

        assert outstanding_documents(accepted) == ()

    def test_an_old_acceptance_counts_for_nothing(self) -> None:
        """The whole point of versioning. Treating a stale acceptance as valid
        would let the terms change without anyone agreeing to the change."""

        accepted = {key: "1999-01-01" for key in REQUIRED_DOCUMENTS}

        assert outstanding_documents(accepted) == REQUIRED_DOCUMENTS

    def test_one_document_can_be_outstanding_alone(self) -> None:
        accepted = {TERMS: current_version(TERMS)}

        assert outstanding_documents(accepted) == (PRIVACY,)

    def test_an_unknown_document_is_refused_rather_than_invented(self) -> None:
        """A typo would otherwise create acceptances for a document that does
        not exist, and they would look exactly like real ones."""

        with pytest.raises(KeyError):
            current_version("terms_of_servce")

    def test_every_required_document_has_a_current_version(self) -> None:
        """Guards the registry against a document being required and unshippable
        at the same time."""

        for key in REQUIRED_DOCUMENTS:
            assert key in CURRENT_DOCUMENTS
            assert current_version(key)

    def test_the_module_carries_no_legal_wording(self) -> None:
        """Writing and reviewing the text is external. This module holds
        identity and versions only, so a build cannot ship prose nobody
        approved."""

        import inspect

        from app.core import legal_documents

        source = inspect.getsource(legal_documents).lower()
        for phrase in ("you agree", "warranty", "liability", "hereby", "jurisdiction"):
            assert phrase not in source, phrase


class TestRecording:
    async def test_an_acceptance_is_stored_against_its_version(
        self, db_session, person
    ) -> None:
        await record_acceptance(
            db_session, user_id=person.id, document_key=TERMS, now=NOW
        )
        await db_session.flush()

        rows = (
            await db_session.execute(
                select(LegalAcceptance).where(LegalAcceptance.user_id == person.id)
            )
        ).scalars().all()

        assert len(rows) == 1
        assert rows[0].document_key == TERMS
        assert rows[0].version == current_version(TERMS)

    async def test_accepting_twice_records_one_agreement(
        self, db_session, person
    ) -> None:
        """A double-click or a client retry is one agreement. A second row would
        suggest a separate act of consent that never happened."""

        for _ in range(3):
            await record_acceptance(
                db_session, user_id=person.id, document_key=TERMS, now=NOW
            )
            await db_session.flush()

        rows = (
            await db_session.execute(
                select(LegalAcceptance).where(LegalAcceptance.user_id == person.id)
            )
        ).scalars().all()

        assert len(rows) == 1

    async def test_a_new_version_is_a_new_record_not_an_edit(
        self, db_session, person
    ) -> None:
        """History is the product here. Overwriting the old row would destroy
        the only evidence of what they agreed to before."""

        await record_acceptance(
            db_session, user_id=person.id, document_key=TERMS, version="2025-01-01", now=NOW
        )
        await record_acceptance(
            db_session,
            user_id=person.id,
            document_key=TERMS,
            version=current_version(TERMS),
            now=NOW + timedelta(days=1),
        )
        await db_session.flush()

        rows = (
            await db_session.execute(
                select(LegalAcceptance)
                .where(LegalAcceptance.user_id == person.id)
                .order_by(LegalAcceptance.accepted_at)
            )
        ).scalars().all()

        assert [row.version for row in rows] == ["2025-01-01", current_version(TERMS)]

    async def test_recording_for_an_unknown_document_is_refused(
        self, db_session, person
    ) -> None:
        with pytest.raises(KeyError):
            await record_acceptance(
                db_session, user_id=person.id, document_key="not_a_document", now=NOW
            )

    async def test_one_persons_acceptance_is_not_anothers(self, db_session) -> None:
        first = User(email=f"legal-a-{uuid.uuid4().hex[:8]}@example.test")
        second = User(email=f"legal-b-{uuid.uuid4().hex[:8]}@example.test")
        db_session.add_all([first, second])
        await db_session.flush()

        await record_acceptance(db_session, user_id=first.id, document_key=TERMS, now=NOW)
        await record_acceptance(db_session, user_id=first.id, document_key=PRIVACY, now=NOW)
        await db_session.flush()

        assert await documents_awaiting_acceptance(db_session, first.id) == ()
        assert (
            await documents_awaiting_acceptance(db_session, second.id)
            == REQUIRED_DOCUMENTS
        )


class TestWhatIsStillOwed:
    async def test_a_fresh_account_owes_everything(self, db_session, person) -> None:
        assert (
            await documents_awaiting_acceptance(db_session, person.id)
            == REQUIRED_DOCUMENTS
        )

    async def test_accepting_both_settles_it(self, db_session, person) -> None:
        for key in REQUIRED_DOCUMENTS:
            await record_acceptance(db_session, user_id=person.id, document_key=key, now=NOW)
        await db_session.flush()

        assert await documents_awaiting_acceptance(db_session, person.id) == ()

    async def test_a_superseded_acceptance_becomes_outstanding_again(
        self, db_session, person
    ) -> None:
        """What reacceptance actually is: the same person, newly owing."""

        for key in REQUIRED_DOCUMENTS:
            await record_acceptance(
                db_session, user_id=person.id, document_key=key, version="2020-01-01", now=NOW
            )
        await db_session.flush()

        assert (
            await documents_awaiting_acceptance(db_session, person.id)
            == REQUIRED_DOCUMENTS
        )

    async def test_the_latest_acceptance_wins_regardless_of_string_order(
        self, db_session, person
    ) -> None:
        """Ordered by when it happened, not by how the version sorts. Versions
        are dates today and may not be tomorrow, and an ordering rule that
        depends on the format breaks silently when the format changes."""

        await record_acceptance(
            db_session, user_id=person.id, document_key=TERMS, version="zzz-old", now=NOW
        )
        await record_acceptance(
            db_session,
            user_id=person.id,
            document_key=TERMS,
            version=current_version(TERMS),
            now=NOW + timedelta(days=1),
        )
        await db_session.flush()

        assert (await accepted_versions(db_session, person.id))[TERMS] == current_version(
            TERMS
        )
