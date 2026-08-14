from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest


def _migration_module() -> ModuleType:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0057_admin_session_assurance.py"
    )
    spec = importlib.util.spec_from_file_location(
        "creatorjobs_migration_0057",
        migration_path,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FakeResult:
    def __init__(self, row: object | None):
        self.row = row

    def first(self) -> object | None:
        return self.row


class _FakeBind:
    def __init__(self, row: object | None):
        self.row = row
        self.query = ""

    def execute(self, statement) -> _FakeResult:
        self.query = str(statement)
        return _FakeResult(self.row)


def test_assurance_downgrade_refuses_used_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _migration_module()
    bind = _FakeBind(("session-id",))
    monkeypatch.setattr(migration.op, "get_bind", lambda: bind)

    with pytest.raises(RuntimeError, match="would let an old binary bypass"):
        migration._assert_downgrade_has_no_assurance_state()

    assert "FROM auth_sessions" in bind.query
    assert "strong_auth_method IS NOT NULL" in bind.query


def test_assurance_downgrade_accepts_never_used_additive_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _migration_module()
    monkeypatch.setattr(migration.op, "get_bind", lambda: _FakeBind(None))

    migration._assert_downgrade_has_no_assurance_state()
