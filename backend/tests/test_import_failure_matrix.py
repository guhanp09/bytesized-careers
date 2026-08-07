"""Every way a retrieval can go wrong, and what the recruiter gets instead.

The benchmark left this matrix unwritten, which mattered: the defects it did find
were all cases where a failure looked like a success. A page that fetched but
held no job, a bot check reported as a sign-in wall, one stray provider field
discarding an entire extraction.

The through-line is that none of these may become recruiter work. Each must land
on a truthful classification, spend nothing on the provider, and leave the paste
path open.
"""

from __future__ import annotations

import ipaddress

import httpx
import pytest

from app.core.job_page_evidence import classify_job_page
from app.services.job_url_fetcher import PublicJobUrlFetcher, PublicJobUrlFetchError

pytestmark = pytest.mark.anyio


async def _public(_host: str, _port: int):
    return [ipaddress.ip_address("93.184.216.34")]


def _page(body: str, *, json_ld: str | None = None) -> bytes:
    script = f'<script type="application/ld+json">{json_ld}</script>' if json_ld else ""
    return f"<html><head><title>t</title>{script}</head><body>{body}</body></html>".encode()


async def _fetch(content: bytes | None = None, *, status: int = 200, exc: Exception | None = None):
    calls = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if exc is not None:
            raise exc
        return httpx.Response(status, headers={"content-type": "text/html"}, content=content or b"")

    fetcher = PublicJobUrlFetcher(resolver=_public, transport=httpx.MockTransport(handler))
    try:
        result = await fetcher.fetch("https://public.example/jobs/1")
        return result, None, calls["n"]
    except PublicJobUrlFetchError as error:
        return None, error, calls["n"]


POSTING_BODY = (
    "<h1>Video Editor</h1>"
    "<p>A production studio making long-form documentary work for broadcast.</p>"
    "<h2>About the role</h2><p>Cut weekly explainer videos.</p>"
    "<h2>Responsibilities</h2><p>Edit long-form and shorts.</p>"
    "<h2>Qualifications</h2><p>3+ years of experience with Premiere Pro.</p>"
    "<h2>Benefits</h2><p>Paid time off.</p>"
)

INDEX_BODY = (
    "<h1>Jobs at Northwind</h1><p>Current openings</p><p>Create a job alert</p>"
    "<p>13 jobs</p><p>Filter by team</p><p>Sort by date</p><p>View all jobs</p>"
)


class TestPagesThatCannotBecomeAJob:
    """Each lands on its own classification, and none reaches the provider."""

    async def test_an_empty_page_is_a_shell(self) -> None:
        _r, error, calls = await _fetch(_page(""))
        assert error is not None and calls == 1
        assert error.code in {"JOB_IMPORT_URL_NO_JOB_CONTENT", "JOB_IMPORT_URL_EMPTY_CONTENT"}

    async def test_a_tiny_spa_shell_is_a_shell(self) -> None:
        _r, error, _calls = await _fetch(_page("<div id='root'>Jobs</div>"))
        assert error is not None
        assert error.code == "JOB_IMPORT_URL_NO_JOB_CONTENT"

    async def test_a_challenge_page_says_the_site_declined(self) -> None:
        _r, error, _calls = await _fetch(
            _page("<p>Just a moment... checking your browser</p>"), status=403
        )
        assert error is not None
        assert error.code == "JOB_IMPORT_URL_ACCESS_DECLINED"
        assert "paste" in error.message.lower()

    async def test_a_sign_in_page_still_says_sign_in(self) -> None:
        _r, error, _calls = await _fetch(_page("<p>Please sign in</p>"), status=401)
        assert error is not None
        assert error.code == "JOB_IMPORT_URL_AUTH_REQUIRED"

    async def test_a_board_index_names_itself_as_several_jobs(self) -> None:
        _r, error, _calls = await _fetch(_page(INDEX_BODY))
        assert error is not None
        assert error.code == "JOB_IMPORT_URL_MULTIPLE_JOBS"
        assert "several jobs" in error.message

    async def test_an_ordinary_webpage_is_not_a_job(self) -> None:
        prose = "<p>" + "We build software for teams and care about craft. " * 12 + "</p>"
        _r, error, _calls = await _fetch(_page(prose))
        assert error is not None
        assert error.code == "JOB_IMPORT_URL_NO_JOB_CONTENT"


