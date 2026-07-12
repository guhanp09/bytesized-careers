from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect

from app.api.v1.routers import realtime as realtime_router
from app.realtime import events as realtime_events
from app.realtime.manager import ConversationRealtimeManager
from app.models import Conversation, User
from conftest import TestSessionLocal


async def _register_verified_login(client: AsyncClient, *, email: str, username: str) -> str:
    register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "Password123!",
            "username": username,
            "display_name": username.title(),
        },
    )
    assert register.status_code in {200, 201}
    verification_token = register.json()["verification_url"].rsplit("token=", 1)[-1]
    verified = await client.post("/api/v1/auth/verify-email", json={"token": verification_token})
    assert verified.status_code == 200
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
    )
    assert login.status_code == 200
    return login.json()["access_token"]


async def _published_job(client: AsyncClient, owner_token: str, *, title: str) -> str:
    response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": title,
            "category": "Editing",
            "platforms": ["youtube"],
            "status": "published",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _application_conversation(
    client: AsyncClient,
    *,
    applicant_token: str,
    job_id: str,
) -> tuple[str, str]:
    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "I can help with this.", "portfolio_item_ids": []},
    )
    assert application.status_code == 201, application.text
    application_id = application.json()["id"]
    detail = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert detail.status_code == 200
    return application_id, detail.json()["conversation"]["id"]


class _FakeSocket:
    """Tiny WebSocket stand-in for broadcaster semantics without network I/O."""

    def __init__(self) -> None:
        self.accepted_subprotocol: str | None = None
        self.events: list[dict] = []

    async def accept(self, *, subprotocol: str | None = None) -> None:
        self.accepted_subprotocol = subprotocol

    async def send_json(self, payload: dict) -> None:
        self.events.append(payload)


async def _user_id(session: AsyncSession, email: str) -> UUID:
    return (
        await session.execute(select(User.id).where(User.email == email))
    ).scalar_one()


async def test_user_blocking_preserves_history_and_stops_new_direct_interactions(
    client: AsyncClient,
) -> None:
    owner = await _register_verified_login(client, email="block-owner@example.com", username="block_owner")
    applicant = await _register_verified_login(
        client, email="block-applicant@example.com", username="block_applicant"
    )
    owner_h = {"Authorization": f"Bearer {owner}"}
    applicant_h = {"Authorization": f"Bearer {applicant}"}
    job_id = await _published_job(client, owner, title="Blocked-pair finance editor")
    application_id, conversation_id = await _application_conversation(
        client, applicant_token=applicant, job_id=job_id
    )
    historical = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "This history must remain visible."},
    )
    assert historical.status_code == 201

    async with TestSessionLocal() as session:
        applicant_id = await _user_id(session, "block-applicant@example.com")

    blocked = await client.post(f"/api/v1/me/blocks/{applicant_id}", headers=owner_h)
    assert blocked.status_code == 200
    assert blocked.json() == {"interaction_blocked": True, "blocked_by_me": True}
    # Directional ownership makes repeat block idempotent, not a duplicate row.
    repeated = await client.post(f"/api/v1/me/blocks/{applicant_id}", headers=owner_h)
    assert repeated.status_code == 200

    owner_detail = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=owner_h)
    applicant_detail = await client.get(
        f"/api/v1/me/conversations/{conversation_id}", headers=applicant_h
    )
    assert [message["body"] for message in owner_detail.json()["messages"]] == [
        "This history must remain visible."
    ]
    assert owner_detail.json()["conversation"]["interaction_blocked"] is True
    assert owner_detail.json()["conversation"]["blocked_by_me"] is True
    assert applicant_detail.json()["conversation"]["interaction_blocked"] is True
    assert applicant_detail.json()["conversation"]["blocked_by_me"] is False
    assert applicant_detail.json()["conversation"]["counterparty_last_read_at"] is None

    blocked_message = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "This must not be delivered."},
    )
    assert blocked_message.status_code == 403

    # Existing relationships remain stable, but a different job cannot be used
    # to bypass a pair-level block.
    second_job_id = await _published_job(client, owner, title="Blocked-pair thumbnail role")
    blocked_application = await client.post(
        f"/api/v1/jobs/{second_job_id}/applications",
        headers=applicant_h,
        json={"cover_note": "Trying a second listing.", "portfolio_item_ids": []},
    )
    assert blocked_application.status_code == 403

    listing = await client.post(
        "/api/v1/talent-listings",
        headers=applicant_h,
        json={"title": "Blocked pair talent listing", "roles": ["Video editor"], "status": "published"},
    )
    assert listing.status_code == 201
    blocked_interest = await client.post(
        f"/api/v1/talent-listings/{listing.json()['id']}/interest",
        headers=owner_h,
        json={"note": "Trying a new hiring request."},
    )
    assert blocked_interest.status_code == 403

    unblocked = await client.delete(f"/api/v1/me/blocks/{applicant_id}", headers=owner_h)
    assert unblocked.status_code == 200
    assert unblocked.json() == {"interaction_blocked": False, "blocked_by_me": False}
    resumed = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "Messaging resumes only after explicit unblock."},
    )
    assert resumed.status_code == 201

    # The original immutable application remains the one and only record.
    conversation = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_h
    )
    assert conversation.status_code == 200
    assert conversation.json()["conversation"]["id"] == conversation_id


