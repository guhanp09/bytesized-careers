"""Where organization-page resolution is allowed to send a request.

Someone types their company or channel URL and the product offers to fill in the
name and logo from that page. That is a fetch of a URL a user chose, and it used
to happen in the Next runtime with its own DNS resolution, its own redirect
following, and a private-host pattern list that a decimal-encoded address walks
straight through.

These tests cover the two things the move has to get right: platform pages carry
a per-hop allowlist so a profile cannot redirect the request off the platform,
and *no* page — platform or not — can reach a private address, send a
credential, or return more than the handful of fields the product uses.
"""

from __future__ import annotations

import ipaddress
from uuid import uuid4

import httpx
import pytest
from httpx import AsyncClient

from app.services.organization_page_service import (
    MAX_NAME_CHARS,
    OrganizationPageError,
    read_organization_page,
)
from app.services.safe_outbound_fetch import SafeOutboundFetcher

pytestmark = pytest.mark.anyio

PUBLIC = ipaddress.ip_address("93.184.216.34")
METADATA = ipaddress.ip_address("169.254.169.254")


def _fetcher(handler, *, resolver=None) -> SafeOutboundFetcher:
    async def public_resolver(_hostname: str, _port: int):
        return [PUBLIC]

    return SafeOutboundFetcher(
        resolver=resolver or public_resolver,
        transport=httpx.MockTransport(handler),
    )


def _html(body: str) -> httpx.Response:
    return httpx.Response(
        200, headers={"Content-Type": "text/html; charset=utf-8"}, content=body.encode()
    )


PAGE = """
<html><head>
<title>Acme Studio — home</title>
<meta property="og:site_name" content="Acme Studio">
<meta property="og:image" content="/logo.png">
<link rel="apple-touch-icon" href="https://cdn.example.com/icon.png">
</head><body>hello</body></html>
"""


async def test_a_public_company_page_returns_only_the_fields_the_product_uses() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return _html(PAGE)

    metadata = await read_organization_page(
        "https://acme.example/about", fetcher=_fetcher(handler)
    )

    assert metadata.site_name == "Acme Studio"
    assert metadata.title == "Acme Studio — home"
    # Relative metadata is resolved against the page that supplied it.
    assert metadata.image_url == "https://acme.example/logo.png"
    assert metadata.icon_url == "https://cdn.example.com/icon.png"
    # A general website has no channel to report.
    assert metadata.youtube_channel_id == ""
    assert "authorization" not in requests[0].headers
    assert "cookie" not in requests[0].headers


async def test_a_private_destination_is_refused() -> None:
    async def resolver(_hostname: str, _port: int):
        return [METADATA]

    fetcher = _fetcher(
        lambda request: pytest.fail(f"unexpected request to {request.url}"),
        resolver=resolver,
    )

    with pytest.raises(OrganizationPageError):
        await read_organization_page("https://metadata.example/", fetcher=fetcher)


async def test_a_redirect_to_a_private_address_is_refused() -> None:
    async def resolver(hostname: str, _port: int):
        return [METADATA if hostname == "internal.example" else PUBLIC]

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "acme.example":
            return httpx.Response(302, headers={"Location": "https://internal.example/"})
        return _html(PAGE)

    with pytest.raises(OrganizationPageError):
        await read_organization_page(
            "https://acme.example/", fetcher=_fetcher(handler, resolver=resolver)
        )

    assert all(request.url.host == "acme.example" for request in seen)


@pytest.mark.parametrize(
    ("entered", "location"),
    [
        ("https://www.instagram.com/creator/", "https://attacker.example/creator"),
        ("https://www.instagram.com/creator/", "https://notinstagram.com/creator"),
        ("https://www.youtube.com/@creator", "https://youtube.com.attacker.example/@creator"),
        ("https://www.youtube.com/@creator", "https://attacker.example/@creator"),
    ],
)
async def test_a_platform_page_cannot_redirect_off_its_platform(
    entered: str, location: str
) -> None:
    """The allowlist has to hold on the hop the first response chooses."""

    seen: list[httpx.Request] = []
    entered_host = httpx.URL(entered).host

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == entered_host:
            return httpx.Response(302, headers={"Location": location})
        return _html("<html><head><title>somewhere else</title></head></html>")

    with pytest.raises(OrganizationPageError):
        await read_organization_page(entered, fetcher=_fetcher(handler))

    assert all(request.url.host == entered_host for request in seen)


