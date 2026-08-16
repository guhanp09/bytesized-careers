"""Moving realtime events between instances, and what must not go wrong.

Today every socket lives in the process that publishes to it. With a second
instance that stops working, and it stops working SILENTLY: someone connected to
instance 2 never sees the message sent through instance 1, nothing errors,
nothing logs, and the symptom is a conversation that looks dead until reload.

Three properties are tested here because each has a failure that is invisible
rather than loud.

A shared broker delivers at least once, so duplicates will arrive. The handling
has to exist before the broker does, or the first duplicate in production is
also the first exercise of that code path.

A publish that fails must not fail the write. The database holds the truth and
the client reconciles over HTTP, so a lost hint is a delay; raising would turn a
broker hiccup into a failed message send.

And production must not run on the process-local bus by accident. Two instances
each talking to themselves look healthy from every angle.
"""

from __future__ import annotations

import uuid

import pytest

from app.core import config
from app.realtime.bus import (
    DEDUPE_WINDOW,
    DeliveryDeduplicator,
    InProcessRealtimeBus,
    RealtimeEvent,
    UnsafeRealtimeConfigurationError,
    build_realtime_bus,
)
from app.realtime.manager import ConversationRealtimeManager


class _Socket:
    """Enough of a WebSocket to count what reached it."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.accepted_subprotocol: str | None = None

    async def accept(self, subprotocol: str | None = None) -> None:
        self.accepted_subprotocol = subprotocol

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)


class TestTheEnvelope:
    def test_an_event_must_have_an_identity(self) -> None:
        """Without one a duplicate cannot be recognised, and "usually unique"
        is not an identity."""

        with pytest.raises(ValueError, match="deduplicated"):
            RealtimeEvent(event_id="", user_id=uuid.uuid4(), payload={})

    def test_it_carries_a_hint_rather_than_the_record(self) -> None:
        """The payload is a nudge; the HTTP API and database stay
        authoritative, so nothing private needs to cross a broker."""

        event = RealtimeEvent(
            event_id="m1",
            user_id=uuid.uuid4(),
            payload={"type": "conversation.unread", "unread_count": 3},
        )

        assert set(event.payload) <= {"type", "unread_count"}


class TestDeduplication:
    def test_the_same_event_is_only_new_once(self) -> None:
        deduplicator = DeliveryDeduplicator()

        assert deduplicator.is_duplicate("event-1") is False
        assert deduplicator.is_duplicate("event-1") is True

    def test_different_events_are_independent(self) -> None:
        deduplicator = DeliveryDeduplicator()

        assert deduplicator.is_duplicate("event-1") is False
        assert deduplicator.is_duplicate("event-2") is False

    def test_the_memory_is_bounded(self) -> None:
        """An unbounded set lives as long as the socket does, which for an idle
        tab is days."""

        deduplicator = DeliveryDeduplicator(window=4)
        for index in range(10):
            deduplicator.is_duplicate(f"event-{index}")

        assert len(deduplicator._seen) == 4

    def test_a_repeatedly_redelivered_event_stays_remembered(self) -> None:
        """Otherwise a broker that redelivers steadily would age its own event
        out of the window and deliver it again as new."""

        deduplicator = DeliveryDeduplicator(window=3)
        deduplicator.is_duplicate("sticky")
        for index in range(6):
            deduplicator.is_duplicate(f"filler-{index}")
            assert deduplicator.is_duplicate("sticky") is True

    def test_the_default_window_is_not_trivial(self) -> None:
        assert DEDUPE_WINDOW >= 64


class TestDeliveryThroughTheManager:
    async def test_an_event_reaches_a_connected_socket(self) -> None:
        manager = ConversationRealtimeManager()
        socket = _Socket()
        user_id = uuid.uuid4()
        await manager.connect(socket, user_id, "bearer")

        await manager.publish_to_user(user_id, {"type": "message.created", "event_id": "m1"})

        assert [event["event_id"] for event in socket.sent] == ["m1"]

    async def test_a_duplicate_publish_is_delivered_once(self) -> None:
        """The property a shared broker makes necessary: at-least-once delivery
        must not become two toasts for one message."""

        manager = ConversationRealtimeManager()
        socket = _Socket()
        user_id = uuid.uuid4()
        await manager.connect(socket, user_id, "bearer")

        payload = {"type": "message.created", "event_id": "m1"}
        await manager.publish_to_user(user_id, payload)
        await manager.publish_to_user(user_id, payload)
        await manager.publish_to_user(user_id, payload)

        assert len(socket.sent) == 1

    async def test_every_connection_of_one_user_is_served(self) -> None:
        """Two tabs are two audiences. Deduplication is per connection, so the
        second tab must still receive an event the first already had."""

        manager = ConversationRealtimeManager()
        first, second = _Socket(), _Socket()
        user_id = uuid.uuid4()
        await manager.connect(first, user_id, "bearer")
        await manager.connect(second, user_id, "bearer")

        await manager.publish_to_user(user_id, {"type": "message.created", "event_id": "m1"})

        assert len(first.sent) == 1
        assert len(second.sent) == 1

    async def test_a_second_user_is_unaffected(self) -> None:
        """A channel name is not authorization: events are addressed to a user
        and nobody else's socket sees them."""

        manager = ConversationRealtimeManager()
        mine, theirs = _Socket(), _Socket()
        me, them = uuid.uuid4(), uuid.uuid4()
        await manager.connect(mine, me, "bearer")
        await manager.connect(theirs, them, "bearer")

        await manager.publish_to_user(me, {"type": "message.created", "event_id": "m1"})

        assert len(mine.sent) == 1
        assert theirs.sent == []

    async def test_a_reconnected_socket_may_receive_an_event_again(self) -> None:
        """Dedupe state belongs to a connection. A new connection has no history
        and must not be silenced by what an old one was sent."""

        manager = ConversationRealtimeManager()
        user_id = uuid.uuid4()
        first = _Socket()
        await manager.connect(first, user_id, "bearer")
        await manager.publish_to_user(user_id, {"type": "message.created", "event_id": "m1"})
        await manager.disconnect(first)

        second = _Socket()
        await manager.connect(second, user_id, "bearer")
        await manager.publish_to_user(user_id, {"type": "message.created", "event_id": "m1"})

        assert len(second.sent) == 1


