"""Public SQL reads must enforce both independent account blocking states."""

from __future__ import annotations

import ast
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.core.account_state import account_is_blocked, active_account_clause
from app.models import Job, TalentListing, User
from app.services.account_deletion_service import cancel_request, request_deletion
from tests.conftest import TestSessionLocal
from tests.test_messaging import _register_verified_login


@pytest_asyncio.fixture
async def records():
    marker = f"visibility{uuid4().hex[:10]}"
    async with TestSessionLocal() as session:
        owner = User(email=f"{marker}@example.test", username=marker, display_name=marker)
        control = User(email=f"control{marker}@example.test", username=f"c{marker}")
        session.add_all([owner, control])
        await session.flush()
        jobs = [
            Job(title=f"Video editor {marker}", posted_by_user_id=user.id, status="published")
            for user in (owner, control)
        ]
        talent = [
            TalentListing(
                owner_user_id=user.id,
                title=f"Video editor {marker}",
                primary_role="Video Editor",
                status="published",
            )
            for user in (owner, control)
        ]
        session.add_all(jobs + talent)
        await session.commit()
        return {
            "owner": owner.id,
            "username": marker,
            "q": marker,
            "job": str(jobs[0].id),
            "talent": str(talent[0].id),
            "control_job": str(jobs[1].id),
            "control_talent": str(talent[1].id),
        }


async def block_owner(records, state):
    async with TestSessionLocal() as session:
        owner = await session.get(User, records["owner"])
        if state in {"deletion", "both"}:
            await request_deletion(session, owner)
        if state in {"suspended", "both"}:
            owner.suspended_at = datetime.now(UTC)
        await session.commit()


@pytest.mark.parametrize("state", ["deletion", "suspended", "both"])
@pytest.mark.parametrize(
    "surface,kind",
    [
        ("jobs", "job"),
        ("talent-listings", "talent"),
        ("search/jobs", "job"),
        ("search/talent", "talent"),
    ],
)
async def test_public_collections_hide_blocked_accounts(client, records, state, surface, kind):
    async def ids():
        response = await client.get(f"/api/v1/{surface}", params={"q": records["q"], "limit": 100})
        assert response.status_code == 200, response.text
        rows = response.json()["items"]
        return {row.get("item", row)["id"] for row in rows}

    # A non-vacuous check: target and independent control were both discoverable.
    before = await ids()
    assert {records[kind], records[f"control_{kind}"]} <= before
    await block_owner(records, state)
    after = await ids()
    assert records[kind] not in after
    assert records[f"control_{kind}"] in after


@pytest.mark.parametrize("state", ["deletion", "suspended", "both"])
@pytest.mark.parametrize("surface", ["job", "talent", "profile"])
async def test_public_details_hide_blocked_accounts(client, records, state, surface):
    path = {
        "job": f"jobs/{records['job']}",
        "talent": f"talent-listings/{records['talent']}",
        "profile": f"users/{records['username']}/public-profile",
    }[surface]
    assert (await client.get(f"/api/v1/{path}")).status_code == 200
    await block_owner(records, state)
    assert (await client.get(f"/api/v1/{path}")).status_code == 404


@pytest.mark.parametrize("suspended", [False, True])
async def test_cancel_deletion_restores_only_an_unsuspended_owner(client, records, suspended):
    await block_owner(records, "both" if suspended else "deletion")
    path = f"/api/v1/jobs/{records['job']}"
    assert (await client.get(path)).status_code == 404
    async with TestSessionLocal() as session:
        owner = await session.get(User, records["owner"])
        await cancel_request(session, owner)
        await session.commit()
    assert (await client.get(path)).status_code == (404 if suspended else 200)


def test_sql_account_enforcement_cannot_read_only_one_blocking_column():
    """AST covers SQLAlchemy .is_/.isnot, missed by the older Python-is guard."""
    root = Path(__file__).resolve().parents[1] / "app"
    exempt = {root / "core/account_state.py", root / "api/v1/routers/admin.py"}
    offenders = []
    for path in root.rglob("*.py"):
        if path in exempt:
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in {"is_", "isnot", "is_not"}
                and isinstance(node.func.value, ast.Attribute)
                and node.func.value.attr in {"suspended_at", "deletion_hidden_at"}
            ):
                offenders.append(f"{path.relative_to(root)}:{node.lineno}")
    assert not offenders, offenders


