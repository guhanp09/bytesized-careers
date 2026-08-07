"""A fetched page is not automatically a job posting.

Three real pages in a live benchmark proved this, and all three were reported as
successful retrievals.

An Ashby listing normalised to four characters — "Jobs" — because the posting is
drawn by client-side JavaScript. A Greenhouse job id that had moved served the
company's board index instead, so the page read "Jobs at The New York Times ·
Current openings" with no job on it. A third did the same at 840 characters.

Downstream, a successful-but-empty retrieval is worse than a failure: the model
is handed a company blurb and whatever it invents becomes a draft the recruiter
has to unpick. The fixtures below are sanitised to the *shape* that triggered
each case, not to the companies that happened to serve them.
"""

from __future__ import annotations

import pytest

from app.core.job_page_evidence import MIN_JOB_PAGE_CHARS, page_holds_a_job

REAL_POSTING = """
Video Editor
Hybrid / Remote: Boston, MA (Preferred)
Who are we?
A production studio making long-form documentary work.
About the role
You will cut long-form episodes and social versions.
Responsibilities
Edit episodes, build rough cuts, and hand off for colour.
Qualifications
3+ years of experience with Premiere Pro and After Effects.
Benefits
Health cover and paid time off.
"""

BOARD_INDEX = """
Jobs at Northwind
Current openings at Northwind
Create a Job Alert
Level-up your career by having opportunities sent to your inbox.
Search
13 jobs
Engineering
Marketing
Operations
View all jobs
"""

SPA_SHELL = "Jobs"


class TestARealPostingIsAccepted:
    def test_prose_alone_is_enough_when_it_reads_like_a_posting(self) -> None:
        # This page carries no JobPosting markup at all, so it has to pass on
        # its section vocabulary. Rejecting it would lose a genuine listing.
        assert page_holds_a_job(REAL_POSTING, has_structured_job=False)

    def test_structured_markup_settles_it_immediately(self) -> None:
        # A terse posting with good markup must not be second-guessed on prose.
        assert page_holds_a_job("Video Editor. Apply within.", has_structured_job=True)


class TestAPageWithoutAJobIsRefused:
    def test_a_board_index_is_not_a_posting(self) -> None:
        # It advertises a list of openings and describes none of them.
        assert not page_holds_a_job(BOARD_INDEX, has_structured_job=False)

    def test_a_client_rendered_shell_is_not_a_posting(self) -> None:
        assert not page_holds_a_job(SPA_SHELL, has_structured_job=False)

    @pytest.mark.parametrize("text", ["", "   ", None, "Not found", "404"])
    def test_nothing_useful_is_never_a_posting(self, text: str | None) -> None:
        assert not page_holds_a_job(text, has_structured_job=False)

    def test_the_floor_is_about_length_and_evidence_together(self) -> None:
        # Long enough, but saying nothing a posting says.
        filler = "This company builds software for teams. " * 20
        assert len(filler) > MIN_JOB_PAGE_CHARS
        assert not page_holds_a_job(filler, has_structured_job=False)


class TestTheRuleIsAboutEvidenceNotHosts:
    def test_a_posting_mentioning_the_board_in_its_footer_still_passes(self) -> None:
        # "View all jobs" in a footer must not outweigh a page full of posting
        # sections, or every board-hosted listing would be rejected.
        assert page_holds_a_job(REAL_POSTING + "\nView all jobs\n", has_structured_job=False)

    def test_an_index_mentioning_one_posting_word_still_fails(self) -> None:
        assert not page_holds_a_job(BOARD_INDEX + "\nSkills\n", has_structured_job=False)


