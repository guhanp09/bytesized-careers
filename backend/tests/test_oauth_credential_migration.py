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
        / "0055_oauth_credential_encryption.py"
    )
    spec = importlib.util.spec_from_file_location(
        "creatorjobs_migration_0055",
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


def test_oauth_encryption_downgrade_refuses_encrypted_only_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _migration_module()
    bind = _FakeBind(("account-id",))
    monkeypatch.setattr(migration.op, "get_bind", lambda: bind)

    with pytest.raises(RuntimeError, match="would lose provider credentials"):
        migration._assert_plaintext_rollback_safe()

    assert "access_token_ciphertext IS NOT NULL AND access_token IS NULL" in bind.query
    assert "refresh_token_ciphertext IS NOT NULL AND refresh_token IS NULL" in bind.query


def test_oauth_encryption_downgrade_accepts_rollback_compatible_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _migration_module()
    monkeypatch.setattr(migration.op, "get_bind", lambda: _FakeBind(None))

    migration._assert_plaintext_rollback_safe()
