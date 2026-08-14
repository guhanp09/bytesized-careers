from __future__ import annotations

import ipaddress
import json
from datetime import UTC, datetime

import httpx
import pytest
from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import select

from app.models import EmailVerificationToken, User
from app.services.link_preview_service import (
    MAX_METADATA_DESCRIPTION_CHARS,
    MAX_METADATA_TITLE_CHARS,
    MAX_OEMBED_BYTES,
    MAX_PREVIEW_BYTES,
    LinkPreviewFetchError,
    LinkPreviewValidationError,
    _assert_public_http_url,
    _fetch_oembed_json,
    _fetch_text_url,
    _parse_html_metadata,
    _preview_oembed,
    detect_link_source,
)
from app.services.safe_outbound_fetch import SafeOutboundFetcher
from app.services.youtube_service import YouTubeAPIError, YouTubeVideoMetadataResult


async def _public_resolver(_hostname: str, _port: int):
    return [ipaddress.ip_address("93.184.216.34")]


def _outbound_fixture(handler) -> SafeOutboundFetcher:
    return SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(handler),
    )


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


@pytest.mark.parametrize(
    "url",
    [
        "https://notyoutube.com/watch?v=NNnIGH9g6fA",
        "https://youtube.com.attacker.example/watch?v=NNnIGH9g6fA",
        "https://notvimeo.com/123456",
        "https://notion.site.attacker.example/work",
        "https://notbehance.net/gallery/123/sample",
        "https://notinstagram.com/p/abc",
        "https://nottiktok.com/@creator/video/123",
    ],
)
def test_detect_link_source_does_not_trust_suffix_spoofed_hosts(url: str) -> None:
    assert detect_link_source(url) == "website"


def test_page_metadata_cannot_return_an_unbounded_field() -> None:
    """A bounded body can still be one enormous field.

    The fetch ceiling caps the whole page, not each value inside it, and these
    values are handed to the browser and offered as defaults for a saved
    portfolio item. A title longer than the stored column could never be saved
    as offered, so each field is clamped to a length the product can use.
    """

    html = (
        "<html><head>"
        f'<meta property="og:title" content="{"t" * 5000}">'
        f'<meta property="og:description" content="{"d" * 40000}">'
        f'<meta property="og:site_name" content="{"s" * 5000}">'
        f'<meta name="author" content="{"a" * 5000}">'
        "</head><body></body></html>"
    )

    metadata = _parse_html_metadata(html, "https://portfolio.example.com/work")

    assert len(metadata["title"]) == MAX_METADATA_TITLE_CHARS
    assert len(metadata["description"]) == MAX_METADATA_DESCRIPTION_CHARS
    assert len(metadata["provider_name"]) <= 255
    assert len(metadata["author_name"]) <= 255
    # Truncation, not refusal: the rest of the preview still reaches the creator.
    assert metadata["title"].startswith("t")
    assert metadata["canonical_url"] == "https://portfolio.example.com/work"


async def test_html_fetch_uses_shared_boundary_and_revalidates_redirects() -> None:
    requests: list[httpx.Request] = []
    resolutions: list[tuple[str, int]] = []

    async def resolver(hostname: str, port: int):
        resolutions.append((hostname, port))
        return [ipaddress.ip_address("93.184.216.34")]

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(
                302,
                headers={"Location": "https://final.example/work"},
                request=request,
            )
        return httpx.Response(
            200,
            headers={"Content-Type": "text/html; charset=utf-8"},
            content=b"<html><title>Bounded preview</title></html>",
            request=request,
        )

    final_url, body = await _fetch_text_url(
        "https://portfolio.example/start",
        fetcher=SafeOutboundFetcher(
            resolver=resolver,
            transport=httpx.MockTransport(handler),
        ),
    )

    assert final_url == "https://final.example/work"
    assert "Bounded preview" in body
    assert {hostname for hostname, _port in resolutions} == {
        "portfolio.example",
        "final.example",
    }
    assert len(requests) == 2
    assert all(request.headers["accept"].startswith("text/html") for request in requests)
    assert all("authorization" not in request.headers for request in requests)
    assert all("cookie" not in request.headers for request in requests)


async def test_html_fetch_blocks_private_redirect_before_a_second_request() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            302,
            headers={"Location": "http://169.254.169.254/latest/meta-data"},
            request=request,
        )

    with pytest.raises(LinkPreviewValidationError, match="cannot be previewed"):
        await _fetch_text_url(
            "https://portfolio.example/work",
            fetcher=_outbound_fixture(handler),
        )
    assert len(requests) == 1


async def test_html_fetch_maps_network_timeout_to_safe_manual_fallback_error() -> None:
    def timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("fixture timeout")

    with pytest.raises(LinkPreviewFetchError, match="temporarily unavailable"):
        await _fetch_text_url(
            "https://portfolio.example/work",
            fetcher=_outbound_fixture(timeout),
        )


