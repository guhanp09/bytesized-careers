"""Security and product contracts for the fixed YouTube provider boundary."""

from __future__ import annotations

import asyncio
from urllib.parse import parse_qs
from uuid import uuid4

import httpx
import pytest
from httpx import AsyncClient
from pydantic import SecretStr

from app.api.deps import get_youtube_provider_client
from app.core.config import settings
from app.main import app
from app.schemas.profile import YouTubeIdentityRead
from app.services.youtube_service import (
    MAX_IDENTIFIER_CHARS,
    MAX_PROVIDER_RESPONSE_BYTES,
    YOUTUBE_CHANNELS_URL,
    YOUTUBE_VIDEOS_URL,
    YouTubeAPIError,
    YouTubeChannelIdentityResult,
    YouTubeInvalidSelectorError,
    YouTubeNotConfiguredError,
    YouTubeProviderClient,
    YouTubeReauthRequiredError,
    configured_youtube_api_key,
    fetch_youtube_video_metadata,
)

pytestmark = pytest.mark.anyio

CHANNEL_ID = f"UC{'a' * 22}"
VIDEO_ID = "abc123DEF_-"


def _json(payload: object, *, status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=payload,
        headers={"Content-Type": "application/json; charset=UTF-8"},
    )


def _channel_item(**snippet_overrides: object) -> dict[str, object]:
    return {
        "id": CHANNEL_ID,
        "snippet": {
            "title": "Creator Channel",
            "customUrl": "@creator",
            "thumbnails": {
                "high": {
                    "url": "https://yt3.ggpht.com/channel.jpg",
                    "width": 800,
                    "height": 800,
                }
            },
            **snippet_overrides,
        },
    }


async def test_owned_channels_use_one_fixed_redirect_free_redacted_request() -> None:
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return _json({"items": [_channel_item()]})

    provider = YouTubeProviderClient(
        "provider-api-secret",
        transport=httpx.MockTransport(handler),
    )
    channels = await provider.fetch_user_channels("oauth-access-secret")

    assert len(channels) == 1
    assert channels[0].channel_id == CHANNEL_ID
    assert channels[0].title == "Creator Channel"
    assert channels[0].thumbnail_url == "https://yt3.ggpht.com/channel.jpg"
    assert len(observed) == 1
    request = observed[0]
    assert request.method == "GET"
    assert f"{request.url.scheme}://{request.url.host}{request.url.path}" == (YOUTUBE_CHANNELS_URL)
    assert parse_qs(request.url.query.decode()) == {
        "part": ["snippet"],
        "mine": ["true"],
        "maxResults": ["50"],
    }
    assert request.headers["authorization"] == "Bearer oauth-access-secret"
    assert "cookie" not in request.headers
    assert "provider-api-secret" not in repr(provider)
    assert "oauth-access-secret" not in repr(provider)


async def test_owned_channel_output_is_deduplicated() -> None:
    items: list[object] = [
        _channel_item(),
        _channel_item(title="duplicate"),
    ]
    items.extend(
        {
            "id": f"UC{index:022d}",
            "snippet": {"title": f"Channel {index}", "thumbnails": {}},
        }
        for index in range(48)
    )
    provider = YouTubeProviderClient(
        transport=httpx.MockTransport(lambda _request: _json({"items": items}))
    )

    channels = await provider.fetch_user_channels("oauth-access-secret")

    assert len(channels) == 49
    assert len({channel.channel_id for channel in channels}) == len(channels)
    assert all(len(channel.title) <= 255 for channel in channels)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"items": None},
        {"items": {}},
        {"items": [None]},
        {"items": [{"id": "invalid", "snippet": {}}]},
        {"items": [{"id": CHANNEL_ID}]},
        {"items": [_channel_item()] * 51},
        {"items": [_channel_item()], "nextPageToken": "next"},
    ],
)
async def test_partial_or_malformed_owned_snapshot_cannot_replace_channel_authority(
    payload: dict[str, object],
) -> None:
    provider = YouTubeProviderClient(transport=httpx.MockTransport(lambda _request: _json(payload)))
    with pytest.raises(YouTubeAPIError):
        await provider.fetch_user_channels("oauth-access-secret")


async def test_genuine_empty_owned_snapshot_remains_supported() -> None:
    provider = YouTubeProviderClient(
        transport=httpx.MockTransport(lambda _request: _json({"items": []}))
    )
    assert await provider.fetch_user_channels("oauth-access-secret") == []


