from __future__ import annotations

from datetime import UTC, datetime

from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import select

from app.models import EmailVerificationToken, User
from app.services.link_preview_service import LinkPreviewFetchError, detect_link_source
from app.services.youtube_service import YouTubeAPIError, YouTubeVideoMetadataResult


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


def test_detect_link_source_common_portfolio_sources() -> None:
    assert detect_link_source("https://www.youtube.com/watch?v=NNnIGH9g6fA") == "youtube"
    assert detect_link_source("https://youtu.be/NNnIGH9g6fA") == "youtube"
    assert detect_link_source("https://www.youtube.com/shorts/NNnIGH9g6fA") == "youtube"
    assert detect_link_source("https://vimeo.com/123456") == "vimeo"
    assert detect_link_source("https://www.behance.net/gallery/123/sample") == "behance"
    assert detect_link_source("https://drive.google.com/file/d/123/view") == "drive"
    assert detect_link_source("https://docs.google.com/document/d/123/edit") == "google_docs"
    assert detect_link_source("https://example.notion.site/work") == "notion"
    assert detect_link_source("https://www.instagram.com/p/abc") == "instagram"
    assert detect_link_source("https://www.tiktok.com/@creator/video/123") == "tiktok"
    assert detect_link_source("https://portfolio.example.com/work") == "website"


async def test_link_preview_youtube_success_with_mocked_metadata(client: AsyncClient, monkeypatch) -> None:
    bearer = await _register_verify_login(
        client,
        email="link-preview-youtube@example.com",
        username="link_preview_youtube",
    )

    async def noop_public_url(_url: str) -> None:
        return None

    async def fake_fetch_youtube_video_metadata(_video_id: str) -> YouTubeVideoMetadataResult:
        return YouTubeVideoMetadataResult(
            video_id="NNnIGH9g6fA",
            title="Creator portfolio video",
            description="Public description",
            thumbnail_url="https://example.com/thumb.jpg",
            channel_name="Creator Channel",
            channel_id="UC123",
            view_count=1000,
            like_count=50,
            comment_count=8,
            published_date=datetime(2026, 1, 1, tzinfo=UTC),
            duration="3:21",
            duration_iso="PT3M21S",
            duration_label="3:21",
            thumbnail_options=[],
            video_url="https://www.youtube.com/watch?v=NNnIGH9g6fA",
        )

    monkeypatch.setattr("app.services.link_preview_service._assert_public_http_url", noop_public_url)
    monkeypatch.setattr(
        "app.services.link_preview_service.fetch_youtube_video_metadata",
        fake_fetch_youtube_video_metadata,
    )

    response = await client.post(
        "/api/v1/portfolio/link-preview",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"url": "https://youtu.be/NNnIGH9g6fA?t=10"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source_type"] == "youtube"
    assert payload["status"] == "ok"
    assert payload["confidence"] == "high"
    assert payload["title"] == "Creator portfolio video"
    assert payload["thumbnail_url"] == "https://example.com/thumb.jpg"
    assert payload["author_name"] == "Creator Channel"
    assert payload["public_metrics"]["views"] == 1000
    assert payload["public_metrics"]["duration"] == "3:21"
    assert "role" in payload["manual_required_fields"]


async def test_link_preview_youtube_missing_key_uses_oembed_fallback(client: AsyncClient, monkeypatch) -> None:
    bearer = await _register_verify_login(
        client,
        email="link-preview-youtube-fallback@example.com",
        username="lp_fallback",
    )

    async def noop_public_url(_url: str) -> None:
        return None

    async def failing_youtube_fetch(_video_id: str) -> YouTubeVideoMetadataResult:
        raise YouTubeAPIError("YouTube metadata import is not configured yet.")

    async def fake_oembed(_endpoint: str, _work_url: str) -> dict[str, str]:
        return {
            "title": "Fallback YouTube title",
            "thumbnail_url": "https://example.com/oembed.jpg",
            "author_name": "Fallback Channel",
            "provider_name": "YouTube",
        }

    monkeypatch.setattr("app.services.link_preview_service._assert_public_http_url", noop_public_url)
    monkeypatch.setattr("app.services.link_preview_service.fetch_youtube_video_metadata", failing_youtube_fetch)
    monkeypatch.setattr("app.services.link_preview_service._fetch_oembed_json", fake_oembed)

    response = await client.post(
        "/api/v1/portfolio/link-preview",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"url": "https://www.youtube.com/watch?v=NNnIGH9g6fA"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source_type"] == "youtube"
    assert payload["status"] == "partial"
    assert payload["confidence"] == "medium"
    assert payload["title"] == "Fallback YouTube title"
    assert payload["public_metrics"]["views"] is None


async def test_link_preview_generic_open_graph_parse(client: AsyncClient, monkeypatch) -> None:
    bearer = await _register_verify_login(
        client,
        email="link-preview-og@example.com",
        username="link_preview_og",
    )

    async def noop_public_url(_url: str) -> None:
        return None

    async def fake_fetch_text_url(_url: str) -> tuple[str, str]:
        return (
            "https://portfolio.example.com/work",
            """
            <html>
              <head>
                <meta property="og:title" content="Thumbnail case study">
                <meta property="og:description" content="Packaging and thumbnail design">
                <meta property="og:image" content="/cover.jpg">
                <meta property="og:site_name" content="Portfolio Site">
              </head>
            </html>
            """,
        )

    monkeypatch.setattr("app.services.link_preview_service._assert_public_http_url", noop_public_url)
    monkeypatch.setattr("app.services.link_preview_service._fetch_text_url", fake_fetch_text_url)

    response = await client.post(
        "/api/v1/portfolio/link-preview",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"url": "https://portfolio.example.com/work"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source_type"] == "website"
    assert payload["status"] == "ok"
    assert payload["title"] == "Thumbnail case study"
    assert payload["description"] == "Packaging and thumbnail design"
    assert payload["thumbnail_url"] == "https://portfolio.example.com/cover.jpg"
    assert payload["provider_name"] == "Portfolio Site"


async def test_link_preview_fetch_failure_returns_manual_required(client: AsyncClient, monkeypatch) -> None:
    bearer = await _register_verify_login(
        client,
        email="link-preview-manual@example.com",
        username="link_preview_manual",
    )

    async def noop_public_url(_url: str) -> None:
        return None

    async def failing_fetch_text_url(_url: str) -> tuple[str, str]:
        raise LinkPreviewFetchError("blocked")

    monkeypatch.setattr("app.services.link_preview_service._assert_public_http_url", noop_public_url)
    monkeypatch.setattr("app.services.link_preview_service._fetch_text_url", failing_fetch_text_url)

    response = await client.post(
        "/api/v1/portfolio/link-preview",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"url": "https://private.example.com/work"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "manual_required"
    assert payload["confidence"] == "low"
    assert payload["source_url"] == "https://private.example.com/work"
    assert "title" in payload["manual_required_fields"]


async def test_link_preview_rejects_local_urls(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="link-preview-local@example.com",
        username="link_preview_local",
    )

    response = await client.post(
        "/api/v1/portfolio/link-preview",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"url": "http://localhost:8000/private"},
    )

    assert response.status_code == 400
