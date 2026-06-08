from __future__ import annotations

from datetime import UTC, datetime

from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import select

from app.models import EmailVerificationToken, User
from app.services.youtube_service import YouTubeVideoMetadataResult, extract_video_id


async def _latest_token_for_email(email: str) -> str:
    async with TestSessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        row = (
            await session.execute(
                select(EmailVerificationToken)
                .where(EmailVerificationToken.user_id == user.id)
                .order_by(EmailVerificationToken.created_at.desc())
                .limit(1)
            )
        ).scalar_one()
        return row.token


async def _register_verify_login(client: AsyncClient, *, email: str, username: str) -> str:
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "supersecure123", "username": username},
    )
    assert register.status_code == 200

    token = await _latest_token_for_email(email)
    verify = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verify.status_code == 200

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "supersecure123"},
    )
    assert login.status_code == 200
    return login.json()["access_token"]


def test_extract_video_id_common_youtube_formats() -> None:
    assert extract_video_id("https://www.youtube.com/watch?v=NNnIGH9g6fA&list=abc") == "NNnIGH9g6fA"
    assert extract_video_id("https://youtu.be/NNnIGH9g6fA?t=198") == "NNnIGH9g6fA"
    assert extract_video_id("https://www.youtube.com/shorts/NNnIGH9g6fA?feature=share") == "NNnIGH9g6fA"
    assert extract_video_id("https://www.youtube.com/embed/NNnIGH9g6fA?start=11") == "NNnIGH9g6fA"
    assert extract_video_id("NNnIGH9g6fA") == "NNnIGH9g6fA"
    assert extract_video_id("https://example.com/watch?v=NNnIGH9g6fA") is None


async def test_youtube_preview_endpoint_with_mocked_metadata(
    client: AsyncClient, monkeypatch
) -> None:
    bearer = await _register_verify_login(
        client,
        email="portfolio-preview@example.com",
        username="portfolio_preview",
    )

    async def fake_fetch_youtube_video_metadata(_video_id: str) -> YouTubeVideoMetadataResult:
        return YouTubeVideoMetadataResult(
            video_id="NNnIGH9g6fA",
            title="Creator proof video",
            description="Useful public description",
            thumbnail_url="https://example.com/thumb.jpg",
            channel_name="Creator Channel",
            channel_id="UC123",
            view_count=12345,
            like_count=678,
            comment_count=90,
            published_date=datetime(2026, 1, 1, tzinfo=UTC),
            duration="3:21",
            duration_iso="PT3M21S",
            duration_label="3:21",
            thumbnail_options=[
                {"quality": "high", "url": "https://example.com/thumb.jpg", "width": 480, "height": 360}
            ],
            video_url="https://www.youtube.com/watch?v=NNnIGH9g6fA",
        )

    monkeypatch.setattr(
        "app.services.profile_service.fetch_youtube_video_metadata",
        fake_fetch_youtube_video_metadata,
    )

    response = await client.post(
        "/api/v1/portfolio/youtube/preview",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"url": "https://youtu.be/NNnIGH9g6fA?t=10"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "Creator proof video"
    assert payload["thumbnail_url"] == "https://example.com/thumb.jpg"
    assert payload["duration_iso"] == "PT3M21S"
    assert payload["duration_label"] == "3:21"
    assert payload["thumbnail_options"][0]["quality"] == "high"
    assert payload["public_metrics"]["views"] == 12345
    assert payload["verification_status"] == "youtube_metadata_verified"


async def test_portfolio_items_create_list_update_delete(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="portfolio-crud@example.com",
        username="portfolio_crud",
    )

    create = await client.post(
        "/api/v1/portfolio/items",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Retention proof package",
            "source_type": "custom",
            "source_url": "https://example.com/proof",
            "role_name": "Video Editor",
            "contribution_summary": "Handled hook, pacing, captions, and final delivery.",
            "contribution_tags": ["Hook", "Pacing", "Captions"],
            "tools": ["Premiere Pro"],
            "manual_metrics": {"retention_percent": 62.5, "ctr_percent": 8.1},
            "visibility": "public",
            "thumbnail_url": "https://example.com/thumb.jpg",
            "publish_status": "published",
            "portfolio_status": "past",
            "is_featured": True,
        },
    )
    assert create.status_code == 201
    item = create.json()
    assert item["verification_status"] == "manual"
    assert item["publish_status"] == "published"
    assert item["role_name"] == "Video Editor"

    listing = await client.get(
        "/api/v1/portfolio/items?user_id=me",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert listing.status_code == 200
    assert any(row["id"] == item["id"] for row in listing.json()["items"])

    update = await client.patch(
        f"/api/v1/portfolio/items/{item['id']}",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"is_featured": False, "manual_metrics": {"turnaround_days": 2}},
    )
    assert update.status_code == 200
    assert update.json()["is_featured"] is False
    assert update.json()["manual_metrics"]["turnaround_days"] == 2

    delete = await client.delete(
        f"/api/v1/portfolio/items/{item['id']}",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert delete.status_code == 200


async def test_portfolio_item_can_be_created_without_role(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="portfolio-no-role@example.com",
        username="portfolio_no_role",
    )

    create = await client.post(
        "/api/v1/portfolio/items",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "First proof link",
            "source_type": "custom",
            "source_url": "https://example.com/proof",
            "portfolio_status": "now",
        },
    )

    assert create.status_code == 201
    payload = create.json()
    assert payload["title"] == "First proof link"
    assert payload["role_name"] is None


async def test_public_listing_hides_private_and_draft_items(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="portfolio-visibility@example.com",
        username="portfolio_visibility",
    )

    draft = await client.post(
        "/api/v1/portfolio/items",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Draft proof",
            "source_type": "custom",
            "source_url": "https://example.com/draft",
            "thumbnail_url": "https://example.com/draft.jpg",
            "role_name": "Video Editor",
            "publish_status": "draft",
            "visibility": "public",
            "is_public": True,
        },
    )
    assert draft.status_code == 201

    private = await client.post(
        "/api/v1/portfolio/items",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Private proof",
            "source_type": "custom",
            "source_url": "https://example.com/private",
            "thumbnail_url": "https://example.com/private.jpg",
            "role_name": "Video Editor",
            "publish_status": "published",
            "visibility": "private",
            "is_public": False,
        },
    )
    assert private.status_code == 201

    published = await client.post(
        "/api/v1/portfolio/items",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Public proof",
            "source_type": "custom",
            "source_url": "https://example.com/public",
            "thumbnail_url": "https://example.com/public.jpg",
            "role_name": "Video Editor",
            "publish_status": "published",
            "visibility": "public",
            "is_public": True,
        },
    )
    assert published.status_code == 201

    owner_listing = await client.get(
        "/api/v1/portfolio/items?user_id=me",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert owner_listing.status_code == 200
    assert len(owner_listing.json()["items"]) == 3

    public_listing = await client.get(f"/api/v1/portfolio/{owner_listing.json()['items'][0]['user_id']}")
    assert public_listing.status_code == 200
    public_titles = {item["title"] for item in public_listing.json()["items"]}
    assert public_titles == {"Public proof"}
