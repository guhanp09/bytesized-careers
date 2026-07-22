from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha1
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import func, select

from app.models import Engagement, EngagementReview
from conftest import TestSessionLocal, create_valid_published_job


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, prefix: str) -> tuple[str, str]:
    email = f"{prefix}@example.com"
    username = f"rv_{sha1(prefix.encode()).hexdigest()[:12]}"
    password = "Password123!"
    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "username": username,
            "display_name": prefix.replace("_", " ").title(),
        },
    )
    assert registered.status_code in {200, 201}, registered.text
    verification_token = registered.json()["verification_url"].rsplit("token=", 1)[-1]
    assert (await client.post("/api/v1/auth/verify-email", json={"token": verification_token})).status_code == 200
    logged_in = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert logged_in.status_code == 200, logged_in.text
    return logged_in.json()["access_token"], username


async def _hired_application(
    client: AsyncClient, prefix: str
) -> tuple[str, str, str, str, str]:
    recruiter_token, recruiter_name = await _register(client, f"{prefix}_recruiter")
    talent_token, talent_name = await _register(client, f"{prefix}_talent")
    job = await create_valid_published_job(
        client,
        recruiter_token,
        title=f"{prefix} creator editor",
    )
    assert job.status_code == 201, job.text
    application = await client.post(
        f"/api/v1/jobs/{job.json()['id']}/applications",
        headers=_auth(talent_token),
        json={"cover_note": "I can help with this project.", "portfolio_item_ids": []},
    )
    assert application.status_code == 201, application.text
    application_id = application.json()["id"]
    hired = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers=_auth(recruiter_token),
        json={"status": "hired"},
    )
    assert hired.status_code == 200, hired.text
    assert hired.json()["engagement"]["status"] == "ready_to_start"
    return recruiter_token, talent_token, recruiter_name, talent_name, application_id


