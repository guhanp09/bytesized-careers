"""What kind of page came back, and whether one job can be read from it.

Fetching a URL successfully is not the same as finding a job on it. A live
benchmark across real boards produced three pages the importer treated as
successes while none contained a job: a client-rendered listing that normalised
to four characters, and two board indexes served when a job id had moved.

The first version of this module answered a yes/no question and answered it with
keyword heuristics — "current openings", "N jobs". That caught the cases in front
of it and missed the shape underneath: an aggregator search page carries the same
vocabulary a posting does, many times over, and passed.

So the question is now about *coherence* rather than vocabulary. A job page is
about one job: one title, one employer, one body of description. An index is
about many, and says so structurally — repeated title/company/location tuples,
a JobPosting object per card, pagination, filters. Counting how many jobs a page
is about separates them without knowing anything about who served it.

The caller gets a classification rather than a boolean, because the right
response differs: a blocked page and a multi-job page both need the recruiter,
but they need to be told different things.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Final, Literal

#: Below this, nothing is a job description — it is a shell or an error page.
#:
#: Deliberately low. Length is only a proxy for "is there anything here at all";
#: the section vocabulary below is the real test. At 400 it rejected a terse but
#: genuine 378-character posting, and a missed real listing costs more than a
#: caught shell.
MIN_JOB_PAGE_CHARS: Final[int] = 200

#: What the page turned out to be.
#:
#: Only ``single_job`` may reach the provider. The rest each need a different
#: sentence in front of the recruiter, which is why they are not collapsed into
#: one failure.
PageClass = Literal[
    "single_job",
    "multi_job_or_index",
    "blocked_or_challenge",
    "thin_or_shell",
    "not_a_job",
    "ambiguous",
]


@dataclass(frozen=True)
class PageEvidence:
    """The classification, and the evidence that produced it."""

    classification: PageClass
    #: Distinct job titles the page declares in markup.
    declared_jobs: int = 0
    posting_signals: int = 0
    index_signals: int = 0
    chars: int = 0
    reason: str = ""
    #: Populated for multi-job pages, so a caller can name what it saw.
    titles: list[str] = field(default_factory=list)

    @property
    def may_extract(self) -> bool:
        """Whether this page may be sent to the provider at all."""

        return self.classification == "single_job"


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

#: Structures that belong to a list of openings rather than to one opening.
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
    r"\bpost a job\b",
    r"\bfilter by\b",
    r"\bsort by\b",
    r"\bnext page\b",
    r"\bshowing \d+",
    r"\bload more\b",
    r"jobs? (?:platform|board)\b",
)

#: Wording a bot check or a login wall puts on the page instead of content.
_CHALLENGE_SIGNALS: Final[tuple[str, ...]] = (
    r"just a moment",
    r"checking your browser",
    r"enable javascript",
    r"verify (?:you are|you're) (?:a )?human",
    r"access denied",
    r"unusual traffic",
    r"security check",
)

_AUTH_SIGNALS: Final[tuple[str, ...]] = (
    r"\bsign in\b",
    r"\blog in\b",
    r"authentication required",
    r"create an account",
)

#: A repeated "Title · Company · Location" row is the shape of a results list.
_CARD_ROW = re.compile(r"^.{3,80}\n.{3,60}\n.{3,60}$", re.MULTILINE)


def _count(patterns: tuple[str, ...], text: str) -> int:
    return sum(1 for pattern in patterns if re.search(pattern, text, re.IGNORECASE))


def classify_job_page(
    normalized_text: str | None,
    *,
    declared_job_titles: list[str] | None = None,
    declared_job_identities: list[str] | None = None,
) -> PageEvidence:
    """Decide what this page is, from its own evidence.

    ``declared_job_titles`` are the distinct titles the page's JobPosting markup
    declares. One is the strongest possible evidence of a single job; several
    distinct ones are the strongest possible evidence of an index, and outrank
    prose either way because markup is unambiguous where prose is not.
    """

    text = (normalized_text or "").strip()
    # Deduplicated here as well as upstream: a page often repeats the same
    # posting for syndication, and "declared twice" is still one job.
    titles: list[str] = []
    for candidate in declared_job_titles or []:
        cleaned = " ".join(str(candidate).split()).strip()
        if cleaned and cleaned.casefold() not in {t.casefold() for t in titles}:
            titles.append(cleaned)
    identities = list(dict.fromkeys(str(item) for item in declared_job_identities or [] if item))
    declared_jobs = len(identities) if identities else len(titles)
    chars = len(text)

    def verdict(classification: PageClass, reason: str) -> PageEvidence:
        return PageEvidence(
            classification=classification,
            declared_jobs=declared_jobs,
            posting_signals=_count(_POSTING_SIGNALS, text),
            index_signals=_count(_INDEX_SIGNALS, text),
            chars=chars,
            reason=reason,
            titles=titles[:10],
        )

    # Several materially different roles in markup settles it, however the prose
    # reads. Importing "whichever came first" is how a thirty-role index used to
    # become one arbitrary draft.
    if declared_jobs > 1:
        return verdict("multi_job_or_index", "several distinct JobPosting records")

    if _count(_CHALLENGE_SIGNALS, text) and chars < 2000:
        return verdict("blocked_or_challenge", "the page shows a bot or browser check")

    if declared_jobs == 1:
        # Markup naming exactly one job is the clearest evidence there is.
        return verdict("single_job", "one JobPosting record")

    posting = _count(_POSTING_SIGNALS, text)
    index = _count(_INDEX_SIGNALS, text)

    if chars < MIN_JOB_PAGE_CHARS:
        if _count(_AUTH_SIGNALS, text):
            return verdict("blocked_or_challenge", "the page asks for sign-in")
        # A terse index is still an index. Checking length first classified a
        # compact board listing as an empty shell, which is the wrong sentence
        # to put in front of the recruiter: there is content, just not one job.
        if index >= 2:
            return verdict("multi_job_or_index", "the page advertises a list of openings")
        return verdict("thin_or_shell", "almost no readable content")

    # A results list repeats a compact title/company/location row. One posting
    # does not, however long it is.
    card_rows = len(_CARD_ROW.findall(text))

    if index >= 3 or (index and posting <= index):
        return verdict("multi_job_or_index", "the page advertises a list of openings")
    if card_rows >= 6 and posting < 4:
        return verdict("multi_job_or_index", "the page repeats job-card rows")

    if posting >= 2:
        return verdict("single_job", "the page reads as one posting")
    if posting == 1:
        # Something job-shaped, but not enough to be sure. Guessing either way
        # costs the recruiter — a wrong accept fabricates, a wrong reject loses
        # a real listing — so this is handed back undecided.
        return verdict("ambiguous", "too little evidence to be sure this is one job")
    return verdict("not_a_job", "no job-posting evidence on the page")


def page_holds_a_job(
    normalized_text: str | None,
    *,
    has_structured_job: bool = False,
    declared_job_titles: list[str] | None = None,
) -> bool:
    """Backwards-compatible boolean for callers that only need yes or no."""

    titles = declared_job_titles
    if titles is None and has_structured_job:
        titles = ["(declared)"]
    return classify_job_page(normalized_text, declared_job_titles=titles).may_extract