async def test_a_general_website_may_still_redirect_to_another_public_host() -> None:
    """Real organizations redirect across domains, and that is not an attack.

    The allowlist exists for platforms whose page we can name in advance. For a
    company URL nobody has seen before, the boundary is the generic public
    policy — which is exactly what makes this hop safe.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "acme.example":
            return httpx.Response(301, headers={"Location": "https://www.acme-studio.example/"})
        return _html(PAGE)

    metadata = await read_organization_page(
        "https://acme.example/", fetcher=_fetcher(handler)
    )

    assert metadata.site_name == "Acme Studio"
    assert metadata.final_url.startswith("https://www.acme-studio.example/")


async def test_a_youtube_page_yields_only_its_channel_id() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return _html(
            '<html><head><meta itemprop="channelId" '
            'content="UCabcdefghijklmnopqrstuv">'
            "<title>A creator</title></head></html>"
        )

    metadata = await read_organization_page(
        "https://www.youtube.com/somecustompath", fetcher=_fetcher(handler)
    )

    assert metadata.youtube_channel_id == "UCabcdefghijklmnopqrstuv"


@pytest.mark.parametrize(
    ("content_type", "body"),
    [
        ("application/json", b'{"not":"html"}'),
        ("text/html", b"x" * (1024 * 1024 + 1)),
    ],
)
async def test_a_wrong_type_or_oversized_page_is_refused(
    content_type: str, body: bytes
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"Content-Type": content_type}, content=body)

    with pytest.raises(OrganizationPageError):
        await read_organization_page("https://acme.example/", fetcher=_fetcher(handler))


async def test_returned_values_are_bounded_and_never_a_browser_scheme() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return _html(
            "<html><head>"
            f'<meta property="og:site_name" content="{"n" * 5000}">'
            '<meta property="og:image" content="javascript:alert(1)">'
            '<link rel="icon" href="data:text/html,<script>alert(1)</script>">'
            "</head></html>"
        )

    metadata = await read_organization_page(
        "https://acme.example/", fetcher=_fetcher(handler)
    )

    assert len(metadata.site_name) == MAX_NAME_CHARS
    # A page may put anything in these attributes; only http(s) leaves here,
    # because the browser is going to treat them as image sources.
    assert metadata.image_url == ""
    assert metadata.icon_url == ""


async def test_an_unreadable_page_raises_rather_than_inventing_metadata() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, headers={"Content-Type": "text/html"}, content=b"gone")

    with pytest.raises(OrganizationPageError):
        await read_organization_page("https://acme.example/", fetcher=_fetcher(handler))


async def test_the_endpoint_requires_authentication(client: AsyncClient) -> None:
    """Reading a page the caller chose is never anonymous."""

    response = await client.post(
        "/api/v1/me/organization-page", json={"url": "https://acme.example/"}
    )

    assert response.status_code in {401, 403}


async def test_an_unreadable_page_answers_with_empty_fields(
    client: AsyncClient, monkeypatch
) -> None:
    """A page that cannot be read is an ordinary outcome, not a failure.

    The resolver falls back to the identity it derives from the URL itself, so
    answering with an error status here would turn a best-effort enrichment into
    a blocked workflow.
    """

    from test_link_preview import _register_verify_login

    bearer = await _register_verify_login(
        client, email=f"org-{uuid4().hex[:8]}@example.com", username=f"org{uuid4().hex[:6]}"
    )

    async def unreadable(_url: str):
        raise OrganizationPageError("PAGE_UNAVAILABLE")

    monkeypatch.setattr(
        "app.api.v1.routers.me.read_organization_page", unreadable
    )

    response = await client.post(
        "/api/v1/me/organization-page",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"url": "https://acme.example/"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "final_url": "",
        "site_name": "",
        "title": "",
        "image_url": "",
        "icon_url": "",
        "youtube_channel_id": "",
    }
