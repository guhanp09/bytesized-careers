from __future__ import annotations

import asyncio
import inspect
from collections import defaultdict

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.core import rate_limit as rate_limit_module
from app.core.rate_limit import (
    InMemoryRateLimitBackend,
    RateLimitRule,
    RedisRateLimitBackend,
    ensure_rate_limit_backend_ready,
    rate_limit,
)
from scripts.exercise_redis_rate_limit import loopback_redis_url


async def test_in_memory_rate_limiter_blocks_after_limit() -> None:
    limiter = InMemoryRateLimitBackend()
    rule = RateLimitRule("unit_test", limit=2, window_seconds=60)

    assert await limiter.hit(key="client", rule=rule) == (True, 0)
    assert await limiter.hit(key="client", rule=rule) == (True, 0)

    allowed, retry_after = await limiter.hit(key="client", rule=rule)
    assert allowed is False
    assert retry_after > 0


async def test_in_memory_rate_limiter_isolated_by_key() -> None:
    limiter = InMemoryRateLimitBackend()
    rule = RateLimitRule("unit_test", limit=1, window_seconds=60)

    assert await limiter.hit(key="client-a", rule=rule) == (True, 0)
    assert await limiter.hit(key="client-b", rule=rule) == (True, 0)


class _AtomicEvalClient:
    """Protocol-faithful enough to expose multiple client-side operations.

    It does not pretend to execute Lua. The real-server exercise owns that. It
    makes the Python contract observable: every hit gets exactly one atomic
    command, arguments are server-time compatible, and concurrent callers
    interpret the single decision without a second read or write.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._members: dict[str, set[str]] = defaultdict(set)
        self.eval_calls = 0

    async def eval(
        self,
        script: str,
        number_of_keys: int,
        bucket_key: str,
        limit: int,
        window_ms: int,
        member: str,
    ) -> list[int]:
        assert script == RedisRateLimitBackend._HIT_SCRIPT
        assert number_of_keys == 1
        assert window_ms > 0
        self.eval_calls += 1
        async with self._lock:
            members = self._members[bucket_key]
            if len(members) >= limit:
                return [0, max(1, window_ms // 1000)]
            members.add(member)
            return [1, 0]


def _redis_backend(client: object) -> RedisRateLimitBackend:
    backend = object.__new__(RedisRateLimitBackend)
    backend._client = client  # type: ignore[attr-defined]
    return backend


async def test_redis_rate_limiter_has_one_atomic_decision_under_contention() -> None:
    client = _AtomicEvalClient()
    limiter = _redis_backend(client)
    rule = RateLimitRule("atomic", limit=7, window_seconds=60)

    results = await asyncio.gather(
        *(limiter.hit(key="shared-client", rule=rule) for _ in range(100))
    )

    assert sum(allowed for allowed, _ in results) == rule.limit
    assert all(retry_after == 0 for allowed, retry_after in results if allowed)
    assert all(retry_after >= 1 for allowed, retry_after in results if not allowed)
    assert client.eval_calls == 100
    assert len(client._members["rate_limit:atomic:shared-client"]) == rule.limit


async def test_redis_rate_limiter_isolates_keys_and_uses_unique_members() -> None:
    client = _AtomicEvalClient()
    limiter = _redis_backend(client)
    rule = RateLimitRule("isolated", limit=2, window_seconds=60)

    assert await limiter.hit(key="client-a", rule=rule) == (True, 0)
    assert await limiter.hit(key="client-a", rule=rule) == (True, 0)
    assert (await limiter.hit(key="client-a", rule=rule))[0] is False
    assert await limiter.hit(key="client-b", rule=rule) == (True, 0)

    assert len(client._members["rate_limit:isolated:client-a"]) == 2
    assert len(client._members["rate_limit:isolated:client-b"]) == 1


def test_redis_script_owns_time_expiry_and_the_entire_decision() -> None:
    script = RedisRateLimitBackend._HIT_SCRIPT
    hit_source = inspect.getsource(RedisRateLimitBackend.hit)

    assert 'redis.call("TIME")' in script
    assert 'redis.call("ZREMRANGEBYSCORE"' in script
    assert 'redis.call("ZCARD"' in script
    assert 'redis.call("ZADD"' in script
    assert 'redis.call("PEXPIRE"' in script
    assert "pipeline" not in hit_source
    assert "time.time" not in hit_source
    assert hit_source.count("await self._client.eval(") == 1


class _MalformedRedisClient:
    async def eval(self, *_args: object) -> list[int]:
        return [1, 15]


async def test_malformed_redis_decision_fails_closed() -> None:
    limiter = _redis_backend(_MalformedRedisClient())

    with pytest.raises(RuntimeError, match="invalid decision"):
        await limiter.hit(
            key="client",
            rule=RateLimitRule("malformed", limit=1, window_seconds=60),
        )


class _UnavailableBackend:
    async def hit(self, *, key: str, rule: RateLimitRule) -> tuple[bool, int]:
        del key, rule
        raise RuntimeError("redis://private-user:private-password@cache.internal:6379")


async def test_dependency_returns_safe_503_instead_of_falling_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rate_limit_module.settings, "app_env", "development")
    monkeypatch.setattr(rate_limit_module, "_limiter", _UnavailableBackend())
    dependency = rate_limit(RateLimitRule("unavailable", 1, 60)).dependency
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/protected",
            "headers": [],
            "query_string": b"",
            "server": ("test", 80),
            "client": ("203.0.113.5", 12345),
            "scheme": "http",
        }
    )

    with pytest.raises(HTTPException) as captured:
        await dependency(request)

    assert captured.value.status_code == 503
    assert "private" not in str(captured.value.detail)
    assert "cache.internal" not in str(captured.value.detail)
    assert isinstance(rate_limit_module._limiter, _UnavailableBackend)


class _PingClient:
    def __init__(self, result: object = True, error: Exception | None = None) -> None:
        self.result = result
        self.error = error

    async def ping(self) -> object:
        if self.error is not None:
            raise self.error
        return self.result


async def test_production_boot_probe_accepts_only_a_real_redis_ping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend = _redis_backend(_PingClient())
    monkeypatch.setattr(rate_limit_module, "_limiter", backend)
    await ensure_rate_limit_backend_ready()

    backend._client = _PingClient(error=RuntimeError("secret cache host"))  # type: ignore[attr-defined]
    with pytest.raises(RuntimeError, match="Shared rate-limit backend is unavailable") as captured:
        await ensure_rate_limit_backend_ready()
    assert "secret cache host" not in str(captured.value)


@pytest.mark.parametrize(
    "url",
    [
        "redis://127.0.0.1:6379/15",
        "redis://localhost:6379/15",
        "redis://[::1]:6379/15",
        "rediss://user:password@127.0.0.1:6380/15",
    ],
)
def test_real_redis_exercise_accepts_only_explicit_loopback_urls(url: str) -> None:
    assert loopback_redis_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "http://127.0.0.1:6379",
        "redis://10.0.0.5:6379/15",
        "redis://cache.internal:6379/15",
    ],
)
def test_real_redis_exercise_cannot_target_a_hosted_service(url: str | None) -> None:
    with pytest.raises(RuntimeError, match="RATE_LIMIT_TEST_REDIS_URL"):
        loopback_redis_url(url)


def test_application_lifecycle_probes_and_closes_the_shared_limiter() -> None:
    from app.main import on_shutdown, on_startup

    assert "await ensure_rate_limit_backend_ready()" in inspect.getsource(on_startup)
    assert "await close_rate_limit_backend()" in inspect.getsource(on_shutdown)
