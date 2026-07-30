from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from conftest import TestSessionLocal
from httpx import AsyncClient

from app.models import Job, JobImportDraft, JobImportSource, TalentListing, User
from app.services.search_service import parse_search_intent


def test_search_intent_understands_creator_queries_without_a_provider() -> None:
    editor = parse_search_intent(
        "YouTube edtor who uses Premiere and After Effects",
        domain="talent",
    )
    assert editor.roles == ["video-editor"]
    assert editor.platforms == ["youtube"]
    assert {"premiere-pro", "after-effects"} <= set(editor.tools)
    assert any("edtor" in correction for correction in editor.corrections)

    budget = parse_search_intent(
        "remote thumbnail designer under ₹40,000 per month",
        domain="jobs",
    )
    assert budget.roles == ["thumbnail-designer"]
    assert budget.work_modes == ["remote"]
    assert budget.compensation is not None
    assert budget.compensation.amount == 40000
    assert budget.compensation.currency == "INR"
    assert budget.compensation.unit == "per month"
    assert "compensation" in budget.hard_constraints

    creator = parse_search_intent(
        "UGC creator for beauty reels available now",
        domain="talent",
    )
    assert creator.roles == ["ugc-creator"]
    assert creator.niches == ["beauty"]
    assert creator.formats == ["shorts-reels"]
    assert creator.availability == ["available"]

    documentary = parse_search_intent(
        "documentary long-form editor",
        domain="jobs",
    )
    assert documentary.genres == ["documentaries"]
    assert documentary.formats == ["long-form-video"]


def test_search_intent_is_order_independent_and_bounded() -> None:
    first = parse_search_intent(
        "finance short-form video editor remote",
        domain="jobs",
    )
    second = parse_search_intent(
        "remote editor short-form finance",
        domain="jobs",
    )
    assert first.roles == second.roles
    assert first.formats == second.formats
    assert first.niches == second.niches
    assert first.work_modes == second.work_modes
    assert len(parse_search_intent("x" * 500, domain="jobs").query) == 300


async def _seed_search_records() -> dict[str, str]:
    suffix = uuid4().hex[:8]
    owner = User(
        email=f"deep-search-{suffix}@example.com",
        username=f"search_{suffix}",
        display_name="Deep Search Creator",
    )
    suspended = User(
        email=f"deep-search-suspended-{suffix}@example.com",
        username=f"susp_{suffix}",
        suspended_at=datetime.now(UTC),
    )
    async with TestSessionLocal() as session:
        session.add_all([owner, suspended])
        await session.flush()
        exact_job = Job(
            title=f"Finance YouTube editor {suffix}",
            listing_schema_version=3,
            primary_role_name_snapshot="Video Editor",
            role_specialization="Talking-head educational videos",
            platforms=["YouTube"],
            content_niches=["Finance"],
            content_genres=["Explainers"],
            formats_hired_for=["Long-form video"],
            required_tool_keys=["premiere-pro", "after-effects"],
            required_skill_keys=["storytelling"],
            work_mode="remote",
            engagement_type="part_time",
            expected_weekly_hours_min=20,
            expected_weekly_hours_max=25,
            compensation_mode="fixed",
            budget_amount=35000,
            budget_currency="INR",
            budget_unit="per month",
            about_channel="A public finance education channel.",
            requirements=["Strong pacing"],
            responsibilities=["Edit weekly videos"],
            posted_by_user_id=owner.id,
            status="published",
        )
        partial_job = Job(
            title=f"General creator editor {suffix}",
            listing_schema_version=1,
            category="Editing",
            platforms=["Instagram"],
            content_niches=["Lifestyle"],
            formats_hired_for=["Shorts/Reels"],
            work_mode="hybrid",
            posted_by_user_id=owner.id,
            status="published",
        )
        hidden_draft = Job(
            title=f"Secret Premiere finance draft {suffix}",
            listing_schema_version=3,
            primary_role_name_snapshot="Video Editor",
            required_tool_keys=["premiere-pro"],
            posted_by_user_id=owner.id,
            status="draft",
            screening_questions=[{"prompt": "Private screening phrase", "required": True}],
        )
        hidden_suspended = Job(
            title=f"Suspended Premiere editor {suffix}",
            listing_schema_version=3,
            primary_role_name_snapshot="Video Editor",
            required_tool_keys=["premiere-pro"],
            posted_by_user_id=suspended.id,
            status="published",
        )
        exact_talent = TalentListing(
            owner_user_id=owner.id,
            title=f"Tamil creator strategist {suffix}",
            primary_role="Content Strategist",
            roles=["Content Strategist"],
            content_niches=["Finance"],
            formats=["Shorts/Reels"],
            platforms=["YouTube", "Instagram"],
            tools=["Premiere Pro"],
            languages=["Tamil", "English"],
            work_mode="remote",
            location="Chennai",
            availability_status="available",
            experience_years=5,
            rate_min=30000,
            rate_max=45000,
            rate_currency="INR",
            description="Public creator strategy and educational content work.",
            status="published",
        )
        hidden_talent = TalentListing(
            owner_user_id=owner.id,
            title=f"Private Tamil strategist {suffix}",
            primary_role="Content Strategist",
            roles=["Content Strategist"],
            languages=["Tamil"],
            status="draft",
        )
        suspended_talent = TalentListing(
            owner_user_id=suspended.id,
            title=f"Suspended Tamil strategist {suffix}",
            primary_role="Content Strategist",
            roles=["Content Strategist"],
            languages=["Tamil"],
            status="published",
        )
        source = JobImportSource(
            owner_user_id=owner.id,
            source_type="pasted_text",
            original_text=f"PRIVATE-IMPORT-{suffix} premiere finance",
            content_fingerprint=f"private-import-{suffix}",
        )
        session.add_all(
            [
                exact_job,
                partial_job,
                hidden_draft,
                hidden_suspended,
                exact_talent,
                hidden_talent,
                suspended_talent,
                source,
            ]
        )
        await session.flush()
        draft = JobImportDraft(
            source_id=source.id,
            owner_user_id=owner.id,
            target_listing_schema_version=3,
            processing_status="awaiting_recruiter_review",
            machine_output={"title": f"PRIVATE-DRAFT-{suffix}"},
        )
        session.add(draft)
        await session.commit()
        return {
            "suffix": suffix,
            "exact_job": str(exact_job.id),
            "partial_job": str(partial_job.id),
            "hidden_job": str(hidden_draft.id),
            "suspended_job": str(hidden_suspended.id),
            "exact_talent": str(exact_talent.id),
            "hidden_talent": str(hidden_talent.id),
            "suspended_talent": str(suspended_talent.id),
        }


