from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from ipaddress import IPv4Network, IPv6Network, ip_address, ip_network
from threading import Lock
from typing import Literal, Protocol

from fastapi import Depends, HTTPException, Request, status
from redis import asyncio as redis_asyncio

from app.core.config import settings
from app.core.operational_metrics import record_redis_rate_limit


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    limit: int
    window_seconds: int


RateLimitIdentityScope = Literal["ip", "user"]


@dataclass(frozen=True)
class RateLimitPolicy:
    """Auditable policy metadata attached to every HTTP quota dependency."""

    rule: RateLimitRule
    identity_scope: RateLimitIdentityScope


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
    """Shared sliding-window limiter whose decision is one Redis operation."""

    #: One script, one key, one linearization point. A pipeline only batches the
    #: old remove/count calls; it does not stop two instances from both observing
    #: a count below the limit and both admitting a request. Redis executes this
    #: script atomically, and its own clock keeps application-host skew from
    #: producing different windows.
    _HIT_SCRIPT = """
local bucket_key = KEYS[1]
local request_limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local member = ARGV[3]

if request_limit == nil or request_limit < 1 then
  return redis.error_reply("rate limit must be a positive integer")
end
if window_ms == nil or window_ms < 1 then
  return redis.error_reply("rate limit window must be positive")
end

local redis_time = redis.call("TIME")
local now_ms = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local cutoff_ms = now_ms - window_ms

redis.call("ZREMRANGEBYSCORE", bucket_key, "-inf", cutoff_ms)
local count = redis.call("ZCARD", bucket_key)

if count >= request_limit then
  local oldest = redis.call("ZRANGE", bucket_key, 0, 0, "WITHSCORES")
  local retry_ms = window_ms
  if oldest[2] ~= nil then
    retry_ms = math.max(1, math.ceil(tonumber(oldest[2]) + window_ms - now_ms))
  end
  return {0, math.max(1, math.ceil(retry_ms / 1000))}
end

redis.call("ZADD", bucket_key, now_ms, member)
redis.call("PEXPIRE", bucket_key, window_ms)
return {1, 0}
"""

    def __init__(self, redis_url: str) -> None:
        self._client = redis_asyncio.from_url(
            redis_url,
            decode_responses=True,
            # A security dependency must not hold a request open indefinitely.
            socket_connect_timeout=1.0,
            socket_timeout=1.0,
            retry_on_timeout=False,
            health_check_interval=30,
            # redis-py 8 defaults to RESP3. Keep the wire contract explicit
            # while production Redis 7.2/7.4 remains supported.
            protocol=2,
        )

    async def ping(self) -> None:
        if await self._client.ping() is not True:
            raise RuntimeError("Shared rate-limit backend returned an invalid ping response.")

    async def aclose(self) -> None:
        await self._client.aclose()

    async def hit(self, *, key: str, rule: RateLimitRule) -> tuple[bool, int]:
        started = time.perf_counter()
        try:
            window_ms = rule.window_seconds * 1000
            bucket_key = f"rate_limit:{rule.name}:{key}"
            result = await self._client.eval(
                self._HIT_SCRIPT,
                1,
                bucket_key,
                rule.limit,
                window_ms,
                uuid.uuid4().hex,
            )
            if not isinstance(result, (list, tuple)) or len(result) != 2:
                raise RuntimeError("Shared rate-limit backend returned a malformed decision.")
            decision, retry_after = int(result[0]), int(result[1])
            if decision == 1 and retry_after == 0:
                allowed = True
            elif decision == 0 and retry_after >= 1:
                allowed = False
            else:
                raise RuntimeError("Shared rate-limit backend returned an invalid decision.")
        except Exception:
            record_redis_rate_limit(
                allowed=None,
                elapsed_seconds=time.perf_counter() - started,
            )
            raise
        record_redis_rate_limit(
            allowed=allowed,
            elapsed_seconds=time.perf_counter() - started,
        )
        return allowed, retry_after


def _build_backend() -> RateLimitBackend:
    if settings.rate_limit_backend == "redis":
        if not settings.redis_url:
            raise RuntimeError("REDIS_URL is required when RATE_LIMIT_BACKEND=redis.")
        return RedisRateLimitBackend(settings.redis_url)
    return InMemoryRateLimitBackend()


_limiter: RateLimitBackend = _build_backend()


async def ensure_rate_limit_backend_ready() -> None:
    """Refuse production startup when its required shared limiter is unreachable."""

    if isinstance(_limiter, RedisRateLimitBackend):
        try:
            await _limiter.ping()
        except Exception as exc:
            raise RuntimeError("Shared rate-limit backend is unavailable.") from exc


async def close_rate_limit_backend() -> None:
    if isinstance(_limiter, RedisRateLimitBackend):
        await _limiter.aclose()


def _parse_networks(raw: str | None) -> tuple[IPv4Network | IPv6Network, ...]:
    """The configured proxy addresses, as networks. Unparseable entries are dropped."""

    if not raw:
        return ()
    networks: list[IPv4Network | IPv6Network] = []
    for entry in raw.split(","):
        candidate = entry.strip()
        if not candidate:
            continue
        try:
            # `strict=False` so a bare address and a CIDR block are both accepted.
            networks.append(ip_network(candidate, strict=False))
        except ValueError:
            # A typo in configuration must not silently widen trust. Dropping the
            # entry means that proxy is simply not trusted, which fails safe.
            continue
    return tuple(networks)


