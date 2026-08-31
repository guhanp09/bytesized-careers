from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

from conftest import create_valid_published_job, valid_published_job_payload
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job


async def _register_verified_login(
    client: AsyncClient,
    *,
    email: str,
    username: str,
    password: str = "Password123!",
) -> str:
    register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "username": username,
            "display_name": username.replace("_", " ").title(),
        },
    )
    assert register.status_code in {200, 201}
    verification_url = register.json().get("verification_url")
    assert verification_url
    token = verification_url.rsplit("token=", 1)[-1]
    verify = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verify.status_code == 200
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return login.json()["access_token"]


async def test_saved_jobs_applications_notifications_reports_and_launch_entitlement(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="owner@example.com", username="job_owner")
    applicant_token = await _register_verified_login(client, email="applicant@example.com", username="applicant")

    job_response = await create_valid_published_job(
        client,
        owner_token,
        title="Long-form gaming editor",
    )
    assert job_response.status_code == 201
    job_id = job_response.json()["id"]

    checkout = await client.post(
        "/api/v1/checkout/launch-free",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"kind": "job_post", "target_type": "job", "target_id": job_id},
    )
    assert checkout.status_code == 201
    assert checkout.json()["source"] == "free_launch"

    save = await client.post(
        f"/api/v1/jobs/{job_id}/save",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"note": "Looks relevant"},
    )
    assert save.status_code == 200
    saved = await client.get("/api/v1/me/saved-jobs", headers={"Authorization": f"Bearer {applicant_token}"})
    assert saved.status_code == 200
    assert saved.json()[0]["job_id"] == job_id

    saved_summary = await client.get(
        "/api/v1/me/saved/summary",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert saved_summary.status_code == 200
    assert saved_summary.json()["jobs"][0]["job"]["title"] == "Long-form gaming editor"

    remove_saved = await client.delete(
        f"/api/v1/jobs/{job_id}/save",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert remove_saved.status_code == 200
    assert remove_saved.json()["ok"] is True

    saved_summary_after_remove = await client.get(
        "/api/v1/me/saved/summary",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert saved_summary_after_remove.status_code == 200
    assert saved_summary_after_remove.json()["jobs"] == []

    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "I can help.", "portfolio_item_ids": []},
    )
    assert application.status_code == 201
    application_id = application.json()["id"]

    sent = await client.get("/api/v1/me/applications/sent", headers={"Authorization": f"Bearer {applicant_token}"})
    assert sent.status_code == 200
    assert sent.json()[0]["id"] == application_id

    received = await client.get(
        "/api/v1/me/applications/received",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert received.status_code == 200
    assert received.json()[0]["id"] == application_id

    status_update = await client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"status": "reviewing"},
    )
    assert status_update.status_code == 200
    assert status_update.json()["status"] == "reviewing"

    notifications = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {applicant_token}"})
    assert notifications.status_code == 200
    assert notifications.json()["unread_count"] >= 1

    report = await client.post(
        "/api/v1/reports",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"target_type": "job", "target_id": job_id, "category": "suspicious", "note": "Test report"},
    )
    assert report.status_code == 201
    assert report.json()["target_type"] == "job"