async def test_block_is_directional_for_management_and_rejects_self_or_unknown_users(
    client: AsyncClient,
) -> None:
    first = await _register_verified_login(client, email="block-first@example.com", username="block_first")
    second = await _register_verified_login(client, email="block-second@example.com", username="block_second")
    first_h = {"Authorization": f"Bearer {first}"}
    second_h = {"Authorization": f"Bearer {second}"}
    async with TestSessionLocal() as session:
        first_id = await _user_id(session, "block-first@example.com")
        second_id = await _user_id(session, "block-second@example.com")

    assert (await client.post(f"/api/v1/me/blocks/{first_id}", headers=first_h)).status_code == 422
    assert (await client.post(f"/api/v1/me/blocks/00000000-0000-0000-0000-000000000001", headers=first_h)).status_code == 404
    assert (await client.post(f"/api/v1/me/blocks/{second_id}", headers=first_h)).status_code == 200

    # The other participant cannot remove a block they do not own.
    other_remove = await client.delete(f"/api/v1/me/blocks/{first_id}", headers=second_h)
    assert other_remove.status_code == 200
    assert other_remove.json() == {"interaction_blocked": True, "blocked_by_me": False}
    listed = await client.get("/api/v1/me/blocks", headers=first_h)
    assert listed.status_code == 200
    assert [item["blocked_user_id"] for item in listed.json()] == [str(second_id)]


async def test_read_progress_is_persisted_monotonically_and_exposed_only_to_the_sender(
    client: AsyncClient,
) -> None:
    owner = await _register_verified_login(client, email="receipt-owner@example.com", username="receipt_owner")
    applicant = await _register_verified_login(
        client, email="receipt-applicant@example.com", username="receipt_applicant"
    )
    owner_h = {"Authorization": f"Bearer {owner}"}
    applicant_h = {"Authorization": f"Bearer {applicant}"}
    job_id = await _published_job(client, owner, title="Read receipt editor")
    _, conversation_id = await _application_conversation(client, applicant_token=applicant, job_id=job_id)
    message = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        headers=applicant_h,
        json={"body": "Please confirm the read receipt."},
    )
    assert message.status_code == 201

    before = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=applicant_h)
    assert before.json()["messages"][-1]["read_by_recipient"] is False
    # Fetching a thread is not itself a receipt.
    owner_fetch = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=owner_h)
    assert owner_fetch.status_code == 200
    still_unread = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=applicant_h)
    assert still_unread.json()["messages"][-1]["read_by_recipient"] is False

    marked = await client.post(f"/api/v1/me/conversations/{conversation_id}/read", headers=owner_h)
    assert marked.status_code == 200
    after = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=applicant_h)
    assert after.json()["messages"][-1]["read_by_recipient"] is True

    # A stale tab can never move read progress backwards. Seed a future value,
    # then exercise the ordinary endpoint that must preserve it.
    future = datetime.now(UTC) + timedelta(minutes=10)
    async with TestSessionLocal() as session:
        conversation = (
            await session.execute(select(Conversation).where(Conversation.id == UUID(conversation_id)))
        ).scalar_one()
        conversation.participant_b_last_read_at = future
        await session.commit()
    again = await client.post(f"/api/v1/me/conversations/{conversation_id}/read", headers=owner_h)
    assert again.status_code == 200
    assert datetime.fromisoformat(again.json()["viewer_last_read_at"]).replace(tzinfo=UTC) >= future


