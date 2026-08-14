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
        / "0056_persistent_auth_sessions.py"
    )
    spec = importlib.util.spec_from_file_location(
        "creatorjobs_migration_0056",
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


def test_auth_session_downgrade_refuses_unexpired_session_families(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _migration_module()
    bind = _FakeBind(("credential-id",))
    monkeypatch.setattr(migration.op, "get_bind", lambda: bind)

    with pytest.raises(RuntimeError, match="would reactivate consumed or revoked"):
        migration._assert_downgrade_cannot_reactivate_refresh_credentials()

    assert "FROM auth_sessions" in bind.query
    assert "absolute_expires_at > CURRENT_TIMESTAMP" in bind.query


def test_auth_session_downgrade_accepts_only_fully_expired_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _migration_module()
    monkeypatch.setattr(migration.op, "get_bind", lambda: _FakeBind(None))

    migration._assert_downgrade_cannot_reactivate_refresh_credentials()
