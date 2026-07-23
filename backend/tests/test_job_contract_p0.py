from __future__ import annotations

import importlib.util
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import AsyncClient
from sqlalchemy import select

from app.core.security import create_access_token
from app.models import Job, Role, User
from conftest import TestSessionLocal


def _load_migration(filename: str):
    path = Path(__file__).parents[1] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _auth(client: AsyncClient, label: str) -> tuple[dict[str, str], str]:
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": f"{label}@example.com",
            "provider_account_id": f"google-{label}",
            "access_token": f"token-{label}",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert response.status_code == 200
    body = response.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, body["user"]["id"]


async def _role(name: str = "Video Editor", category: str = "Production") -> Role:
    async with TestSessionLocal() as session:
        existing = (await session.execute(select(Role).where(Role.name == name))).scalar_one_or_none()
        if existing is not None:
            return existing
        role = Role(name=name, category=category, is_active=True)
        session.add(role)
        await session.commit()
        await session.refresh(role)
        return role


def _published_payload(role_id: str, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "title": "Retention-focused video editor",
        "primary_role_id": role_id,
        "engagement_type": "one_time_project",
        "platforms": ["youtube"],
        "work_mode": "remote",
        "about_channel": "A creator-led education channel publishing weekly explainers.",
        "responsibilities": ["Edit one polished long-form video"],
        "requirements": ["Strong pacing and narrative judgment"],
        "start_timeframe": "ASAP",
        "application_mode": "internal",
        "compensation_mode": "range",
        "budget_amount": 1000,
        "budget_max": 1500,
        "budget_currency": "USD",
        "budget_unit": "per video",
        "deliverables": [
            {"type": "long_form_video", "quantity": 1, "frequency": "per_week"}
        ],
        "turnaround_value": 5,
        "turnaround_unit": "business_days",
        "turnaround_basis": "first_draft",
        "status": "published",
    }
    payload.update(overrides)
    return payload


async def test_tools_round_trip_and_owner_reads_non_public_job(client: AsyncClient) -> None:
    headers, _user_id = await _auth(client, "p0-tools-owner")
    created_response = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Tools draft",
            "tools": ["Premiere Pro", "premiere-pro", "Custom Review Rig"],
            "status": "draft",
        },
    )
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["required_tool_keys"] == ["premiere-pro"]
    assert created["other_required_tools"] == ["Custom Review Rig"]
    assert created["tools"] == ["Adobe Premiere Pro", "Custom Review Rig"]
    assert created["listing_schema_version"] == 3

    assert (await client.get(f"/api/v1/jobs/{created['id']}")).status_code == 404
    owned = await client.get("/api/v1/me/jobs", headers=headers)
    assert owned.status_code == 200
    assert next(item for item in owned.json() if item["id"] == created["id"])["tools"] == [
        "Adobe Premiere Pro",
        "Custom Review Rig",
    ]

    updated = await client.patch(
        f"/api/v1/jobs/{created['id']}",
        headers=headers,
        json={"required_tool_keys": [], "other_required_tools": []},
    )
    assert updated.status_code == 200
    assert updated.json()["required_tool_keys"] == []
    assert updated.json()["other_required_tools"] == []
    assert updated.json()["tools"] == []


async def test_tool_compatibility_inputs_must_agree(client: AsyncClient) -> None:
    headers, _ = await _auth(client, "p0-tool-conflict")
    response = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Conflicting tools draft",
            "tools": ["Premiere Pro"],
            "required_tool_keys": ["figma"],
            "other_required_tools": [],
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "JOB_PUBLISH_VALIDATION_FAILED"
    assert "tools" in response.json()["detail"]["field_errors"]


