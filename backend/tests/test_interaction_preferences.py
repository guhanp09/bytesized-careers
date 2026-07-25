from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InteractionUserPreference
from conftest import create_valid_published_job


async def _login(client: AsyncClient) -> str:
    stem = f"pref_{uuid.uuid4().hex[:10]}"
    email = f"{stem}@example.com"
    password = "PrefTest123!"
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "username": stem, "display_name": stem},
    )
    assert register.status_code in {200, 201}, register.text
    token = register.json()["verification_url"].rsplit("token=", 1)[-1]
    assert (await client.post("/api/v1/auth/verify-email", json={"token": token})).status_code == 200
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return login.json()["access_token"]


async def _conversation(client: AsyncClient) -> tuple[str, str, str]:
    """A real application conversation plus both participants' tokens."""
    owner = await _login(client)
    applicant = await _login(client)
    job = await create_valid_published_job(client, owner, title="Preferences fixture role")
    assert job.status_code == 201, job.text
    application = await client.post(
        f"/api/v1/jobs/{job.json()['id']}/applications",
        headers={"Authorization": f"Bearer {applicant}"},
        json={"cover_note": "Keen to help."},
    )
    assert application.status_code == 201, application.text
    detail = await client.get(
        f"/api/v1/me/applications/{application.json()['id']}/conversation",
        headers={"Authorization": f"Bearer {owner}"},
    )
    return owner, applicant, detail.json()["conversation"]["id"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_participant_can_manage_their_own_preferences(client: AsyncClient) -> None:
    owner, _, conversation_id = await _conversation(client)

    empty = await client.get("/api/v1/me/interaction-preferences", headers=_h(owner))
    assert empty.status_code == 200
    assert empty.json() == []

    starred = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/star",
        headers=_h(owner),
        json={"starred": True},
    )
    assert starred.status_code == 200, starred.text
    assert starred.json()["starred"] is True
    assert starred.json()["starred_at"]

    listed = await client.get("/api/v1/me/interaction-preferences", headers=_h(owner))
    assert [row["conversation_id"] for row in listed.json()] == [conversation_id]
    assert listed.json()[0]["starred"] is True

    cleared = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/star",
        headers=_h(owner),
        json={"starred": False},
    )
    assert cleared.json()["starred"] is False
    assert cleared.json()["starred_at"] is None


async def test_preferences_are_independent_per_participant(client: AsyncClient) -> None:
    """Both sides organise the same relationship without seeing each other."""
    owner, applicant, conversation_id = await _conversation(client)

    await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/star",
        headers=_h(owner),
        json={"starred": True},
    )

    # The counterparty's own view is untouched: no star, nothing leaked.
    applicant_view = await client.get("/api/v1/me/interaction-preferences", headers=_h(applicant))
    assert applicant_view.json() == []

    # And they may star it themselves without disturbing the owner.
    await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/star",
        headers=_h(applicant),
        json={"starred": True},
    )
    assert (await client.get("/api/v1/me/interaction-preferences", headers=_h(owner))).json()[0][
        "starred"
    ] is True
    assert (await client.get("/api/v1/me/interaction-preferences", headers=_h(applicant))).json()[0][
        "starred"
    ] is True


async def test_non_participant_cannot_read_or_mutate(client: AsyncClient) -> None:
    _, _, conversation_id = await _conversation(client)
    stranger = await _login(client)

    blocked = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/star",
        headers=_h(stranger),
        json={"starred": True},
    )
    assert blocked.status_code == 403

    # And they learn nothing from the list endpoint either.
    assert (await client.get("/api/v1/me/interaction-preferences", headers=_h(stranger))).json() == []


async def test_preferences_never_appear_in_counterparty_payloads(client: AsyncClient) -> None:
    """A star must not be observable anywhere the other side can read."""
    owner, applicant, conversation_id = await _conversation(client)
    await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/star",
        headers=_h(owner),
        json={"starred": True},
    )
    await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/snooze",
        headers=_h(owner),
        json={"until": (datetime.now(UTC) + timedelta(days=1)).isoformat()},
    )

    conversation = await client.get(
        f"/api/v1/me/conversations/{conversation_id}", headers=_h(applicant)
    )
    body = conversation.text.lower()
    for leaked in ("starred", "snoozed", "queue_dismissed", "decision_prompt"):
        assert leaked not in body, f"{leaked} leaked to the counterparty"

    sent = await client.get("/api/v1/me/applications/sent", headers=_h(applicant))
    assert "starred" not in sent.text.lower()


