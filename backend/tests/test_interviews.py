"""Interview coordination.

The properties worth defending here are behavioural, not structural: an
invitation reaches the applicant with the time in it, a retry never books twice,
a stale form never overwrites a newer arrangement, and marking an interview
complete tells the applicant nothing at all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from conftest import create_valid_published_job
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InteractionInterview, JobApplication, Notification


async def _login(client: AsyncClient) -> str:
    stem = f"iv_{uuid.uuid4().hex[:10]}"
    email = f"{stem}@example.com"
    password = "InterviewTest123!"
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


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class Fixture:
    def __init__(self, owner: str, applicant: str, conversation_id: str, application_id: str):
        self.owner = owner
        self.applicant = applicant
        self.conversation_id = conversation_id
        self.application_id = application_id


async def _application(client: AsyncClient) -> Fixture:
    owner = await _login(client)
    applicant = await _login(client)
    job = await create_valid_published_job(client, owner, title="Interview fixture role")
    assert job.status_code == 201, job.text
    application = await client.post(
        f"/api/v1/jobs/{job.json()['id']}/applications",
        headers=_h(applicant),
        json={"cover_note": "Keen to help."},
    )
    assert application.status_code == 201, application.text
    application_id = application.json()["id"]
    detail = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=_h(owner)
    )
    assert detail.status_code == 200, detail.text
    return Fixture(owner, applicant, detail.json()["conversation"]["id"], application_id)


def _when(days: int = 3, hour: int = 10) -> str:
    return (datetime.now(UTC) + timedelta(days=days)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    ).isoformat()


async def _propose(
    client: AsyncClient,
    fixture: Fixture,
    *,
    token: str | None = None,
    expected_version: int = 0,
    key: str | None = None,
    **overrides,
):
    payload = {
        "scheduled_at": _when(),
        "timezone": "Asia/Kolkata",
        "meeting_method": "video_call",
        "meeting_detail": "https://meet.example.com/abc-defg-hij",
        "duration_minutes": 30,
        "expected_version": expected_version,
        "idempotency_key": key or str(uuid.uuid4()),
    }
    payload.update(overrides)
    return await client.put(
        f"/api/v1/me/conversations/{fixture.conversation_id}/interview",
        headers=_h(token or fixture.owner),
        json=payload,
    )


# --- inviting --------------------------------------------------------------


async def test_recruiter_invitation_reaches_the_applicant_with_the_time(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    fixture = await _application(client)

    response = await _propose(client, fixture, note="Looking forward to talking this through.")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "proposed"
    assert body["version"] == 1
    assert body["can_manage"] is True
    assert body["follow_up_due"] is False
    # The zone is spelled out: "4pm" means different things in two countries.
    assert "Asia/Kolkata" in body["schedule_label"]
    assert "Video call" in body["schedule_label"]

    # The applicant sees the invitation, the stage, and the organiser's own note.
    applicant_view = await client.get(
        f"/api/v1/me/applications/{fixture.application_id}/conversation",
        headers=_h(fixture.applicant),
    )
    assert applicant_view.status_code == 200
    detail = applicant_view.json()
    assert detail["interview"]["status"] == "proposed"
    # The applicant is a participant, not the organiser: they may read it but the
    # client is told not to offer management controls.
    assert detail["interview"]["can_manage"] is False
    bodies = [message["body"] for message in detail["messages"]]
    assert any("Invited to interview" in text and "Asia/Kolkata" in text for text in bodies)
    assert any("Looking forward to talking this through." in text for text in bodies)

    # One authoritative status path: the stage moved through the ordinary
    # transition service, so the applicant's own view of it moved too.
    application = (
        await db_session.execute(
            select(JobApplication).where(JobApplication.id == uuid.UUID(fixture.application_id))
        )
    ).scalar_one()
    assert application.status == "interviewing"
    assert application.participant_status == "interviewing"


async def test_invitation_notifies_the_applicant_without_leaking_the_link(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    fixture = await _application(client)
    assert (await _propose(client, fixture)).status_code == 200

    notifications = (
        await db_session.execute(
            select(Notification).where(
                Notification.type == "application_status_changed",
                Notification.resource_id == fixture.application_id,
            )
        )
    ).scalars().all()
    assert len(notifications) == 1
    # A meeting link must not sit in an email preview or a lock-screen banner.
    assert "meet.example.com" not in (notifications[0].body or "")
    assert "Invited to interview" in (notifications[0].body or "")


async def test_only_the_managing_side_may_arrange(client: AsyncClient) -> None:
    fixture = await _application(client)
    forbidden = await _propose(client, fixture, token=fixture.applicant)
    assert forbidden.status_code == 403


async def test_retrying_the_same_submit_books_once(client: AsyncClient, db_session: AsyncSession) -> None:
    fixture = await _application(client)
    key = str(uuid.uuid4())

    first = await _propose(client, fixture, key=key)
    assert first.status_code == 200, first.text
    second = await _propose(client, fixture, key=key)
    assert second.status_code == 200, second.text

    assert second.json()["version"] == first.json()["version"] == 1
    assert second.json()["reschedule_count"] == 0
    rows = (
        await db_session.execute(
            select(InteractionInterview).where(
                InteractionInterview.conversation_id == uuid.UUID(fixture.conversation_id)
            )
        )
    ).scalars().all()
    assert len(rows) == 1

    # And exactly one invitation reached the thread.
    detail = await client.get(
        f"/api/v1/me/applications/{fixture.application_id}/conversation", headers=_h(fixture.owner)
    )
    invitations = [
        message for message in detail.json()["messages"] if "Invited to interview" in message["body"]
    ]
    assert len(invitations) == 1


async def test_a_stale_second_tab_cannot_overwrite_the_arrangement(client: AsyncClient) -> None:
    fixture = await _application(client)
    assert (await _propose(client, fixture)).status_code == 200

    # Tab A rescheduled to version 2. Tab B still believes it is version 1.
    moved = await _propose(client, fixture, expected_version=1, scheduled_at=_when(days=5))
    assert moved.status_code == 200, moved.text
    assert moved.json()["version"] == 2

    stale = await _propose(client, fixture, expected_version=1, scheduled_at=_when(days=9))
    assert stale.status_code == 409
    detail = stale.json()["error"]["details"] if "error" in stale.json() else stale.json()["detail"]
    assert detail["code"] == "stale_interview"
    assert detail["current_version"] == 2


async def test_invalid_timezone_and_absurd_dates_are_refused(client: AsyncClient) -> None:
    fixture = await _application(client)

    bad_zone = await _propose(client, fixture, timezone="Middle/Earth")
    assert bad_zone.status_code == 422

    far_future = await _propose(client, fixture, scheduled_at=_when(days=800))
    assert far_future.status_code == 422


# --- rescheduling ----------------------------------------------------------


async def test_reschedule_tells_the_applicant_and_keeps_the_stage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    fixture = await _application(client)
    assert (await _propose(client, fixture)).status_code == 200

    moved = await _propose(
        client, fixture, expected_version=1, scheduled_at=_when(days=6), note="Sorry — clash on my side."
    )
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert body["version"] == 2
    assert body["reschedule_count"] == 1
    assert body["previous_scheduled_at"]
    # A reschedule re-opens confirmation: agreeing to one time is not agreeing to another.
    assert body["status"] == "proposed"

    detail = await client.get(
        f"/api/v1/me/applications/{fixture.application_id}/conversation",
        headers=_h(fixture.applicant),
    )
    bodies = [message["body"] for message in detail.json()["messages"]]
    assert any("Interview moved" in text for text in bodies)
    assert any("Sorry — clash on my side." in text for text in bodies)

    application = (
        await db_session.execute(
            select(JobApplication).where(JobApplication.id == uuid.UUID(fixture.application_id))
        )
    ).scalar_one()
    assert application.status == "interviewing"
    # Moving a time is not a second status change.
    assert application.status_version == 2


# --- confirmation ----------------------------------------------------------


async def test_the_applicant_can_confirm_and_the_recruiter_sees_it(client: AsyncClient) -> None:
    fixture = await _application(client)
    assert (await _propose(client, fixture)).status_code == 200

    confirmed = await client.post(
        f"/api/v1/me/conversations/{fixture.conversation_id}/interview/confirm",
        headers=_h(fixture.applicant),
        json={"expected_version": 1, "idempotency_key": str(uuid.uuid4())},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    assert confirmed.json()["confirmed_by_me"] is True

    recruiter_view = await client.get(
        f"/api/v1/me/applications/{fixture.application_id}/conversation", headers=_h(fixture.owner)
    )
    interview = recruiter_view.json()["interview"]
    assert interview["status"] == "confirmed"
    # The recruiter did not confirm it; the flag is per-viewer, not global.
    assert interview["confirmed_by_me"] is False
    assert any(
        "Interview confirmed" in message["body"] for message in recruiter_view.json()["messages"]
    )


async def test_confirming_twice_changes_nothing(client: AsyncClient) -> None:
    fixture = await _application(client)
    assert (await _propose(client, fixture)).status_code == 200
    url = f"/api/v1/me/conversations/{fixture.conversation_id}/interview/confirm"

    first = await client.post(
        url, headers=_h(fixture.applicant), json={"expected_version": 1, "idempotency_key": str(uuid.uuid4())}
    )
    assert first.status_code == 200
    second = await client.post(
        url, headers=_h(fixture.applicant), json={"expected_version": 2, "idempotency_key": str(uuid.uuid4())}
    )
    assert second.status_code == 200
    assert second.json()["version"] == first.json()["version"]


# --- completion and follow-up ---------------------------------------------


async def test_marking_complete_is_private_and_decides_nothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    fixture = await _application(client)
    assert (await _propose(client, fixture)).status_code == 200

    before = await client.get(
        f"/api/v1/me/applications/{fixture.application_id}/conversation", headers=_h(fixture.applicant)
    )
    message_count = len(before.json()["messages"])
    notifications_before = len((await db_session.execute(select(Notification))).scalars().all())

    completed = await client.post(
        f"/api/v1/me/conversations/{fixture.conversation_id}/interview/complete",
        headers=_h(fixture.owner),
        json={"expected_version": 1, "idempotency_key": str(uuid.uuid4())},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    # It is now the organiser's move — but nobody was told to hurry.
    assert completed.json()["follow_up_due"] is True

    after = await client.get(
        f"/api/v1/me/applications/{fixture.application_id}/conversation", headers=_h(fixture.applicant)
    )
    assert len(after.json()["messages"]) == message_count
    assert len((await db_session.execute(select(Notification))).scalars().all()) == notifications_before

    # And the decision is still entirely open.
    application = (
        await db_session.execute(
            select(JobApplication).where(JobApplication.id == uuid.UUID(fixture.application_id))
        )
    ).scalar_one()
    assert application.status == "interviewing"
    assert application.participant_status == "interviewing"


async def test_only_the_managing_side_may_complete_or_cancel(client: AsyncClient) -> None:
    fixture = await _application(client)
    assert (await _propose(client, fixture)).status_code == 200
    payload = {"expected_version": 1, "idempotency_key": str(uuid.uuid4())}

    complete = await client.post(
        f"/api/v1/me/conversations/{fixture.conversation_id}/interview/complete",
        headers=_h(fixture.applicant),
        json=payload,
    )
    assert complete.status_code == 403

    cancel = await client.post(
        f"/api/v1/me/conversations/{fixture.conversation_id}/interview/cancel",
        headers=_h(fixture.applicant),
        json=payload,
    )
    assert cancel.status_code == 403


async def test_cancelling_always_tells_the_other_participant(client: AsyncClient) -> None:
    fixture = await _application(client)
    assert (await _propose(client, fixture)).status_code == 200

    cancelled = await client.post(
        f"/api/v1/me/conversations/{fixture.conversation_id}/interview/cancel",
        headers=_h(fixture.owner),
        json={
            "expected_version": 1,
            "idempotency_key": str(uuid.uuid4()),
            "reason": "Something came up — I'll suggest a new time.",
        },
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    # A cancelled call owes nothing; it must not sit in the follow-up queue.
    assert cancelled.json()["follow_up_due"] is False

    detail = await client.get(
        f"/api/v1/me/applications/{fixture.application_id}/conversation", headers=_h(fixture.applicant)
    )
    bodies = [message["body"] for message in detail.json()["messages"]]
    assert any("Interview cancelled" in text for text in bodies)
    assert any("Something came up" in text for text in bodies)


async def test_a_new_round_after_completion_starts_clean(client: AsyncClient) -> None:
    fixture = await _application(client)
    assert (await _propose(client, fixture)).status_code == 200
    assert (
        await client.post(
            f"/api/v1/me/conversations/{fixture.conversation_id}/interview/complete",
            headers=_h(fixture.owner),
            json={"expected_version": 1, "idempotency_key": str(uuid.uuid4())},
        )
    ).status_code == 200

    second_round = await _propose(client, fixture, expected_version=2, scheduled_at=_when(days=8))
    assert second_round.status_code == 200, second_round.text
    body = second_round.json()
    assert body["round_number"] == 2
    assert body["reschedule_count"] == 0
    assert body["status"] == "proposed"
    assert body["completed_at"] is None


async def test_interviews_list_is_scoped_to_the_callers_conversations(client: AsyncClient) -> None:
    fixture = await _application(client)
    stranger = await _login(client)
    assert (await _propose(client, fixture)).status_code == 200

    for token, expected in ((fixture.owner, 1), (fixture.applicant, 1), (stranger, 0)):
        listed = await client.get("/api/v1/me/interviews", headers=_h(token))
        assert listed.status_code == 200, listed.text
        assert len(listed.json()) == expected


# --- hiring requests -------------------------------------------------------


async def test_a_hiring_request_interview_changes_no_stage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Talent-side parity, without inventing a stage that does not exist.

    A hiring request has no "interviewing" stage — a call before accepting is not
    an acceptance — so the arrangement is recorded and announced while the
    request itself stays exactly where it was.
    """
    recruiter = await _login(client)
    talent = await _login(client)
    listing = await client.post(
        "/api/v1/talent-listings",
        headers=_h(talent),
        json={"title": "Editor for hire", "roles": ["Video editor"], "status": "published"},
    )
    assert listing.status_code == 201, listing.text
    interest = await client.post(
        f"/api/v1/talent-listings/{listing.json()['id']}/interest",
        headers=_h(recruiter),
        json={"note": "Would love to work together."},
    )
    assert interest.status_code == 201, interest.text
    interest_id = interest.json()["id"]
    detail = await client.get(
        f"/api/v1/me/talent-interests/{interest_id}/conversation", headers=_h(talent)
    )
    assert detail.status_code == 200, detail.text
    conversation_id = detail.json()["conversation"]["id"]

    # The listing owner manages the request, so the listing owner arranges the call.
    proposed = await client.put(
        f"/api/v1/me/conversations/{conversation_id}/interview",
        headers=_h(talent),
        json={
            "scheduled_at": _when(),
            "timezone": "Europe/London",
            "meeting_method": "phone",
            "expected_version": 0,
            "idempotency_key": str(uuid.uuid4()),
        },
    )
    assert proposed.status_code == 200, proposed.text
    assert proposed.json()["status"] == "proposed"

    recruiter_view = await client.get(
        f"/api/v1/me/talent-interests/{interest_id}/conversation", headers=_h(recruiter)
    )
    assert recruiter_view.json()["interview"]["status"] == "proposed"
    assert any(
        "Interview invitation" in message["body"] for message in recruiter_view.json()["messages"]
    )
    # The request itself is untouched: nothing has been accepted or declined.
    from app.models import TalentInterest

    record = (
        await db_session.execute(
            select(TalentInterest).where(TalentInterest.id == uuid.UUID(interest_id))
        )
    ).scalar_one()
    assert record.status == "new"
    assert record.participant_status == "new"


