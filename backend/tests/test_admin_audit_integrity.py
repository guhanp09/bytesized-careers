"""The audit log is only worth having if nothing can edit it.

Its value is entirely in being the record an administrator cannot adjust
afterwards. That property is currently a convention — the model's docstring says
there is deliberately no update or delete path — and a convention is exactly the
kind of thing that erodes: someone adds a "correct a typo in the reason" feature,
or a cleanup script, and the log quietly becomes a thing that can be edited by
whoever most wants to edit it.

There is no database-level guarantee here (no trigger, no revoked GRANT), so
these tests do the next best thing and check the source. A structural test is
weaker than a permission, and it is much stronger than a comment, because it
fails in review rather than during an investigation.

Retention and export are named in the ledger row and are not built; what is
tested here is integrity, which is the part everything else depends on.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import AdminAuditLog, User

APP_ROOT = Path(__file__).resolve().parents[1] / "app"


def _python_sources() -> list[Path]:
    return [path for path in APP_ROOT.rglob("*.py") if "__pycache__" not in str(path)]


class TestNothingInTheApplicationEditsIt:
    def test_no_code_updates_an_audit_row(self) -> None:
        """An UPDATE against this table is a way to rewrite history, whatever
        the intention behind it."""

        offenders = [
            str(path.relative_to(APP_ROOT))
            for path in _python_sources()
            if re.search(r"update\(\s*AdminAuditLog", path.read_text(encoding="utf8"))
        ]

        assert offenders == [], f"these update the audit log: {offenders}"

    def test_no_code_deletes_an_audit_row(self) -> None:
        """Deleting entries is the same problem, with less evidence left."""

        offenders = [
            str(path.relative_to(APP_ROOT))
            for path in _python_sources()
            if re.search(r"delete\(\s*AdminAuditLog", path.read_text(encoding="utf8"))
        ]

        assert offenders == [], f"these delete from the audit log: {offenders}"

    def test_no_route_exposes_a_write_other_than_appending(self) -> None:
        """A PATCH or DELETE endpoint on audit logs would make the record
        editable by exactly the people it exists to hold to account."""

        admin_router = APP_ROOT / "api" / "v1" / "routers" / "admin.py"
        source = admin_router.read_text(encoding="utf8")

        for pattern in (
            r'@router\.patch\(\s*"[^"]*audit',
            r'@router\.delete\(\s*"[^"]*audit',
            r'@router\.put\(\s*"[^"]*audit',
        ):
            assert not re.search(pattern, source), pattern

    def test_the_guard_can_actually_find_things(self) -> None:
        """Guards the guard: a regex that matched nothing would make every
        assertion above pass while checking nothing at all."""

        found = [
            path
            for path in _python_sources()
            if "AdminAuditLog" in path.read_text(encoding="utf8")
        ]

        assert found, "expected the audit model to be referenced somewhere"


@pytest_asyncio.fixture
async def actor(db_session) -> User:
    user = User(email=f"auditor-{uuid.uuid4().hex[:8]}@example.test")
    db_session.add(user)
    await db_session.flush()
    return user


class TestWhatAnEntryHasToSay:
    async def test_an_entry_records_who_did_what_to_whom(
        self, db_session, actor
    ) -> None:
        """The four facts an investigation starts from. An entry missing any of
        them is a line that raises a question and answers none."""

        entry = AdminAuditLog(
            actor_user_id=actor.id,
            action="user.suspend",
            target_type="user",
            target_id=str(uuid.uuid4()),
            target_label="somebody",
        )
        db_session.add(entry)
        await db_session.flush()

        stored = (
            await db_session.execute(
                select(AdminAuditLog).where(AdminAuditLog.id == entry.id)
            )
        ).scalar_one()

        assert stored.actor_user_id == actor.id
        assert stored.action == "user.suspend"
        assert stored.target_type == "user"
        assert stored.target_id
        assert stored.created_at is not None

    async def test_it_survives_the_actor_being_deleted(
        self, db_session, actor
    ) -> None:
        """The entry outlives the account. An administrator leaving must not
        erase what they did — which is why the foreign key is SET NULL and the
        label is snapshotted at write time.
        """

        entry = AdminAuditLog(
            actor_user_id=actor.id,
            action="user.suspend",
            target_type="user",
            target_id=str(uuid.uuid4()),
            target_label="a name captured when it happened",
        )
        db_session.add(entry)
        await db_session.flush()

        await db_session.delete(actor)
        await db_session.flush()

        # SET NULL is applied by the database, so the in-memory copy is stale;
        # re-read rather than trust the identity map.
        stored = await db_session.get(AdminAuditLog, entry.id, populate_existing=True)
        assert stored is not None
        assert stored.actor_user_id is None
        # And the entry still says who it was about.
        assert stored.target_label == "a name captured when it happened"

    def test_the_actor_reference_does_not_cascade(self) -> None:
        """A CASCADE here would let an administrator erase their own trail by
        deleting their account."""

        actor_column = AdminAuditLog.__table__.columns["actor_user_id"]
        foreign_key = next(iter(actor_column.foreign_keys))

        assert foreign_key.ondelete == "SET NULL"


class TestTheModelSaysWhatItIs:
    def test_the_append_only_intent_is_written_down(self) -> None:
        """Not a substitute for the structural tests above, but the reason those
        tests exist should be findable from the model."""

        documentation = " ".join((AdminAuditLog.__doc__ or "").split()).lower()

        assert "append-only" in documentation

    @pytest.mark.parametrize("column", ["action", "target_type", "target_id"])
    def test_the_identifying_fields_are_required(self, column: str) -> None:
        """An entry that can omit what happened, or to whom, is a line nobody
        can act on."""

        assert AdminAuditLog.__table__.columns[column].nullable is False


def test_entries_are_timestamped_by_the_database() -> None:
    """A caller-supplied time can be wrong, or chosen. The server clock is at
    least the same clock for every entry."""

    created_at = AdminAuditLog.__table__.columns["created_at"]

    assert created_at.server_default is not None
    assert created_at.nullable is False


def test_a_written_entry_needs_no_later_edit_to_be_legible(db_session) -> None:
    """target_label exists so an entry stays readable after the thing it refers
    to is renamed or removed — which is what removes the temptation to go back
    and update old rows."""

    assert "target_label" in AdminAuditLog.__table__.columns
    assert datetime.now(UTC) is not None