async def test_tools_use_catalog_order_and_punctuation_insensitive_aliases(client: AsyncClient) -> None:
    headers, _ = await _auth(client, "p0-tool-order")
    response = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={
            "title": "Ordered tools draft",
            "tools": ["Figma", "Adobe-Premiere", "Custom Rig", "custom rig"],
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["required_tool_keys"] == ["premiere-pro", "figma"]
    assert response.json()["other_required_tools"] == ["Custom Rig"]


async def test_role_category_engagement_hours_and_turnaround_are_independent(client: AsyncClient) -> None:
    headers, _ = await _auth(client, "p0-canonical-owner")
    role = await _role()
    response = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=_published_payload(
            str(role.id),
            engagement_type="ongoing_freelance",
            expected_weekly_hours_min=10,
            expected_weekly_hours_max=20,
            turnaround_value=3,
            turnaround_unit="business_days",
            turnaround_basis="per_deliverable",
            contract_type="Legacy user-entered contract label",
            weekly_hours="Legacy five-day note",
            budget_unit="per short",
        ),
    )
    assert response.status_code == 201, response.text
    job = response.json()
    assert job["primary_role_name_snapshot"] == "Video Editor"
    assert job["category"] == "Editing"
    assert job["engagement_type"] == "ongoing_freelance"
    assert job["budget_unit"] == "per short"
    assert job["contract_type"] == "Legacy user-entered contract label"
    assert job["weekly_hours"] == "Legacy five-day note"
    assert float(job["expected_weekly_hours_min"]) == 10
    assert float(job["expected_weekly_hours_max"]) == 20
    assert job["turnaround_value"] == 3


async def test_role_snapshot_other_specialization_and_no_category_inference(client: AsyncClient) -> None:
    headers, user_id = await _auth(client, "p0-role-contract")
    category_only = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={"title": "Category-only draft", "category": "Editing"},
    )
    assert category_only.status_code == 201, category_only.text
    assert category_only.json()["category"] is None
    assert category_only.json()["primary_role_id"] is None

    other_role = await _role("Other Creator Role", "Other")
    missing_specialization = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=_published_payload(str(other_role.id)),
    )
    assert missing_specialization.status_code == 422
    assert "role_specialization" in missing_specialization.json()["detail"]["field_errors"]

    specialized = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=_published_payload(str(other_role.id), role_specialization="Livestream clip producer"),
    )
    assert specialized.status_code == 201, specialized.text
    assert specialized.json()["primary_role_name_snapshot"] == "Other Creator Role"
    assert specialized.json()["category"] is None
    async with TestSessionLocal() as session:
        stored_other_role = await session.get(Role, other_role.id)
        assert stored_other_role is not None
        stored_other_role.is_active = False
        await session.commit()
    historical = await client.get(f"/api/v1/jobs/{specialized.json()['id']}")
    assert historical.status_code == 200
    assert historical.json()["primary_role_name_snapshot"] == "Other Creator Role"
    async with TestSessionLocal() as session:
        stored_other_role = await session.get(Role, other_role.id)
        assert stored_other_role is not None
        stored_other_role.is_active = True
        await session.commit()

    inactive = Role(name="Inactive P0 Role", category="Other", is_active=False)
    async with TestSessionLocal() as session:
        session.add(inactive)
        await session.commit()
        await session.refresh(inactive)
        inactive_id = str(inactive.id)
    rejected = await client.post(
        "/api/v1/jobs", headers=headers, json=_published_payload(inactive_id)
    )
    assert rejected.status_code == 422
    assert "primary_role_id" in rejected.json()["detail"]["field_errors"]

    legacy_id = uuid4()
    async with TestSessionLocal() as session:
        session.add(
            Job(
                id=legacy_id,
                title="Legacy category must survive",
                category="Writing",
                listing_schema_version=1,
                posted_by_user_id=UUID(user_id),
                status="paused",
            )
        )
        await session.commit()
    role = await _role()
    upgraded_draft = await client.patch(
        f"/api/v1/jobs/{legacy_id}", headers=headers, json={"primary_role_id": str(role.id)}
    )
    assert upgraded_draft.status_code == 200, upgraded_draft.text
    assert upgraded_draft.json()["category"] == "Writing"
    assert upgraded_draft.json()["primary_role_name_snapshot"] == "Video Editor"


