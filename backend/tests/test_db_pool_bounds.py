"""How many database connections one process may hold, and who decides.

The tempting move is a default: twenty connections, because twenty looks normal.
It is fine for one process and it exhausts a small managed Postgres plan the
moment eight of them run against it — and the failure is not an error. The pool
blocks, requests queue behind it, and the application is simply slow. Nobody
looks at a connection limit when the symptom is latency.

So the split tested here is deliberate. The CODE guarantees boundedness: a pool
that cannot grow without limit, and a wait that cannot last forever. The
DEPLOYMENT supplies capacity, because the right number depends on the database
plan actually bought and how many processes share it — facts this file cannot
know. Production refuses to start without them.
"""

from __future__ import annotations

import pytest

from app.core import config
from app.db.session import _pool_options


@pytest.fixture
def postgres_url(monkeypatch):
    monkeypatch.setattr(
        config.settings,
        "database_url",
        "postgresql+asyncpg://user:pass@db.example/creatorjobs",
    )
    yield


class TestThePoolIsAlwaysBounded:
    def test_it_cannot_grow_without_limit(self, postgres_url, monkeypatch) -> None:
        """An unbounded burst is how one instance takes every connection the
        database has, and every other instance then fails."""

        monkeypatch.setattr(config.settings, "db_pool_size", 4)
        monkeypatch.setattr(config.settings, "db_max_overflow", 2)

        options = _pool_options()

        assert options["pool_size"] == 4
        assert options["max_overflow"] == 2

    def test_it_cannot_wait_forever(self, postgres_url) -> None:
        """Without a bound, exhaustion becomes requests hanging until their
        client gives up — an outage with no error recorded anywhere."""

        options = _pool_options()

        assert options["pool_timeout"] > 0
        assert options["pool_timeout"] <= 120

    def test_connections_are_recycled(self, postgres_url) -> None:
        """Replaced by us before a proxy or managed database quietly drops one,
        so a request does not discover it instead."""

        options = _pool_options()

        assert options["pool_recycle"] > 0

    def test_a_local_default_applies_when_unset(self, postgres_url, monkeypatch) -> None:
        """Development must still work without capacity configuration; only
        production insists on it."""

        monkeypatch.setattr(config.settings, "db_pool_size", None)
        monkeypatch.setattr(config.settings, "db_max_overflow", None)

        options = _pool_options()

        assert isinstance(options["pool_size"], int)
        assert options["pool_size"] >= 1


class TestSqliteIsLeftAlone:
    def test_no_pool_options_are_passed(self, monkeypatch) -> None:
        """SQLite has no pool worth sizing — the driver serialises access — and
        passing pool arguments either errors or means nothing."""

        monkeypatch.setattr(config.settings, "database_url", "sqlite+aiosqlite:///./dev.db")

        assert _pool_options() == {}


class TestProductionMustSupplyCapacity:
    def _production(self, **overrides):
        from tests.test_config import _safe_production_settings

        return _safe_production_settings(**overrides)

    def test_it_refuses_to_boot_without_a_pool_size(self, monkeypatch) -> None:
        """The number depends on the plan bought and the instance count. A
        default chosen in code would be wrong quietly."""

        monkeypatch.setattr(
            config, "settings", self._production(DB_POOL_SIZE=None, DB_MAX_OVERFLOW=5)
        )

        with pytest.raises(RuntimeError, match="DB_POOL_SIZE"):
            config.validate_production_settings()

    def test_it_refuses_to_boot_without_an_overflow_bound(self, monkeypatch) -> None:
        monkeypatch.setattr(
            config, "settings", self._production(DB_POOL_SIZE=5, DB_MAX_OVERFLOW=None)
        )

        with pytest.raises(RuntimeError, match="DB_MAX_OVERFLOW"):
            config.validate_production_settings()

    def test_it_boots_when_capacity_is_supplied(self, monkeypatch) -> None:
        monkeypatch.setattr(
            config, "settings", self._production(DB_POOL_SIZE=5, DB_MAX_OVERFLOW=5)
        )

        config.validate_production_settings()

    def test_the_refusal_explains_why_no_default_exists(self, monkeypatch) -> None:
        """An operator who has to set a variable deserves to know what it depends
        on, or they will pick a number as arbitrary as the default would have
        been."""

        monkeypatch.setattr(
            config, "settings", self._production(DB_POOL_SIZE=None, DB_MAX_OVERFLOW=None)
        )

        with pytest.raises(RuntimeError) as raised:
            config.validate_production_settings()

        message = str(raised.value).lower()
        assert "database plan" in message
        assert "processes" in message


@pytest.mark.parametrize(
    ("field", "value"),
    [("db_pool_size", 0), ("db_pool_size", 500), ("db_max_overflow", -1)],
)
def test_absurd_capacity_is_refused_by_the_schema(field: str, value: int) -> None:
    """Bounds on the bound. A pool of five hundred against a small plan is the
    same failure as no bound at all."""

    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        config.Settings(**{field.upper(): value})