@pytest.mark.parametrize(
    ("headers", "body"),
    [
        ({"Content-Type": "application/octet-stream"}, b"not HTML"),
        ({"Content-Type": "text/html"}, b"x" * (MAX_PREVIEW_BYTES + 1)),
        (
            {
                "Content-Type": "text/html",
                "Content-Length": str(MAX_PREVIEW_BYTES + 1),
            },
            b"",
        ),
    ],
)
async def test_html_fetch_rejects_unsupported_or_oversized_responses(
    headers: dict[str, str],
    body: bytes,
) -> None:
    fetcher = _outbound_fixture(
        lambda request: httpx.Response(
            200,
            headers=headers,
            content=body,
            request=request,
        )
    )
    with pytest.raises(LinkPreviewFetchError, match="temporarily unavailable"):
        await _fetch_text_url("https://portfolio.example/work", fetcher=fetcher)


async def test_link_validation_rejects_mixed_public_and_private_dns_answers() -> None:
    async def mixed_resolver(_hostname: str, _port: int):
        return [
            ipaddress.ip_address("93.184.216.34"),
            ipaddress.ip_address("10.0.0.5"),
        ]

    with pytest.raises(LinkPreviewValidationError, match="cannot be previewed"):
        await _assert_public_http_url(
            "https://portfolio.example/work",
            fetcher=SafeOutboundFetcher(
                resolver=mixed_resolver,
                transport=httpx.MockTransport(
                    lambda request: pytest.fail(f"unexpected request to {request.url}")
                ),
            ),
        )


async def test_oembed_fetch_is_fixed_redirect_free_bounded_json() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            headers={"Content-Type": "application/json; charset=utf-8"},
            content=json.dumps(
                {
                    "title": "A bounded provider response",
                    "provider_name": "YouTube",
                }
            ).encode(),
            request=request,
        )

    payload = await _fetch_oembed_json(
        "https://www.youtube.com/oembed",
        "https://www.youtube.com/watch?v=NNnIGH9g6fA&feature=share",
        fetcher=_outbound_fixture(handler),
    )

    assert payload["title"] == "A bounded provider response"
    assert len(requests) == 1
    assert requests[0].url.host == "www.youtube.com"
    assert requests[0].url.path == "/oembed"
    assert requests[0].url.params["format"] == "json"
    assert requests[0].url.params["url"].startswith("https://www.youtube.com/watch")
    assert requests[0].headers["accept"] == "application/json"
    assert "authorization" not in requests[0].headers
    assert "cookie" not in requests[0].headers


async def test_oembed_rejects_an_unapproved_endpoint_without_requesting_it() -> None:
    fetcher = _outbound_fixture(
        lambda request: pytest.fail(f"unexpected request to {request.url}")
    )
    with pytest.raises(LinkPreviewFetchError, match="not supported"):
        await _fetch_oembed_json(
            "https://attacker.example/oembed",
            "https://www.youtube.com/watch?v=NNnIGH9g6fA",
            fetcher=fetcher,
        )


async def test_oembed_refuses_provider_redirects() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            302,
            headers={"Location": "https://attacker.example/oembed"},
            request=request,
        )

    with pytest.raises(LinkPreviewFetchError, match="temporarily unavailable"):
        await _fetch_oembed_json(
            "https://vimeo.com/api/oembed.json",
            "https://vimeo.com/123456",
            fetcher=_outbound_fixture(handler),
        )
    assert len(requests) == 1


@pytest.mark.parametrize(
    ("content_type", "body"),
    [
        ("text/html", b"<html>not JSON</html>"),
        ("application/json", b"x" * (MAX_OEMBED_BYTES + 1)),
        ("application/json", b"{malformed"),
    ],
)
async def test_oembed_rejects_wrong_type_oversize_and_malformed_json(
    content_type: str,
    body: bytes,
) -> None:
    fetcher = _outbound_fixture(
        lambda request: httpx.Response(
            200,
            headers={"Content-Type": content_type},
            content=body,
            request=request,
        )
    )
    with pytest.raises(LinkPreviewFetchError):
        await _fetch_oembed_json(
            "https://www.youtube.com/oembed",
            "https://www.youtube.com/watch?v=NNnIGH9g6fA",
            fetcher=fetcher,
        )


async def test_vimeo_oembed_outage_preserves_manual_entry_fallback(monkeypatch) -> None:
    async def unavailable(_endpoint: str, _work_url: str) -> dict[str, str]:
        raise LinkPreviewFetchError("provider unavailable")

    monkeypatch.setattr("app.services.link_preview_service._fetch_oembed_json", unavailable)

    result = await _preview_oembed(
        "https://vimeo.com/123456",
        source_type="vimeo",
        endpoint="https://vimeo.com/api/oembed.json",
    )

    assert result.status == "manual_required"
    assert result.source_url == "https://vimeo.com/123456"
    assert result.manual_required_fields == ["title", "role", "contribution", "tools", "outcome"]


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


async def test_link_preview_requires_authentication(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/portfolio/link-preview",
        json={"url": "https://portfolio.example/work"},
    )

    assert response.status_code == 401


async def test_link_preview_rejects_unsafe_urls(client: AsyncClient) -> None:
    bearer = await _register_verify_login(
        client,
        email="link-preview-local@example.com",
        username="link_preview_local",
    )

    for url in [
        "http://localhost:8000/private",
        "http://169.254.169.254/latest/meta-data",
        "https://user:secret@portfolio.example/work",
        "https://93.184.216.34:22/work",
        "http://[::1]/private",
    ]:
        response = await client.post(
            "/api/v1/portfolio/link-preview",
            headers={"Authorization": f"Bearer {bearer}"},
            json={"url": url},
        )
        assert response.status_code == 400, url