async def test_compensation_modes_and_special_units_validate_independently(client: AsyncClient) -> None:
    headers, _ = await _auth(client, "p0-compensation-rules")
    role = await _role()
    role_id = str(role.id)

    invalid_cases = [
        {"compensation_mode": "fixed", "budget_amount": 100, "budget_max": 200},
        {"compensation_mode": "range", "budget_amount": 100, "budget_max": None},
        {"compensation_mode": "negotiable", "budget_amount": 100, "budget_max": None},
        {
            "compensation_mode": "negotiable",
            "budget_amount": None,
            "budget_max": None,
            "budget_currency": None,
            "budget_unit": "commission",
            "budget_note": None,
        },
        {
            "compensation_mode": "negotiable",
            "budget_amount": None,
            "budget_max": None,
            "budget_currency": None,
            "budget_unit": "mixed",
            "budget_note": None,
        },
        {
            "compensation_mode": "negotiable",
            "budget_amount": None,
            "budget_max": None,
            "budget_unit": "custom",
            "budget_unit_custom": None,
        },
    ]
    for index, overrides in enumerate(invalid_cases):
        response = await client.post(
            "/api/v1/jobs",
            headers=headers,
            json=_published_payload(role_id, title=f"Invalid compensation case {index}", **overrides),
        )
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "JOB_PUBLISH_VALIDATION_FAILED"

    commission = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=_published_payload(
            role_id,
            title="Negotiable commission role",
            compensation_mode="negotiable",
            budget_amount=None,
            budget_max=None,
            budget_currency=None,
            budget_unit="commission",
            budget_note="Ten percent of attributable sales",
        ),
    )
    assert commission.status_code == 201, commission.text

    mixed = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=_published_payload(
            role_id,
            title="Negotiable mixed compensation role",
            compensation_mode="negotiable",
            budget_amount=None,
            budget_max=None,
            budget_currency=None,
            budget_unit="mixed",
            budget_note="Revenue share plus non-cash creator benefits",
        ),
    )
    assert mixed.status_code == 201, mixed.text

    custom = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json=_published_payload(
            role_id,
            title="Custom negotiable compensation role",
            compensation_mode="negotiable",
            budget_amount=None,
            budget_max=None,
            budget_unit="custom",
            budget_unit_custom="per approved content pack",
        ),
    )
    assert custom.status_code == 201, custom.text


