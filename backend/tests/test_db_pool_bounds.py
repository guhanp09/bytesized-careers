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

import asyncio

import pytest

from app.core import config
from app.db.session import _connection_options, _pool_options


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
        monkeypatch.setattr(config, "settings", self._production(DB_POOL_SIZE=5, DB_MAX_OVERFLOW=5))

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


def test_sqlite_receives_no_postgres_driver_timeouts(monkeypatch) -> None:
    monkeypatch.setattr(config.settings, "database_url", "sqlite+aiosqlite:///:memory:")
    assert _connection_options() == {}


@pytest.mark.anyio
async def test_sqlalchemy_passes_owned_deadlines_to_actual_asyncpg_connect(
    postgres_url, monkeypatch
) -> None:
    from sqlalchemy import event
    from sqlalchemy.ext.asyncio import create_async_engine

    monkeypatch.setattr(config.settings, "db_connect_timeout_seconds", 7.5)
    monkeypatch.setattr(config.settings, "db_command_timeout_seconds", 24.0)
    observed = []
    engine = create_async_engine(config.settings.database_url, **_connection_options())

    @event.listens_for(engine.sync_engine, "do_connect")
    def capture(_dialect, _record, _args, kwargs):
        observed.append(kwargs)
        raise RuntimeError("connection intercepted before network")

    try:
        with pytest.raises(RuntimeError, match="connection intercepted"):
            async with engine.connect():
                pytest.fail("the test must not open a database connection")
    finally:
        await engine.dispose()
    assert len(observed) == 1
    assert observed[0]["timeout"] == 7.5
    assert observed[0]["command_timeout"] == 24.0


@pytest.mark.anyio
async def test_real_driver_abandons_a_loopback_server_that_never_finishes_handshake(
    monkeypatch,
) -> None:
    from sqlalchemy.ext.asyncio import create_async_engine

    peers = set()
    handlers = set()
    accepted = asyncio.Event()

    async def stall(reader, writer):
        task = asyncio.current_task()
        handlers.add(task)
        peers.add(writer)
        accepted.set()
        try:
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()
            peers.discard(writer)
            handlers.discard(task)

    server = await asyncio.start_server(stall, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    url = f"postgresql+asyncpg://test_user:test_password@127.0.0.1:{port}/test_db"
    monkeypatch.setattr(config.settings, "database_url", url)
    monkeypatch.setattr(config.settings, "db_connect_timeout_seconds", 0.05)
    engine = create_async_engine(url, **_connection_options())
    try:
        # Outer guard detects a broken/unbounded driver timeout. Success is the
        # inner asyncpg timeout, not merely reaching this outer test deadline.
        outer = asyncio.timeout(5)
        async with outer:
            with pytest.raises(TimeoutError):
                async with engine.connect():
                    pytest.fail("the stalled peer cannot complete startup")
        assert not outer.expired()
        assert accepted.is_set()
        assert engine.sync_engine.pool.checkedout() == 0
    finally:
        await engine.dispose()
        server.close()
        await server.wait_closed()
        for writer in tuple(peers):
            writer.close()
        if handlers:
            await asyncio.gather(*tuple(handlers))


@pytest.mark.parametrize("alias", ["DB_CONNECT_TIMEOUT_SECONDS", "DB_COMMAND_TIMEOUT_SECONDS"])
@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan"), 301])
def test_database_deadlines_are_finite_positive_and_bounded(alias, value) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        config.Settings(_env_file=None, **{alias: value})


@pytest.mark.parametrize(
    "url",
    [
        "",
        "sqlite+aiosqlite:///./dev.db",
        "postgresql+asyncpg://creatorjobs_test:pw@db.example:55439/creatorjobs_interaction_test",
        "postgresql+asyncpg://creatorjobs_test:pw@127.0.0.1:55439/production",
        "postgresql+asyncpg://owner:pw@127.0.0.1:55439/creatorjobs_interaction_test",
        "postgresql+asyncpg://creatorjobs_test:pw@127.0.0.1:55439/creatorjobs_interaction_test?host=evil.example",
        "postgresql+asyncpg://creatorjobs_test:pw@127.0.0.1/creatorjobs_interaction_test",
    ],
)
def test_database_timeout_drill_refuses_unowned_targets_without_exposing_credentials(url) -> None:
    from scripts.exercise_database_timeouts import validated_test_url

    with pytest.raises(ValueError) as captured:
        validated_test_url(url)
    assert "pw" not in str(captured.value)
    assert "evil.example" not in str(captured.value)


@pytest.mark.parametrize("host", ["127.0.0.1", "[::1]"])
def test_database_timeout_drill_accepts_only_the_owned_loopback_database(host) -> None:
    from scripts.exercise_database_timeouts import validated_test_url

    url = f"postgresql+asyncpg://creatorjobs_test:pw@{host}:55439/creatorjobs_interaction_test"
    assert validated_test_url(url) == url