async def _active_engagement(
    client: AsyncClient, prefix: str
) -> tuple[str, str, str, str, str, str]:
    recruiter, talent, recruiter_name, talent_name, application_id = await _hired_application(client, prefix)
    requested = await client.post(
        f"/api/v1/me/applications/{application_id}/engagement/start-request",
        headers=_auth(talent),
    )
    assert requested.status_code == 200, requested.text
    assert requested.json()["status"] == "start_pending"
    engagement_id = requested.json()["id"]
    confirmed = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/start-response",
        headers=_auth(recruiter),
        json={"decision": "confirm"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "active"
    return recruiter, talent, recruiter_name, talent_name, application_id, engagement_id


async def _completed_engagement(
    client: AsyncClient, prefix: str
) -> tuple[str, str, str, str, str]:
    recruiter, talent, recruiter_name, talent_name, _, engagement_id = await _active_engagement(client, prefix)
    requested = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/completion-request",
        headers=_auth(talent),
        json={"outcome": "completed", "note": "All agreed deliverables were sent."},
    )
    assert requested.status_code == 200, requested.text
    confirmed = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/completion-response",
        headers=_auth(recruiter),
        json={"decision": "confirm"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "completed"
    assert confirmed.json()["review_state"] == "available"
    return recruiter, talent, recruiter_name, talent_name, engagement_id


async def _accepted_talent_interest(
    client: AsyncClient, prefix: str
) -> tuple[str, str, str, str, str]:
    talent_token, talent_name = await _register(client, f"{prefix}_talent_owner")
    recruiter_token, recruiter_name = await _register(client, f"{prefix}_recruiter_sender")
    listing = await client.post(
        "/api/v1/talent-listings",
        headers=_auth(talent_token),
        json={
            "title": f"{prefix} creator services",
            "roles": ["Video editor"],
            "platforms": ["YouTube"],
            "work_mode": "remote",
            "status": "published",
        },
    )
    assert listing.status_code == 201, listing.text
    interest = await client.post(
        f"/api/v1/talent-listings/{listing.json()['id']}/interest",
        headers=_auth(recruiter_token),
        json={"note": "I would like to discuss this project."},
    )
    assert interest.status_code == 201, interest.text
    interest_id = interest.json()["id"]
    accepted = await client.patch(
        f"/api/v1/talent-interests/{interest_id}/status",
        headers=_auth(talent_token),
        json={"status": "accepted"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["engagement"]["status"] == "ready_to_start"
    return recruiter_token, talent_token, recruiter_name, talent_name, interest_id


async def test_complete_two_sided_flow_is_blind_and_mode_specific(client: AsyncClient) -> None:
    recruiter, talent, recruiter_name, talent_name, engagement_id = await _completed_engagement(
        client, "review_flow"
    )

    first = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(talent),
        json={
            "overall_rating": 4,
            "dimension_ratings": {"brief_clarity": 5, "communication": 4},
            "public_feedback": "Clear brief and professional communication throughout.",
        },
    )
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "submitted"
    assert first.json()["editable"] is True

    # The recruiter sees an available opportunity, not whether the talent has submitted.
    recruiter_workspace = await client.get("/api/v1/me/reviews?mode=hiring", headers=_auth(recruiter))
    assert recruiter_workspace.status_code == 200, recruiter_workspace.text
    assert recruiter_workspace.json()["received"]["summary"]["review_count"] == 0
    assert recruiter_workspace.json()["opportunities"][0]["engagement"]["review_state"] == "available"

    owner_public = await client.get(f"/api/v1/users/{recruiter_name}/public-profile")
    assert owner_public.status_code == 200
    assert owner_public.json()["reviews_by_mode"]["hiring"]["summary"]["review_count"] == 0

    edited = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(talent),
        json={
            "overall_rating": 5,
            "dimension_ratings": {"brief_clarity": 5, "communication": 5, "professionalism": 5},
            "public_feedback": "Clear brief, prompt decisions, and professional collaboration.",
        },
    )
    assert edited.status_code == 200
    assert edited.json()["id"] == first.json()["id"]

    second = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(recruiter),
        json={
            "overall_rating": 5,
            "dimension_ratings": {"quality_of_work": 5, "communication": 5, "reliability": 4},
            "public_feedback": "Strong work, reliable delivery, and thoughtful communication.",
        },
    )
    assert second.status_code == 200, second.text
    assert second.json()["status"] == "published"

    recruiter_public = (await client.get(f"/api/v1/users/{recruiter_name}/public-profile")).json()
    talent_public = (await client.get(f"/api/v1/users/{talent_name}/public-profile")).json()
    assert recruiter_public["reviews_by_mode"]["hiring"]["summary"] == {"avg_rating": 5.0, "review_count": 1}
    assert talent_public["reviews_by_mode"]["talent"]["summary"] == {"avg_rating": 5.0, "review_count": 1}
    assert recruiter_public["reviews_by_mode"]["talent"]["summary"]["review_count"] == 0
    assert talent_public["reviews_by_mode"]["hiring"]["summary"]["review_count"] == 0
    assert "dimension_ratings" not in recruiter_public["reviews_by_mode"]["hiring"]["items"][0]

    immutable = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(talent),
        json={"overall_rating": 3, "dimension_ratings": {}, "public_feedback": "Changed"},
    )
    assert immutable.status_code == 409


async def test_talent_interest_source_runs_the_same_verified_lifecycle(client: AsyncClient) -> None:
    recruiter, talent, recruiter_name, talent_name, interest_id = await _accepted_talent_interest(
        client, "review_interest"
    )
    requested = await client.post(
        f"/api/v1/me/talent-interests/{interest_id}/engagement/start-request",
        headers=_auth(recruiter),
    )
    assert requested.status_code == 200, requested.text
    engagement_id = requested.json()["id"]
    assert requested.json()["status"] == "start_pending"

    talent_notifications = await client.get("/api/v1/notifications", headers=_auth(talent))
    start_notice = next(
        item
        for item in talent_notifications.json()["items"]
        if item["type"] == "engagement_start_requested"
    )
    assert "mode=talent" in start_notice["action_url"]
    assert f"thread={interest_id}" in start_notice["action_url"]

    confirmed = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/start-response",
        headers=_auth(talent),
        json={"decision": "confirm"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "active"

    completion = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/completion-request",
        headers=_auth(talent),
        json={"outcome": "completed"},
    )
    assert completion.status_code == 200, completion.text
    recruiter_notifications = await client.get("/api/v1/notifications", headers=_auth(recruiter))
    completion_notice = next(
        item
        for item in recruiter_notifications.json()["items"]
        if item["type"] == "engagement_completion_requested"
    )
    assert "mode=recruiter" in completion_notice["action_url"]

    finalized = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/completion-response",
        headers=_auth(recruiter),
        json={"decision": "confirm"},
    )
    assert finalized.status_code == 200, finalized.text
    assert finalized.json()["review_state"] == "available"

    recruiter_review = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(recruiter),
        json={
            "overall_rating": 5,
            "dimension_ratings": {"quality_of_work": 5},
            "public_feedback": "Excellent work and a reliable creative process.",
        },
    )
    assert recruiter_review.status_code == 200, recruiter_review.text
    talent_review = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(talent),
        json={
            "overall_rating": 4,
            "dimension_ratings": {"brief_clarity": 4},
            "public_feedback": "Clear goals and a professional working relationship.",
        },
    )
    assert talent_review.status_code == 200, talent_review.text
    assert talent_review.json()["status"] == "published"

    recruiter_profile = (await client.get(f"/api/v1/users/{recruiter_name}/public-profile")).json()
    talent_profile = (await client.get(f"/api/v1/users/{talent_name}/public-profile")).json()
    assert recruiter_profile["reviews_by_mode"]["hiring"]["summary"]["review_count"] == 1
    assert talent_profile["reviews_by_mode"]["talent"]["summary"]["review_count"] == 1