async def test_realtime_manager_keeps_typing_visible_until_all_sender_tabs_stop() -> None:
    manager = ConversationRealtimeManager()
    sender_id = UUID("11111111-1111-1111-1111-111111111111")
    recipient_id = UUID("22222222-2222-2222-2222-222222222222")
    first_tab = _FakeSocket()
    second_tab = _FakeSocket()
    recipient = _FakeSocket()
    conversation_id = "33333333-3333-3333-3333-333333333333"
    await manager.connect(first_tab, sender_id, "test")
    await manager.connect(second_tab, sender_id, "test")
    await manager.connect(recipient, recipient_id, "test")
    await manager.subscribe(recipient, conversation_id)

    await manager.update_typing(
        first_tab,
        conversation_id=conversation_id,
        is_typing=True,
        recipient_user_id=recipient_id,
    )
    await manager.update_typing(
        second_tab,
        conversation_id=conversation_id,
        is_typing=True,
        recipient_user_id=recipient_id,
    )
    await manager.update_typing(
        first_tab,
        conversation_id=conversation_id,
        is_typing=False,
        recipient_user_id=recipient_id,
    )
    assert recipient.events[-1]["is_typing"] is True
    await manager.update_typing(
        second_tab,
        conversation_id=conversation_id,
        is_typing=False,
        recipient_user_id=recipient_id,
    )
    assert recipient.events[-1]["is_typing"] is False

    await manager.disconnect(first_tab)
    await manager.disconnect(second_tab)
    await manager.disconnect(recipient)


async def test_authenticated_websocket_authorizes_subscriptions_and_fans_out_persisted_messages(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _register_verified_login(client, email="ws-owner@example.com", username="ws_owner")
    applicant = await _register_verified_login(client, email="ws-applicant@example.com", username="ws_applicant")
    stranger = await _register_verified_login(client, email="ws-stranger@example.com", username="ws_stranger")
    owner_h = {"Authorization": f"Bearer {owner}"}
    applicant_h = {"Authorization": f"Bearer {applicant}"}
    job_id = await _published_job(client, owner, title="WebSocket delivery editor")
    _, conversation_id = await _application_conversation(client, applicant_token=applicant, job_id=job_id)

    manager = ConversationRealtimeManager()
    monkeypatch.setattr(realtime_router, "SessionLocal", TestSessionLocal)
    monkeypatch.setattr(realtime_router, "realtime_manager", manager)
    monkeypatch.setattr(realtime_events, "realtime_manager", manager)
    socket_app = FastAPI()
    socket_app.include_router(realtime_router.router, prefix="/api/v1")

    with TestClient(socket_app) as socket_client:
        with pytest.raises(WebSocketDisconnect) as unauthenticated:
            with socket_client.websocket_connect("/api/v1/ws/conversations"):
                pass
        assert unauthenticated.value.code == 4401

        with socket_client.websocket_connect(
            "/api/v1/ws/conversations",
            subprotocols=[realtime_router.REALTIME_SUBPROTOCOL, owner],
        ) as owner_socket, socket_client.websocket_connect(
                "/api/v1/ws/conversations",
                subprotocols=[realtime_router.REALTIME_SUBPROTOCOL, applicant],
            ) as applicant_socket, socket_client.websocket_connect(
                "/api/v1/ws/conversations",
                subprotocols=[realtime_router.REALTIME_SUBPROTOCOL, stranger],
            ) as stranger_socket:
                assert owner_socket.receive_json()["type"] == "connected"
                assert applicant_socket.receive_json()["type"] == "connected"
                assert stranger_socket.receive_json()["type"] == "connected"

                owner_socket.send_json({"type": "subscribe", "conversation_id": conversation_id})
                applicant_socket.send_json({"type": "subscribe", "conversation_id": conversation_id})
                assert owner_socket.receive_json()["type"] == "subscribed"
                assert applicant_socket.receive_json()["type"] == "subscribed"

                stranger_socket.send_json({"type": "subscribe", "conversation_id": conversation_id})
                assert stranger_socket.receive_json()["code"] == "conversation_forbidden"

                applicant_socket.send_json(
                    {"type": "typing", "conversation_id": conversation_id, "is_typing": True}
                )
                typing = owner_socket.receive_json()
                assert typing["type"] == "conversation.typing"
                assert typing["is_typing"] is True

                delivered = await client.post(
                    f"/api/v1/me/conversations/{conversation_id}/messages",
                    headers=applicant_h,
                    json={"body": "WebSocket delivery without a polling wait."},
                )
                assert delivered.status_code == 201
                owner_events = {owner_socket.receive_json()["type"], owner_socket.receive_json()["type"]}
                assert owner_events == {"conversation.unread", "message.created"}
                sender_events = {
                    applicant_socket.receive_json()["type"],
                    applicant_socket.receive_json()["type"],
                }
                assert sender_events == {"conversation.unread", "message.created"}

                read = await client.post(
                    f"/api/v1/me/conversations/{conversation_id}/read", headers=owner_h
                )
                assert read.status_code == 200
                receipt = applicant_socket.receive_json()
                assert receipt["type"] == "conversation.read_progress"
                assert receipt["reader_user_id"] != receipt.get("sender_user_id")