async def test_talent_listing_save_interest_and_notifications(client: AsyncClient) -> None:
    creator_token = await _register_verified_login(client, email="creator@example.com", username="creator")
    recruiter_token = await _register_verified_login(client, email="recruiter@example.com", username="recruiter")

    create_listing = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {creator_token}"},
        json={
            "title": "Video editor open for creator channels",
            "roles": ["Video editor"],
            "niche": "Gaming",
            "content_niches": ["Gaming", "gaming", ""],
            "content_genres": ["Explainers", "Explainers"],
            "formats": ["Long-form"],
            "platforms": ["YouTube"],
            "tools": ["DaVinci Resolve"],
            "languages": ["Hindi", "English"],
            "work_mode": "remote",
            "location": "Remote",
            "timezone": "IST",
            "availability_status": "available",
            "rate_note": "Contact for pricing",
            "description": "Listing-specific availability for June projects.",
            "status": "published",
        },
    )
    assert create_listing.status_code == 201
    created_listing = create_listing.json()
    listing_id = created_listing["id"]
    assert created_listing["languages"] == ["Hindi", "English"]
    assert created_listing["content_niches"] == ["Gaming"]
    assert created_listing["content_genres"] == ["Explainers"]

    public_list = await client.get("/api/v1/talent-listings")
    assert public_list.status_code == 200
    matched = next((item for item in public_list.json()["items"] if item["id"] == listing_id), None)
    assert matched is not None
    assert matched["languages"] == ["Hindi", "English"]
    assert matched["content_niches"] == ["Gaming"]
    assert matched["content_genres"] == ["Explainers"]

    search_by_genre = await client.get("/api/v1/talent-listings", params={"q": "explainers"})
    assert search_by_genre.status_code == 200
    assert any(item["id"] == listing_id for item in search_by_genre.json()["items"])

    save = await client.post(
        f"/api/v1/talent-listings/{listing_id}/save",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Good fit"},
    )
    assert save.status_code == 200

    saved_summary = await client.get(
        "/api/v1/me/saved/summary",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert saved_summary.status_code == 200
    assert saved_summary.json()["talent"][0]["talent"]["title"] == "Video editor open for creator channels"

    remove_saved = await client.delete(
        f"/api/v1/talent-listings/{listing_id}/save",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert remove_saved.status_code == 200
    assert remove_saved.json()["ok"] is True

    saved_summary_after_remove = await client.get(
        "/api/v1/me/saved/summary",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert saved_summary_after_remove.status_code == 200
    assert saved_summary_after_remove.json()["talent"] == []

    interest = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Interested in an edit test."},
    )
    assert interest.status_code == 201
    interest_id = interest.json()["id"]

    received = await client.get(
        "/api/v1/me/talent-interests",
        headers={"Authorization": f"Bearer {creator_token}"},
    )
    assert received.status_code == 200
    assert received.json()[0]["id"] == interest_id

    notifications = await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {creator_token}"})
    assert notifications.status_code == 200
    assert notifications.json()["unread_count"] >= 1

    creator_activity = await client.get(
        "/api/v1/me/activity/summary",
        headers={"Authorization": f"Bearer {creator_token}"},
    )
    assert creator_activity.status_code == 200
    creator_activity_data = creator_activity.json()
    assert creator_activity_data["received_interests"][0]["id"] == interest_id
    assert creator_activity_data["related_talent_listings"][0]["id"] == listing_id

    recruiter_activity = await client.get(
        "/api/v1/me/activity/summary",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert recruiter_activity.status_code == 200
    assert recruiter_activity.json()["sent_interests"][0]["id"] == interest_id


async def test_talent_listing_delete_requires_owner(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(
        client, email="talent-delete-owner@example.com", username="talent_delete_owner"
    )
    other_token = await _register_verified_login(
        client, email="talent-delete-other@example.com", username="talent_delete_other"
    )

    create_listing = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Thumbnail designer open for work",
            "roles": ["Thumbnail designer"],
            "niche": "Gaming",
            "formats": ["Thumbnails"],
            "platforms": ["YouTube"],
            "work_mode": "remote",
            "location": "Remote",
            "availability_status": "available",
            "status": "published",
        },
    )
    assert create_listing.status_code == 201
    listing_id = create_listing.json()["id"]

    # Anonymous callers can't delete.
    unauth_delete = await client.delete(f"/api/v1/talent-listings/{listing_id}")
    assert unauth_delete.status_code == 401

    # A signed-in non-owner is forbidden.
    wrong_owner_delete = await client.delete(
        f"/api/v1/talent-listings/{listing_id}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert wrong_owner_delete.status_code == 403

    # The owner can soft-delete it.
    owner_delete = await client.delete(
        f"/api/v1/talent-listings/{listing_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert owner_delete.status_code == 200
    assert owner_delete.json()["ok"] is True

    # Once deleted it 404s on fetch and disappears from the public list.
    fetch_deleted = await client.get(f"/api/v1/talent-listings/{listing_id}")
    assert fetch_deleted.status_code == 404

    public_list = await client.get("/api/v1/talent-listings")
    assert public_list.status_code == 200
    assert all(item["id"] != listing_id for item in public_list.json()["items"])

    # It also drops out of the owner's own listing endpoint.
    my_listings = await client.get(
        "/api/v1/me/talent-listings",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert my_listings.status_code == 200
    my_listing_ids = [item["id"] for item in my_listings.json()]
    assert listing_id not in my_listing_ids


async def test_talent_interest_can_be_attached_to_recruiter_job(client: AsyncClient) -> None:
    talent_token = await _register_verified_login(
        client,
        email="talent-invite@example.com",
        username="talent_invite",
    )
    recruiter_token = await _register_verified_login(
        client,
        email="recruiter-invite@example.com",
        username="recruiter_invite",
    )
    other_recruiter_token = await _register_verified_login(
        client,
        email="other-recruiter-invite@example.com",
        username="other_invite",
    )

    listing_response = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {talent_token}"},
        json={
            "title": "Thumbnail designer for creator-led channels",
            "roles": ["Thumbnail designer"],
            "platforms": ["YouTube"],
            "tools": ["Photoshop"],
            "work_mode": "remote",
            "status": "published",
        },
    )
    assert listing_response.status_code == 201
    listing_id = listing_response.json()["id"]

    job_response = await create_valid_published_job(
        client,
        recruiter_token,
        title="YouTube thumbnail designer",
    )
    assert job_response.status_code == 201
    job_id = job_response.json()["id"]

    wrong_owner = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {other_recruiter_token}"},
        json={"job_id": job_id, "note": "Can you work on this?"},
    )
    assert wrong_owner.status_code == 403

    invite = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"job_id": job_id, "note": "Can you work on this?"},
    )
    assert invite.status_code == 201
    assert invite.json()["job_id"] == job_id
    invite_id = invite.json()["id"]

    duplicate_invite = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"job_id": job_id, "note": "Updated invite context."},
    )
    assert duplicate_invite.status_code == 201
    assert duplicate_invite.json()["id"] == invite_id
    # A retry/revisit returns the durable original request without rewriting
    # its opening message or creating a second Inbox thread.
    assert duplicate_invite.json()["note"] == "Can you work on this?"
    assert duplicate_invite.json()["status"] == "new"

    sent = await client.get(
        "/api/v1/me/talent-interests/sent",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert sent.status_code == 200
    assert len(sent.json()) == 1
    assert sent.json()[0]["job_id"] == job_id


async def test_job_and_talent_drafts_resume_by_updating_existing_records(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client,
        email="draft-resume@example.com",
        username="draft_resume",
    )

    job_draft = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Draft editor role",
            "category": "Editing",
            "location": "Remote",
            "status": "draft",
        },
    )
    assert job_draft.status_code == 201
    job_id = job_draft.json()["id"]

    resumed_job = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json=await valid_published_job_payload(title="Published editor role"),
    )
    assert resumed_job.status_code == 200
    assert resumed_job.json()["id"] == job_id
    assert resumed_job.json()["title"] == "Published editor role"
    assert resumed_job.json()["status"] == "published"

    talent_draft = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Draft retention editor listing",
            "roles": ["Video editor"],
            "tools": ["Premiere Pro"],
            "work_mode": "remote",
            "status": "draft",
        },
    )
    assert talent_draft.status_code == 201
    listing_id = talent_draft.json()["id"]

    resumed_listing = await client.patch(
        f"/api/v1/talent-listings/{listing_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"title": "Published retention editor listing", "status": "published"},
    )
    assert resumed_listing.status_code == 200
    assert resumed_listing.json()["id"] == listing_id
    assert resumed_listing.json()["title"] == "Published retention editor listing"
    assert resumed_listing.json()["status"] == "published"

    activity = await client.get(
        "/api/v1/me/activity/summary",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert activity.status_code == 200
    data = activity.json()
    assert any(item["id"] == job_id for item in data["my_jobs"])
    assert any(item["id"] == listing_id for item in data["my_talent_listings"])


async def test_saved_drafts_appear_in_my_listing_endpoints(client: AsyncClient) -> None:
    # The dedicated /drafts page reads GET /me/jobs and GET /me/talent-listings, so a
    # Save Draft must persist with status "draft" and show up in those lists. Partial
    # data (no budget/rate/description) must not block saving a draft.
    owner_token = await _register_verified_login(
        client, email="drafts-listing@example.com", username="drafts_listing"
    )

    job_draft = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"title": "Partial editor draft", "category": "Editing", "location": "Remote", "status": "draft"},
    )
    assert job_draft.status_code == 201
    job_id = job_draft.json()["id"]

    my_jobs = await client.get("/api/v1/me/jobs", headers={"Authorization": f"Bearer {owner_token}"})
    assert my_jobs.status_code == 200
    job_row = next((item for item in my_jobs.json() if item["id"] == job_id), None)
    assert job_row is not None
    assert job_row["status"] == "draft"

    talent_draft = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Partial talent draft",
            "roles": ["Video editor"],
            "tools": ["Premiere Pro"],
            "work_mode": "remote",
            "status": "draft",
        },
    )
    assert talent_draft.status_code == 201
    listing_id = talent_draft.json()["id"]

    my_listings = await client.get(
        "/api/v1/me/talent-listings", headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert my_listings.status_code == 200
    listing_row = next((item for item in my_listings.json() if item["id"] == listing_id), None)
    assert listing_row is not None
    assert listing_row["status"] == "draft"

    # Resuming a draft updates the same record instead of creating a duplicate.
    updated = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"title": "Partial editor draft (updated)"},
    )
    assert updated.status_code == 200
    assert updated.json()["id"] == job_id
    my_jobs_after = await client.get("/api/v1/me/jobs", headers={"Authorization": f"Bearer {owner_token}"})
    assert sum(1 for item in my_jobs_after.json() if item["id"] == job_id) == 1


