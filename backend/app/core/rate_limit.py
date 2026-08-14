from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Protocol

from fastapi import Depends, HTTPException, Request, status

from app.core.config import settings


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    limit: int
    window_seconds: int


class RateLimitBackend(Protocol):
    async def hit(self, *, key: str, rule: RateLimitRule) -> tuple[bool, int]:
        """Return whether the request is allowed and the retry-after seconds."""


class InMemoryRateLimitBackend:
    """Process-local fallback store for development, tests, and single-process demos."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._buckets: dict[str, list[float]] = {}

    async def hit(self, *, key: str, rule: RateLimitRule) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - rule.window_seconds
        bucket_key = f"{rule.name}:{key}"
        with self._lock:
            current = [stamp for stamp in self._buckets.get(bucket_key, []) if stamp > cutoff]
            if len(current) >= rule.limit:
                retry_after = max(1, int(rule.window_seconds - (now - min(current))))
                self._buckets[bucket_key] = current
                return False, retry_after
            current.append(now)
            self._buckets[bucket_key] = current
            return True, 0


class RedisRateLimitBackend:
    """Redis-backed limiter.

    The implementation intentionally imports redis lazily. Local development does
    not need Redis installed, while production can opt into RATE_LIMIT_BACKEND=redis
    after adding the redis package and REDIS_URL to the deployment.
    """

    def __init__(self, redis_url: str) -> None:
        try:
            from redis import asyncio as redis_asyncio  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - depends on optional deployment package
            raise RuntimeError(
                "RATE_LIMIT_BACKEND=redis requires the optional 'redis' Python package. "
                "Install redis>=5 and set REDIS_URL."
            ) from exc

        self._client = redis_asyncio.from_url(redis_url, decode_responses=True)

    async def hit(self, *, key: str, rule: RateLimitRule) -> tuple[bool, int]:
        now_ms = int(time.time() * 1000)
        window_ms = rule.window_seconds * 1000
        cutoff_ms = now_ms - window_ms
        bucket_key = f"rate_limit:{rule.name}:{key}"
        pipe = self._client.pipeline()
        pipe.zremrangebyscore(bucket_key, 0, cutoff_ms)
        pipe.zcard(bucket_key)
        _, count = await pipe.execute()
        if int(count) >= rule.limit:
            oldest = await self._client.zrange(bucket_key, 0, 0, withscores=True)
            if oldest:
                retry_after = max(1, int((int(oldest[0][1]) + window_ms - now_ms) / 1000))
            else:
                retry_after = rule.window_seconds
            return False, retry_after
        await self._client.zadd(bucket_key, {f"{now_ms}:{uuid.uuid4().hex}": now_ms})
        await self._client.expire(bucket_key, rule.window_seconds)
        return True, 0


def _build_backend() -> RateLimitBackend:
    if settings.rate_limit_backend == "redis":
        if not settings.redis_url:
            raise RuntimeError("REDIS_URL is required when RATE_LIMIT_BACKEND=redis.")
        return RedisRateLimitBackend(settings.redis_url)
    return InMemoryRateLimitBackend()


_limiter: RateLimitBackend = _build_backend()


def _client_key(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(rule: RateLimitRule):
    async def dependency(request: Request) -> None:
        if settings.app_env == "test":
            return
        allowed, retry_after = await _limiter.hit(key=_client_key(request), rule=rule)
        if allowed:
            return
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait a moment and try again.",
            headers={"Retry-After": str(retry_after)},
        )

    return Depends(dependency)


AUTH_REGISTER_LIMIT = RateLimitRule("auth_register", limit=30, window_seconds=600)
AUTH_LOGIN_LIMIT = RateLimitRule("auth_login", limit=60, window_seconds=300)
AUTH_EMAIL_LIMIT = RateLimitRule("auth_email", limit=30, window_seconds=600)
STRONG_AUTH_ENROLL_LIMIT = RateLimitRule(
    "strong_auth_enroll",
    limit=5,
    window_seconds=3600,
)
STRONG_AUTH_CHALLENGE_LIMIT = RateLimitRule(
    "strong_auth_challenge",
    limit=20,
    window_seconds=300,
)
STRONG_AUTH_FACTOR_CHANGE_LIMIT = RateLimitRule(
    "strong_auth_factor_change",
    limit=5,
    window_seconds=3600,
)
MARKETPLACE_ACTION_LIMIT = RateLimitRule("marketplace_action", limit=120, window_seconds=300)
REPORT_LIMIT = RateLimitRule("report", limit=30, window_seconds=600)
CHECKOUT_LIMIT = RateLimitRule("checkout", limit=30, window_seconds=600)
