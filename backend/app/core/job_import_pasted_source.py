"""Turning what a recruiter pasted into the same evidence a fetched page becomes.

A public URL and a paste differ in exactly one thing: how CreatorJobs obtains the
words. After that they are the same string — ``JobImportSource.original_text`` —
and everything intelligent in this product reads that string: the evidence spans,
the whole-job provider contract, the deterministic signal readers, reconciliation,
the question planner, native conversion.

So the pasted path needs no intelligence of its own. What it needs is for the
string to arrive in the same condition, prepared by the same side of the wire.
Three things were missing, and each is a way for a paste to be understood less
well than the identical job read from a page.

**Normalization was the client's job.** The URL path normalizes on the server
inside the fetcher; the pasted path normalized in React and the server stored
whatever arrived. Every deterministic reader downstream — weekly hours, the
experience grammar, location resolution — is written against normalized text, so
a non-breaking space or a CRLF from a copied email quietly weakened them, and
only for pastes. The browser still normalizes, for the character counter and so
the recruiter sees what will be read; this module makes that a convenience rather
than the contract.

**Nothing asked what the paste was.** A fetched page is classified before it may
reach the provider, because a board index is not a job and neither is a login
wall. A paste went straight through, so three roles pasted together became one
listing that never existed. The same classifier answers that here — with a
narrower rejection, because the two cases are not symmetrical: a URL that turns
out to be an index is a wrong link, while a short paste is usually a recruiter
deliberately writing a brief in their own words, and refusing that would be
refusing the product's own ``rough_description`` source type.

**A paste could impersonate the server.** The fetcher writes ``Structured job
title: …`` lines from a page's schema.org markup, and the provider contract
treats those lines as explicit publisher data rather than prose. Nothing stopped
pasted text from containing the same prefix. Copy a job post that carries those
words and the strongest evidence class in the system is being written by whoever
wrote the source — which is the one thing evidence authority must never allow.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

from app.core.job_page_evidence import PageEvidence, classify_job_page

#: Source kinds whose text a recruiter supplies directly.
#:
#: ``public_url`` is deliberately absent: its text is composed by the fetcher,
#: which is the server, and the reserved labels below are the fetcher's own.
RECRUITER_SUPPLIED_TEXT_TYPES: Final[frozenset[str]] = frozenset(
    {"pasted_text", "rough_description", "external_listing_text"}
)

#: Typographic bullet glyphs, unified so segmentation sees one bullet syntax
#: rather than fourteen.
_BULLET_RE = re.compile("^[ \t]*(?:[\u2022\u25cf\u25aa\u25b8\u25b6\u2023\u25e6"
                        "\u00b7\u2605\u2666\u25a0\u25a1\u25cb\u2013\u2014*-])+[ \t]+")

#: A run of pictographs opening a line, as a hiring post writes it.
#:
#: LinkedIn and WhatsApp posts label their rows with emoji — a money bag before
#: the pay, an hourglass before the experience. They are decoration in the exact
#: sense that matters here: the line beneath them is a labelled row, and reading
#: it as one is how "Experience: 1 to 2 years" settles a field instead of
#: becoming a sentence nobody parsed. Only a leading run is removed; an emoji
#: inside a sentence is the recruiter's writing and stays.
_LEADING_PICTOGRAPHS = re.compile(
    "^[ \t]*(?:[\u2190-\u21ff\u2300-\u27bf\u2b00-\u2bff\ufe0f\u20e3"
    "\U0001f000-\U0001faff]+[ \t]*)+"
)

#: Control and zero-width characters. Invisible, and they break every regex that
#: expects a word boundary where one visibly exists.
_STRIP_RE = re.compile(
    "[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\u2060\ufeff]"
)

_NBSP_RE = re.compile("[\u00a0\u2007\u202f]")
_SINGLE_QUOTES_RE = re.compile("[\u2018\u2019\u2032]")
_DOUBLE_QUOTES_RE = re.compile("[\u201c\u201d\u2033]")

#: The label prefix the fetcher owns.
#:
#: Matched at line start only, and only in text a recruiter supplied. The
#: replacement keeps every word the source actually contains — nothing is
#: censored — and removes only the claim that the server wrote the line.
_RESERVED_LABEL_RE = re.compile(r"^[ \t]*Structured\s+(?=\S)", re.IGNORECASE)

#: What a paste is called when it is not one job. Paste wording, not page
#: wording: "open the specific job" is advice for a link.
PASTE_REJECTION_MESSAGES: Final[dict[str, str]] = {
    "multi_job_or_index": (
        "That looks like several jobs rather than one. Paste a single job and "
        "I'll prepare it — you can import the others separately."
    ),
    "not_a_job": (
        "I couldn't find a job description in that text. Paste the job details "
        "and I'll continue from them."
    ),
}

PASTE_REJECTION_CODES: Final[dict[str, str]] = {
    "multi_job_or_index": "JOB_IMPORT_TEXT_MULTIPLE_JOBS",
    "not_a_job": "JOB_IMPORT_TEXT_NO_JOB_CONTENT",
}

#: Wording that says someone is hiring, even when nothing else on the page does.
#:
#: The page classifier looks for the sections a published listing has —
#: responsibilities, qualifications, benefits. A recruiter typing into WhatsApp
#: writes none of them and is still unmistakably hiring. Without this, "Need a
#: video editor for our channel, DM me" reads as non-job content, and refusing it
#: would be refusing the shortest legitimate way to start a job.
_HIRING_INTENT: Final[tuple[str, ...]] = (
    r"\b(?:we(?:'re| are)?|now|currently)\s+hiring\b",
    r"\bhiring\s+(?:a|an|for|now)\b",
    r"\blooking\s+for\s+(?:a|an|someone|talented|experienced)\b",
    r"\b(?:need|want|seeking|wanted)\s+(?:a|an|experienced|talented)\b",
    r"\bjoin\s+(?:our|the|my)\s+(?:team|channel|studio|agency)\b",
    r"\b(?:vacancy|vacancies|opening for|position for|job opening)\b",
    r"\b(?:apply|dm|message|reach out|get in touch)\b",
    r"\b(?:freelance|full[- ]time|part[- ]time|internship|contract)\s+"
    r"(?:role|position|opportunity|gig)\b",
    r"\b(?:editor|designer|writer|manager|producer|animator|videographer|"
    r"strategist|marketer)\s+(?:wanted|needed|required)\b",
)


def neutralize_reserved_source_labels(text: str) -> str:
    """Strip the server's own evidence label from lines it did not write.

    Server-labelled ``Structured …`` lines carry publisher authority in the
    provider contract. A source that writes them itself is claiming an authority
    the transport is supposed to grant, so the claim is removed while the words
    stay: the sentence is still evidence, just ordinary evidence, judged on what
    it says like every other line.
    """

    if "structured" not in text.casefold():
        return text
    return "\n".join(
        _RESERVED_LABEL_RE.sub("", line) if _RESERVED_LABEL_RE.match(line) else line
        for line in text.split("\n")
    )


def normalize_pasted_source_text(raw: str | None) -> str:
    """The server's own normalization of recruiter-supplied text.

    Deliberately identical in effect to the browser's, and idempotent, so text
    that arrived through the product is unchanged and text that arrived any other
    way is brought to the same shape. Newlines survive: they are how a paste
    carries its structure, and the evidence segmenter reads them.
    """

    if not raw:
        return ""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = _STRIP_RE.sub("", text)
    text = _NBSP_RE.sub(" ", text)
    text = _SINGLE_QUOTES_RE.sub("'", text)
    text = _DOUBLE_QUOTES_RE.sub('"', text)

    lines: list[str] = []
    for line in text.split("\n"):
        # Bullets first: several bullet glyphs live inside the pictograph
        # blocks below, and a list marker is a list marker rather than
        # decoration.
        cleaned = _BULLET_RE.sub("- ", line)
        cleaned = _LEADING_PICTOGRAPHS.sub("", cleaned)
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
        lines.append(cleaned.rstrip(" \t"))
    return neutralize_reserved_source_labels("\n".join(lines)).strip()


@dataclass(frozen=True)
class PasteAdmission:
    """Whether pasted text may become an import source."""

    admitted: bool
    evidence: PageEvidence
    code: str = ""
    message: str = ""


def _has_hiring_intent(text: str) -> bool:
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in _HIRING_INTENT)


def admit_pasted_source(text: str) -> PasteAdmission:
    """Decide whether a paste is one job, using the accepted page classifier.

    Only two verdicts refuse, and both are the failure the classifier exists to
    prevent rather than a judgement about how much the recruiter wrote:

    * several jobs — merging them fabricates a listing nobody posted, and the
      recruiter cannot tell which parts came from which role;
    * no job at all — a résumé, an article, a marketing page.

    Everything the classifier calls thin or ambiguous is admitted. A page that
    thin is a failed retrieval; text that thin is a recruiter who typed one
    sentence, which this product supports on purpose, and the assistant's job
    from there is to ask — not to refuse the source.
    """

    evidence = classify_job_page(text)
    classification = evidence.classification

    if classification == "multi_job_or_index":
        return PasteAdmission(
            False,
            evidence,
            PASTE_REJECTION_CODES["multi_job_or_index"],
            PASTE_REJECTION_MESSAGES["multi_job_or_index"],
        )

    if classification in {"not_a_job", "blocked_or_challenge"} and not _has_hiring_intent(
        text
    ):
        # `blocked_or_challenge` means a bot check was pasted instead of a job.
        # It reaches the recruiter as "no job description", because that is what
        # it is to them; naming the challenge would describe a page they were
        # never told they were fetching.
        return PasteAdmission(
            False,
            evidence,
            PASTE_REJECTION_CODES["not_a_job"],
            PASTE_REJECTION_MESSAGES["not_a_job"],
        )

    return PasteAdmission(True, evidence)
