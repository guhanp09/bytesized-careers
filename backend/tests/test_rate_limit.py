from __future__ import annotations

from app.core.rate_limit import InMemoryRateLimitBackend, RateLimitRule


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
