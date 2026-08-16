"""The seam between "this event happened" and "these sockets hear about it".

Today every socket lives in the process that publishes to it, so a direct call
works. With a second instance it stops working, and it stops working silently:
a recruiter connected to instance 2 simply never sees the message someone sent
through instance 1. Nothing errors, nothing logs, and the only symptom is a
conversation that looks dead until the page is reloaded.

What this module adds is the place a shared broker plugs in. The in-process bus
is exactly today's behaviour, kept honest by two things.

First, delivery is DEDUPLICATED by event id. A shared broker delivers at least
once, so the same event will arrive twice, and the code that handles that has to
exist before the broker does — otherwise the first duplicate in production is
also the first test of the code path. Most payloads here are already idempotent
by design (an unread event carries a COUNT, not a delta), which is worth
preserving: dedupe is the second line, not the first.

Second, production must not quietly run on the in-process bus. Two instances
each talking to themselves look healthy from every angle — no errors, no alerts,
just users who intermittently miss events. So configuration decides, and
production refuses to start on the process-local adapter unless someone says in
so many words that it is deliberate.

The events themselves stay small. A payload is a hint that something changed;
the HTTP API and the database remain authoritative, so nothing here needs to
carry private content across a broker to be useful.
"""

from __future__ import annotations

import logging
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import UUID

logger = logging.getLogger(__name__)

#: How many recently delivered event ids to remember per connection. Small: it
#: only has to cover the window in which a broker might redeliver, and an
#: unbounded set is a memory leak that lasts as long as the socket does.
DEDUPE_WINDOW = 256


@dataclass(frozen=True)
class RealtimeEvent:
    """One thing that happened, addressed to one user.

    `event_id` is the identity a duplicate shares, so it is required rather than
    optional — an event without one cannot be deduplicated, and "usually unique"
    is not an identity.
    """

    event_id: str
    user_id: UUID
    payload: dict[str, Any]
    conversation_id: str | None = None

    def __post_init__(self) -> None:
        if not self.event_id:
            raise ValueError("A realtime event needs an id to be deduplicated by.")


#: What a bus calls when an event should reach this process's sockets.
LocalDelivery = Callable[[RealtimeEvent], Awaitable[None]]


class RealtimeBus(Protocol):
    """What the application needs from a way to move events between instances."""

    def set_local_delivery(self, deliver: LocalDelivery) -> None: ...

    async def publish(self, event: RealtimeEvent) -> None: ...


class InProcessRealtimeBus:
    """Delivers straight back to this process. Correct for one instance only.

    Not a fallback for production. Two instances each running this look perfectly
    healthy while quietly serving different halves of a conversation, which is
    the failure mode that no dashboard shows.
    """

    name = "memory"

    def __init__(self) -> None:
        self._deliver: LocalDelivery | None = None

    def set_local_delivery(self, deliver: LocalDelivery) -> None:
        self._deliver = deliver

    async def publish(self, event: RealtimeEvent) -> None:
        if self._deliver is None:
            # Nothing is listening in this process yet. Dropping is correct: the
            # database already holds the truth, and a client reconciles on
            # connect regardless of what it missed.
            return
        await self._deliver(event)


@dataclass
class DeliveryDeduplicator:
    """Remembers what a connection has already been sent.

    Per connection rather than per user or per process: two tabs are two
    audiences, and an event delivered to one is not delivered to the other.
    An OrderedDict rather than a set because the window has to be bounded, and
    bounding it means knowing what to forget first.
    """

    window: int = DEDUPE_WINDOW
    _seen: OrderedDict[str, None] = field(default_factory=OrderedDict)

    def is_duplicate(self, event_id: str) -> bool:
        if event_id in self._seen:
            # Refreshed so a repeatedly redelivered event stays remembered
            # rather than ageing out and being delivered again.
            self._seen.move_to_end(event_id)
            return True
        self._seen[event_id] = None
        while len(self._seen) > self.window:
            self._seen.popitem(last=False)
        return False


class UnsafeRealtimeConfigurationError(Exception):
    """The configured bus cannot do what this deployment needs."""


def build_realtime_bus() -> RealtimeBus:
    """The bus this deployment should use, or a refusal.

    Refusing at startup is the point. A process-local bus in a multi-instance
    deployment produces no error at any later moment — it produces users who
    miss events, reported eventually as "messaging is flaky".
    """

    from app.core.config import settings

    configured = (settings.realtime_bus or "memory").strip().lower()

    if configured != "memory":
        # No other adapter exists yet. Naming one that is not implemented must
        # not silently downgrade to process-local delivery.
        raise UnsafeRealtimeConfigurationError(
            f"Realtime bus {configured!r} is configured but not implemented."
        )

    if settings.app_env == "production" and not settings.allow_process_local_realtime_in_production:
        raise UnsafeRealtimeConfigurationError(
            "The process-local realtime bus cannot be used in production unless "
            "ALLOW_PROCESS_LOCAL_REALTIME_IN_PRODUCTION is set: with more than one "
            "instance, each one would deliver only to its own connections and "
            "users would silently miss events."
        )

    return InProcessRealtimeBus()