async def test_apply_blocked_for_unpublished_job(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(client, email="draft-owner@example.com", username="draft_owner")
    applicant_token = await _register_verified_login(
        client, email="draft-applicant@example.com", username="draft_applicant"
    )

    job_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Draft-only editing role",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "draft",
        },
    )
    assert job_response.status_code == 201
    job_id = job_response.json()["id"]

    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "Interested.", "portfolio_item_ids": []},
    )
    assert application.status_code == 400
    assert application.json()["error"]["message"] == "This job is not accepting applications"


async def test_application_first_message_answers_persist_and_round_trip(client: AsyncClient) -> None:
    """Structured first-message answers survive apply and appear for both sides of the inbox."""
    owner_token = await _register_verified_login(client, email="fm-owner@example.com", username="fm_owner")
    applicant_token = await _register_verified_login(client, email="fm-applicant@example.com", username="fm_applicant")

    job = await create_valid_published_job(
        client,
        owner_token,
        title="Finance editor with first-message requirements",
        application_requirements=["expected_rate", "relevant_portfolio", "fit_note"],
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    answers = {
        "expected_rate": {"amount": "2500", "unit": "per video"},
        "relevant_portfolio": [{"id": "portfolio-1", "title": "Retention edit"}],
        "fit_note": "I edit finance explainers with tight retention.",
    }
    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={
            "cover_note": "Excited to help.",
            "portfolio_item_ids": ["portfolio-1"],
            "first_message_answers": answers,
        },
    )
    assert application.status_code == 201
    assert application.json()["first_message_answers"] == answers

    sent = await client.get("/api/v1/me/applications/sent", headers={"Authorization": f"Bearer {applicant_token}"})
    assert sent.status_code == 200
    assert sent.json()[0]["first_message_answers"] == answers

    received = await client.get(
        "/api/v1/me/applications/received",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert received.status_code == 200
    assert received.json()[0]["first_message_answers"] == answers


async def test_application_without_first_message_answers_defaults_to_empty(client: AsyncClient) -> None:
    """Backward compatibility: applying without answers stores an empty mapping."""
    owner_token = await _register_verified_login(client, email="fm-legacy-owner@example.com", username="fm_legacy_owner")
    applicant_token = await _register_verified_login(
        client, email="fm-legacy-applicant@example.com", username="fm_legacy_applicant"
    )

    job = await create_valid_published_job(
        client,
        owner_token,
        title="Legacy editor role",
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "Interested.", "portfolio_item_ids": []},
    )
    assert application.status_code == 201
    assert application.json()["first_message_answers"] == {}


async def test_talent_listing_first_message_requirements_persist_and_round_trip(client: AsyncClient) -> None:
    """Talent listings store the recruiter-facing first-message requirements they declare."""
    creator_token = await _register_verified_login(client, email="fm-creator@example.com", username="fm_creator")

    requirements = ["project_budget", "project_brief", "reference_links", "fit_note"]
    create_listing = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {creator_token}"},
        json={
            "title": "Retention editor open for creator channels",
            "roles": ["Video editor"],
            "platforms": ["YouTube"],
            "tools": ["Premiere Pro"],
            "work_mode": "remote",
            "first_message_requirements": requirements,
            "status": "published",
        },
    )
    assert create_listing.status_code == 201
    listing_id = create_listing.json()["id"]
    assert create_listing.json()["first_message_requirements"] == requirements
    assert create_listing.json()["content_niches"] == []
    assert create_listing.json()["content_genres"] == []

    public_list = await client.get("/api/v1/talent-listings")
    assert public_list.status_code == 200
    listing = next(item for item in public_list.json()["items"] if item["id"] == listing_id)
    assert listing["first_message_requirements"] == requirements


