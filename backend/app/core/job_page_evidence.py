"""Whether a retrieved page actually contains a job posting.

Fetching a URL successfully is not the same as finding a job on it, and the
importer had no way to tell the difference. Three real pages made that concrete.

An Ashby listing normalised to four characters — "Jobs" — because the posting is
drawn by client-side JavaScript the fetcher does not run. A Greenhouse job id
that has since moved served the company's *board index* instead, so the page read
"Jobs at The New York Times · Current openings", with no job on it at all. A
third did the same at 840 characters.

All three were reported as successful retrievals. Downstream, that is worse than
a failure: the model is handed a company blurb, and whatever it invents from it
becomes a draft the recruiter must then unpick. A truthful "we could not read a
job here, paste the text instead" costs them one paste; a fabricated draft costs
them a review of every field.

The test is deliberately about *evidence*, not hosts. A page carrying JobPosting
markup is a job page, full stop. Otherwise it has to read like one: enough text
to be a posting, and the section vocabulary postings actually use. A page that
instead advertises a list of openings — "13 jobs", "current openings", "create a
job alert" — without any of that vocabulary is an index, whoever serves it.
"""

from __future__ import annotations

import re
from typing import Final

#: Below this, nothing is a job description — it is a shell or an error page.
#:
#: Deliberately low. Length is only a proxy for "is there anything here at all";
#: the section vocabulary below is the real test. Setting this at 400 rejected a
#: terse but perfectly genuine posting of 378 characters, which is the wrong
#: mistake to make — a missed real listing costs more than a caught shell.
MIN_JOB_PAGE_CHARS: Final[int] = 200

#: Section vocabulary a real posting uses. Two of these is enough; requiring more
#: would reject terse but genuine listings, which are common on smaller boards.
_POSTING_SIGNALS: Final[tuple[str, ...]] = (
    r"responsibilit",
    r"qualification",
    r"requirement",
    r"what you'?ll do",
    r"what you will do",
    r"about the role",
    r"about this role",
    r"the role",
    r"who you are",
    r"your profile",
    r"we'?re looking for",
    r"we are looking for",
    r"years? of experience",
    r"experience (?:in|with)",
    r"skills",
    r"benefits",
    r"compensation",
    r"salary",
    r"job (?:type|description)",
    r"employment type",
    r"how to apply",
    r"apply now",
)

#: Wording that belongs to a list of openings rather than to one opening.
_INDEX_SIGNALS: Final[tuple[str, ...]] = (
    r"\b\d+\s+jobs?\b",
    r"current openings",
    r"all openings",
    r"open positions",
    r"create (?:a )?job alert",
    r"view all jobs",
    r"browse jobs",
    r"search jobs",
    r"join our talent",
    r"no jobs found",
)


def _count(patterns: tuple[str, ...], text: str) -> int:
    return sum(1 for pattern in patterns if re.search(pattern, text, re.IGNORECASE))


def page_holds_a_job(
    normalized_text: str | None,
    *,
    has_structured_job: bool = False,
) -> bool:
    """Whether this page is a job posting rather than an index or a shell.

    ``has_structured_job`` short-circuits everything: a page that declares
    JobPosting markup has told us what it is, and second-guessing that on prose
    would reject terse postings whose markup is perfectly good.
    """

    if has_structured_job:
        return True

    text = (normalized_text or "").strip()
    if len(text) < MIN_JOB_PAGE_CHARS:
        return False

    posting = _count(_POSTING_SIGNALS, text)
    index = _count(_INDEX_SIGNALS, text)

    # An index that also happens to mention "skills" once should still be an
    # index; a posting that mentions "view all jobs" in its footer should still
    # be a posting. Comparing the weight of each reads both correctly.
    if index and posting <= index:
        return False
    return posting >= 2