async def test_owned_thumbnail_respects_persisted_column_limit() -> None:
    item = _channel_item(
        thumbnails={
            "high": {"url": "https://yt3.ggpht.com/" + "a" * 1024},
            "medium": {"url": "https://yt3.ggpht.com/medium.jpg"},
        }
    )
    provider = YouTubeProviderClient(
        transport=httpx.MockTransport(lambda _request: _json({"items": [item]}))
    )
    channels = await provider.fetch_user_channels("oauth-access-secret")
    assert channels[0].thumbnail_url == "https://yt3.ggpht.com/medium.jpg"


@pytest.mark.parametrize("custom_url", ["a" * 99, "a" * 100, "@" + "a" * 100])
async def test_identity_handle_limit_includes_normalized_at_sign(custom_url: str) -> None:
    provider = YouTubeProviderClient(
        "key",
        transport=httpx.MockTransport(
            lambda _request: _json({"items": [_channel_item(customUrl=custom_url)]})
        ),
    )
    identity = await provider.resolve_channel_identity("handle", "creator")
    assert identity is not None
    normalized = YouTubeIdentityRead(
        channel_id=identity.channel_id,
        title=identity.title,
        thumbnail_url=identity.thumbnail_url,
        handle=identity.handle,
        canonical_url=identity.canonical_url,
    )
    assert normalized.handle == ("@" + custom_url if len(custom_url) == 99 else None)


async def test_both_entrypoints_use_stripped_secret_key_precedence(monkeypatch) -> None:
    monkeypatch.setattr(settings, "youtube_api_key", SecretStr("   "))
    monkeypatch.setattr(settings, "youtube_data_api_key", SecretStr(" alias-secret "))
    assert configured_youtube_api_key() == "alias-secret"
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return _json({"items": [_channel_item()]})

    real_client = httpx.AsyncClient

    def client_factory(**kwargs):
        assert kwargs["follow_redirects"] is False
        assert kwargs["trust_env"] is False
        assert kwargs["timeout"].connect == 2.0
        assert kwargs["timeout"].read == 8.0
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    await get_youtube_provider_client().resolve_channel_identity("handle", "creator")
    await fetch_youtube_video_metadata(VIDEO_ID)
    assert len(observed) == 2
    assert all(request.url.params["key"] == "alias-secret" for request in observed)
    monkeypatch.setattr(settings, "youtube_api_key", SecretStr(" preferred-secret "))
    assert configured_youtube_api_key() == "preferred-secret"


@pytest.mark.parametrize("status_code", [302, 403, 429, 503])
async def test_provider_failures_do_not_masquerade_as_revoked_user_grants(
    status_code: int,
) -> None:
    provider = YouTubeProviderClient(
        transport=httpx.MockTransport(
            lambda _request: _json(
                {"error": {"errors": [{"reason": "quotaExceeded"}]}},
                status_code=status_code,
            )
        )
    )
    with pytest.raises(YouTubeAPIError):
        await provider.fetch_user_channels("oauth-access-secret")


@pytest.mark.parametrize(
    ("status_code", "reason"),
    [(401, None), (403, "authError"), (403, "insufficientPermissions")],
)
async def test_only_explicit_auth_or_permission_failures_require_reauthorization(
    status_code: int,
    reason: str | None,
) -> None:
    payload: dict[str, object] = {"error": "invalid_token"}
    if reason:
        payload = {"error": {"errors": [{"reason": reason}]}}
    provider = YouTubeProviderClient(
        transport=httpx.MockTransport(lambda _request: _json(payload, status_code=status_code))
    )
    with pytest.raises(YouTubeReauthRequiredError):
        await provider.fetch_user_channels("oauth-access-secret")


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"not-json", headers={"Content-Type": "application/json"}),
        httpx.Response(
            200,
            content=b'{"items":' + b"[" * 2000 + b"]" * 2000 + b"}",
            headers={"Content-Type": "application/json"},
        ),
        httpx.Response(
            200,
            content=b'{"items":[],"value":Infinity}',
            headers={"Content-Type": "application/json"},
        ),
        httpx.Response(200, json=[], headers={"Content-Type": "application/json"}),
        httpx.Response(200, content=b"<html></html>", headers={"Content-Type": "text/html"}),
        httpx.Response(
            200,
            content=b"{}",
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(MAX_PROVIDER_RESPONSE_BYTES + 1),
            },
        ),
        httpx.Response(
            200,
            content=b"x" * (MAX_PROVIDER_RESPONSE_BYTES + 1),
            headers={"Content-Type": "application/json"},
        ),
    ],
)
async def test_success_json_type_shape_and_decoded_body_are_bounded(
    response: httpx.Response,
) -> None:
    provider = YouTubeProviderClient(transport=httpx.MockTransport(lambda _request: response))
    with pytest.raises(YouTubeAPIError):
        await provider.fetch_user_channels("oauth-access-secret")