async def test_talent_interest_first_message_answers_persist_and_round_trip(client: AsyncClient) -> None:
    """Recruiter hiring requests carry structured answers through to the creator's inbox."""
    creator_token = await _register_verified_login(client, email="fm-talent@example.com", username="fm_talent")
    recruiter_token = await _register_verified_login(client, email="fm-recruiter@example.com", username="fm_recruiter")

    create_listing = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {creator_token}"},
        json={
            "title": "Shorts editor for daily channels",
            "roles": ["Shorts editor"],
            "platforms": ["YouTube"],
            "tools": ["CapCut"],
            "work_mode": "remote",
            "first_message_requirements": ["project_budget", "project_brief", "fit_note"],
            "status": "published",
        },
    )
    assert create_listing.status_code == 201
    listing_id = create_listing.json()["id"]

    answers = {
        "project_budget": {"amount": "40000", "unit": "per month"},
        "project_brief": "Daily faceless shorts from long-form podcast clips.",
        "fit_note": "Looking for fast turnaround and consistent style.",
    }
    interest = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Would love to work together.", "first_message_answers": answers},
    )
    assert interest.status_code == 201
    assert interest.json()["first_message_answers"] == answers

    received = await client.get(
        "/api/v1/me/talent-interests",
        headers={"Authorization": f"Bearer {creator_token}"},
    )
    assert received.status_code == 200
    assert received.json()[0]["first_message_answers"] == answers


async def test_apply_to_job_missing_required_answers_returns_422(client: AsyncClient) -> None:
    """The apply endpoint rejects a direct call that omits required first-message details."""
    owner_token = await _register_verified_login(client, email="fm-block-owner@example.com", username="fm_block_owner")
    applicant_token = await _register_verified_login(
        client, email="fm-block-applicant@example.com", username="fm_block_applicant"
    )

    job = await create_valid_published_job(
        client,
        owner_token,
        title="Editor that requires opening details",
        application_requirements=["expected_rate", "relevant_portfolio", "fit_note"],
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    # No answers at all → blocked.
    blocked = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "Trying to bypass the modal.", "first_message_answers": {}},
    )
    assert blocked.status_code == 422
    detail = blocked.json()["error"]["message"]
    assert "expected_rate" in detail and "relevant_portfolio" in detail and "fit_note" in detail

    # Present-but-blank answers are still incomplete → blocked.
    partial = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={
            "first_message_answers": {
                "expected_rate": {"amount": "", "unit": "per video"},
                "relevant_portfolio": [],
                "fit_note": "   ",
            }
        },
    )
    assert partial.status_code == 422

    # Complete answers → accepted.
    accepted = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={
            "first_message_answers": {
                "expected_rate": {"amount": "2500", "unit": "per video"},
                "relevant_portfolio": [{"id": "portfolio-1", "title": "Reel"}],
                "fit_note": "Strong retention editing background.",
            }
        },
    )
    assert accepted.status_code == 201


async def test_send_talent_interest_missing_required_answers_returns_422(client: AsyncClient) -> None:
    """The talent-interest endpoint rejects a direct call that omits required details."""
    creator_token = await _register_verified_login(client, email="fm-block-talent@example.com", username="fm_block_talent")
    recruiter_token = await _register_verified_login(
        client, email="fm-block-recruiter@example.com", username="fm_block_recruiter"
    )

    create_listing = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {creator_token}"},
        json={
            "title": "Editor requiring recruiter details",
            "roles": ["Video editor"],
            "platforms": ["YouTube"],
            "tools": ["Premiere Pro"],
            "work_mode": "remote",
            "first_message_requirements": ["project_budget", "project_brief", "fit_note"],
            "status": "published",
        },
    )
    assert create_listing.status_code == 201
    listing_id = create_listing.json()["id"]

    blocked = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Trying to bypass.", "first_message_answers": {}},
    )
    assert blocked.status_code == 422
    detail = blocked.json()["error"]["message"]
    assert "project_budget" in detail and "project_brief" in detail and "fit_note" in detail

    accepted = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={
            "note": "Real outreach.",
            "first_message_answers": {
                "project_budget": {"amount": "40000", "unit": "per month"},
                "project_brief": "Daily shorts from podcast clips.",
                "fit_note": "Need consistent style and fast turnaround.",
            },
        },
    )
    assert accepted.status_code == 201


async def test_apply_without_requirements_ignores_first_message_enforcement(client: AsyncClient) -> None:
    """Backward compatibility: a job with no requirements accepts an empty application."""
    owner_token = await _register_verified_login(
        client, email="fm-compat-owner@example.com", username="fm_compat_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="fm-compat-applicant@example.com", username="fm_compat_applicant"
    )

    job = await create_valid_published_job(
        client,
        owner_token,
        title="No-requirements role",
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "No structured details needed."},
    )
    assert application.status_code == 201


async def test_external_job_rejects_new_internal_application(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(
        client, email="external-owner@example.com", username="external_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="external-applicant@example.com", username="external_applicant"
    )

    job = await create_valid_published_job(
        client,
        owner_token,
        title="External application editor role",
        application_mode="external",
        external_apply_url="https://careers.example.com/creator-editor",
    )
    assert job.status_code == 201
    job_id = job.json()["id"]
    applicant_headers = {"Authorization": f"Bearer {applicant_token}"}

    blocked = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers=applicant_headers,
        json={"cover_note": "This must not create an internal application."},
    )
    assert blocked.status_code == 422
    error = blocked.json()["error"]
    assert error["code"] == "EXTERNAL_APPLICATION_ONLY"
    assert error["details"] == {
        "code": "EXTERNAL_APPLICATION_ONLY",
        "message": "This job accepts applications on an external site.",
    }

    relationship = await client.get(
        f"/api/v1/jobs/{job_id}/application", headers=applicant_headers
    )
    assert relationship.status_code == 200
    assert relationship.json() is None


