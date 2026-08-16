"""What must still be true when realtime is not working.

Realtime here is a hint, not a record. That claim is easy to make and easy to
quietly stop being true — one `await publish(...)` moved above a commit, or one
handler that raises, and suddenly a broker outage means a message that was never
saved. So it is tested from the outside: break the bus completely, send a
message, and require that the message exists, is readable, and counts as unread
for the person who missed the live event.

The second half is being honest about the degradation. A process-local bus on
two instances produces no error at any moment — only users who intermittently
miss events — so an operator has to be able to see the difference between "a
broker is delivering across instances" and "this process is talking to itself".
"""

from __future__ import annotations

from httpx import AsyncClient

from app.core import config
from app.realtime import manager as realtime_manager_module
from app.realtime.bus import RealtimeEvent
from tests.test_messaging import (
    _apply,
    _published_job,
    _register_verified_login,
)


class _BrokenBus:
    """A broker that is completely unavailable."""

    def set_local_delivery(self, deliver) -> None:  # noqa: ANN001 - protocol shape
        return None

    async def publish(self, event: RealtimeEvent) -> None:
        raise RuntimeError("realtime broker is unreachable")


class TestCanonicalStateSurvivesARealtimeOutage:
    async def test_a_message_sent_during_an_outage_is_still_there(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        """The property the whole architecture rests on: the database is the
        record and realtime is the nudge. If a broker outage could lose a
        message, every other realtime guarantee would be beside the point."""

        owner = await _register_verified_login(
            client, email="degraded_owner@example.com", username="degraded_owner"
        )
        applicant = await _register_verified_login(
            client, email="degraded_applicant@example.com", username="degraded_applicant"
        )
        job_id = await _published_job(client, owner)
        application_id = await _apply(client, applicant, job_id)

        applicant_headers = {"Authorization": f"Bearer {applicant}"}
        owner_headers = {"Authorization": f"Bearer {owner}"}
        conversation = await client.get(
            f"/api/v1/me/applications/{application_id}/conversation",
            headers=applicant_headers,
        )
        conversation_id = conversation.json()["conversation"]["id"]

        # The broker is down for the whole of the send.
        monkeypatch.setattr(
            realtime_manager_module.realtime_manager, "_bus", _BrokenBus(), raising=False
        )

        sent = await client.post(
            f"/api/v1/me/conversations/{conversation_id}/messages",
            headers=applicant_headers,
            json={"body": "Sent while realtime was down."},
        )

        # The write succeeded despite realtime failing.
        assert sent.status_code in {200, 201}, sent.text

        # And the recipient reconciles over HTTP — which is exactly what a
        # client does on reconnect, so this is the reconnect path too.
        reconciled = await client.get(
            f"/api/v1/me/conversations/{conversation_id}", headers=owner_headers
        )
        assert reconciled.status_code == 200
        bodies = [message["body"] for message in reconciled.json()["messages"]]
        assert "Sent while realtime was down." in bodies

    async def test_the_missed_event_still_counts_as_unread(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        """Unread state lives in the database, not in whether a socket was
        listening. Otherwise a dropped connection would silently mark a
        conversation read."""

        owner = await _register_verified_login(
            client, email="degraded_unread_owner@example.com", username="degraded_unread_o"
        )
        applicant = await _register_verified_login(
            client,
            email="degraded_unread_applicant@example.com",
            username="degraded_unread_a",
        )
        job_id = await _published_job(client, owner)
        application_id = await _apply(client, applicant, job_id)

        applicant_headers = {"Authorization": f"Bearer {applicant}"}
        owner_headers = {"Authorization": f"Bearer {owner}"}
        conversation = await client.get(
            f"/api/v1/me/applications/{application_id}/conversation",
            headers=applicant_headers,
        )
        conversation_id = conversation.json()["conversation"]["id"]

        monkeypatch.setattr(
            realtime_manager_module.realtime_manager, "_bus", _BrokenBus(), raising=False
        )
        await client.post(
            f"/api/v1/me/conversations/{conversation_id}/messages",
            headers=applicant_headers,
            json={"body": "You did not get a ping for this."},
        )

        threads = await client.get("/api/v1/me/conversations", headers=owner_headers)

        assert threads.status_code == 200
        unread = [
            thread.get("unread_count", 0)
            for thread in threads.json()
            if thread.get("id") == conversation_id
        ]
        assert unread and unread[0] >= 1


class TestTheProbeTellsTheTruthAboutDelivery:
    async def test_a_process_local_bus_does_not_claim_cross_instance_delivery(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        """The distinction that matters to an operator. "Configured" is not the
        same as "reaches the other instance"."""

        monkeypatch.setattr(config.settings, "app_env", "development")
        monkeypatch.setattr(config.settings, "realtime_bus", "memory")

        response = await client.get("/api/v1/health/realtime")

        assert response.status_code == 200
        body = response.json()
        assert body["configured"] is True
        assert body["cross_instance"] is False

    async def test_an_unsafe_configuration_is_reported_rather_than_hidden(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        monkeypatch.setattr(config.settings, "app_env", "production")
        monkeypatch.setattr(config.settings, "realtime_bus", "memory")
        monkeypatch.setattr(
            config.settings, "allow_process_local_realtime_in_production", False
        )

        body = (await client.get("/api/v1/health/realtime")).json()

        assert body["configured"] is False
        assert body["cross_instance"] is False
        assert body["problem"]

    async def test_it_leaks_no_configuration(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        """Unauthenticated, so it says what is true and not what is set."""

        monkeypatch.setattr(config.settings, "realtime_bus", "memory")

        text = (await client.get("/api/v1/health/realtime")).text.lower()

        for leak in ("redis://", "password", "token", "secret", "@"):
            assert leak not in text, leak