@pytest.mark.parametrize(
    "unit",
    [
        "per hour",
        "per day",
        "per deliverable",
        "per video",
        "per short",
        "per thumbnail",
        "per script",
        "per episode",
        "per post",
        "per project",
        "per week",
        "per month",
        "per year",
        "commission",
        "mixed",
        "custom",
    ],
)
async def test_all_p0_compensation_units_deserialize_on_drafts(
    client: AsyncClient, unit: str
) -> None:
    headers, _ = await _auth(client, f"p0-unit-{unit.replace(' ', '-')}")
    response = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={"title": f"Draft paid {unit}", "budget_unit": unit, "status": "draft"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["budget_unit"] == unit


async def test_direct_publication_attempt_gets_structured_validation_errors(client: AsyncClient) -> None:
    headers, _ = await _auth(client, "p0-publish-gate")
    direct = await client.post(
        "/api/v1/jobs",
        headers=headers,
        json={"title": "Incomplete public job", "category": "Editing", "status": "published"},
    )
    assert direct.status_code == 422
    detail = direct.json()["detail"]
    assert detail["code"] == "JOB_PUBLISH_VALIDATION_FAILED"
    assert {"primary_role_id", "engagement_type", "platforms", "compensation_mode"}.issubset(
        detail["field_errors"]
    )

    draft = await client.post(
        "/api/v1/jobs", headers=headers, json={"title": "Incomplete draft", "status": "draft"}
    )
    assert draft.status_code == 201
    publish = await client.patch(
        f"/api/v1/jobs/{draft.json()['id']}", headers=headers, json={"status": "published"}
    )
    assert publish.status_code == 422
    assert publish.json()["detail"]["code"] == "JOB_PUBLISH_VALIDATION_FAILED"


async def test_public_visibility_and_owner_access(client: AsyncClient) -> None:
    headers, _ = await _auth(client, "p0-visibility-owner")
    role = await _role()
    created = await client.post(
        "/api/v1/jobs", headers=headers, json=_published_payload(str(role.id))
    )
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 200

    paused = await client.patch(
        f"/api/v1/jobs/{job_id}", headers=headers, json={"status": "paused"}
    )
    assert paused.status_code == 200
    assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 404
    public_list = await client.get("/api/v1/jobs")
    assert all(item["id"] != job_id for item in public_list.json()["items"])
    assert (await client.get("/api/v1/jobs", params={"status": "draft"})).status_code == 422
    owner_list = await client.get("/api/v1/me/jobs", headers=headers)
    assert any(item["id"] == job_id and item["status"] == "paused" for item in owner_list.json())


async def test_every_non_public_state_deleted_and_suspended_owner_are_hidden(client: AsyncClient) -> None:
    headers, user_id = await _auth(client, "p0-all-visibility")
    _suspended_headers, suspended_user_id = await _auth(client, "p0-suspended-owner")
    hidden_ids: list[UUID] = []
    admin_id = uuid4()
    async with TestSessionLocal() as session:
        suspended_owner = await session.get(User, UUID(suspended_user_id))
        assert suspended_owner is not None
        suspended_owner.suspended_at = datetime.now(UTC)
        admin = User(
            id=admin_id,
            email="p0-contract-admin@example.com",
            username="p0_contract_admin",
            account_type="ADMIN",
            email_verified_at=datetime.now(UTC),
        )
        session.add(admin)
        for job_status in ("draft", "paused", "closed", "archived"):
            job = Job(
                title=f"P0 hidden {job_status} listing",
                category="Editing",
                listing_schema_version=1,
                posted_by_user_id=UUID(user_id),
                status=job_status,
            )
            session.add(job)
            await session.flush()
            hidden_ids.append(job.id)
        deleted = Job(
            title="P0 hidden deleted listing",
            category="Editing",
            listing_schema_version=1,
            posted_by_user_id=UUID(user_id),
            status="published",
            deleted_at=datetime.now(UTC),
        )
        suspended = Job(
            title="P0 hidden suspended-owner listing",
            category="Editing",
            listing_schema_version=1,
            posted_by_user_id=UUID(suspended_user_id),
            status="published",
        )
        session.add_all([deleted, suspended])
        await session.flush()
        hidden_ids.extend([deleted.id, suspended.id])
        await session.commit()

    listed = await client.get("/api/v1/jobs", params={"q": "P0 hidden"})
    assert listed.status_code == 200
    assert {item["id"] for item in listed.json()["items"]}.isdisjoint(
        {str(job_id) for job_id in hidden_ids}
    )
    for job_id in hidden_ids:
        assert (await client.get(f"/api/v1/jobs/{job_id}")).status_code == 404

    owner_jobs = await client.get("/api/v1/me/jobs", headers=headers)
    assert owner_jobs.status_code == 200
    owner_ids = {item["id"] for item in owner_jobs.json()}
    assert {str(job_id) for job_id in hidden_ids[:4]} <= owner_ids

    admin_headers = {"Authorization": f"Bearer {create_access_token(str(admin_id))}"}
    admin_jobs = await client.get(
        "/api/v1/admin/jobs",
        params={"q": "P0 hidden", "include_deleted": "true"},
        headers=admin_headers,
    )
    assert admin_jobs.status_code == 200, admin_jobs.text
    assert {item["id"] for item in admin_jobs.json()["items"]} >= {
        str(job_id) for job_id in hidden_ids
    }


async def test_legacy_record_is_honest_and_grandfathered_until_republish(client: AsyncClient) -> None:
    headers, user_id = await _auth(client, "p0-legacy-owner")
    legacy_id = uuid4()
    async with TestSessionLocal() as session:
        session.add(
            Job(
                id=legacy_id,
                title="Grandfathered legacy listing",
                category="Writing",
                listing_schema_version=1,
                platforms=["youtube"],
                weekly_hours="5 days",
                contract_type="Project-based",
                budget_amount=Decimal("12.50"),
                budget_currency=None,
                budget_unit="per legacy pack",
                posted_by_user_id=UUID(user_id),
                status="published",
            )
        )
        await session.commit()

    public = await client.get(f"/api/v1/jobs/{legacy_id}")
    assert public.status_code == 200
    body = public.json()
    assert body["category"] == "Writing"
    assert body["primary_role_id"] is None
    assert body["engagement_type"] is None
    assert body["weekly_hours"] == "5 days"
    assert body["turnaround_value"] is None
    assert body["tools"] is None
    assert Decimal(body["budget_amount"]) == Decimal("12.50")
    assert body["budget_currency"] is None
    assert body["budget_unit"] == "per legacy pack"

    ordinary_edit = await client.patch(
        f"/api/v1/jobs/{legacy_id}", headers=headers, json={"title": "Edited legacy listing"}
    )
    assert ordinary_edit.status_code == 200
    assert ordinary_edit.json()["listing_schema_version"] == 1
    assert (await client.patch(f"/api/v1/jobs/{legacy_id}", headers=headers, json={"status": "paused"})).status_code == 200
    republish = await client.patch(
        f"/api/v1/jobs/{legacy_id}", headers=headers, json={"status": "published"}
    )
    assert republish.status_code == 422
    assert republish.json()["detail"]["code"] == "JOB_PUBLISH_VALIDATION_FAILED"

    role = await _role()
    valid_republish = await client.patch(
        f"/api/v1/jobs/{legacy_id}",
        headers=headers,
        json={
            "primary_role_id": str(role.id),
            "engagement_type": "one_time_project",
            "work_mode": "remote",
            "about_channel": "A legacy creator channel now confirming its publication details.",
            "responsibilities": ["Edit the next creator video"],
            "requirements": ["Demonstrated creator-economy editing experience"],
            "start_timeframe": "ASAP",
            "compensation_mode": "fixed",
            "budget_amount": 900,
            "budget_max": None,
            "budget_currency": "USD",
            "budget_unit": "per video",
            "deliverables": [
                {"type": "long_form_video", "quantity": 1, "frequency": "per_week"}
            ],
            "turnaround_value": 5,
            "turnaround_unit": "business_days",
            "turnaround_basis": "first_draft",
            "status": "published",
        },
    )
    assert valid_republish.status_code == 200, valid_republish.text
    assert valid_republish.json()["listing_schema_version"] == 3
    assert valid_republish.json()["category"] == "Writing"
    assert valid_republish.json()["weekly_hours"] == "5 days"


def test_migrations_preserve_representative_legacy_values(tmp_path: Path) -> None:
    database_path = tmp_path / "legacy-p0.db"
    engine = sa.create_engine(f"sqlite:///{database_path}")
    metadata = sa.MetaData()
    roles = sa.Table(
        "roles",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("slug", sa.String(160), nullable=False, unique=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("popularity_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("category", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )
    jobs = sa.Table(
        "jobs",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("category", sa.String(64), nullable=False, server_default="Editing"),
        sa.Column("budget_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("budget_max", sa.Numeric(12, 2), nullable=True),
        sa.Column("budget_note", sa.String(64), nullable=True),
        sa.Column("budget_currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("budget_unit", sa.String(32), nullable=False, server_default="per project"),
        sa.Column("contract_type", sa.String(64), nullable=True),
        sa.Column("weekly_hours", sa.String(64), nullable=True),
    )
    metadata.create_all(engine)
    legacy_id = uuid4()
    expected = {
        "category": "Writing",
        "contract_type": "Creator-defined arrangement",
        "weekly_hours": "Three edits every seven days",
        "budget_currency": "EUR",
        "budget_unit": "per legacy bundle",
        "budget_note": "Original creator-authored note",
    }
    with engine.begin() as connection:
        connection.execute(
            jobs.insert().values(
                id=legacy_id,
                title="Representative legacy listing",
                budget_amount=1250,
                budget_max=None,
                **expected,
            )
        )
        migration_context = MigrationContext.configure(connection)
        migration_0040 = _load_migration("0040_job_contract_p0_fields.py")
        migration_0041 = _load_migration("0041_job_contract_p0_backfill.py")
        with Operations.context(migration_context):
            migration_0040.upgrade()
            migration_0041.upgrade()

        migrated = connection.execute(
            sa.text(
                "SELECT category, contract_type, weekly_hours, budget_currency, budget_unit, "
                "budget_note, listing_schema_version, compensation_mode, primary_role_id, "
                "engagement_type, required_tool_keys, expected_weekly_hours_min, turnaround_value "
                "FROM jobs WHERE id = :job_id"
            ),
            {"job_id": legacy_id.hex},
        ).mappings().one()
        seeded_role_names = {
            row[0] for row in connection.execute(sa.select(roles.c.name)).all()
        }
        with Operations.context(migration_context):
            migration_0041.downgrade()
            migration_0040.downgrade()
        downgraded = connection.execute(
            sa.text(
                "SELECT category, contract_type, weekly_hours, budget_currency, budget_unit, budget_note "
                "FROM jobs WHERE id = :job_id"
            ),
            {"job_id": legacy_id.hex},
        ).mappings().one()

    for field, value in expected.items():
        assert migrated[field] == value
    assert migrated["listing_schema_version"] == 1
    assert migrated["compensation_mode"] == "fixed"
    assert migrated["primary_role_id"] is None
    assert migrated["engagement_type"] is None
    assert migrated["required_tool_keys"] is None
    assert migrated["expected_weekly_hours_min"] is None
    assert migrated["turnaround_value"] is None
    for field, value in expected.items():
        assert downgraded[field] == value
    assert {"Researcher", "Voice Over Artist", "Other Creator Role"} <= seeded_role_names