class TestARefusedRequestSaysSo:
    """A site declining a bot is not a sign-in wall.

    Cloudflare answers "Just a moment..." with a 403, and the fetcher reported
    that as "This page requires sign-in", sending the recruiter to look for a
    password that would not have helped. 401 is genuinely authentication; 403
    here is a refusal, and the honest response points at the paste fallback.
    """

    @staticmethod
    async def _fetch(status: int):
        import ipaddress

        import httpx

        from app.services.job_url_fetcher import PublicJobUrlFetcher, PublicJobUrlFetchError

        async def public(_host: str, _port: int):
            return [ipaddress.ip_address("93.184.216.34")]

        fetcher = PublicJobUrlFetcher(
            resolver=public,
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    status, headers={"content-type": "text/html"}, content=b"Just a moment..."
                )
            ),
        )
        try:
            await fetcher.fetch("https://public.example/jobs/1")
        except PublicJobUrlFetchError as exc:
            return exc
        raise AssertionError("expected a fetch error")

    @pytest.mark.anyio
    async def test_a_bot_refusal_is_not_reported_as_sign_in(self) -> None:
        error = await self._fetch(403)

        assert error.code == "JOB_IMPORT_URL_ACCESS_DECLINED"
        assert "sign in" not in error.message.lower()
        assert "paste" in error.message.lower()

    @pytest.mark.anyio
    async def test_genuine_authentication_still_says_sign_in(self) -> None:
        error = await self._fetch(401)

        assert error.code == "JOB_IMPORT_URL_AUTH_REQUIRED"


class TestClassificationRatherThanYesOrNo:
    """The right response differs by *what* came back, so the class does too."""

    @staticmethod
    def _classify(text, declared_job_titles=None):
        from app.core.job_page_evidence import classify_job_page

        return classify_job_page(text, declared_job_titles=declared_job_titles)

    def test_one_declared_posting_is_a_single_job(self) -> None:
        result = self._classify("Video Editor. Apply within.", declared_job_titles=["Video Editor"])

        assert result.classification == "single_job"
        assert result.may_extract

    def test_several_distinct_postings_are_an_index(self) -> None:
        # Markup outranks prose: keeping only the first posting is how a page of
        # thirty roles used to import as one arbitrary draft.
        result = self._classify(
            REAL_POSTING,
            declared_job_titles=["Video Editor", "Motion Designer", "Producer"],
        )

        assert result.classification == "multi_job_or_index"
        assert not result.may_extract

    def test_the_same_job_declared_twice_is_still_one_job(self) -> None:
        # Pages repeat a posting for syndication; identical titles collapse.
        result = self._classify(REAL_POSTING, declared_job_titles=["Video Editor", "Video Editor"])

        assert result.classification == "single_job"

    def test_a_bot_check_is_named_as_such(self) -> None:
        result = self._classify("Just a moment... checking your browser")

        assert result.classification == "blocked_or_challenge"

    def test_a_sign_in_wall_is_a_block_not_a_shell(self) -> None:
        result = self._classify("Please log in to continue")

        assert result.classification == "blocked_or_challenge"

    def test_an_empty_shell_is_a_shell(self) -> None:
        assert self._classify("Jobs").classification == "thin_or_shell"

    def test_an_aggregator_search_page_is_an_index(self) -> None:
        # The regression this rewrite exists for: a search page carries posting
        # vocabulary many times over and passed the old keyword gate.
        aggregator = (
            "Remote Video Editor Jobs\nLog in\nPost a Job\n"
            "Filter by salary\nSort by date\nShowing 40 results\n"
            + "Video Editor\nAcme\nRemote\n" * 8
            + "Skills\nBenefits\n"
        )
        assert self._classify(aggregator).classification == "multi_job_or_index"

    def test_a_page_about_nothing_job_shaped_is_not_a_job(self) -> None:
        prose = "We make software for teams. Our values are curiosity and care. " * 8
        assert self._classify(prose).classification == "not_a_job"

    def test_only_a_single_job_may_reach_the_provider(self) -> None:
        for text, titles in (
            ("Jobs", []),
            ("Just a moment...", []),
            (REAL_POSTING, ["A", "B"]),
        ):
            assert not self._classify(text, declared_job_titles=titles).may_extract
