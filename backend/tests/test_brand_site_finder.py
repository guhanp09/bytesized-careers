"""The provider may discover a URL; only its actual search tool may attest it."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.core.brand_discovery import BrandContext
from app.integrations.openai.brand_site_finder import (
    BrandSiteFinderConfig,
    OpenAIBrandSiteFinder,
)


class _Responses:
    def __init__(self, response: object | None = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.response


class _Client:
    def __init__(self, responses: _Responses) -> None:
        self.responses = responses


def _response(
    payload: dict[str, object],
    *,
    sources: tuple[str, ...] = ("https://financesimplified.example/about",),
) -> object:
    return SimpleNamespace(
        output_text=json.dumps(payload),
        output=(
            {
                "type": "web_search_call",
                "action": {"sources": [{"url": url} for url in sources]},
            },
        ),
    )


def _finder(responses: _Responses, *, api_key: str | None = "test-key") -> OpenAIBrandSiteFinder:
    return OpenAIBrandSiteFinder(
        BrandSiteFinderConfig(api_key=api_key, model="gpt-test"),
        client=_Client(responses),
    )


@pytest.mark.asyncio
async def test_discovery_uses_bounded_structured_web_search_without_storage() -> None:
    responses = _Responses(
        _response(
            {
                "verdict": "verified_match",
                "official_url": "https://financesimplified.example/",
                "detail": "official site matches the finance context",
                "considered": ["https://model-invented.example"],
            }
        )
    )
    finder = _finder(responses)
    context = BrandContext(
        name="Finance Simplified " * 30,
        source_employer="Finance Simplified",
        industry_terms=("personal finance", "education"),
        role_terms=("video editor",),
        location="Chennai",
        known_identifiers=("@financesimplified",),
        source_host="simplyhired.co.in",
    )

    result = await finder.find_official_site(context)

    assert result.verdict == "verified_match"
    assert result.official_url == "https://financesimplified.example/about"
    # Internal considered URLs come from the server-returned search action, not
    # generated JSON the model could use to smuggle an arbitrary fetch target.
    assert result.considered == ("https://financesimplified.example/about",)
    request = responses.calls[0]
    assert request["tools"] == [{"type": "web_search"}]
    assert request["include"] == ["web_search_call.action.sources"]
    assert request["store"] is False
    assert request["max_tool_calls"] == 4
    assert request["max_output_tokens"] == 500
    assert request["text"]["format"]["type"] == "json_schema"
    sent = json.loads(request["input"])
    assert len(sent["brand_name"]) <= 160
    assert sent["imported_from_host"] == "simplyhired.co.in"
    assert sent["known_identity_markers"] == ["@financesimplified"]


@pytest.mark.asyncio
async def test_generated_url_without_a_real_search_source_is_never_fetchable() -> None:
    responses = _Responses(
        _response(
            {
                "verdict": "verified_match",
                "official_url": "https://attacker.example/internal",
                "detail": "trust me",
                "considered": ["https://attacker.example/internal"],
            },
            sources=("https://directory.example/finance-simplified",),
        )
    )

    result = await _finder(responses).find_official_site(
        BrandContext(name="Finance Simplified")
    )

    assert result.verdict == "ambiguous"
    assert result.official_url is None
    assert "not corroborated" in result.detail


@pytest.mark.asyncio
async def test_empty_malformed_and_unknown_replies_fail_closed() -> None:
    for reply in (
        "",
        "not json",
        json.dumps({"verdict": "certain", "official_url": None}),
    ):
        responses = _Responses(SimpleNamespace(output_text=reply, output=[]))
        result = await _finder(responses).find_official_site(BrandContext(name="Pulse"))

        assert result.verdict == "no_match"
        assert result.official_url is None
        assert result.failed is True


@pytest.mark.asyncio
async def test_provider_failure_is_retryable_and_never_escapes() -> None:
    responses = _Responses(error=RuntimeError("search unavailable"))

    result = await _finder(responses).find_official_site(BrandContext(name="Pulse"))

    assert result.verdict == "no_match"
    assert result.failed is True
    assert result.official_url is None


@pytest.mark.asyncio
async def test_unconfigured_discovery_makes_no_provider_call() -> None:
    responses = _Responses(error=AssertionError("provider must not be called"))

    result = await _finder(responses, api_key=None).find_official_site(
        BrandContext(name="Finance Simplified")
    )

    assert result.verdict == "no_match"
    assert result.failed is False
    assert responses.calls == []


def test_sdk_style_nested_search_objects_are_read_without_trusting_model_json() -> None:
    class _Model:
        def __init__(self, value: dict[str, object]) -> None:
            self.value = value

        def model_dump(self) -> dict[str, object]:
            return self.value

    response = SimpleNamespace(
        output=(
            _Model(
                {
                    "type": "web_search_call",
                    "action": _Model(
                        {
                            "sources": (
                                SimpleNamespace(url="https://brand.example/about"),
                            )
                        }
                    ),
                }
            ),
        )
    )

    assert OpenAIBrandSiteFinder._searched_urls(response) == (
        "https://brand.example/about",
    )


@pytest.mark.asyncio
async def test_an_attested_about_page_is_preferred_on_the_selected_official_host() -> None:
    responses = _Responses(
        _response(
            {
                "verdict": "verified_match",
                "official_url": "https://brand.example/",
                "detail": "official domain",
                "considered": [],
            },
            sources=(
                "https://brand.example/",
                "https://brand.example/about-us",
                "https://directory.example/brand",
            ),
        )
    )

    result = await _finder(responses).find_official_site(
        BrandContext(name="Distinctive Brand")
    )

    assert result.official_url == "https://brand.example/about-us"


@pytest.mark.asyncio
async def test_an_attested_homepage_replaces_a_selected_contact_page() -> None:
    responses = _Responses(
        _response(
            {
                "verdict": "verified_match",
                "official_url": "https://brand.example/contact-us",
                "detail": "official domain",
                "considered": [],
            },
            sources=(
                "https://brand.example/contact-us",
                "https://brand.example/",
                "https://directory.example/brand",
            ),
        )
    )

    result = await _finder(responses).find_official_site(
        BrandContext(name="Distinctive Brand")
    )

    assert result.official_url == "https://brand.example/"
