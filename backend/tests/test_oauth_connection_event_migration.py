from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest


def _migration_module() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0059_oauth_connection_events.py"
    )
    spec = importlib.util.spec_from_file_location("creatorjobs_migration_0059", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Result:
    def __init__(self, row: object | None):
        self.row = row

    def first(self) -> object | None:
        return self.row


class _Bind:
    def __init__(self, row: object | None):
        self.row = row
        self.query = ""

    def execute(self, statement) -> _Result:
        self.query = str(statement)
        return _Result(self.row)


def test_oauth_connection_event_downgrade_refuses_audit_loss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _migration_module()
    bind = _Bind(("event-id",))
    monkeypatch.setattr(migration.op, "get_bind", lambda: bind)

    with pytest.raises(RuntimeError, match="destroy security audit data"):
        migration._assert_no_connection_history()
    assert "oauth_connection_events" in bind.query


def test_oauth_connection_event_downgrade_allows_empty_table(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _migration_module()
    monkeypatch.setattr(migration.op, "get_bind", lambda: _Bind(None))
    migration._assert_no_connection_history()
