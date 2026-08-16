"""The loop around the pass.

`process_outbox_once` is already covered; what is tested here is the part that
turns it into something that runs unattended. Three properties matter and each
one has a failure that looks like "email stopped working" with nothing obviously
broken:

* it stops when asked, or a deploy hangs waiting for it;
* a pass that raises does not end it, or one bad row silently retires the
  worker and the queue stops draining;
* each pass gets its own session, or an idle worker sits on an open transaction
  between passes.

No provider, no database engine, and no sleeping longer than a test should: the
loop is driven with an event and a fake.
"""

from __future__ import annotations

import asyncio

from app.notifications import runner
from app.notifications.provider import MockEmailProvider


class _FakeSession:
    def __init__(self, log: list[str]) -> None:
        self.log = log
        self.committed = 0

    async def __aenter__(self) -> _FakeSession:
        self.log.append("open")
        return self

    async def __aexit__(self, *_exc) -> None:
        self.log.append("close")

    async def commit(self) -> None:
        self.committed += 1


class _Factory:
    """Records every session it hands out, so "a fresh one" is checkable."""

    def __init__(self) -> None:
        self.log: list[str] = []
        self.sessions: list[_FakeSession] = []

    def __call__(self) -> _FakeSession:
        session = _FakeSession(self.log)
        self.sessions.append(session)
        return session


async def _run_passes(monkeypatch, *, passes: int, pass_impl) -> _Factory:
    """Drive the loop for a fixed number of passes, then let it stop."""

    factory = _Factory()
    stop = asyncio.Event()
    seen = 0

    async def fake_pass(session, **kwargs):
        nonlocal seen
        seen += 1
        try:
            return await pass_impl(session, seen, **kwargs)
        finally:
            if seen >= passes:
                stop.set()

    monkeypatch.setattr("app.notifications.worker.process_outbox_once", fake_pass)

    await asyncio.wait_for(
        runner.run_worker_forever(
            factory,
            provider=MockEmailProvider(),
            interval_seconds=0.01,
            stop=stop,
        ),
        timeout=5,
    )
    return factory


class TestItStopsWhenAsked:
    async def test_a_set_stop_event_ends_the_loop(self, monkeypatch) -> None:
        async def ok(_session, _n, **_kwargs):
            return None

        factory = await _run_passes(monkeypatch, passes=1, pass_impl=ok)
        assert len(factory.sessions) == 1

    async def test_an_already_set_event_runs_nothing(self) -> None:
        """Shutdown racing startup must not start a pass at all."""

        factory = _Factory()
        stop = asyncio.Event()
        stop.set()

        await asyncio.wait_for(
            runner.run_worker_forever(
                factory, provider=MockEmailProvider(), interval_seconds=0.01, stop=stop
            ),
            timeout=5,
        )

        assert factory.sessions == []


class TestOneBadPassDoesNotEndIt:
    async def test_the_loop_survives_a_raising_pass(self, monkeypatch) -> None:
        attempted: list[int] = []

        async def explode_once(_session, n, **_kwargs):
            attempted.append(n)
            if n == 1:
                raise RuntimeError("database went away")
            return None

        factory = await _run_passes(monkeypatch, passes=2, pass_impl=explode_once)

        assert attempted == [1, 2]
        # And the failed pass still closed its session rather than leaking it.
        assert factory.log.count("close") == 2


class TestEachPassGetsItsOwnSession:
    async def test_sessions_are_not_reused_between_passes(self, monkeypatch) -> None:
        async def ok(_session, _n, **_kwargs):
            return None

        factory = await _run_passes(monkeypatch, passes=3, pass_impl=ok)

        assert len({id(session) for session in factory.sessions}) == 3
        assert factory.log == ["open", "close"] * 3

    async def test_a_successful_pass_commits(self, monkeypatch) -> None:
        """Otherwise the worker marks rows sent and throws the marking away."""

        async def ok(_session, _n, **_kwargs):
            return None

        factory = await _run_passes(monkeypatch, passes=1, pass_impl=ok)
        assert factory.sessions[0].committed == 1


class TestProviderSelection:
    def test_the_mock_is_the_default(self, monkeypatch) -> None:
        """An incompletely configured deployment records mail; it does not half-send it."""

        monkeypatch.setattr(runner, "real_delivery_enabled", lambda: False)
        assert isinstance(runner.build_provider(), MockEmailProvider)

    def test_smtp_only_when_delivery_is_switched_on(self, monkeypatch) -> None:
        from app.notifications.provider import SmtpEmailProvider

        monkeypatch.setattr(runner, "real_delivery_enabled", lambda: True)
        assert isinstance(runner.build_provider(), SmtpEmailProvider)


async def test_the_interval_is_a_wait_not_a_sleep(monkeypatch) -> None:
    """Stopping must not have to wait out the interval.

    A `sleep` between passes would mean shutdown takes up to a full interval —
    with a production interval that is a deploy hanging for no reason. Waiting
    on the event instead means shutdown costs only the pass in flight.

    The interval here is far longer than the loop should need, so the assertion
    is about which mechanism is used rather than about machine speed.
    """

    interval = 30.0
    factory = _Factory()
    stop = asyncio.Event()

    async def stop_after_one(_session, **_kwargs):
        stop.set()
        return None

    monkeypatch.setattr("app.notifications.worker.process_outbox_once", stop_after_one)

    started = asyncio.get_running_loop().time()
    await asyncio.wait_for(
        runner.run_worker_forever(
            factory, provider=MockEmailProvider(), interval_seconds=interval, stop=stop
        ),
        timeout=10,
    )
    elapsed = asyncio.get_running_loop().time() - started

    assert elapsed < 5.0
