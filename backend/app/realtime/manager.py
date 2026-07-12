"""Small replaceable broadcaster for authenticated conversation WebSockets.

This is intentionally in-process for the local/single-instance deployment model.
The public methods are the transport boundary: a future Redis/NATS adapter can
implement the same methods without changing marketplace or messaging services.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import WebSocket


@dataclass
class _Connection:
    websocket: WebSocket
    user_id: UUID
    subscriptions: set[str] = field(default_factory=set)
    typing_conversations: set[str] = field(default_factory=set)
    typing_recipients: dict[str, UUID] = field(default_factory=dict)


class ConversationRealtimeManager:
    def __init__(self) -> None:
        self._connections: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._by_socket: dict[WebSocket, _Connection] = {}
        self._typing_expiry_tasks: dict[tuple[WebSocket, str], asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user_id: UUID, subprotocol: str) -> None:
        await websocket.accept(subprotocol=subprotocol)
        async with self._lock:
            self._connections[user_id].add(websocket)
            self._by_socket[websocket] = _Connection(websocket=websocket, user_id=user_id)

    async def disconnect(self, websocket: WebSocket) -> None:
        removed_typing: list[tuple[UUID, str, UUID]] = []
        async with self._lock:
            connection = self._by_socket.pop(websocket, None)
            if connection is None:
                return
            sockets = self._connections.get(connection.user_id)
            if sockets is not None:
                sockets.discard(websocket)
                if not sockets:
                    self._connections.pop(connection.user_id, None)
            for conversation_id in list(connection.typing_conversations):
                recipient_user_id = connection.typing_recipients.get(conversation_id)
                if recipient_user_id is not None:
                    removed_typing.append((connection.user_id, conversation_id, recipient_user_id))
            for key, task in list(self._typing_expiry_tasks.items()):
                if key[0] is websocket:
                    task.cancel()
                    self._typing_expiry_tasks.pop(key, None)
        for user_id, conversation_id, recipient_user_id in removed_typing:
            if not await self._user_is_typing_elsewhere(user_id, conversation_id):
                # The router only records typing for authorised participants; this
                # cleanup broadcasts to the opposite participant explicitly.
                await self.publish_typing_cleared(user_id, conversation_id, recipient_user_id)

    async def _user_is_typing_elsewhere(self, user_id: UUID, conversation_id: str) -> bool:
        async with self._lock:
            return any(
                conversation_id in self._by_socket[socket].typing_conversations
                for socket in self._connections.get(user_id, set())
                if socket in self._by_socket
            )

    async def subscribe(self, websocket: WebSocket, conversation_id: str) -> None:
        async with self._lock:
            connection = self._by_socket.get(websocket)
            if connection is not None:
                connection.subscriptions.add(conversation_id)

    async def unsubscribe(self, websocket: WebSocket, conversation_id: str) -> None:
        cleared: tuple[UUID, UUID] | None = None
        async with self._lock:
            connection = self._by_socket.get(websocket)
            if connection is not None:
                connection.subscriptions.discard(conversation_id)
                recipient_user_id = connection.typing_recipients.get(conversation_id)
                connection.typing_conversations.discard(conversation_id)
                connection.typing_recipients.pop(conversation_id, None)
                task = self._typing_expiry_tasks.pop((websocket, conversation_id), None)
                if task is not None:
                    task.cancel()
                if recipient_user_id is not None:
                    cleared = (connection.user_id, recipient_user_id)
        if cleared and not await self._user_is_typing_elsewhere(cleared[0], conversation_id):
            await self.publish_typing_cleared(cleared[0], conversation_id, cleared[1])

    async def _targets(
        self,
        user_id: UUID,
        *,
        conversation_id: str | None = None,
    ) -> list[WebSocket]:
        async with self._lock:
            sockets = list(self._connections.get(user_id, set()))
            if conversation_id is None:
                return sockets
            return [
                socket
                for socket in sockets
                if conversation_id in self._by_socket.get(socket, _Connection(socket, user_id)).subscriptions
            ]

    async def _send_many(self, sockets: list[WebSocket], payload: dict[str, Any]) -> None:
        failures: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                failures.append(socket)
        for socket in failures:
            await self.disconnect(socket)

    async def publish_to_user(
        self,
        user_id: UUID,
        payload: dict[str, Any],
        *,
        conversation_id: str | None = None,
    ) -> None:
        await self._send_many(await self._targets(user_id, conversation_id=conversation_id), payload)

    async def publish_to_participants(
        self,
        participant_ids: tuple[UUID, UUID],
        payload_by_user: dict[UUID, dict[str, Any]],
        *,
        conversation_id: str | None = None,
    ) -> None:
        for participant_id in participant_ids:
            payload = payload_by_user.get(participant_id)
            if payload is not None:
                await self.publish_to_user(participant_id, payload, conversation_id=conversation_id)

    async def update_typing(
        self,
        websocket: WebSocket,
        *,
        conversation_id: str,
        is_typing: bool,
        recipient_user_id: UUID,
    ) -> None:
        should_publish = True
        async with self._lock:
            connection = self._by_socket.get(websocket)
            if connection is None:
                return
            key = (websocket, conversation_id)
            old_task = self._typing_expiry_tasks.pop(key, None)
            if old_task is not None:
                old_task.cancel()
            if is_typing:
                connection.typing_conversations.add(conversation_id)
                connection.typing_recipients[conversation_id] = recipient_user_id
                self._typing_expiry_tasks[key] = asyncio.create_task(
                    self._expire_typing(websocket, conversation_id, recipient_user_id)
                )
            else:
                connection.typing_conversations.discard(conversation_id)
                connection.typing_recipients.pop(conversation_id, None)
            sender_id = connection.user_id

            # A single user can have the same thread open in multiple tabs. A
            # false update from one tab must not make the other participant's
            # indicator flicker while another tab is still actively typing.
            if not is_typing:
                should_publish = not any(
                    conversation_id in self._by_socket[socket].typing_conversations
                    for socket in self._connections.get(sender_id, set())
                    if socket in self._by_socket
                )

        if not should_publish:
            return

        event = {
            "type": "conversation.typing",
            "event_id": str(uuid4()),
            "conversation_id": conversation_id,
            "sender_user_id": str(sender_id),
            "is_typing": is_typing,
            "expires_at": (
                datetime.now(timezone.utc).timestamp() + 6 if is_typing else None
            ),
        }
        await self.publish_to_user(recipient_user_id, event, conversation_id=conversation_id)

    async def _expire_typing(
        self,
        websocket: WebSocket,
        conversation_id: str,
        recipient_user_id: UUID,
    ) -> None:
        try:
            await asyncio.sleep(6)
        except asyncio.CancelledError:
            return
        async with self._lock:
            connection = self._by_socket.get(websocket)
            if connection is None:
                return
            connection.typing_conversations.discard(conversation_id)
            connection.typing_recipients.pop(conversation_id, None)
            self._typing_expiry_tasks.pop((websocket, conversation_id), None)
            sender_id = connection.user_id
        if not await self._user_is_typing_elsewhere(sender_id, conversation_id):
            await self.publish_typing_cleared(sender_id, conversation_id, recipient_user_id)

    async def publish_typing_cleared(
        self,
        sender_user_id: UUID,
        conversation_id: str,
        recipient_user_id: UUID | None = None,
    ) -> None:
        # If the reciprocal user is unknown (disconnect cleanup), there is no safe
        # global recipient lookup here; the next subscription/event naturally clears
        # client-side expiry. The router passes it for normal typing transitions.
        if recipient_user_id is None:
            return
        await self.publish_to_user(
            recipient_user_id,
            {
                "type": "conversation.typing",
                "event_id": str(uuid4()),
                "conversation_id": conversation_id,
                "sender_user_id": str(sender_user_id),
                "is_typing": False,
                "expires_at": None,
            },
            conversation_id=conversation_id,
        )


realtime_manager = ConversationRealtimeManager()
