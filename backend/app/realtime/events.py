"""Authoritative real-time event emitters for persisted conversation changes."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Conversation, Message
from app.realtime.manager import realtime_manager
from app.services import blocking_service
from app.services import messaging_service as ms


async def emit_message_created(
    session: AsyncSession,
    *,
    conversation: Conversation,
    message: Message,
) -> None:
    """Fan out only a message that has already committed to the database."""

    names = await ms.participant_names(session, conversation)
    conversation_id = str(conversation.id)
    thread_id = str(conversation.application_id or conversation.talent_interest_id or conversation.id)
    for viewer_id in (conversation.participant_a_user_id, conversation.participant_b_user_id):
        counterpart_id = ms.other_participant_id(conversation, viewer_id)
        blocked = await blocking_service.interaction_is_blocked(session, viewer_id, counterpart_id)
        # A blocked pair cannot generate new user messages. This guard also keeps
        # the event layer safe if a future server-generated path accidentally calls
        # it after a block.
        if blocked:
            continue
        unread = await ms.unread_count(session, conversation, viewer_id)
        await realtime_manager.publish_to_user(
            viewer_id,
            {
                "type": "conversation.unread",
                "event_id": f"{message.id}:unread:{viewer_id}",
                "conversation_id": conversation_id,
                "thread_id": thread_id,
                "unread_count": unread,
            },
        )
        await realtime_manager.publish_to_user(
            viewer_id,
            {
                "type": "message.created",
                "event_id": str(message.id),
                "conversation_id": conversation_id,
                "thread_id": thread_id,
                "message": ms.serialize_message(
                    message,
                    viewer_id,
                    names.get(message.sender_user_id),
                    counterparty_last_read_at=ms.counterparty_last_read_for(conversation, viewer_id),
                ),
            },
            conversation_id=conversation_id,
        )


async def emit_read_progress(
    session: AsyncSession,
    *,
    conversation: Conversation,
    reader_user_id: UUID,
    read_at: datetime,
) -> None:
    """Tell only the sender-side participant that their latest message was read."""

    other_user_id = ms.other_participant_id(conversation, reader_user_id)
    if await blocking_service.interaction_is_blocked(session, reader_user_id, other_user_id):
        return
    await realtime_manager.publish_to_user(
        other_user_id,
        {
            "type": "conversation.read_progress",
            "event_id": f"{conversation.id}:read:{reader_user_id}:{read_at.isoformat()}",
            "conversation_id": str(conversation.id),
            "reader_user_id": str(reader_user_id),
            "read_at": read_at.isoformat(),
        },
        conversation_id=str(conversation.id),
    )


async def emit_block_change(
    *,
    blocker_user_id: UUID,
    blocked_user_id: UUID,
    blocked: bool,
) -> None:
    # Both clients only need to refresh their own server-authorized state. Do
    # not disclose which participant owns a directional block record.
    payload = {
        "type": "interaction.blocked",
        "event_id": str(uuid4()),
        "blocked": blocked,
    }
    await realtime_manager.publish_to_user(blocker_user_id, payload)
    await realtime_manager.publish_to_user(blocked_user_id, payload)
