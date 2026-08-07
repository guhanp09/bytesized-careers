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