@lru_cache(maxsize=1)
def _trusted_proxies() -> tuple[IPv4Network | IPv6Network, ...]:
    return _parse_networks(settings.trusted_proxy_ips)


def _is_trusted(candidate: str, networks: tuple[IPv4Network | IPv6Network, ...]) -> bool:
    if not networks:
        return False
    try:
        address = ip_address(candidate)
    except ValueError:
        return False
    return any(address in network for network in networks)


def client_identity(request: Request) -> str:
    """Who this request is, for the purpose of counting it.

    `X-Forwarded-For` is a string the caller chose. It is only evidence when the
    peer that handed it to us is a proxy we put there ourselves — otherwise every
    limit in the product is one header away from being meaningless, because a
    different value produces a different bucket.

    The chain is read right to left, which is the only direction that is
    trustworthy: entries are appended by each hop, so the rightmost ones were
    written by our own infrastructure and anything further left could have been
    supplied by the client. The first address that is not one of our proxies is
    the closest thing to the real caller.
    """

    peer = request.client.host if request.client else None
    if not peer:
        return "unknown"

    networks = _trusted_proxies()
    if not _is_trusted(peer, networks):
        # Either nothing is configured in front of us, or this connection did not
        # come through it. Believe the socket and nothing else.
        return peer

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return peer

    for entry in reversed(forwarded.split(",")):
        hop = entry.strip()
        if not hop or _is_trusted(hop, networks):
            continue
        try:
            address = ip_address(hop)
        except ValueError:
            # A malformed hop is not an identity. Stop rather than reach further
            # left into entries the client could have written.
            break
        # `::ffff:1.2.3.4` is the same caller as `1.2.3.4`, and two spellings
        # would otherwise be two separate allowances.
        mapped = getattr(address, "ipv4_mapped", None)
        return str(mapped or address)
    return peer


def client_rate_limit_key(request: Request) -> str:
    """Namespace anonymous/pre-auth callers so they cannot collide with users."""

    return f"ip:{client_identity(request)}"


def user_rate_limit_key(user_id: object) -> str:
    """Return the stable cross-device bucket for an independently verified user."""

    return f"user:{user_id}"


_POLICY_ATTRIBUTE = "__creatorjobs_rate_limit_policy__"


def tag_rate_limit_dependency(
    dependency: Callable[..., object],
    *,
    rule: RateLimitRule,
    identity_scope: RateLimitIdentityScope,
) -> None:
    """Expose route policy to structural tests and future inventory tooling."""

    setattr(
        dependency,
        _POLICY_ATTRIBUTE,
        RateLimitPolicy(rule=rule, identity_scope=identity_scope),
    )


def rate_limit_policy_for(dependency: object) -> RateLimitPolicy | None:
    policy = getattr(dependency, _POLICY_ATTRIBUTE, None)
    return policy if isinstance(policy, RateLimitPolicy) else None


async def enforce_rate_limit(*, key: str, rule: RateLimitRule) -> None:
    """Apply one policy through the configured backend, failing closed safely."""

    if settings.app_env == "test":
        return
    try:
        allowed, retry_after = await _limiter.hit(key=key, rule=rule)
    except Exception as exc:
        # Never fall back to the process-local store after a shared-backend
        # outage: two instances would silently grant separate allowances.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Request safeguards are temporarily unavailable. Please try again.",
        ) from exc
    if allowed:
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many requests. Please wait a moment and try again.",
        headers={"Retry-After": str(retry_after)},
    )


def rate_limit(rule: RateLimitRule):
    async def dependency(request: Request) -> None:
        await enforce_rate_limit(
            key=client_rate_limit_key(request),
            rule=rule,
        )

    tag_rate_limit_dependency(dependency, rule=rule, identity_scope="ip")
    return Depends(dependency)


AUTH_REGISTER_LIMIT = RateLimitRule("auth_register", limit=30, window_seconds=600)
AUTH_LOGIN_LIMIT = RateLimitRule("auth_login", limit=60, window_seconds=300)
AUTH_EMAIL_LIMIT = RateLimitRule("auth_email", limit=30, window_seconds=600)
# Token checks are cheap but externally reachable; refresh is intentionally
# looser for households/offices whose legitimate sessions share one public IP.
AUTH_VERIFY_LIMIT = RateLimitRule("auth_verify", limit=60, window_seconds=600)
AUTH_REFRESH_LIMIT = RateLimitRule("auth_refresh", limit=120, window_seconds=300)
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
# These rules are shared within each category. Switching from a portfolio
# preview to organization lookup, or from avatar to banner, cannot mint a new
# allowance while ordinary interactive use still has ample headroom.
OUTBOUND_FETCH_LIMIT = RateLimitRule("outbound_fetch", limit=30, window_seconds=600)
LOCATION_LOOKUP_LIMIT = RateLimitRule("location_lookup", limit=120, window_seconds=60)
MEDIA_UPLOAD_LIMIT = RateLimitRule("media_upload", limit=20, window_seconds=3600)
PUBLIC_SEARCH_LIMIT = RateLimitRule("public_search", limit=120, window_seconds=60)
ADMIN_REQUEST_LIMIT = RateLimitRule("admin_request", limit=300, window_seconds=300)
REPORT_LIMIT = RateLimitRule("report", limit=30, window_seconds=600)
CLIENT_ERROR_LIMIT = RateLimitRule("client_error", limit=30, window_seconds=300)