async def test_expired_job_rejects_new_application(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner_token = await _register_verified_login(
        client, email="expired-owner@example.com", username="expired_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="expired-applicant@example.com", username="expired_applicant"
    )

    job = await create_valid_published_job(
        client,
        owner_token,
        title="Expired application editor role",
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    stored_job = await db_session.get(Job, UUID(job_id))
    assert stored_job is not None
    stored_job.deadline_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()

    blocked = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={},
    )
    assert blocked.status_code == 422
    error = blocked.json()["error"]
    assert error["code"] == "APPLICATION_DEADLINE_PASSED"
    assert error["details"] == {
        "code": "APPLICATION_DEADLINE_PASSED",
        "message": "The application deadline for this job has passed.",
    }


async def test_application_succeeds_without_screening_and_delivers_questions_to_inbox(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="screening-owner@example.com", username="screening_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="screening-applicant@example.com", username="screening_applicant"
    )
    applicant_headers = {"Authorization": f"Bearer {applicant_token}"}
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    required_prompt = "Which edit best demonstrates your retention judgment?"
    optional_prompt = "Anything else you would like the hiring team to know?"

    job = await create_valid_published_job(
        client,
        owner_token,
        title="Screened creator editor role",
        application_requirements=["fit_note"],
        screening_questions=[
            {
                "prompt": required_prompt,
                "required": True,
                "response_guidance": "Name one project and explain your contribution.",
            },
            {"prompt": optional_prompt, "required": False, "response_guidance": None},
        ],
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    # Public job serialization no longer exposes the screening questions...
    public = await client.get(f"/api/v1/jobs/{job_id}")
    assert public.status_code == 200
    assert public.json()["screening_questions"] is None
    # ...but the owner's own job list still returns them for editing.
    mine = await client.get("/api/v1/me/jobs", headers=owner_headers)
    my_job = [j for j in mine.json() if j["id"] == job_id][0]
    assert [q["prompt"] for q in my_job["screening_questions"]] == [required_prompt, optional_prompt]

    saved = await client.post(
        f"/api/v1/jobs/{job_id}/save",
        headers=applicant_headers,
        json={},
    )
    assert saved.status_code == 200
    saved_summary = await client.get(
        "/api/v1/me/saved/summary",
        headers=applicant_headers,
    )
    saved_job = saved_summary.json()["jobs"][0]["job"]
    assert saved_job["screening_questions"] is None
    assert saved_job["languages"] == []
    assert saved_job["language_requirements"] is None

    # The application succeeds without any screening answers, and a client-supplied
    # screening payload is dropped rather than stored.
    accepted = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers=applicant_headers,
        json={
            "first_message_answers": {
                "fit_note": "I have relevant creator-economy editing experience.",
                "screening_questions": [{"question_index": 0, "response": "forged"}],
            }
        },
    )
    assert accepted.status_code == 201
    application_id = accepted.json()["id"]
    assert "screening_questions" not in accepted.json()["first_message_answers"]
    assert accepted.json()["first_message_answers"]["fit_note"].startswith("I have relevant")

    # The applicant sees an automated hiring-side screening message, unread, structured.
    convo = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_headers
    )
    assert convo.status_code == 200
    messages = convo.json()["messages"]
    assert len(messages) == 1
    screening = messages[0]
    assert screening["message_kind"] == "screening_questions"
    assert screening["automated"] is True
    assert screening["from_me"] is False  # sent by the hiring side, not the applicant
    assert screening["read_by_recipient"] is False
    assert [q["prompt"] for q in screening["screening"]["questions"]] == [required_prompt, optional_prompt]
    assert [q["required"] for q in screening["screening"]["questions"]] == [True, False]
    assert convo.json()["conversation"]["unread_count"] == 1

    applicant_activity = await client.get(
        "/api/v1/me/activity/summary",
        headers=applicant_headers,
    )
    related = next(
        row for row in applicant_activity.json()["related_jobs"] if row["id"] == job_id
    )
    assert related["screening_questions"] is None

    # The recruiter sees the same message as their own (from_me), not counted unread.
    owner_convo = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=owner_headers
    )
    owner_messages = owner_convo.json()["messages"]
    assert len(owner_messages) == 1
    assert owner_messages[0]["from_me"] is True
    assert owner_convo.json()["conversation"]["unread_count"] == 0

    # Idempotent: a duplicate application returns the existing one and never resends.
    duplicate = await client.post(
        f"/api/v1/jobs/{job_id}/applications", headers=applicant_headers, json={}
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["id"] == application_id
    convo_again = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_headers
    )
    assert len(convo_again.json()["messages"]) == 1

    paused = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers=owner_headers,
        json={"status": "paused"},
    )
    assert paused.status_code == 200
    hidden_saved = await client.get(
        "/api/v1/me/saved/summary",
        headers=applicant_headers,
    )
    assert hidden_saved.json()["jobs"][0]["job"] is None

    draft = await create_valid_published_job(
        client,
        owner_token,
        title="Private screened draft",
        status="draft",
        screening_questions=[{"prompt": "Private prompt", "required": True}],
    )
    assert draft.status_code == 201
    assert (
        await client.post(
            f"/api/v1/jobs/{draft.json()['id']}/save",
            headers=applicant_headers,
            json={},
        )
    ).status_code == 404