async def test_repeated_and_concurrent_writes_keep_exactly_one_row(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _, conversation_id = await _conversation(client)

    # Concurrent first-writes race the unique constraint deliberately.
    await asyncio.gather(
        *[
            client.put(
                f"/api/v1/me/conversations/{conversation_id}/preferences/star",
                headers=_h(owner),
                json={"starred": True},
            )
            for _ in range(4)
        ]
    )
    # ...and repeated writes stay idempotent.
    for _ in range(3):
        await client.put(
            f"/api/v1/me/conversations/{conversation_id}/preferences/star",
            headers=_h(owner),
            json={"starred": True},
        )

    count = (
        await db_session.execute(
            select(func.count())
            .select_from(InteractionUserPreference)
            .where(InteractionUserPreference.conversation_id == uuid.UUID(conversation_id))
        )
    ).scalar_one()
    assert count == 1


async def test_snooze_set_clear_and_expiry_semantics(client: AsyncClient) -> None:
    owner, _, conversation_id = await _conversation(client)
    until = datetime.now(UTC) + timedelta(hours=6)

    snoozed = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/snooze",
        headers=_h(owner),
        json={"until": until.isoformat()},
    )
    assert snoozed.status_code == 200, snoozed.text
    assert snoozed.json()["snoozed_until"] is not None

    # An elapsed snooze is simply a past timestamp — nothing to clean up.
    past = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/snooze",
        headers=_h(owner),
        json={"until": (datetime.now(UTC) - timedelta(minutes=1)).isoformat()},
    )
    assert past.json()["snoozed_until"] is not None

    cleared = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/snooze",
        headers=_h(owner),
        json={"until": None},
    )
    assert cleared.json()["snoozed_until"] is None


async def test_queue_dismissal_and_decision_prompt_persist(client: AsyncClient) -> None:
    owner, _, conversation_id = await _conversation(client)

    dismissed = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/queue-dismissal",
        headers=_h(owner),
        json={"dismissed": True},
    )
    assert dismissed.json()["queue_dismissed"] is True

    prompt = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/decision-prompt",
        headers=_h(owner),
        json={"dismissed": True, "trigger_version": 1},
    )
    assert prompt.json()["decision_prompt_dismissed"] is True
    assert prompt.json()["decision_prompt_trigger_version"] == 1

    # Both survive a fresh read, which is what "durable" has to mean.
    listed = (await client.get("/api/v1/me/interaction-preferences", headers=_h(owner))).json()[0]
    assert listed["queue_dismissed"] is True
    assert listed["decision_prompt_dismissed"] is True

    undone = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/preferences/queue-dismissal",
        headers=_h(owner),
        json={"dismissed": False},
    )
    assert undone.json()["queue_dismissed"] is False


async def test_preferences_never_change_lifecycle_state(client: AsyncClient) -> None:
    """The whole point: personal organisation is not a status change."""
    owner, applicant, conversation_id = await _conversation(client)

    before = (await client.get("/api/v1/me/applications/received", headers=_h(owner))).json()[0]

    for path, payload in (
        ("star", {"starred": True}),
        ("snooze", {"until": (datetime.now(UTC) + timedelta(days=1)).isoformat()}),
        ("queue-dismissal", {"dismissed": True}),
        ("decision-prompt", {"dismissed": True, "trigger_version": 1}),
    ):
        response = await client.put(
            f"/api/v1/me/conversations/{conversation_id}/preferences/{path}",
            headers=_h(owner),
            json=payload,
        )
        assert response.status_code == 200, response.text

    after = (await client.get("/api/v1/me/applications/received", headers=_h(owner))).json()[0]
    assert after["status"] == before["status"]
    assert after["participant_status"] == before["participant_status"]
    assert after["status_version"] == before["status_version"]

    # No message and no notification reached the applicant.
    thread = await client.get(f"/api/v1/me/conversations/{conversation_id}", headers=_h(applicant))
    assert thread.json()["messages"] == []
    notifications = await client.get("/api/v1/me/notifications", headers=_h(applicant))
    assert all(
        "star" not in (item.get("title", "") + item.get("body", "")).lower()
        for item in notifications.json().get("items", notifications.json())
        if isinstance(item, dict)
    )


async def test_unknown_conversation_is_a_404(client: AsyncClient) -> None:
    owner = await _login(client)
    missing = await client.put(
        f"/api/v1/me/conversations/{uuid.uuid4()}/preferences/star",
        headers=_h(owner),
        json={"starred": True},
    )
    assert missing.status_code == 404