async def test_the_arranged_time_survives_a_round_trip_with_its_offset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A stored instant must come back as an unambiguous instant.

    SQLite has no time-zone type, so a stored value is handed back naive. Left
    alone, `isoformat` emits it without an offset and a browser parses it as its
    *own* local time — showing someone a confident, wrong interview time. This is
    the regression that guards the round trip.
    """
    fixture = await _application(client)
    # 09:00 in Kolkata is 03:30 UTC — a half-hour offset, so a zone that was
    # dropped or misapplied cannot coincidentally produce the right answer.
    when = (datetime.now(UTC) + timedelta(days=4)).replace(
        hour=3, minute=30, second=0, microsecond=0
    )
    created = await _propose(
        client, fixture, scheduled_at=when.isoformat(), timezone="Asia/Kolkata"
    )
    assert created.status_code == 200, created.text
    assert "9:00 AM (Asia/Kolkata)" in created.json()["schedule_label"]

    # Re-read from storage rather than reusing the in-memory row.
    db_session.expire_all()
    reloaded = await client.get(
        f"/api/v1/me/applications/{fixture.application_id}/conversation",
        headers=_h(fixture.owner),
    )
    interview = reloaded.json()["interview"]
    parsed = datetime.fromisoformat(interview["scheduled_at"])
    assert parsed.tzinfo is not None, "a serialised instant must carry its offset"
    assert parsed.astimezone(UTC) == when
    assert "9:00 AM (Asia/Kolkata)" in interview["schedule_label"]