class TestStructuredDataDecidesWhenItCan:
    async def test_one_job_posting_is_imported(self) -> None:
        result, error, _calls = await _fetch(
            _page(POSTING_BODY, json_ld='{"@context":"https://schema.org","@type":"JobPosting","title":"Video Editor"}')
        )
        assert error is None and result is not None
        assert result.metadata["page_classification"] == "single_job"

    async def test_the_same_job_declared_twice_is_still_one_job(self) -> None:
        twice = (
            '[{"@context":"https://schema.org","@type":"JobPosting","title":"Video Editor"},'
            '{"@context":"https://schema.org","@type":"JobPosting","title":"Video Editor"}]'
        )
        result, error, _calls = await _fetch(_page(POSTING_BODY, json_ld=twice))
        assert error is None and result is not None
        assert result.metadata["page_classification"] == "single_job"

    async def test_several_different_jobs_are_refused(self) -> None:
        several = (
            '[{"@context":"https://schema.org","@type":"JobPosting","title":"Video Editor"},'
            '{"@context":"https://schema.org","@type":"JobPosting","title":"Motion Designer"},'
            '{"@context":"https://schema.org","@type":"JobPosting","title":"Producer"}]'
        )
        _r, error, _calls = await _fetch(_page(POSTING_BODY, json_ld=several))
        assert error is not None
        assert error.code == "JOB_IMPORT_URL_MULTIPLE_JOBS"

    async def test_malformed_json_ld_falls_back_to_the_prose(self) -> None:
        # Broken markup must not lose a page whose text reads perfectly well.
        result, error, _calls = await _fetch(_page(POSTING_BODY, json_ld="{not json"))
        assert error is None and result is not None
        assert result.metadata["page_classification"] == "single_job"


class TestNetworkFailuresStayTruthful:
    async def test_a_read_timeout_is_retried_then_reported(self) -> None:
        _r, error, calls = await _fetch(exc=httpx.ReadTimeout("stalled"))
        assert error is not None
        assert error.code == "JOB_IMPORT_URL_TIMEOUT"
        # Bounded: one retry, and no more.
        assert calls == 2

    async def test_a_connection_error_is_not_reported_as_a_job_problem(self) -> None:
        _r, error, _calls = await _fetch(exc=httpx.ConnectError("refused"))
        assert error is not None
        assert error.code != "JOB_IMPORT_URL_NO_JOB_CONTENT"

    async def test_a_server_error_is_a_retrieval_failure(self) -> None:
        _r, error, _calls = await _fetch(_page(POSTING_BODY), status=500)
        assert error is not None
        assert error.code == "JOB_IMPORT_URL_FETCH_FAILED"


class TestNothingUnreadableCanReachTheProvider:
    """The cost and quality guarantee, stated as a contract.

    Extraction is driven from stored source text, and unusable pages never
    become a source at all — the fetch raises first. So the proof is that every
    unusable classification refuses before any draft exists to extract from.
    """

    @pytest.mark.parametrize(
        ("body", "json_ld"),
        [
            (INDEX_BODY, None),
            ("<div id='root'>Jobs</div>", None),
            ("<p>Just a moment... checking your browser</p>", None),
            (
                POSTING_BODY,
                '[{"@context":"https://schema.org","@type":"JobPosting","title":"A"},'
                '{"@context":"https://schema.org","@type":"JobPosting","title":"B"}]',
            ),
        ],
    )
    async def test_an_unusable_page_never_yields_source_text(
        self, body: str, json_ld: str | None
    ) -> None:
        result, error, _calls = await _fetch(_page(body, json_ld=json_ld))

        assert result is None, "an unusable page must not produce importable text"
        assert error is not None
        # And the recruiter is always told what to do next.
        assert "paste" in error.message.lower()

    def test_only_single_job_is_extractable(self) -> None:
        for text, titles in (
            (INDEX_BODY, []),
            ("Jobs", []),
            ("Just a moment...", []),
            ("anything", ["A", "B"]),
        ):
            assert not classify_job_page(text, declared_job_titles=titles).may_extract