async def test_start_expiry_and_pre_start_cancel_never_unlock_reviews(client: AsyncClient) -> None:
    recruiter, talent, _, _, application_id = await _hired_application(client, "review_start_expiry")
    requested = await client.post(
        f"/api/v1/me/applications/{application_id}/engagement/start-request",
        headers=_auth(talent),
    )
    engagement_id = requested.json()["id"]
    async with TestSessionLocal() as session:
        engagement = await session.get(Engagement, UUID(engagement_id))
        engagement.start_response_due_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    reconciled = await client.get(f"/api/v1/me/engagements/{engagement_id}", headers=_auth(talent))
    assert reconciled.status_code == 200
    assert reconciled.json()["status"] == "ready_to_start"
    assert reconciled.json()["review_state"] == "not_eligible"

    cancelled = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/cancel", headers=_auth(recruiter)
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled_before_start"
    review = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(talent),
        json={"overall_rating": 5, "dimension_ratings": {}, "public_feedback": ""},
    )
    assert review.status_code == 409


async def test_start_requests_are_idempotent_and_unrelated_users_are_denied(client: AsyncClient) -> None:
    recruiter, talent, _, _, application_id = await _hired_application(client, "review_authz")
    outsider, _ = await _register(client, "review_authz_outsider")
    first = await client.post(
        f"/api/v1/me/applications/{application_id}/engagement/start-request",
        headers=_auth(talent),
    )
    second = await client.post(
        f"/api/v1/me/applications/{application_id}/engagement/start-request",
        headers=_auth(talent),
    )
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"]

    async with TestSessionLocal() as session:
        count = await session.scalar(
            select(func.count()).select_from(Engagement).where(
                Engagement.application_id == UUID(application_id)
            )
        )
        assert count == 1

    engagement_id = first.json()["id"]
    assert (
        await client.get(f"/api/v1/me/engagements/{engagement_id}", headers=_auth(outsider))
    ).status_code == 403
    assert (
        await client.put(
            f"/api/v1/me/engagements/{engagement_id}/review",
            headers=_auth(outsider),
            json={"overall_rating": 5, "dimension_ratings": {}, "public_feedback": ""},
        )
    ).status_code == 403
    own_confirmation = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/start-response",
        headers=_auth(talent),
        json={"decision": "confirm"},
    )
    assert own_confirmation.status_code == 409

    confirmed = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/start-response",
        headers=_auth(recruiter),
        json={"decision": "confirm"},
    )
    assert confirmed.status_code == 200


async def test_completion_issue_returns_active_and_fallback_finalizes(client: AsyncClient) -> None:
    recruiter, talent, _, _, _, engagement_id = await _active_engagement(client, "review_issue")
    request = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/completion-request",
        headers=_auth(recruiter),
        json={"outcome": "ended_after_start"},
    )
    assert request.status_code == 200
    issue = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/completion-response",
        headers=_auth(talent),
        json={"decision": "needs_attention", "note": "The final source files still need to be delivered."},
    )
    assert issue.status_code == 200
    assert issue.json()["status"] == "active"
    assert issue.json()["review_state"] == "not_eligible"

    second_request = await client.post(
        f"/api/v1/me/engagements/{engagement_id}/completion-request",
        headers=_auth(talent),
        json={"outcome": "ended_after_start"},
    )
    assert second_request.status_code == 200
    async with TestSessionLocal() as session:
        engagement = await session.get(Engagement, UUID(engagement_id))
        engagement.completion_response_due_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    reconciled = await client.get(f"/api/v1/me/engagements/{engagement_id}", headers=_auth(recruiter))
    assert reconciled.status_code == 200
    assert reconciled.json()["status"] == "ended_after_start"
    assert reconciled.json()["review_state"] == "available"


