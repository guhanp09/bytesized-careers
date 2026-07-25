from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient

from app.models import Job, Role, User
from conftest import TestSessionLocal


async def test_list_filters_and_pagination(client: AsyncClient) -> None:
    seed_jobs = [
        Job(
            title="Instagram Shorts Editor",
            category="Shorts",
            location="Remote",
            platforms=["instagram"],
            start_timeframe="ASAP",
            listing_schema_version=1,
            status="published",
        ),
        Job(
            title="Instagram Reels Editor",
            category="Editing",
            location="Bangalore",
            platforms=["instagram"],
            start_timeframe="<1mo",
            listing_schema_version=1,
            status="published",
        ),
        Job(
            title="Instagram Thumbnail Designer",
            category="Thumbnails",
            location="Remote",
            platforms=["instagram"],
            start_timeframe="ASAP",
            listing_schema_version=1,
            status="draft",
        ),
    ]
    async with TestSessionLocal() as session:
        session.add_all(seed_jobs)
        await session.commit()

    filtered = await client.get(
        "/api/v1/jobs",
        params={
            "platform": "instagram",
            "location": "remote",
            "status": "published",
            "limit": 10,
            "offset": 0,
        },
    )
    assert filtered.status_code == 200
    filtered_data = filtered.json()
    assert filtered_data["total"] >= 1
    for item in filtered_data["items"]:
        assert "instagram" in {platform.casefold() for platform in item["platforms"]}
        assert item["status"] == "published"

    paged = await client.get("/api/v1/jobs", params={"limit": 1, "offset": 0})
    assert paged.status_code == 200
    paged_data = paged.json()
    assert paged_data["limit"] == 1
    assert len(paged_data["items"]) == 1


