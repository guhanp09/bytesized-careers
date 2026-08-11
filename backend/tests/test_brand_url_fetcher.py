"""Brand pages reuse URL safety without pretending every homepage is a job."""

from __future__ import annotations

import ipaddress

import httpx
import pytest

from app.services.job_url_fetcher import (
    BRAND_URL_USER_AGENT,
    MAX_BRAND_URL_RESPONSE_BYTES,
    PublicBrandUrlFetcher,
    PublicJobUrlFetchError,
)


async def _public_resolver(_hostname: str, _port: int):
    return [ipaddress.ip_address("93.184.216.34")]


@pytest.mark.asyncio
async def test_a_non_job_official_homepage_is_read_with_a_bounded_brand_policy() -> None:
    seen_user_agent: str | None = None

    def homepage(request: httpx.Request) -> httpx.Response:
        nonlocal seen_user_agent
        seen_user_agent = request.headers.get("user-agent")
        return httpx.Response(
            200,
            text=(
                "<html><head><title>Finance Simplified</title>"
                '<meta name="description" content="Practical money education for new investors.">'
                '<script type="application/ld+json">'
                '{"@context":"https://schema.org","@type":"Organization",'
                '"name":"Finance Simplified","description":"Finance Simplified creates '
                'personal finance explainers for young adults."}</script></head><body><main>'
                "<h1>Finance Simplified</h1><p>Finance Simplified publishes "
                "personal finance videos for young adults learning about budgeting "
                "and investing through practical explainers.</p></main></body></html>"
            ),
            headers={"Content-Type": "text/html"},
            request=request,
        )

    retrieval = await PublicBrandUrlFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(homepage),
    ).fetch("https://financesimplified.example")

    assert retrieval.metadata["page_classification"] == "brand_page"
    assert "personal finance videos" in retrieval.normalized_text
    assert "personal finance explainers" in retrieval.normalized_text
    assert retrieval.metadata["organization_descriptions_found"] == 1
    assert retrieval.metadata["meta_descriptions_found"] == 1
    assert seen_user_agent == BRAND_URL_USER_AGENT


@pytest.mark.asyncio
async def test_brand_policy_remains_bounded_and_revalidates_redirects() -> None:
    def too_large(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "Content-Type": "text/html",
                "Content-Length": str(MAX_BRAND_URL_RESPONSE_BYTES + 1),
            },
            request=request,
        )

    with pytest.raises(PublicJobUrlFetchError) as large:
        await PublicBrandUrlFetcher(
            resolver=_public_resolver,
            transport=httpx.MockTransport(too_large),
        ).fetch("https://brand.example")
    assert large.value.code == "JOB_IMPORT_URL_RESPONSE_TOO_LARGE"

    def private_redirect(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            302,
            headers={"Location": "http://169.254.169.254/latest/meta-data"},
            request=request,
        )

    with pytest.raises(PublicJobUrlFetchError) as unsafe:
        await PublicBrandUrlFetcher(
            resolver=_public_resolver,
            transport=httpx.MockTransport(private_redirect),
        ).fetch("https://brand.example")
    assert unsafe.value.code == "JOB_IMPORT_URL_UNSAFE_DESTINATION"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://localhost/admin",
        "http://127.0.0.1/internal",
        "http://service.internal/metadata",
    ],
)
async def test_brand_policy_rejects_client_or_private_destinations(url: str) -> None:
    with pytest.raises(PublicJobUrlFetchError):
        await PublicBrandUrlFetcher().fetch(url)
