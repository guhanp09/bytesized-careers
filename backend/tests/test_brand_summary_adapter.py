"""The provider compresses bounded evidence; it never becomes the authority."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.integrations.openai.brand_summary_adapter import (
    BrandSummaryConfig,
    BrandSummaryProviderError,
    OpenAIBrandSummarizer,
)


class _Responses:
    def __init__(self, *, text: str | None = None, error: Exception | None = None) -> None:
        self.text = text
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return SimpleNamespace(output_text=self.text)


class _Client:
    def __init__(self, responses: _Responses) -> None:
        self.responses = responses


def _adapter(responses: _Responses, *, api_key: str | None = "test-key"):
    return OpenAIBrandSummarizer(
        BrandSummaryConfig(api_key=api_key, model="gpt-test"),
        client=_Client(responses),
    )


@pytest.mark.asyncio
async def test_summary_uses_bounded_evidence_without_provider_storage() -> None:
    responses = _Responses(text="  Finance Simplified publishes finance videos.  ")
    result = await _adapter(responses).summarize(
        brand_name="Finance Simplified " * 20,
        evidence="E" * 5000,
        job_context="video editor | finance " * 80,
        source_authority="discovered_official_site",
    )

    assert result == "Finance Simplified publishes finance videos."
    request = responses.calls[0]
    assert request["model"] == "gpt-test"
    assert request["max_output_tokens"] == 1000
    assert request["store"] is False
    sent = str(request["input"])
    assert "Evidence authority: discovered_official_site" in sent
    assert "Job context for relevance only (not a factual source):" in sent
    assert len(sent.split("Brand evidence:\n", 1)[1]) == 4000
    assert len(sent.split("Brand name: ", 1)[1].split("\n", 1)[0]) <= 160


@pytest.mark.asyncio
async def test_unconfigured_or_failed_summary_returns_nothing() -> None:
    unconfigured = _Responses(error=AssertionError("must not call provider"))
    assert (
        await _adapter(unconfigured, api_key=None).summarize(
            brand_name="Finance Simplified", evidence="enough evidence"
        )
        is None
    )
    assert unconfigured.calls == []

    failed = _Responses(error=RuntimeError("provider down"))
    with pytest.raises(BrandSummaryProviderError):
        await _adapter(failed).summarize(
            brand_name="Finance Simplified", evidence="enough evidence"
        )
    assert len(failed.calls) == 1