async def test_screening_message_keeps_its_original_snapshot_after_the_job_is_edited(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="snap-owner@example.com", username="snap_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="snap-applicant@example.com", username="snap_applicant"
    )
    original_prompt = "What is your reliable weekly batch capacity?"
    job = await create_valid_published_job(
        client,
        owner_token,
        title="Snapshot editor role",
        application_requirements=["fit_note"],
        screening_questions=[{"prompt": original_prompt, "required": True, "response_guidance": None}],
    )
    job_id = job.json()["id"]
    applied = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"first_message_answers": {"fit_note": "Available for weekly batches."}},
    )
    assert applied.status_code == 201
    application_id = applied.json()["id"]

    # The recruiter later changes the job's screening questions entirely.
    edited = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"screening_questions": [{"prompt": "A completely different question?", "required": False}]},
    )
    assert edited.status_code == 200, edited.text

    # The existing conversation still shows the ORIGINAL snapshot, not the edited job.
    convo = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    questions = convo.json()["messages"][0]["screening"]["questions"]
    assert [q["prompt"] for q in questions] == [original_prompt]


async def test_no_screening_questions_creates_no_automated_message(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="noscreen-owner@example.com", username="noscreen_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="noscreen-applicant@example.com", username="noscreen_applicant"
    )
    job = await create_valid_published_job(
        client, owner_token, title="No-screening editor role", application_requirements=["fit_note"]
    )
    job_id = job.json()["id"]
    applied = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"first_message_answers": {"fit_note": "Ready to help with your edits."}},
    )
    assert applied.status_code == 201
    convo = await client.get(
        f"/api/v1/me/applications/{applied.json()['id']}/conversation",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    assert convo.json()["messages"] == []


async def test_existing_application_is_returned_before_external_mode_guard(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="existing-external-owner@example.com", username="route_owner"
    )
    applicant_token = await _register_verified_login(
        client,
        email="existing-external-applicant@example.com",
        username="route_applicant",
    )
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    applicant_headers = {"Authorization": f"Bearer {applicant_token}"}

    job = await create_valid_published_job(
        client,
        owner_token,
        title="Application route changed later",
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    original = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers=applicant_headers,
        json={"cover_note": "Original internal application."},
    )
    assert original.status_code == 201

    changed_route = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers=owner_headers,
        json={
            "application_mode": "external",
            "external_apply_url": "https://careers.example.com/changed-route",
        },
    )
    assert changed_route.status_code == 200
    assert changed_route.json()["application_mode"] == "external"

    duplicate = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers=applicant_headers,
        json={"cover_note": "This must not replace the first application."},
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["id"] == original.json()["id"]
    assert duplicate.json()["cover_note"] == "Original internal application."


async def test_apply_to_job_twice_reuses_the_same_application(client: AsyncClient) -> None:
    """Re-applying never creates a second application: the same conversation is reused."""
    owner_token = await _register_verified_login(client, email="dup-owner@example.com", username="dup_owner")
    applicant_token = await _register_verified_login(client, email="dup-applicant@example.com", username="dup_applicant")

    job = await create_valid_published_job(
        client,
        owner_token,
        title="Editor reused on re-apply",
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    first = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "First send."},
    )
    assert first.status_code == 201
    first_id = first.json()["id"]

    second = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "Accidental re-click."},
    )
    assert second.status_code == 201
    assert second.json()["id"] == first_id

    sent = await client.get("/api/v1/me/applications/sent", headers={"Authorization": f"Bearer {applicant_token}"})
    assert sent.status_code == 200
    assert len([row for row in sent.json() if row["job_id"] == job_id]) == 1


async def test_job_relationship_read_and_terminal_revisit_keep_one_application(
    client: AsyncClient,
) -> None:
    """A job is one immutable opportunity: withdrawal keeps its history and thread."""

    owner_token = await _register_verified_login(
        client, email="relationship-owner@example.com", username="rel_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="relationship-applicant@example.com", username="rel_applicant"
    )
    applicant_headers = {"Authorization": f"Bearer {applicant_token}"}

    job = await create_valid_published_job(
        client,
        owner_token,
        title="Relationship-aware editor role",
    )
    job_id = job.json()["id"]

    before = await client.get(f"/api/v1/jobs/{job_id}/application", headers=applicant_headers)
    assert before.status_code == 200
    assert before.json() is None

    first = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers=applicant_headers,
        json={"cover_note": "Original application context."},
    )
    assert first.status_code == 201
    application_id = first.json()["id"]

    relationship = await client.get(
        f"/api/v1/jobs/{job_id}/application", headers=applicant_headers
    )
    assert relationship.status_code == 200
    assert relationship.json()["id"] == application_id
    assert relationship.json()["status"] == "new"
    assert relationship.json()["manager_note"] is None

    withdrawn = await client.post(
        f"/api/v1/applications/{application_id}/withdraw", headers=applicant_headers
    )
    assert withdrawn.status_code == 200
    assert withdrawn.json()["status"] == "withdrawn"

    closed = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"status": "closed"},
    )
    assert closed.status_code == 200

    revisit = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers=applicant_headers,
        json={"cover_note": "This must not replace or duplicate the original."},
    )
    assert revisit.status_code == 201
    assert revisit.json()["id"] == application_id
    assert revisit.json()["status"] == "withdrawn"
    assert revisit.json()["cover_note"] == "Original application context."

    sent = await client.get("/api/v1/me/applications/sent", headers=applicant_headers)
    matching = [row for row in sent.json() if row["job_id"] == job_id]
    assert len(matching) == 1


