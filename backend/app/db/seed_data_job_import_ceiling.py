"""A reported page that states a ceiling and no floor, sanitised to its shape.

The reported listing was headed ``Up to ₹20,000 a month``. It reached the
recruiter with no pay at all, a question asking what the role pays, and a
candidate preview reading "Compensation not specified · Up to". The model had
understood the qualifier — its note said so — and there was nowhere in
CreatorJobs for a maximum without a minimum to live.

**This is also the worked example of the reported-URL workflow.** When a user
reports a public job URL, the regression it deserves is not a copy of the page.
It is the page's *shape*: which facts sit under labels, which are bare lines,
what the markup says, and where the two disagree. Everything else is somebody's
copyright and somebody's contact details.

So the sanitisation rules, applied here and to be applied to every future report:

* the employer name is replaced with an invented one;
* the URL is an ``example.invalid`` host;
* any contact route — email, phone, form — is dropped entirely;
* free-form prose is rewritten to a generic equivalent of the same length and
  structure, never quoted;
* every *structural* property that caused the failure is preserved exactly: the
  qualifier wording, the absence of a pay label, the ordering of the lines, and
  the markup's silence.

The page is built through the real normaliser rather than transcribed, so a
fixture can never describe a shape the fetcher would not actually produce.
"""

from __future__ import annotations

from typing import Any

from app.services.job_url_fetcher import normalize_public_job_html

CEILING_ONLY_PAY_URL = "https://example.invalid/jobs/freelance-video-editor"

#: Markup that says nothing at all about pay — as the reported page's did.
#: The compensation exists only in the visible copy, and only as a qualifier.
_JSON_LD = """
{"@context":"https://schema.org","@type":"JobPosting",
 "title":"Freelance Video Editor",
 "hiringOrganization":{"@type":"Organization","name":"Finance Simplified"},
 "employmentType":"CONTRACTOR",
 "jobLocationType":"TELECOMMUTE"}
"""

#: The employer's own copy. Pay is a bare line with a qualifier and no label —
#: the single structural property the label reader could not see.
_BODY = """
<h1>Freelance Video Editor</h1>
<p>Finance Simplified</p>
<p>Up to ₹20,000 a month</p>
<p>Remote</p>
<p>Job Type: Freelance</p>
<h2>About the role</h2>
<p>A finance education channel publishing short explainers for new investors.</p>
<h2>What you will do</h2>
<ul>
  <li>Edit raw footage into finished videos including reels and shorts.</li>
  <li>Perform colour correction, grading and audio cleanup.</li>
  <li>Build simple motion graphics for recurring segments.</li>
  <li>Prepare thumbnails from supplied artwork.</li>
</ul>
<h2>Requirements</h2>
<p>Comfortable with short-form editing and able to work to a weekly cycle.
Own a machine capable of handling 4K footage.</p>
"""

CEILING_ONLY_PAY_HTML = (
    f"<html><head><title>Freelance Video Editor</title>"
    f'<script type="application/ld+json">{_JSON_LD}</script></head>'
    f"<body>{_BODY}</body></html>"
)


def ceiling_only_pay_page() -> tuple[str, dict[str, Any]]:
    """The page as the fetcher hands it on: normalised text and metadata."""

    text, _title, metadata = normalize_public_job_html(
        CEILING_ONLY_PAY_HTML, final_url=CEILING_ONLY_PAY_URL
    )
    return text, metadata


CEILING_ONLY_PAY_SOURCE_TEXT, CEILING_ONLY_PAY_METADATA = ceiling_only_pay_page()
CEILING_ONLY_PAY_STRUCTURED_CONTEXT: dict[str, Any] = (
    CEILING_ONLY_PAY_METADATA.get("structured_context") or {}
)