async def test_invalid_error_json_does_not_hide_explicit_401_reauth() -> None:
    provider = YouTubeProviderClient(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                401, content=b"invalid-json", headers={"Content-Type": "application/json"}
            )
        )
    )
    with pytest.raises(YouTubeReauthRequiredError):
        await provider.fetch_user_channels("oauth-access-secret")


async def test_redirect_is_not_followed_and_cannot_receive_the_api_key() -> None:
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return httpx.Response(
            302,
            headers={"Location": "https://attacker.example/collect"},
        )

    provider = YouTubeProviderClient(
        "provider-api-secret",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(YouTubeAPIError) as captured:
        await provider.resolve_channel_identity("handle", "creator")

    assert len(observed) == 1
    assert observed[0].url.host == "www.googleapis.com"
    assert "provider-api-secret" not in str(captured.value)


async def test_network_and_whole_attempt_timeout_are_generic_and_redacted() -> None:
    def network_failure(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("provider-api-secret", request=request)

    async def slow_response(_request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.05)
        return _json({"items": []})

    providers = (
        YouTubeProviderClient(
            "provider-api-secret",
            transport=httpx.MockTransport(network_failure),
        ),
        YouTubeProviderClient(
            "provider-api-secret",
            transport=httpx.MockTransport(slow_response),
            total_timeout_seconds=0.005,
        ),
    )
    for provider in providers:
        with pytest.raises(YouTubeAPIError) as captured:
            await provider.resolve_channel_identity("handle", "creator")
        assert "provider-api-secret" not in str(captured.value)
        assert captured.value.__cause__ is None


async def test_handle_fallback_and_video_resolution_stay_on_fixed_endpoints() -> None:
    handle_requests: list[httpx.Request] = []

    def handle_handler(request: httpx.Request) -> httpx.Response:
        handle_requests.append(request)
        values = parse_qs(request.url.query.decode()).get("forHandle")
        return _json({"items": [] if values == ["@creator"] else [_channel_item()]})

    provider = YouTubeProviderClient(
        "provider-api-secret",
        transport=httpx.MockTransport(handle_handler),
    )
    identity = await provider.resolve_channel_identity("handle", "@creator")
    assert identity == YouTubeChannelIdentityResult(
        channel_id=CHANNEL_ID,
        title="Creator Channel",
        thumbnail_url="https://yt3.ggpht.com/channel.jpg",
        handle="@creator",
        canonical_url=f"https://www.youtube.com/channel/{CHANNEL_ID}",
    )
    assert [parse_qs(request.url.query.decode())["forHandle"] for request in handle_requests] == [
        ["@creator"],
        ["creator"],
    ]

    video_requests: list[httpx.Request] = []

    def video_handler(request: httpx.Request) -> httpx.Response:
        video_requests.append(request)
        if request.url.path.endswith("/videos"):
            return _json({"items": [{"snippet": {"channelId": CHANNEL_ID}}]})
        return _json({"items": [_channel_item()]})

    video_provider = YouTubeProviderClient(
        "provider-api-secret",
        transport=httpx.MockTransport(video_handler),
    )
    assert await video_provider.resolve_channel_identity("video_id", VIDEO_ID)
    assert [
        f"{request.url.scheme}://{request.url.host}{request.url.path}" for request in video_requests
    ] == [
        YOUTUBE_VIDEOS_URL,
        YOUTUBE_CHANNELS_URL,
    ]


@pytest.mark.parametrize(
    ("selector", "value"),
    [
        ("video_id", "short"),
        ("channel_id", "UCshort"),
        ("handle", "has/slash"),
        ("username", "x" * (MAX_IDENTIFIER_CHARS + 1)),
    ],
)
async def test_invalid_selectors_are_rejected_before_provider_work(
    selector: str,
    value: str,
) -> None:
    provider = YouTubeProviderClient(
        "provider-api-secret",
        transport=httpx.MockTransport(
            lambda request: pytest.fail(f"unexpected provider request: {request.url}")
        ),
    )
    with pytest.raises(YouTubeInvalidSelectorError):
        await provider.resolve_channel_identity(selector, value)  # type: ignore[arg-type]


async def test_missing_key_fails_closed_without_a_provider_attempt() -> None:
    provider = YouTubeProviderClient(
        None,
        transport=httpx.MockTransport(
            lambda request: pytest.fail(f"unexpected provider request: {request.url}")
        ),
    )
    with pytest.raises(YouTubeNotConfiguredError):
        await provider.resolve_channel_identity("handle", "creator")


async def test_video_metadata_is_bounded_normalized_and_key_owned_by_backend() -> None:
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return _json(
            {
                "items": [
                    {
                        "snippet": {
                            "title": "A useful video",
                            "description": "d" * 700,
                            "channelTitle": "Creator Channel",
                            "channelId": CHANNEL_ID,
                            "publishedAt": "2026-08-01T12:00:00Z",
                            "thumbnails": {
                                "high": {
                                    "url": "javascript:alert(1)",
                                    "width": -1,
                                    "height": 800,
                                },
                                "medium": {
                                    "url": "https://i.ytimg.com/vi/example/mqdefault.jpg",
                                    "width": 320,
                                    "height": 180,
                                },
                            },
                        },
                        "contentDetails": {"duration": "PT3M21S"},
                        "statistics": {
                            "viewCount": "1234",
                            "likeCount": "-1",
                            "commentCount": "999999999999999999999999999999",
                        },
                    }
                ]
            }
        )

    provider = YouTubeProviderClient(
        "provider-api-secret",
        transport=httpx.MockTransport(handler),
    )
    metadata = await provider.fetch_video_metadata(VIDEO_ID)

    assert metadata.video_id == VIDEO_ID
    assert metadata.title == "A useful video"
    assert metadata.description == "d" * 500
    assert metadata.thumbnail_url == "https://i.ytimg.com/vi/example/mqdefault.jpg"
    assert metadata.view_count == 1234
    assert metadata.like_count is None
    assert metadata.comment_count is None
    assert metadata.duration_iso == "PT3M21S"
    assert metadata.duration_label == "3:21"
    assert len(metadata.thumbnail_options) == 1
    assert parse_qs(observed[0].url.query.decode())["key"] == ["provider-api-secret"]
    assert "authorization" not in observed[0].headers


async def test_existing_video_metadata_entrypoint_uses_the_same_boundary() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return _json(
            {
                "items": [
                    {
                        "snippet": {"title": "Compatibility video"},
                        "contentDetails": {"duration": "PT1M"},
                        "statistics": {},
                    }
                ]
            }
        )

    result = await fetch_youtube_video_metadata(
        VIDEO_ID,
        api_key="provider-api-secret",
        transport=httpx.MockTransport(handler),
    )

    assert result.title == "Compatibility video"
    assert result.video_url == f"https://www.youtube.com/watch?v={VIDEO_ID}"


class _StubYouTubeProvider:
    async def resolve_channel_identity(
        self,
        selector: str,
        value: str,
    ) -> YouTubeChannelIdentityResult | None:
        assert selector == "handle"
        assert value == "creator"
        return YouTubeChannelIdentityResult(
            channel_id=CHANNEL_ID,
            title="Creator Channel",
            thumbnail_url="https://yt3.ggpht.com/channel.jpg",
            handle="@creator",
            canonical_url=f"https://www.youtube.com/channel/{CHANNEL_ID}",
        )


async def _bearer(client: AsyncClient) -> str:
    from test_link_preview import _register_verify_login

    return await _register_verify_login(
        client,
        email=f"youtube-boundary-{uuid4().hex[:8]}@example.com",
        username=f"yt{uuid4().hex[:6]}",
    )


async def test_identity_endpoint_requires_auth_and_returns_only_normalized_fields(
    client: AsyncClient,
) -> None:
    anonymous = await client.post(
        "/api/v1/me/youtube-identity",
        json={"selector": "handle", "value": "creator"},
    )
    assert anonymous.status_code in {401, 403}

    bearer = await _bearer(client)
    app.dependency_overrides[get_youtube_provider_client] = _StubYouTubeProvider
    try:
        response = await client.post(
            "/api/v1/me/youtube-identity",
            headers={"Authorization": f"Bearer {bearer}"},
            json={"selector": "handle", "value": "creator"},
        )
    finally:
        app.dependency_overrides.pop(get_youtube_provider_client, None)

    assert response.status_code == 200
    assert response.json() == {
        "identity": {
            "channel_id": CHANNEL_ID,
            "title": "Creator Channel",
            "thumbnail_url": "https://yt3.ggpht.com/channel.jpg",
            "handle": "@creator",
            "canonical_url": f"https://www.youtube.com/channel/{CHANNEL_ID}",
        }
    }


async def test_unconfigured_identity_endpoint_is_explicit(client: AsyncClient) -> None:
    bearer = await _bearer(client)
    app.dependency_overrides[get_youtube_provider_client] = lambda: YouTubeProviderClient(None)
    try:
        response = await client.post(
            "/api/v1/me/youtube-identity",
            headers={"Authorization": f"Bearer {bearer}"},
            json={"selector": "handle", "value": "creator"},
        )
    finally:
        app.dependency_overrides.pop(get_youtube_provider_client, None)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "missing_api_key"