async def test_application_notifications_deep_link_each_participant_to_the_same_thread(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="deep-owner@example.com", username="deep_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="deep-applicant@example.com", username="deep_applicant"
    )
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    applicant_headers = {"Authorization": f"Bearer {applicant_token}"}
    job = await create_valid_published_job(
        client,
        owner_token,
        title="Notification deep-link role",
    )
    application = await client.post(
        f"/api/v1/jobs/{job.json()['id']}/applications",
        headers=applicant_headers,
        json={},
    )
    application_id = application.json()["id"]

    owner_notifications = (await client.get("/api/v1/notifications", headers=owner_headers)).json()["items"]
    applicant_notifications = (
        await client.get("/api/v1/notifications", headers=applicant_headers)
    ).json()["items"]
    owner_item = next(item for item in owner_notifications if item["type"] == "new_applicant")
    applicant_item = next(
        item for item in applicant_notifications if item["type"] == "application_submitted"
    )
    assert owner_item["action_url"] == (
        f"/applications?view=inbox&mode=recruiter&thread={application_id}"
    )
    assert applicant_item["action_url"] == (
        f"/applications?view=inbox&mode=talent&thread={application_id}"
    )


async def test_concurrent_application_requests_create_one_record_and_one_thread(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="race-owner@example.com", username="race_owner"
    )
    applicant_token = await _register_verified_login(
        client, email="race-applicant@example.com", username="race_applicant"
    )
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    applicant_headers = {"Authorization": f"Bearer {applicant_token}"}
    job = await create_valid_published_job(
        client,
        owner_token,
        title="Concurrent application role",
    )
    job_id = job.json()["id"]

    async def submit(note: str):
        return await client.post(
            f"/api/v1/jobs/{job_id}/applications",
            headers=applicant_headers,
            json={"cover_note": note},
        )

    first, second = await asyncio.gather(submit("First click"), submit("Second click"))
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    sent = await client.get("/api/v1/me/applications/sent", headers=applicant_headers)
    matching = [row for row in sent.json() if row["job_id"] == job_id]
    assert len(matching) == 1
    conversations = await client.get("/api/v1/me/conversations", headers=owner_headers)
    matching_threads = [
        row for row in conversations.json() if row["application_id"] == matching[0]["id"]
    ]
    assert len(matching_threads) == 1

    owner_notifications = (await client.get("/api/v1/notifications", headers=owner_headers)).json()["items"]
    matching_notifications = [
        row
        for row in owner_notifications
        if row["type"] == "new_applicant" and row["resource_id"] == matching[0]["id"]
    ]
    assert len(matching_notifications) == 1


