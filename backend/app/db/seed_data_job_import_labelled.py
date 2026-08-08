"""One sanitised page whose markup contradicts its own copy, defined once.

The structure this preserves came from a real import that went wrong in four
ways at the same time: no pay at all, an engagement of "internship" for a paid
freelance brief, an empty Work section on a page full of work, and a question
asking how pay was measured about a page that printed its rate.

None of that was a reasoning failure. The syndicated JSON-LD carried no
compensation and declared ``employmentType: INTERN``, while the employer's own
visible copy said ``Compensation ₹5,000 / mo`` and ``Type Part-time / Freelance``.
Reading the markup faithfully is what produced the wrong draft.

It lives here rather than in a test because the browser needs it too. A fixture
that only the backend suite can reach proves the reconciliation and nothing
about what a recruiter is shown, and the recruiter-facing half is where this
defect was actually reported. Defining the page once means the deterministic
E2E path and the unit tests cannot drift into testing different pages.

The employer, the URL and the contact address are invented. Everything that
caused the failure — the contradiction, the labelled rows, the compound
application paragraph — is kept exactly.
"""

from __future__ import annotations

from typing import Any

from app.services.job_url_fetcher import normalize_public_job_html

LABELLED_PAY_URL = (
    "https://example.invalid/jobs/paid-content-creator-social-media-manager"
)

#: Markup that is silent about pay and wrong about engagement.
_JSON_LD = """
{"@context":"https://schema.org","@type":"JobPosting",
 "title":"(Paid) Content Creator & Social Media Manager",
 "hiringOrganization":{"@type":"Organization","name":"Larkfield Studio"},
 "employmentType":"INTERN",
 "jobLocationType":"TELECOMMUTE",
 "applicantLocationRequirements":{"@type":"Country","name":"IN"}}
"""

#: The employer's own copy, which contradicts the markup on both counts.
_BODY = """
<h1>(Paid) Content Creator &amp; Social Media Manager</h1>
<p>Larkfield Studio</p>
<dl>
  <dt>Compensation</dt><dd>₹5,000 / mo</dd>
  <dt>Type</dt><dd>Part-time / Freelance</dd>
  <dt>Location</dt><dd>Remote-friendly</dd>
  <dt>Deadline</dt><dd>Rolling — apply early</dd>
</dl>
<h2>About the role</h2>
<p>Own our social presence across Instagram, X and YouTube Shorts.</p>
<h2>Responsibilities</h2>
<ul>
  <li>Concept, shoot and edit 4–6 Reels per month.</li>
  <li>Design static feed and carousel posts.</li>
  <li>Write captions and short-form copy in English and Hinglish.</li>
  <li>Run community management and reply to comments.</li>
  <li>Plan drop campaigns and reshare UGC.</li>
  <li>Maintain hashtag and SEO strategy.</li>
  <li>Send a weekly performance report.</li>
</ul>
<h2>Requirements</h2>
<p>Basic video editing in CapCut or InShot. Flexible hours, creative ownership.</p>
<h2>How to apply</h2>
<p>Send your Instagram handle or examples of social work, two caption examples,
and a one-line answer to: which Indian pop-culture moment would you turn into a
Reel? Email everything to hiring@larkfield.invalid.</p>
"""

LABELLED_PAY_HTML = (
    f"<html><head><title>Content Creator</title>"
    f'<script type="application/ld+json">{_JSON_LD}</script></head>'
    f"<body>{_BODY}</body></html>"
)


def labelled_pay_page() -> tuple[str, dict[str, Any]]:
    """The page as the fetcher would hand it on: normalised text and metadata.

    Produced by the real normaliser rather than transcribed, so the fixture
    cannot describe a page shape the fetcher would never actually produce.
    """

    text, _title, metadata = normalize_public_job_html(
        LABELLED_PAY_HTML, final_url=LABELLED_PAY_URL
    )
    return text, metadata


LABELLED_PAY_SOURCE_TEXT, LABELLED_PAY_METADATA = labelled_pay_page()
LABELLED_PAY_STRUCTURED_CONTEXT: dict[str, Any] = (
    LABELLED_PAY_METADATA.get("structured_context") or {}
)