@pytest.mark.parametrize(
    "suspended,hidden", [(False, False), (True, False), (False, True), (True, True)]
)
async def test_sql_predicate_agrees_with_object_policy_and_supports_aliases(
    db_session, suspended, hidden
):
    now = datetime.now(UTC)
    user = User(
        email=f"policy{uuid4().hex}@example.test",
        suspended_at=now if suspended else None,
        deletion_hidden_at=now if hidden else None,
    )
    db_session.add(user)
    await db_session.flush()
    owner = aliased(User)
    active = (
        await db_session.execute(
            select(owner.id).where(owner.id == user.id, active_account_clause(owner))
        )
    ).scalar_one_or_none()
    assert (active is not None) is (not account_is_blocked(user))


@pytest.mark.parametrize("state", ["deletion", "suspended", "both"])
@pytest.mark.parametrize(
    "surface,kind,payload,expected",
    [
        ("jobs/{id}/save", "job", {"note": "Private note"}, 404),
        ("jobs/{id}/applications", "job", {"cover_note": "Hello", "portfolio_item_ids": []}, 400),
        ("talent-listings/{id}/save", "talent", {"note": "Private note"}, 404),
        ("talent-listings/{id}/interest", "talent", {"note": "Hello"}, 400),
    ],
)
async def test_no_new_interaction_or_snapshot_of_a_blocked_owner(
    client, records, state, surface, kind, payload, expected
):
    label = f"viewer{uuid4().hex[:10]}"
    token = await _register_verified_login(client, email=f"{label}@example.com", username=label)
    headers = {"Authorization": f"Bearer {token}"}
    # An unrelated active listing remains usable through the same endpoint.
    control_path = surface.format(id=records[f"control_{kind}"])
    assert (
        await client.post(f"/api/v1/{control_path}", json=payload, headers=headers)
    ).status_code in {200, 201}
    await block_owner(records, state)
    target_path = surface.format(id=records[kind])
    response = await client.post(f"/api/v1/{target_path}", json=payload, headers=headers)
    assert response.status_code == expected, response.text


async def test_existing_saved_history_remains_private_but_no_live_hidden_details(client, records):
    label = f"saver{uuid4().hex[:10]}"
    token = await _register_verified_login(client, email=f"{label}@example.com", username=label)
    headers = {"Authorization": f"Bearer {token}"}
    for surface, kind in [("jobs", "job"), ("talent-listings", "talent")]:
        assert (
            await client.post(
                f"/api/v1/{surface}/{records[kind]}/save",
                json={"note": "Only mine"},
                headers=headers,
            )
        ).status_code == 200
    await block_owner(records, "deletion")
    result = await client.get("/api/v1/me/saved/summary", headers=headers)
    assert result.status_code == 200, result.text
    for group, key in [("jobs", "job"), ("talent", "talent")]:
        assert len(result.json()[group]) == 1
        assert result.json()[group][0][key] is None
        assert result.json()[group][0]["saved"]["note"] == "Only mine"
    assert (await client.get("/api/v1/me/saved/summary")).status_code == 401


async def test_surviving_participant_keeps_history_but_cannot_message_deleted_owner(
    client, records
):
    label = f"peer{uuid4().hex[:10]}"
    token = await _register_verified_login(client, email=f"{label}@example.com", username=label)
    headers = {"Authorization": f"Bearer {token}"}
    applied = await client.post(
        f"/api/v1/jobs/{records['job']}/applications",
        json={"cover_note": "Hello", "portfolio_item_ids": []},
        headers=headers,
    )
    assert applied.status_code == 201, applied.text
    application_id = applied.json()["id"]
    resolved = await client.get(
        f"/api/v1/me/applications/{application_id}/conversation", headers=headers
    )
    conversation_id = resolved.json()["conversation"]["id"]
    path = f"/api/v1/me/conversations/{conversation_id}"
    assert (
        await client.post(f"{path}/messages", json={"body": "Earlier message"}, headers=headers)
    ).status_code == 201
    await block_owner(records, "deletion")
    history = await client.get(path, headers=headers)
    assert history.status_code == 200
    assert "Earlier message" in {m["body"] for m in history.json()["messages"]}
    denied = await client.post(f"{path}/messages", json={"body": "After deletion"}, headers=headers)
    assert denied.status_code == 409, denied.text
