from __future__ import annotations

from httpx import AsyncClient

from conftest import create_valid_published_job, valid_published_job_payload

PERSONAS_URL = "/api/v1/dev/personas"
SEED_URL = "/api/v1/dev/seed"


async def _register_verified_login(
    client: AsyncClient, *, email: str, username: str, password: str = "Password123!"
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
    token = register.json()["verification_url"].rsplit("token=", 1)[-1]
    assert (await client.post("/api/v1/auth/verify-email", json={"token": token})).status_code == 200
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return login.json()["access_token"]


async def _admin_token(client: AsyncClient) -> str:
    """Log in as the dev-seeded ADMIN persona (the only sanctioned admin path)."""
    await client.post(SEED_URL, json={"scenario": "personas"})
    body = (await client.get(PERSONAS_URL)).json()
    email = next(p["email"] for p in body["personas"] if p["key"] == "admin")
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": body["password"]})
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _published_job(client: AsyncClient, token: str, title: str = "Long-form editor for a finance channel") -> str:
    response = await create_valid_published_job(client, token, title=title)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _published_listing(client: AsyncClient, token: str, title: str = "Video editor open for channels") -> str:
    response = await client.post(
        "/api/v1/talent-listings",
        headers=_auth(token),
        json={
            "title": title,
            "roles": ["Video editor"],
            "niche": "Gaming",
            "formats": ["Long-form"],
            "platforms": ["YouTube"],
            "tools": ["DaVinci Resolve"],
            "work_mode": "remote",
            "location": "Remote",
            "timezone": "IST",
            "availability_status": "available",
            "status": "published",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _file_report(
    client: AsyncClient, token: str, *, target_type: str, target_id: str, category: str = "spam"
) -> str:
    response = await client.post(
        "/api/v1/reports",
        headers=_auth(token),
        json={"target_type": target_type, "target_id": target_id, "category": category, "note": "test"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


async def test_admin_routes_reject_non_admins_and_anonymous(client: AsyncClient) -> None:
    token = await _register_verified_login(client, email="adm_nobody@example.com", username="adm_nobody")
    for path in ("/api/v1/admin/overview", "/api/v1/admin/users", "/api/v1/admin/reports", "/api/v1/admin/audit-log"):
        assert (await client.get(path)).status_code in {401, 403}
        forbidden = await client.get(path, headers=_auth(token))
        assert forbidden.status_code == 403, path


async def test_admin_overview_reports_env_and_counts(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    overview = await client.get("/api/v1/admin/overview", headers=_auth(admin))
    assert overview.status_code == 200
    body = overview.json()
    assert body["env"] == "test"
    assert body["email_delivery_enabled"] is False
    assert body["users_total"] >= 1
    assert set(body["jobs_by_status"]) >= {"draft", "published", "paused", "closed", "archived"}


# ---------------------------------------------------------------------------
# Users: directory, suspension, warnings
# ---------------------------------------------------------------------------


async def test_users_directory_search_and_detail(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    token = await _register_verified_login(client, email="adm_findme@example.com", username="adm_findme")
    # last_active_at is touched by authenticated (bearer) requests.
    assert (await client.get("/api/v1/me/jobs", headers=_auth(token))).status_code == 200

    listing = await client.get("/api/v1/admin/users?q=adm_findme", headers=_auth(admin))
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert len(items) == 1
    assert items[0]["email"] == "adm_findme@example.com"
    assert items[0]["email_verified"] is True
    # last_active_at was touched when the user logged in / authenticated.
    assert items[0]["last_active_at"]

    detail = await client.get(f"/api/v1/admin/users/{items[0]['id']}", headers=_auth(admin))
    assert detail.status_code == 200
    body = detail.json()
    assert body["user"]["id"] == items[0]["id"]
    assert body["identities"] == []
    assert body["reports_about"] == []


async def test_suspension_locks_account_and_hides_public_content(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    owner_token = await _register_verified_login(client, email="adm_suspend@example.com", username="adm_suspend")
    job_id = await _published_job(client, owner_token, title="Suspension visibility job")
    listing_id = await _published_listing(client, owner_token, title="Suspension visibility listing")
    user_id = (await client.get("/api/v1/admin/users?q=adm_suspend", headers=_auth(admin))).json()["items"][0]["id"]

    # Public before: both visible.
    assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 200
    assert (await client.get(f"/api/v1/talent-listings/{listing_id}")).status_code == 200
    assert (await client.get("/api/v1/users/adm_suspend/public-profile")).status_code == 200

    suspended = await client.post(
        f"/api/v1/admin/users/{user_id}/suspend",
        headers=_auth(admin),
        json={"reason": "Repeated off-platform payment pressure."},
    )
    assert suspended.status_code == 200
    assert suspended.json()["suspended_at"]

    # The account is locked out (valid token, locked account -> 403)...
    assert (await client.get("/api/v1/me/jobs", headers=_auth(owner_token))).status_code == 403
    # ...and their content has no public presence.
    assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 404
    assert (await client.get(f"/api/v1/talent-listings/{listing_id}")).status_code == 404
    assert (await client.get("/api/v1/users/adm_suspend/public-profile")).status_code == 404
    jobs_list = (await client.get("/api/v1/jobs?limit=100")).json()
    assert all(item["id"] != job_id for item in jobs_list["items"])

    # Double-suspend conflicts; unsuspend restores access.
    assert (
        await client.post(f"/api/v1/admin/users/{user_id}/suspend", headers=_auth(admin), json={"reason": "again"})
    ).status_code == 409
    restored = await client.post(
        f"/api/v1/admin/users/{user_id}/unsuspend", headers=_auth(admin), json={"reason": "Appeal accepted."}
    )
    assert restored.status_code == 200
    assert (await client.get("/api/v1/me/jobs", headers=_auth(owner_token))).status_code == 200
    assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 200

    # Both actions are in the audit log with justifications.
    audit = await client.get("/api/v1/admin/audit-log?target_type=user", headers=_auth(admin))
    actions = [(row["action"], row["justification"]) for row in audit.json()["items"]]
    assert ("user.suspend", "Repeated off-platform payment pressure.") in actions
    assert ("user.unsuspend", "Appeal accepted.") in actions


async def test_admin_accounts_cannot_be_suspended(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    me_listing = await client.get("/api/v1/admin/users?q=dev_admin", headers=_auth(admin))
    admin_id = me_listing.json()["items"][0]["id"]
    response = await client.post(
        f"/api/v1/admin/users/{admin_id}/suspend", headers=_auth(admin), json={"reason": "nope"}
    )
    assert response.status_code == 400


async def test_warn_user_delivers_moderation_notice(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    token = await _register_verified_login(client, email="adm_warned@example.com", username="adm_warned")
    user_id = (await client.get("/api/v1/admin/users?q=adm_warned", headers=_auth(admin))).json()["items"][0]["id"]

    warned = await client.post(
        f"/api/v1/admin/users/{user_id}/warn",
        headers=_auth(admin),
        json={"body": "Please keep hiring conversations on CreatorJobs."},
    )
    assert warned.status_code == 200

    notifications = (await client.get("/api/v1/notifications", headers=_auth(token))).json()
    warning = next(item for item in notifications["items"] if item["type"] == "account_warning")
    assert warning["category"] == "moderation"
    assert "on CreatorJobs" in warning["body"]


# ---------------------------------------------------------------------------
# Listings: admin lists + audited state actions
# ---------------------------------------------------------------------------


async def test_job_state_actions_are_audited_and_reversible(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    owner = await _register_verified_login(client, email="adm_jobstate@example.com", username="adm_jobstate")
    job_id = await _published_job(client, owner, title="State machine job")

    pause = await client.patch(
        f"/api/v1/admin/jobs/{job_id}/state",
        headers=_auth(admin),
        json={"action": "pause", "reason": "Budget looks off; asking the owner."},
    )
    assert pause.status_code == 200
    assert pause.json()["status"] == "paused"

    hide = await client.patch(
        f"/api/v1/admin/jobs/{job_id}/state",
        headers=_auth(admin),
        json={"action": "hide", "reason": "Confirmed scam pattern."},
    )
    assert hide.status_code == 200
    assert hide.json()["deleted_at"]
    assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 404

    unhide = await client.patch(
        f"/api/v1/admin/jobs/{job_id}/state",
        headers=_auth(admin),
        json={"action": "unhide", "reason": "False positive."},
    )
    assert unhide.status_code == 200
    # Unhide deliberately re-enters as paused, not published.
    assert unhide.json()["status"] == "paused"
    assert unhide.json()["deleted_at"] is None

    # Admin job list includes it with owner context.
    admin_jobs = await client.get("/api/v1/admin/jobs?q=State machine", headers=_auth(admin))
    item = admin_jobs.json()["items"][0]
    assert item["owner"]["email"] == "adm_jobstate@example.com"

    audit = await client.get("/api/v1/admin/audit-log?target_type=job", headers=_auth(admin))
    actions = [row["action"] for row in audit.json()["items"]]
    assert {"job.state.pause", "job.state.hide", "job.state.unhide"} <= set(actions)
    hide_row = next(row for row in audit.json()["items"] if row["action"] == "job.state.hide")
    assert hide_row["before_json"]["deleted_at"] is None
    assert hide_row["after_json"]["deleted_at"]


# ---------------------------------------------------------------------------
# Reports v2
# ---------------------------------------------------------------------------


async def test_report_create_validates_target_and_category(client: AsyncClient) -> None:
    token = await _register_verified_login(client, email="adm_reporter@example.com", username="adm_reporter")
    bogus = await client.post(
        "/api/v1/reports",
        headers=_auth(token),
        json={"target_type": "job", "target_id": "00000000-0000-0000-0000-000000000000", "category": "spam"},
    )
    assert bogus.status_code == 404
    job_id = await _published_job(client, token, title="Category validation job")
    invalid = await client.post(
        "/api/v1/reports",
        headers=_auth(token),
        json={"target_type": "job", "target_id": job_id, "category": "definitely_not_a_reason"},
    )
    assert invalid.status_code == 422


async def test_report_queue_hydration_resolution_and_reopen(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    owner = await _register_verified_login(client, email="adm_rq_owner@example.com", username="adm_rq_owner")
    reporter = await _register_verified_login(client, email="adm_rq_rep@example.com", username="adm_rq_rep")
    job_id = await _published_job(client, owner, title="Hydrated queue job")
    report_id = await _file_report(client, reporter, target_type="job", target_id=job_id, category="scam_or_fraud")

    queue = await client.get("/api/v1/admin/reports?status=open", headers=_auth(admin))
    assert queue.status_code == 200
    item = next(entry for entry in queue.json()["items"] if entry["id"] == report_id)
    assert item["target_label"] == "Job — Hydrated queue job"
    assert item["target_owner"]["email"] == "adm_rq_owner@example.com"
    assert item["reporter"]["email"] == "adm_rq_rep@example.com"
    assert item["sibling_count"] == 0

    # Unknown actions are rejected by the enum now.
    bad = await client.patch(
        f"/api/v1/admin/reports/{report_id}", headers=_auth(admin), json={"action": "mark_verified"}
    )
    assert bad.status_code == 422

    dismissed = await client.patch(
        f"/api/v1/admin/reports/{report_id}",
        headers=_auth(admin),
        json={"action": "dismiss", "admin_note": "Listing checks out."},
    )
    assert dismissed.status_code == 200
    assert dismissed.json()["status"] == "dismissed"

    reopened = await client.patch(
        f"/api/v1/admin/reports/{report_id}", headers=_auth(admin), json={"action": "reopen"}
    )
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "open"
    assert reopened.json()["resolved_at"] is None

    hidden = await client.patch(
        f"/api/v1/admin/reports/{report_id}",
        headers=_auth(admin),
        json={"action": "hide_listing", "admin_note": "Confirmed scam."},
    )
    assert hidden.status_code == 200
    assert hidden.json()["status"] == "action_taken"
    assert hidden.json()["target_status"] == "hidden"
    assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 404

    audit = await client.get("/api/v1/admin/audit-log", headers=_auth(admin))
    rows = audit.json()["items"]
    assert any(row["action"] == "report.hide_listing" and row["report_id"] == report_id for row in rows)
    assert any(row["action"] == "job.state.hide" and row["report_id"] == report_id for row in rows)


async def test_report_warn_and_suspend_actions_target_the_owner(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    owner_token = await _register_verified_login(client, email="adm_rw_owner@example.com", username="adm_rw_owner")
    reporter = await _register_verified_login(client, email="adm_rw_rep@example.com", username="adm_rw_rep")
    listing_id = await _published_listing(client, owner_token, title="Warnable listing")
    report_id = await _file_report(
        client, reporter, target_type="talent_listing", target_id=listing_id, category="harassment"
    )

    missing_note = await client.patch(
        f"/api/v1/admin/reports/{report_id}", headers=_auth(admin), json={"action": "warn_user"}
    )
    assert missing_note.status_code == 422

    warned = await client.patch(
        f"/api/v1/admin/reports/{report_id}",
        headers=_auth(admin),
        json={"action": "warn_user", "user_note": "Keep conversations respectful.", "admin_note": "First strike."},
    )
    assert warned.status_code == 200
    notifications = (await client.get("/api/v1/notifications", headers=_auth(owner_token))).json()
    assert any(item["type"] == "account_warning" for item in notifications["items"])

    second_report = await _file_report(
        client, reporter, target_type="talent_listing", target_id=listing_id, category="scam_or_fraud"
    )
    suspended = await client.patch(
        f"/api/v1/admin/reports/{second_report}",
        headers=_auth(admin),
        json={"action": "suspend_user", "user_note": "Repeated scam attempts."},
    )
    assert suspended.status_code == 200
    assert (await client.get("/api/v1/me/jobs", headers=_auth(owner_token))).status_code == 403


# ---------------------------------------------------------------------------
# Verification queue
# ---------------------------------------------------------------------------


async def test_identity_review_approve_revoke_and_job_badge_derivation(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    owner = await _register_verified_login(client, email="adm_verify@example.com", username="adm_verify")

    created = await client.post(
        "/api/v1/me/hiring-identities",
        headers=_auth(owner),
        json={
            "type": "INDIVIDUAL_CHANNEL",
            "platform": "YOUTUBE",
            "display_name": "Finance Explainers",
            "url": "https://youtube.com/@finance-explainers",
        },
    )
    assert created.status_code in {200, 201}, created.text
    identity_id = created.json()["id"]

    job = await client.post(
        "/api/v1/jobs",
        headers=_auth(owner),
        json={
            "title": "Editor under identity",
            "category": "Editing",
            "status": "draft",
            "platforms": ["youtube"],
            "hiring_identity_id": identity_id,
        },
    )
    assert job.status_code == 201, job.text
    job_id = job.json()["id"]
    assert job.json()["is_verified"] is False

    queue = await client.get("/api/v1/admin/hiring-identities?status=all", headers=_auth(admin))
    entry = next(item for item in queue.json()["items"] if item["id"] == identity_id)
    assert entry["owner"]["email"] == "adm_verify@example.com"
    assert entry["jobs_count"] == 1

    # Reject/revoke require a reason.
    assert (
        await client.patch(
            f"/api/v1/admin/hiring-identities/{identity_id}", headers=_auth(admin), json={"decision": "reject"}
        )
    ).status_code == 422

    approved = await client.patch(
        f"/api/v1/admin/hiring-identities/{identity_id}",
        headers=_auth(admin),
        json={"decision": "approve"},
    )
    assert approved.status_code == 200
    assert approved.json()["verification_status"] == "VERIFIED"
    assert approved.json()["verification_method"] == "MANUAL_ADMIN_REVIEW"
    job_after = (await client.get(f"/api/v1/admin/jobs?q=Editor under identity", headers=_auth(admin))).json()
    assert job_after["items"][0]["is_verified"] is True

    revoked = await client.patch(
        f"/api/v1/admin/hiring-identities/{identity_id}",
        headers=_auth(admin),
        json={"decision": "revoke", "reason": "Channel ownership could not be confirmed."},
    )
    assert revoked.status_code == 200
    assert revoked.json()["verification_status"] == "REJECTED"
    job_final = (await client.get(f"/api/v1/admin/jobs?q=Editor under identity", headers=_auth(admin))).json()
    assert job_final["items"][0]["is_verified"] is False

    audit = await client.get("/api/v1/admin/audit-log?target_type=hiring_identity", headers=_auth(admin))
    actions = [row["action"] for row in audit.json()["items"]]
    assert {"identity.approve", "identity.revoke"} <= set(actions)


async def test_job_is_verified_is_never_client_writable(client: AsyncClient) -> None:
    token = await _register_verified_login(client, email="adm_badge@example.com", username="adm_badge")
    rejected_create = await client.post(
        "/api/v1/jobs",
        headers=_auth(token),
        json=await valid_published_job_payload(
            title="Badge spoof attempt",
            is_verified=True,
        ),
    )
    assert rejected_create.status_code == 422
    assert any(
        error["loc"][-1] == "is_verified"
        for error in rejected_create.json()["error"]["details"]
    )

    created = await create_valid_published_job(client, token, title="Legitimate badge job")
    assert created.status_code == 201, created.text
    assert created.json()["is_verified"] is False

    rejected_update = await client.patch(
        f"/api/v1/jobs/{created.json()['id']}",
        headers=_auth(token),
        json={"is_verified": True},
    )
    assert rejected_update.status_code == 422
    assert any(
        error["loc"][-1] == "is_verified"
        for error in rejected_update.json()["error"]["details"]
    )


# ---------------------------------------------------------------------------
# Conversations: metadata, reported view, message moderation
# ---------------------------------------------------------------------------


async def test_conversations_metadata_and_abuse_signals(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    owner = await _register_verified_login(client, email="adm_conv_owner@example.com", username="adm_conv_owner")
    applicant = await _register_verified_login(client, email="adm_conv_app@example.com", username="adm_conv_app")
    job_id = await _published_job(client, owner, title="Metadata job")
    applied = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers=_auth(applicant),
        json={"cover_note": "Private cover note content.", "portfolio_item_ids": []},
    )
    assert applied.status_code == 201

    applications = await client.get("/api/v1/admin/applications", headers=_auth(admin))
    assert applications.status_code == 200
    entry = next(item for item in applications.json()["items"] if item["job_title"] == "Metadata job")
    # Tier-1 is metadata only: parties + status, never message/cover content.
    assert entry["applicant"]["email"] == "adm_conv_app@example.com"
    assert "cover_note" not in entry and "Private cover note content." not in str(entry)

    signals = await client.get("/api/v1/admin/abuse-signals?days=7", headers=_auth(admin))
    assert signals.status_code == 200
    assert any(row["user"]["email"] == "adm_conv_app@example.com" for row in signals.json()["top_applicants"])


async def test_reported_message_view_is_audited_and_hide_round_trips(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    owner = await _register_verified_login(client, email="adm_msg_owner@example.com", username="adm_msg_owner")
    applicant = await _register_verified_login(client, email="adm_msg_app@example.com", username="adm_msg_app")
    job_id = await _published_job(client, owner, title="Message moderation job")
    application = await client.post(
        f"/api/v1/jobs/{job_id}/applications",
        headers=_auth(applicant),
        json={"cover_note": "Hello.", "portfolio_item_ids": []},
    )
    application_id = application.json()["id"]

    conversation = (
        await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=_auth(applicant))
    ).json()["conversation"]["id"]
    sent = await client.post(
        f"/api/v1/me/conversations/{conversation}/messages",
        headers=_auth(applicant),
        json={"body": "Pay me off-platform on Telegram instead."},
    )
    message_id = sent.json()["id"]

    # The owner reports the message; the admin can then (and only then) view the thread.
    report_id = await _file_report(
        client, owner, target_type="message", target_id=message_id, category="off_platform_payment"
    )
    # Conversation view is refused for non-message reports.
    other_report = await _file_report(client, owner, target_type="job", target_id=job_id, category="other")
    refused = await client.get(f"/api/v1/admin/reports/{other_report}/conversation", headers=_auth(admin))
    assert refused.status_code == 422

    view = await client.get(f"/api/v1/admin/reports/{report_id}/conversation", headers=_auth(admin))
    assert view.status_code == 200
    body = view.json()
    assert body["reported_message_id"] == message_id
    assert any("Telegram" in message["body"] for message in body["messages"])
    audit = await client.get("/api/v1/admin/audit-log?action=conversation.view_reported", headers=_auth(admin))
    assert any(row["report_id"] == report_id for row in audit.json()["items"])

    # Hide removes it from participants' threads; unhide restores it.
    hidden = await client.post(
        f"/api/v1/admin/messages/{message_id}/hide",
        headers=_auth(admin),
        json={"reason": "Off-platform payment pressure.", "report_id": report_id},
    )
    assert hidden.status_code == 200
    owner_view = (
        await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=_auth(owner))
    ).json()
    assert all(message["id"] != message_id for message in owner_view["messages"])

    restored = await client.post(
        f"/api/v1/admin/messages/{message_id}/unhide",
        headers=_auth(admin),
        json={"reason": "Kept as evidence context."},
    )
    assert restored.status_code == 200
    owner_view_after = (
        await client.get(f"/api/v1/me/applications/{application_id}/conversation", headers=_auth(owner))
    ).json()
    assert any(message["id"] == message_id for message in owner_view_after["messages"])


# ---------------------------------------------------------------------------
# Platform: notices, registry, outbox, entitlements
# ---------------------------------------------------------------------------


async def test_platform_notices_registry_and_outbox(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    token = await _register_verified_login(client, email="adm_notice@example.com", username="adm_notice")
    user_id = (await client.get("/api/v1/admin/users?q=adm_notice", headers=_auth(admin))).json()["items"][0]["id"]

    delivered = await client.post(
        "/api/v1/admin/notices",
        headers=_auth(admin),
        json={"user_ids": [user_id], "title": "Beta maintenance window", "body": "CreatorJobs will be read-only tonight."},
    )
    assert delivered.status_code == 200
    assert delivered.json()["delivered"] == 1
    notifications = (await client.get("/api/v1/notifications", headers=_auth(token))).json()
    assert any(item["type"] == "platform_notice" for item in notifications["items"])

    registry = await client.get("/api/v1/admin/notifications/registry", headers=_auth(admin))
    keys = {event["key"] for event in registry.json()}
    assert {"account_warning", "platform_notice", "new_applicant"} <= keys

    outbox = await client.get("/api/v1/admin/email-outbox", headers=_auth(admin))
    assert outbox.status_code == 200


async def test_entitlements_list_and_revoke(client: AsyncClient) -> None:
    admin = await _admin_token(client)
    token = await _register_verified_login(client, email="adm_entitle@example.com", username="adm_entitle")
    checkout = await client.post(
        "/api/v1/checkout/launch-free",
        headers=_auth(token),
        json={"kind": "job_post"},
    )
    assert checkout.status_code == 201
    entitlement_id = checkout.json()["id"]

    listing = await client.get("/api/v1/admin/entitlements?status=active", headers=_auth(admin))
    assert any(item["id"] == entitlement_id for item in listing.json()["items"])

    revoked = await client.post(
        f"/api/v1/admin/entitlements/{entitlement_id}/revoke",
        headers=_auth(admin),
        json={"reason": "Duplicate grant."},
    )
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"
    assert (
        await client.post(
            f"/api/v1/admin/entitlements/{entitlement_id}/revoke", headers=_auth(admin), json={"reason": "again"}
        )
    ).status_code == 409