async def test_public_list_rejects_non_public_status_filter(client: AsyncClient) -> None:
    response = await client.get("/api/v1/jobs", params={"status": "draft"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PUBLIC_JOB_STATUS_INVALID"


async def test_canonical_public_filters_compose_and_support_multiple_values(
    client: AsyncClient,
) -> None:
    prefix = "CJDISC-CANON"
    async with TestSessionLocal() as session:
        editor = Role(name="Discovery Filter Editor", category="Production", is_active=True)
        writer = Role(name="Discovery Filter Writer", category="Writing", is_active=True)
        suspended_owner = User(
            email="discovery-filter-suspended@example.com",
            username="disc_suspended",
            suspended_at=datetime.now(UTC),
        )
        session.add_all([editor, writer, suspended_owner])
        await session.flush()

        long_form = Job(
            title=f"{prefix} long-form editor",
            listing_schema_version=3,
            primary_role_id=editor.id,
            primary_role_name_snapshot=editor.name,
            platforms=["YouTube", "Instagram"],
            formats_hired_for=["Long-form video"],
            work_mode="remote",
            engagement_type="ongoing_freelance",
            budget_unit="per video",
            other_required_tools=["FrameForge Review"],
            language_requirements=[
                {
                    "language": "English",
                    "priority": "required",
                    "purposes": ["content_understanding"],
                }
            ],
            status="published",
        )
        shorts = Job(
            title=f"{prefix} shorts editor",
            listing_schema_version=3,
            primary_role_id=editor.id,
            primary_role_name_snapshot=editor.name,
            platforms=["TikTok"],
            formats_hired_for=["Shorts/Reels"],
            work_mode="hybrid",
            engagement_type="part_time",
            budget_unit="per short",
            language_requirements=[],
            status="published",
        )
        scripts = Job(
            title=f"{prefix} scriptwriter",
            listing_schema_version=3,
            primary_role_id=writer.id,
            primary_role_name_snapshot=writer.name,
            platforms=["TikTok"],
            formats_hired_for=["Scripts"],
            work_mode="onsite",
            engagement_type="fixed_term",
            budget_unit="per month",
            language_requirements=[
                {
                    "language": "Hindi",
                    "priority": "required",
                    "purposes": ["writing"],
                }
            ],
            status="published",
        )
        hidden_draft = Job(
            title=f"{prefix} hidden draft",
            listing_schema_version=3,
            primary_role_id=editor.id,
            platforms=["YouTube"],
            formats_hired_for=["Long-form video"],
            work_mode="remote",
            engagement_type="ongoing_freelance",
            budget_unit="per video",
            status="draft",
        )
        hidden_deleted = Job(
            title=f"{prefix} hidden deleted",
            listing_schema_version=3,
            primary_role_id=editor.id,
            platforms=["YouTube"],
            formats_hired_for=["Long-form video"],
            work_mode="remote",
            engagement_type="ongoing_freelance",
            budget_unit="per video",
            status="published",
            deleted_at=datetime.now(UTC),
        )
        hidden_suspended = Job(
            title=f"{prefix} hidden suspended owner",
            listing_schema_version=3,
            primary_role_id=editor.id,
            platforms=["YouTube"],
            formats_hired_for=["Long-form video"],
            work_mode="remote",
            engagement_type="ongoing_freelance",
            budget_unit="per video",
            posted_by_user_id=suspended_owner.id,
            status="published",
        )
        session.add_all(
            [
                long_form,
                shorts,
                scripts,
                hidden_draft,
                hidden_deleted,
                hidden_suspended,
            ]
        )
        await session.flush()
        expected = {
            "long_form": str(long_form.id),
            "shorts": str(shorts.id),
            "scripts": str(scripts.id),
        }
        editor_slug = editor.slug
        writer_slug = writer.slug
        await session.commit()

    async def filtered_ids(**params: str) -> tuple[set[str], int]:
        response = await client.get(
            "/api/v1/jobs",
            params={"q": prefix, "limit": "100", **params},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        return {item["id"] for item in body["items"]}, body["total"]

    ids, total = await filtered_ids(role=editor_slug)
    assert ids == {expected["long_form"], expected["shorts"]}
    assert total == 2

    role_search = await client.get(
        "/api/v1/jobs",
        params={"q": editor.name, "limit": 100},
    )
    assert role_search.status_code == 200, role_search.text
    assert {item["id"] for item in role_search.json()["items"]} == {
        expected["long_form"],
        expected["shorts"],
    }

    tool_search = await client.get(
        "/api/v1/jobs",
        params={"q": "FrameForge", "limit": 100},
    )
    assert tool_search.status_code == 200, tool_search.text
    assert {item["id"] for item in tool_search.json()["items"]} == {
        expected["long_form"]
    }

    ids, _ = await filtered_ids(role=f"{editor_slug},{writer_slug}")
    assert ids == set(expected.values())

    repeated_platforms = await client.get(
        "/api/v1/jobs",
        params=[
            ("q", prefix),
            ("platform", "YOUTUBE"),
            ("platform", "tiktok"),
            ("limit", "100"),
        ],
    )
    assert repeated_platforms.status_code == 200, repeated_platforms.text
    assert {item["id"] for item in repeated_platforms.json()["items"]} == set(
        expected.values()
    )

    ids, _ = await filtered_ids(format="long-form video,shorts/reels")
    assert ids == {expected["long_form"], expected["shorts"]}
    ids, _ = await filtered_ids(format="long-form")
    assert ids == set(), "JSON list filters must match complete values, not substrings"

    ids, _ = await filtered_ids(work_mode="REMOTE,hybrid")
    assert ids == {expected["long_form"], expected["shorts"]}
    ids, _ = await filtered_ids(engagement_type="ongoing_freelance,part_time")
    assert ids == {expected["long_form"], expected["shorts"]}
    ids, _ = await filtered_ids(budget_unit="per video,per short")
    assert ids == {expected["long_form"], expected["shorts"]}

    ids, total = await filtered_ids(
        role=editor_slug,
        platform="youtube",
        format="long-form video",
        work_mode="remote",
        engagement_type="ongoing_freelance",
        budget_unit="per video",
        language="english",
    )
    assert ids == {expected["long_form"]}
    assert total == 1


async def test_role_filter_never_infers_a_canonical_role_from_legacy_category(
    client: AsyncClient,
) -> None:
    prefix = "CJDISC-ROLE-COMPAT"
    async with TestSessionLocal() as session:
        role = Role(name="Discovery Canonical Video Editor", category="Production", is_active=True)
        session.add(role)
        await session.flush()
        legacy = Job(
            title=f"{prefix} legacy video editor",
            category="Editing",
            listing_schema_version=1,
            platforms=["youtube"],
            status="published",
        )
        canonical = Job(
            title=f"{prefix} canonical video editor",
            category="Editing",
            listing_schema_version=3,
            primary_role_id=role.id,
            primary_role_name_snapshot=role.name,
            platforms=["youtube"],
            status="published",
        )
        session.add_all([legacy, canonical])
        await session.flush()
        legacy_id = str(legacy.id)
        canonical_id = str(canonical.id)
        role_slug = role.slug
        await session.commit()

    response = await client.get(
        "/api/v1/jobs",
        params={"q": prefix, "role": role_slug, "limit": 100},
    )
    assert response.status_code == 200, response.text
    ids = {item["id"] for item in response.json()["items"]}
    assert canonical_id in ids
    assert legacy_id not in ids


async def test_required_language_filter_preserves_null_versus_empty_legacy_semantics(
    client: AsyncClient,
) -> None:
    prefix = "CJDISC-LANGUAGE"
    async with TestSessionLocal() as session:
        canonical_required = Job(
            title=f"{prefix} canonical required English",
            listing_schema_version=3,
            language_requirements=[
                {
                    "language": "English",
                    "priority": "required",
                    "purposes": ["writing"],
                }
            ],
            languages=["Tamil"],
            status="published",
        )
        canonical_preferred = Job(
            title=f"{prefix} preferred English required Hindi",
            listing_schema_version=3,
            language_requirements=[
                {
                    "language": "English",
                    "priority": "preferred",
                    "purposes": ["speaking"],
                },
                {
                    "language": "Hindi",
                    "priority": "required",
                    "purposes": ["writing"],
                },
            ],
            languages=["English"],
            status="published",
        )
        explicitly_none = Job(
            title=f"{prefix} canonical empty legacy English",
            listing_schema_version=3,
            language_requirements=[],
            languages=["English"],
            status="published",
        )
        legacy_english = Job(
            title=f"{prefix} legacy English",
            listing_schema_version=1,
            language_requirements=None,
            languages=["English"],
            status="published",
        )
        legacy_tamil = Job(
            title=f"{prefix} legacy Tamil",
            listing_schema_version=1,
            language_requirements=None,
            languages=["Tamil"],
            status="published",
        )
        session.add_all(
            [
                canonical_required,
                canonical_preferred,
                explicitly_none,
                legacy_english,
                legacy_tamil,
            ]
        )
        await session.flush()
        expected = {
            "required": str(canonical_required.id),
            "preferred": str(canonical_preferred.id),
            "empty": str(explicitly_none.id),
            "legacy_english": str(legacy_english.id),
            "legacy_tamil": str(legacy_tamil.id),
        }
        await session.commit()

    async def language_ids(value: str) -> set[str]:
        response = await client.get(
            "/api/v1/jobs",
            params={"q": prefix, "language": value, "limit": 100},
        )
        assert response.status_code == 200, response.text
        return {item["id"] for item in response.json()["items"]}

    # Language is no longer a public discovery dimension: the obsolete ?language=
    # parameter is accepted (no error) but never filters, so every job is returned
    # regardless of its stored language configuration.
    all_ids = set(expected.values())
    assert await language_ids("ENGLISH") == all_ids
    assert await language_ids("hindi") == all_ids
    assert await language_ids("english,hindi") == all_ids
    # Historical language data remains stored but is absent from the public
    # representation and cannot be inferred through free-text search.
    detail = await client.get(f"/api/v1/jobs/{expected['required']}")
    assert detail.status_code == 200
    assert detail.json()["languages"] == []
    assert detail.json()["language_requirements"] is None
    hidden_by_search = await client.get(
        "/api/v1/jobs",
        params={"q": "Tamil", "limit": 100},
    )
    assert hidden_by_search.status_code == 200
    assert expected["required"] not in {
        item["id"] for item in hidden_by_search.json()["items"]
    }
