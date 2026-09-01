"""Exercise the shared limiter against a real, disposable Redis service.

This is deliberately separate from the ordinary SQLite pytest aggregate: a
protocol fake can prove that Python issues one EVAL, but only Redis can execute
the Lua atomically under contention and attach the real key expiry. CI supplies
an exact Redis service image; local operators may point it only at loopback.
"""

from __future__ import annotations

import asyncio
import os
import socket
import uuid
from ipaddress import ip_address
from urllib.parse import urlsplit

from redis import asyncio as redis_asyncio

from app.core.rate_limit import RateLimitRule, RedisRateLimitBackend

ENVIRONMENT_VARIABLE = "RATE_LIMIT_TEST_REDIS_URL"


def loopback_redis_url(raw: str | None) -> str:
    if not raw:
        raise RuntimeError(f"{ENVIRONMENT_VARIABLE} is required")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"redis", "rediss"} or parsed.hostname is None:
        raise RuntimeError(f"{ENVIRONMENT_VARIABLE} must be a Redis URL")
    try:
        address = ip_address(parsed.hostname)
    except ValueError:
        if parsed.hostname.lower() != "localhost":
            raise RuntimeError(f"{ENVIRONMENT_VARIABLE} must target loopback") from None
    else:
        if not address.is_loopback:
            raise RuntimeError(f"{ENVIRONMENT_VARIABLE} must target loopback")
    return raw


def _unused_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


async def _wait_until_redis_writes_recover(
    client: redis_asyncio.Redis,
    probe_key: str,
    *,
    timeout_seconds: float,
) -> None:
    """Poll write recovery without assuming an exact server wake-up instant."""

    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    while loop.time() < deadline:
        try:
            if await client.set(probe_key, "recovered", px=5_000) is True:
                return
        except Exception:
            pass
        await asyncio.sleep(0.05)
    raise RuntimeError("The disposable Redis service did not restore writes before the deadline")


async def _wait_until_key_expires(
    client: redis_asyncio.Redis,
    key: str,
    *,
    timeout_seconds: float,
) -> None:
    """Observe real expiry rather than treating a positive TTL as equivalent proof."""

    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    while loop.time() < deadline:
        if not await client.exists(key):
            return
        await asyncio.sleep(0.05)
    raise RuntimeError("The disposable Redis rate-limit bucket did not expire")


async def exercise(redis_url: str) -> None:
    namespace = uuid.uuid4().hex
    rule = RateLimitRule(f"real_redis_{namespace}", limit=17, window_seconds=20)
    shared_key = f"shared_{namespace}"
    isolated_key = f"isolated_{namespace}"
    recovery_key = f"recovery_{namespace}"
    transient_outage_key = f"transient_outage_{namespace}"
    expiry_key = f"expiry_{namespace}"
    recovery_probe_key = f"rate_limit_test:recovery_probe:{namespace}"
    expiry_rule = RateLimitRule(
        f"real_redis_expiry_{namespace}",
        limit=1,
        window_seconds=1,
    )
    bucket_keys = [
        f"rate_limit:{rule.name}:{key}"
        for key in (shared_key, isolated_key, recovery_key, transient_outage_key)
    ]
    expiry_bucket_key = f"rate_limit:{expiry_rule.name}:{expiry_key}"
    bucket_keys.append(expiry_bucket_key)
    bucket_keys.append(recovery_probe_key)

    clients = [RedisRateLimitBackend(redis_url) for _ in range(8)]
    control = redis_asyncio.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=1.0,
        socket_timeout=1.0,
        retry_on_timeout=False,
        protocol=2,
    )
    unavailable: RedisRateLimitBackend | None = None
    try:
        await asyncio.gather(*(client.ping() for client in clients))
        await control.delete(*bucket_keys)
        results = await asyncio.gather(
            *(
                clients[index % len(clients)].hit(key=shared_key, rule=rule)
                for index in range(200)
            )
        )
        allowed = sum(decision for decision, _ in results)
        rejected = len(results) - allowed
        if allowed != rule.limit or rejected != 200 - rule.limit:
            raise RuntimeError(
                f"Atomic contention failed: allowed={allowed}, rejected={rejected}"
            )
        if not all(retry >= 1 for decision, retry in results if not decision):
            raise RuntimeError("A rejected request returned no retry window")

        stored = int(await control.zcard(bucket_keys[0]))
        ttl_ms = int(await control.pttl(bucket_keys[0]))
        if stored != rule.limit:
            raise RuntimeError(f"Redis stored {stored} admissions, expected {rule.limit}")
        if not 0 < ttl_ms <= rule.window_seconds * 1000:
            raise RuntimeError("The shared rate-limit bucket has no bounded expiry")

        if await clients[0].hit(key=isolated_key, rule=rule) != (True, 0):
            raise RuntimeError("An unrelated caller did not receive an isolated bucket")

        if await clients[0].hit(key=expiry_key, rule=expiry_rule) != (True, 0):
            raise RuntimeError("The expiry bucket did not admit its first request")
        await _wait_until_key_expires(
            control,
            expiry_bucket_key,
            timeout_seconds=4.0,
        )
        if await clients[0].hit(key=expiry_key, rule=expiry_rule) != (True, 0):
            raise RuntimeError("An expired bucket did not admit a new request")

        # A dead broker must raise rather than silently switching to a process-
        # local allowance. Then the healthy client must remain usable: an outage
        # attempt cannot poison the shared limiter after connectivity recovers.
        unavailable = RedisRateLimitBackend(
            f"redis://127.0.0.1:{_unused_loopback_port()}/15"
        )
        try:
            await asyncio.wait_for(
                unavailable.hit(key="must-fail-closed", rule=rule),
                timeout=3.0,
            )
        except Exception:
            pass
        else:
            raise RuntimeError("An unavailable Redis backend admitted a request")

        # Pause the real service longer than the production command timeout.
        # This forces the existing client pool through a genuine timeout; after
        # Redis resumes, the same pool must reconnect and safely admit a request.
        # WRITE keeps unrelated reads on a mistakenly reused local service
        # available; the module and environment name still require a disposable
        # loopback service because this command pauses all writes briefly.
        await control.execute_command("CLIENT", "PAUSE", 1500, "WRITE")
        try:
            await clients[1].hit(key=transient_outage_key, rule=rule)
        except Exception:
            pass
        else:
            raise RuntimeError("A paused Redis backend admitted a request")
        await _wait_until_redis_writes_recover(
            control,
            recovery_probe_key,
            timeout_seconds=6.0,
        )
        if await clients[1].hit(key=recovery_key, rule=rule) != (True, 0):
            raise RuntimeError("The limiter did not recover through its existing client pool")

        print(
            "Redis rate-limit exercise: "
            f"{allowed} allowed, {rejected} rejected; "
            "atomicity, isolation, expiry, outage, and recovery passed."
        )
    finally:
        await control.delete(*bucket_keys)
        await control.aclose()
        if unavailable is not None:
            await unavailable.aclose()
        await asyncio.gather(*(client.aclose() for client in clients))


def main() -> int:
    try:
        redis_url = loopback_redis_url(os.environ.get(ENVIRONMENT_VARIABLE))
        asyncio.run(exercise(redis_url))
    except Exception as exc:
        # Never echo a URL, Redis exception, key, or credential. The CI/local
        # command needs a binary result; authenticated logs carry diagnostics.
        print(f"Redis rate-limit exercise failed: {type(exc).__name__}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
