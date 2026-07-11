from __future__ import annotations

import asyncio

from httpx import AsyncClient


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

    job_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Long-form gaming editor",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
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
        json={"status": "shortlisted"},
    )
    assert status_update.status_code == 200
    assert status_update.json()["status"] == "shortlisted"

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

    job_response = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={
            "title": "YouTube thumbnail designer",
            "category": "Thumbnails",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
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
        json={"title": "Published editor role", "status": "published"},
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

    job = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Finance editor with first-message requirements",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "application_requirements": ["expected_rate", "relevant_portfolio", "fit_note"],
            "status": "published",
        },
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

    job = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Legacy editor role",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
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

    job = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Editor that requires opening details",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "application_requirements": ["expected_rate", "relevant_portfolio", "fit_note"],
            "status": "published",
        },
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

    job = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "No-requirements role",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
    )
    assert job.status_code == 201
    job_id = job.json()["id"]

    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers={"Authorization": f"Bearer {applicant_token}"},
        json={"cover_note": "No structured details needed."},
    )
    assert application.status_code == 201


async def test_apply_to_job_twice_reuses_the_same_application(client: AsyncClient) -> None:
    """Re-applying never creates a second application: the same conversation is reused."""
    owner_token = await _register_verified_login(client, email="dup-owner@example.com", username="dup_owner")
    applicant_token = await _register_verified_login(client, email="dup-applicant@example.com", username="dup_applicant")

    job = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Editor reused on re-apply",
            "category": "Editing",
            "location": "Remote",
            "platforms": ["youtube"],
            "status": "published",
        },
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

    job = await client.post(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Relationship-aware editor role",
            "category": "Editing",
            "platforms": ["youtube"],
            "status": "published",
        },
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
    job = await client.post(
        "/api/v1/jobs",
        headers=owner_headers,
        json={
            "title": "Notification deep-link role",
            "category": "Editing",
            "platforms": ["youtube"],
            "status": "published",
        },
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
    job = await client.post(
        "/api/v1/jobs",
        headers=owner_headers,
        json={
            "title": "Concurrent application role",
            "category": "Editing",
            "platforms": ["youtube"],
            "status": "published",
        },
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