async def test_job_deep_search_ranks_structured_matches_and_explains_them(
    client: AsyncClient,
) -> None:
    records = await _seed_search_records()
    response = await client.get(
        "/api/v1/search/jobs",
        params={
            "q": "YouTube edtor Premiere After Effects finance remote under ₹40,000 per month",
            "limit": 100,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["domain"] == "jobs"
    assert body["intent"]["roles"] == ["video-editor"]
    assert set(body["intent"]["tools"]) == {"premiere-pro", "after-effects"}
    assert body["items"][0]["item"]["id"] == records["exact_job"]
    assert "Matches Video Editor role" in body["items"][0]["reasons"]
    assert any("Premiere" in reason for reason in body["items"][0]["reasons"])
    assert body["items"][0]["item"]["screening_questions"] is None
    assert body["items"][0]["item"]["languages"] == []
    returned = {match["item"]["id"] for match in body["items"]}
    assert records["hidden_job"] not in returned
    assert records["suspended_job"] not in returned


async def test_talent_deep_search_uses_public_listing_data_and_preserves_privacy(
    client: AsyncClient,
) -> None:
    records = await _seed_search_records()
    response = await client.get(
        "/api/v1/search/talent",
        params={"q": f"Tamil creator strategist Chennai {records['suffix']}", "limit": 100},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["items"][0]["item"]["id"] == records["exact_talent"]
    assert body["items"][0]["item"]["owner_display_name"] == "Deep Search Creator"
    returned = {match["item"]["id"] for match in body["items"]}
    assert records["hidden_talent"] not in returned
    assert records["suspended_talent"] not in returned
    rendered = response.text
    assert "PRIVATE-IMPORT" not in rendered
    assert "PRIVATE-DRAFT" not in rendered
    assert "Private screening phrase" not in rendered


async def test_search_supports_hard_structured_filters_and_partial_fallback(
    client: AsyncClient,
) -> None:
    records = await _seed_search_records()
    filtered = await client.get(
        "/api/v1/search/jobs",
        params=[
            ("q", f"editor {records['suffix']}"),
            ("work_mode", "remote"),
            ("platform", "youtube"),
        ],
    )
    assert filtered.status_code == 200, filtered.text
    filtered_body = filtered.json()
    assert records["exact_job"] in {
        item["item"]["id"] for item in filtered_body["items"]
    }
    assert all(item["item"]["work_mode"] == "remote" for item in filtered_body["items"])
    assert all(
        "youtube" in {platform.casefold() for platform in item["item"]["platforms"]}
        for item in filtered_body["items"]
    )
    assert {"work mode", "platform"} <= set(filtered_body["intent"]["hard_constraints"])

    partial = await client.get(
        "/api/v1/search/jobs",
        params={"q": f"must be onsite editor {records['suffix']}"},
    )
    assert partial.status_code == 200
    assert partial.json()["no_exact_match"] is True
    assert partial.json()["items"]


async def test_public_talent_list_rejects_private_status_selection(
    client: AsyncClient,
) -> None:
    response = await client.get("/api/v1/talent-listings", params={"status": "draft"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PUBLIC_TALENT_STATUS_INVALID"


async def test_search_query_contract_validates_input(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/search/jobs", params={"q": ""})).status_code == 422
    assert (
        await client.get("/api/v1/search/talent", params={"q": "x" * 301})
    ).status_code == 422