async def test_send_talent_interest_twice_reuses_the_same_request(client: AsyncClient) -> None:
    """Revisiting a request preserves its original content and terminal state."""
    creator_token = await _register_verified_login(client, email="dup-creator@example.com", username="dup_creator")
    recruiter_token = await _register_verified_login(client, email="dup-recruiter@example.com", username="dup_recruiter")

    create_listing = await client.post(
        "/api/v1/talent-listings",
        headers={"Authorization": f"Bearer {creator_token}"},
        json={
            "title": "Editor reused on re-request",
            "roles": ["Video editor"],
            "platforms": ["YouTube"],
            "tools": ["Premiere Pro"],
            "work_mode": "remote",
            "status": "published",
        },
    )
    assert create_listing.status_code == 201
    listing_id = create_listing.json()["id"]

    before = await client.get(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert before.status_code == 200
    assert before.json() is None

    first = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "First outreach."},
    )
    assert first.status_code == 201
    first_id = first.json()["id"]

    relationship = await client.get(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert relationship.status_code == 200
    assert relationship.json()["id"] == first_id

    received_summary = await client.get(
        "/api/v1/me/activity/summary",
        headers={"Authorization": f"Bearer {creator_token}"},
    )
    received_request = next(
        row
        for row in received_summary.json()["received_interests"]
        if row["id"] == first_id
    )
    assert received_request["recruiter_display_name"] == "Dup Recruiter"
    assert received_request["recruiter_username"] == "dup_recruiter"

    declined = await client.patch(
        f"/api/v1/talent-interests/{first_id}/status",
        headers={"Authorization": f"Bearer {creator_token}"},
        json={"status": "declined"},
    )
    assert declined.status_code == 200

    second = await client.post(
        f"/api/v1/talent-listings/{listing_id}/interest",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"note": "Accidental re-click."},
    )
    assert second.status_code == 201
    assert second.json()["id"] == first_id
    assert second.json()["status"] == "declined"
    assert second.json()["note"] == "First outreach."

    sent = await client.get(
        "/api/v1/me/talent-interests/sent",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    assert sent.status_code == 200
    assert len([row for row in sent.json() if row["talent_listing_id"] == listing_id]) == 1


async def test_concurrent_hiring_requests_create_one_record_thread_and_notification(
    client: AsyncClient,
) -> None:
    creator_token = await _register_verified_login(
        client, email="race-creator@example.com", username="race_creator"
    )
    recruiter_token = await _register_verified_login(
        client, email="race-recruiter@example.com", username="race_recruiter"
    )
    creator_headers = {"Authorization": f"Bearer {creator_token}"}
    recruiter_headers = {"Authorization": f"Bearer {recruiter_token}"}
    listing = await client.post(
        "/api/v1/talent-listings",
        headers=creator_headers,
        json={
            "title": "Concurrent hiring request listing",
            "roles": ["Video editor"],
            "status": "published",
        },
    )
    listing_id = listing.json()["id"]

    async def submit(note: str):
        return await client.post(
            f"/api/v1/talent-listings/{listing_id}/interest",
            headers=recruiter_headers,
            json={"note": note},
        )

    first, second = await asyncio.gather(submit("First click"), submit("Second click"))
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    interest_id = first.json()["id"]

    sent = await client.get("/api/v1/me/talent-interests/sent", headers=recruiter_headers)
    assert len([row for row in sent.json() if row["talent_listing_id"] == listing_id]) == 1
    conversations = await client.get("/api/v1/me/conversations", headers=creator_headers)
    assert len(
        [row for row in conversations.json() if row["talent_interest_id"] == interest_id]
    ) == 1
    notifications = (await client.get("/api/v1/notifications", headers=creator_headers)).json()[
        "items"
    ]
    assert len(
        [
            row
            for row in notifications
            if row["type"] == "talent_interest_received" and row["resource_id"] == interest_id
        ]
    ) == 1


async def test_screening_answers_return_through_the_conversation_and_stay_snapshotted(
    client: AsyncClient,
) -> None:
    """The applicant answers in the thread; the recruiter reviews it there.

    The questions already travel as one structured message. The answers go back
    the same way — against the question set *as it was asked* — so a later edit
    to the job cannot rewrite what somebody already answered, a retry cannot
    duplicate it, and neither side needs a second place to look.
    """
    owner_token = await _register_verified_login(
        client, email="ansown@example.com", username="ansown"
    )
    applicant_token = await _register_verified_login(
        client, email="ansapp@example.com", username="ansapp"
    )
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    applicant_headers = {"Authorization": f"Bearer {applicant_token}"}
    required_prompt = "Which edit best demonstrates your retention judgment?"
    optional_prompt = "Anything else we should know?"

    job = await create_valid_published_job(
        client,
        owner_token,
        title="Answerable screened role",
        screening_questions=[
            {"prompt": required_prompt, "required": True, "response_guidance": None},
            {"prompt": optional_prompt, "required": False, "response_guidance": None},
        ],
    )
    job_id = job.json()["id"]
    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications", headers=applicant_headers, json={}
    )
    application_id = application.json()["id"]
    convo = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_headers
    )
    conversation_id = convo.json()["conversation"]["id"]

    # A required question left blank is refused, with a reason rather than a code.
    refused = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/screening-answers",
        headers=applicant_headers,
        json={"answers": [{"position": 1, "response": "Only the optional one."}]},
    )
    assert refused.status_code == 422

    # An answer naming a question nobody asked is refused too.
    forged = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/screening-answers",
        headers=applicant_headers,
        json={"answers": [{"position": 0, "response": "ok"}, {"position": 9, "response": "forged"}]},
    )
    assert forged.status_code == 422

    sent = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/screening-answers",
        headers=applicant_headers,
        json={"answers": [{"position": 0, "response": "  The retention rebuild.  "}]},
    )
    assert sent.status_code == 201
    payload = sent.json()["screening_answers"]
    # Every asked question comes back, answered or not: an unanswered optional
    # question must be distinguishable from one that was never asked.
    assert [entry["prompt"] for entry in payload["answers"]] == [required_prompt, optional_prompt]
    assert payload["answers"][0]["response"] == "The retention rebuild."
    assert payload["answers"][0]["answered"] is True
    assert payload["answers"][1]["response"] == ""
    assert payload["answers"][1]["answered"] is False
    assert payload["answers"][1]["required"] is False

    # The recruiter reviews it in the same thread, structured.
    owner_convo = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=owner_headers
    )
    kinds = [message.get("message_kind") for message in owner_convo.json()["messages"]]
    assert kinds == ["screening_questions", "screening_answers"]

    # A retry is the same answer, not a second one.
    again = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/screening-answers",
        headers=applicant_headers,
        json={"answers": [{"position": 0, "response": "The retention rebuild."}]},
    )
    assert again.status_code == 201
    assert again.json()["id"] == sent.json()["id"]
    repeated = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=applicant_headers
    )
    assert len(repeated.json()["messages"]) == 2

    # Editing the job afterwards changes nothing that was already answered.
    edited = await client.patch(
        f"/api/v1/jobs/{job_id}",
        headers=owner_headers,
        json={"screening_questions": [{"prompt": "A completely different question", "required": True}]},
    )
    assert edited.status_code == 200
    after = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=owner_headers
    )
    answered = [m for m in after.json()["messages"] if m.get("message_kind") == "screening_answers"][0]
    assert [entry["prompt"] for entry in answered["screening_answers"]["answers"]] == [
        required_prompt,
        optional_prompt,
    ]


async def test_screening_answers_are_private_to_the_two_participants(
    client: AsyncClient,
) -> None:
    owner_token = await _register_verified_login(
        client, email="anspown@example.com", username="anspown"
    )
    applicant_token = await _register_verified_login(
        client, email="anspapp@example.com", username="anspapp"
    )
    outsider_token = await _register_verified_login(
        client, email="ansout@example.com", username="ansout"
    )
    job = await create_valid_published_job(
        client,
        owner_token,
        title="Private screened role",
        screening_questions=[{"prompt": "Why this role?", "required": True}],
    )
    application = await client.post(
        f"/api/v1/jobs/{job.json()['id']}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={},
    )
    convo = await client.get(
        f"/api/v1/me/applications/{application.json()['id']}/conversation",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    conversation_id = convo.json()["conversation"]["id"]

    blocked = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/screening-answers",
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={"answers": [{"position": 0, "response": "not mine to answer"}]},
    )
    assert blocked.status_code == 403


async def test_screening_answers_need_questions_to_answer(client: AsyncClient) -> None:
    owner_token = await _register_verified_login(
        client, email="ansnown@example.com", username="ansnown"
    )
    applicant_token = await _register_verified_login(
        client, email="ansnapp@example.com", username="ansnapp"
    )
    job = await create_valid_published_job(client, owner_token, title="Unscreened role")
    application = await client.post(
        f"/api/v1/jobs/{job.json()['id']}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={},
    )
    convo = await client.get(
        f"/api/v1/me/applications/{application.json()['id']}/conversation",
        headers={"Authorization": f"Bearer {applicant_token}"},
    )
    missing = await client.post(
        f"/api/v1/me/conversations/{convo.json()['conversation']['id']}/screening-answers",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"answers": []},
    )
    assert missing.status_code == 404
