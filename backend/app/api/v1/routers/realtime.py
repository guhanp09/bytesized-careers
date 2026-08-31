"""Authenticated WebSocket transport for low-latency conversation events.

HTTP remains the persistence and history API.  This route accepts no client-created
messages or status changes; clients may only subscribe to their own conversations
and send ephemeral typing presence.
"""

from __future__ import annotations

import asyncio
import json
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.api.deps import resolve_access_token_user
from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Conversation
from app.realtime.manager import realtime_manager
from app.services import blocking_service
from app.services import messaging_service as ms

router = APIRouter(tags=["realtime"])

REALTIME_SUBPROTOCOL = "creatorjobs.realtime.v1"
AUTH_RECHECK_SECONDS = 30


def _token_from_subprotocols(websocket: WebSocket) -> str | None:
    """Read the bearer token from a WebSocket subprotocol, never a user id.

    JWTs contain only protocol-token-safe Base64URL characters and dots.  Keeping
    the credential out of the URL avoids leaking it through normal request logs.
    """

    offered = websocket.headers.get("sec-websocket-protocol", "")
    candidates = [part.strip() for part in offered.split(",") if part.strip()]
    # ASGI servers normally expose the same list via the header. Starlette's
    # in-process WebSocket test transport, however, may provide it only on the
    # standard scope field. Supporting both keeps the protocol contract the
    # same in browsers and isolated transport tests.
    if not candidates:
        candidates = [
            str(part).strip()
            for part in websocket.scope.get("subprotocols", [])
            if str(part).strip()
        ]
    if REALTIME_SUBPROTOCOL not in candidates:
        return None
    # The protocol label itself has dots, so it must be excluded explicitly
    # before selecting the three-segment JWT. Otherwise every authenticated
    # handshake gets decoded as ``creatorjobs.realtime.v1`` and is rejected.
    return next(
        (
            part
            for part in candidates
            if part != REALTIME_SUBPROTOCOL and part.count(".") == 2
        ),
        None,
    )


async def _conversation_for_participant(
    conversation_id: str,
    user_id: UUID,
) -> Conversation | None:
    try:
        parsed_id = UUID(conversation_id)
    except (TypeError, ValueError):
        return None
    async with SessionLocal() as session:
        conversation = (
            await session.execute(select(Conversation).where(Conversation.id == parsed_id))
        ).scalar_one_or_none()
        if conversation is None or not ms.is_participant(conversation, user_id):
            return None
        # Detached scalar fields are enough for the manager and client event.
        return conversation


def _origin_is_allowed(websocket: WebSocket) -> bool:
    """WebSocket handshakes are not covered by HTTP CORS middleware.

    Browser clients should only connect from a configured frontend origin. Test
    clients and non-browser tooling do not always send an Origin header, so an
    absent header is allowed; an explicit unrecognised browser origin is not.
    """

    origin = websocket.headers.get("origin")
    if not origin:
        return True
    allowed = set(settings.cors_origins)
    allowed.add(settings.frontend_base_url.rstrip("/"))
    return origin.rstrip("/") in {value.rstrip("/") for value in allowed}


async def _resolve_socket_user(token: str):
    """Revalidate the same identity checks used for ordinary HTTP requests."""

    async with SessionLocal() as session:
        return await resolve_access_token_user(session=session, token=token)


async def _send_error(websocket: WebSocket, code: str) -> None:
    await websocket.send_json({"type": "error", "event_id": code, "code": code})


@router.websocket("/ws/conversations")
async def conversation_socket(websocket: WebSocket) -> None:
    if not _origin_is_allowed(websocket):
        await websocket.close(code=4403)
        return
    token = _token_from_subprotocols(websocket)
    if not token:
        await websocket.close(code=4401)
        return
    try:
        user = await _resolve_socket_user(token)
        if user is None:
            await websocket.close(code=4401)
            return
        user_id = user.id
    except HTTPException:
        await websocket.close(code=4401)
        return

    await realtime_manager.connect(websocket, user_id, REALTIME_SUBPROTOCOL)
    await websocket.send_json({"type": "connected", "event_id": f"connected:{uuid4()}"})
    try:
        while True:
            try:
                raw = await asyncio.wait_for(
                    websocket.receive_text(), timeout=AUTH_RECHECK_SECONDS
                )
            except TimeoutError:
                # This catches expired/revoked QA persona sessions even when a
                # quiet browser tab sends no new typing or subscription event.
                try:
                    refreshed_user = await _resolve_socket_user(token)
                except HTTPException:
                    await websocket.close(code=4401)
                    return
                if refreshed_user is None or refreshed_user.id != user_id:
                    await websocket.close(code=4401)
                    return
                continue
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                await _send_error(websocket, "invalid_event")
                continue
            if not isinstance(event, dict):
                await _send_error(websocket, "invalid_event")
                continue
            # Persona/controller access can be revoked after the handshake. Do
            # not permit a stale socket to subscribe or emit presence updates.
            try:
                refreshed_user = await _resolve_socket_user(token)
            except HTTPException:
                await websocket.close(code=4401)
                return
            if refreshed_user is None or refreshed_user.id != user_id:
                await websocket.close(code=4401)
                return
            event_type = event.get("type")
            if event_type == "ping":
                await websocket.send_json({"type": "pong", "event_id": "pong"})
                continue
            conversation_id = event.get("conversation_id")
            if not isinstance(conversation_id, str):
                await _send_error(websocket, "invalid_conversation")
                continue
            conversation = await _conversation_for_participant(conversation_id, user_id)
            if conversation is None:
                await _send_error(websocket, "conversation_forbidden")
                continue
            other_user_id = ms.other_participant_id(conversation, user_id)
            if event_type != "unsubscribe":
                async with SessionLocal() as session:
                    if await blocking_service.interaction_is_blocked(
                        session, conversation.participant_a_user_id, conversation.participant_b_user_id
                    ):
                        await _send_error(websocket, "conversation_unavailable")
                        continue
            if event_type == "subscribe":
                await realtime_manager.subscribe(websocket, conversation_id)
                await websocket.send_json(
                    {"type": "subscribed", "event_id": f"subscribed:{conversation_id}", "conversation_id": conversation_id}
                )
                continue
            if event_type == "unsubscribe":
                await realtime_manager.update_typing(
                    websocket,
                    conversation_id=conversation_id,
                    is_typing=False,
                    recipient_user_id=other_user_id,
                )
                await realtime_manager.unsubscribe(websocket, conversation_id)
                continue
            if event_type != "typing" or not isinstance(event.get("is_typing"), bool):
                await _send_error(websocket, "unsupported_event")
                continue
            async with SessionLocal() as session:
                fresh = (
                    await session.execute(select(Conversation).where(Conversation.id == conversation.id))
                ).scalar_one_or_none()
                if fresh is None or await ms.conversation_is_closed(session, fresh):
                    await _send_error(websocket, "conversation_unavailable")
                    continue
                if await blocking_service.interaction_is_blocked(
                    session, fresh.participant_a_user_id, fresh.participant_b_user_id
                ):
                    await _send_error(websocket, "conversation_unavailable")
                    continue
            await realtime_manager.update_typing(
                websocket,
                conversation_id=conversation_id,
                is_typing=event["is_typing"],
                recipient_user_id=other_user_id,
            )
    except WebSocketDisconnect:
        pass
    finally:
        await realtime_manager.disconnect(websocket)