class TestAFailingBusDoesNotFailTheWrite:
    async def test_publishing_swallows_a_broker_failure(self) -> None:
        """The message is already committed. Raising here would report a failed
        send for a message that was in fact sent."""

        class BrokenBus:
            def set_local_delivery(self, deliver) -> None:  # noqa: ANN001 - protocol shape
                return None

            async def publish(self, event: RealtimeEvent) -> None:
                raise RuntimeError("broker is unreachable")

        manager = ConversationRealtimeManager(bus=BrokenBus())
        socket = _Socket()
        user_id = uuid.uuid4()
        await manager.connect(socket, user_id, "bearer")

        await manager.publish_to_user(user_id, {"type": "message.created", "event_id": "m1"})

        assert socket.sent == []

    async def test_the_bus_drops_events_when_nothing_is_listening(self) -> None:
        """Dropping is correct: the database holds the truth and a client
        reconciles on connect regardless of what it missed."""

        bus = InProcessRealtimeBus()

        await bus.publish(RealtimeEvent(event_id="m1", user_id=uuid.uuid4(), payload={}))


class TestProductionRefusesTheProcessLocalBus:
    def test_development_gets_the_in_process_bus(self, monkeypatch) -> None:
        monkeypatch.setattr(config.settings, "app_env", "development")
        monkeypatch.setattr(config.settings, "realtime_bus", "memory")

        assert isinstance(build_realtime_bus(), InProcessRealtimeBus)

    def test_production_refuses_it(self, monkeypatch) -> None:
        """Two instances each delivering only to themselves produce no error at
        any later moment — just users who miss events."""

        monkeypatch.setattr(config.settings, "app_env", "production")
        monkeypatch.setattr(config.settings, "realtime_bus", "memory")
        monkeypatch.setattr(
            config.settings, "allow_process_local_realtime_in_production", False
        )

        with pytest.raises(UnsafeRealtimeConfigurationError, match="silently miss"):
            build_realtime_bus()

    def test_a_single_instance_deployment_can_say_so_explicitly(self, monkeypatch) -> None:
        """Allowed, but only by someone writing it down."""

        monkeypatch.setattr(config.settings, "app_env", "production")
        monkeypatch.setattr(config.settings, "realtime_bus", "memory")
        monkeypatch.setattr(
            config.settings, "allow_process_local_realtime_in_production", True
        )

        assert isinstance(build_realtime_bus(), InProcessRealtimeBus)

    def test_naming_an_unimplemented_bus_does_not_fall_back(self, monkeypatch) -> None:
        """The dangerous direction. Configuring "redis" and getting process-local
        delivery would be the exact failure this refuses, wearing a safe name."""

        monkeypatch.setattr(config.settings, "app_env", "development")
        monkeypatch.setattr(config.settings, "realtime_bus", "redis")

        with pytest.raises(UnsafeRealtimeConfigurationError, match="not implemented"):
            build_realtime_bus()