async def test_single_review_publishes_after_window_and_low_rating_needs_context(client: AsyncClient) -> None:
    recruiter, talent, recruiter_name, _, engagement_id = await _completed_engagement(client, "review_expiry")
    invalid = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(talent),
        json={"overall_rating": 2, "dimension_ratings": {}, "public_feedback": "Too short"},
    )
    assert invalid.status_code == 422

    invalid_dimension = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(talent),
        json={
            "overall_rating": 4,
            "dimension_ratings": {"quality_of_work": 4},
            "public_feedback": "",
        },
    )
    assert invalid_dimension.status_code == 409

    submitted = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(talent),
        json={
            "overall_rating": 2,
            "dimension_ratings": {"professionalism": 2},
            "public_feedback": "The agreed feedback loop repeatedly changed without notice.",
        },
    )
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "submitted"
    async with TestSessionLocal() as session:
        engagement = await session.get(Engagement, UUID(engagement_id))
        engagement.review_window_ends_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    public = await client.get(f"/api/v1/users/{recruiter_name}/public-profile")
    assert public.status_code == 200
    assert public.json()["reviews_by_mode"]["hiring"]["summary"] == {"avg_rating": 2.0, "review_count": 1}

    late = await client.put(
        f"/api/v1/me/engagements/{engagement_id}/review",
        headers=_auth(recruiter),
        json={"overall_rating": 5, "dimension_ratings": {}, "public_feedback": ""},
    )
    assert late.status_code == 409

    async with TestSessionLocal() as session:
        count = await session.scalar(
            select(func.count()).select_from(EngagementReview).where(EngagementReview.engagement_id == UUID(engagement_id))
        )
        assert count == 1


async def test_review_moderation_hide_and_restore_updates_public_aggregate(client: AsyncClient) -> None:
    recruiter, talent, _, talent_name, engagement_id = await _completed_engagement(client, "review_moderation")
    assert (
        await client.put(
            f"/api/v1/me/engagements/{engagement_id}/review",
            headers=_auth(talent),
            json={"overall_rating": 5, "dimension_ratings": {}, "public_feedback": "A clear and professional hiring experience."},
        )
    ).status_code == 200
    assert (
        await client.put(
            f"/api/v1/me/engagements/{engagement_id}/review",
            headers=_auth(recruiter),
            json={"overall_rating": 4, "dimension_ratings": {}, "public_feedback": "Reliable delivery and thoughtful creative decisions."},
        )
    ).status_code == 200

    talent_profile = (await client.get(f"/api/v1/users/{talent_name}/public-profile")).json()
    review_id = talent_profile["reviews_by_mode"]["talent"]["items"][0]["id"]
    report = await client.post(
        "/api/v1/reports",
        headers=_auth(talent),
        json={"target_type": "review", "target_id": review_id, "category": "other", "note": "Please review this feedback."},
    )
    assert report.status_code == 201, report.text

    await client.post("/api/v1/dev/seed", json={"scenario": "personas"})
    personas = (await client.get("/api/v1/dev/personas")).json()
    admin_email = next(item["email"] for item in personas["personas"] if item["key"] == "admin")
    admin_login = await client.post(
        "/api/v1/auth/login",
        json={"email": admin_email, "password": personas["password"]},
    )
    admin_token = admin_login.json()["access_token"]

    hidden = await client.patch(
        f"/api/v1/admin/reports/{report.json()['id']}",
        headers=_auth(admin_token),
        json={"action": "hide_review", "admin_note": "Temporarily hidden for moderation review."},
    )
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()["target_status"] == "hidden"
    after_hide = (await client.get(f"/api/v1/users/{talent_name}/public-profile")).json()
    assert after_hide["reviews_by_mode"]["talent"]["summary"]["review_count"] == 0

    restored = await client.patch(
        f"/api/v1/admin/reports/{report.json()['id']}",
        headers=_auth(admin_token),
        json={"action": "restore_review", "admin_note": "Review cleared by moderation."},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["target_status"] == "visible"
    after_restore = (await client.get(f"/api/v1/users/{talent_name}/public-profile")).json()
    assert after_restore["reviews_by_mode"]["talent"]["summary"]["review_count"] == 1
