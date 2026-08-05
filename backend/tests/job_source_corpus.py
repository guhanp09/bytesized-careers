"""Job pages, and what each one genuinely establishes.

Every round of this feature has followed the same shape: a recruiter finds one
question that the page had already answered, and one field gets fixed. That does
not converge, because nothing measures the class of defect — only instances of it.

This corpus is the measurement. Each entry pairs a realistic source with a
*golden manifest*: the facts the page states plainly, the facts it genuinely
omits, and the questions that must therefore never be asked. A false question is
then a number that can be driven to zero and held there.

The sources deliberately exercise the deterministic layer with **no model
output at all**. That is the case that matters: when extraction underperforms,
times out or comes back thin, the page's own structured data, its title and the
derivations between fields must still carry the draft. If the corpus passes with
an empty extraction, a degraded model run cannot become recruiter data entry.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class GoldenSource:
    """One page, and what it is allowed to ask about."""

    key: str
    #: What the page looks like. HTML goes through the real normaliser.
    html: str | None = None
    pasted_text: str | None = None
    title: str = ""

    #: Fields the page states plainly. Asking about any of these is a defect.
    established: dict[str, object] = field(default_factory=dict)
    #: Fields the page genuinely does not state. Asking is legitimate.
    absent: tuple[str, ...] = ()
    #: Fields the page states two ways. A one-click choice is legitimate.
    contested: tuple[str, ...] = ()
    #: Notes for whoever reads a failure.
    note: str = ""


def _page(json_ld: str, body: str, title: str) -> str:
    return (
        f"<html><head><title>{title}</title>"
        f'<script type="application/ld+json">{json_ld}</script>'
        f"</head><body>{body}</body></html>"
    )


_BOILERPLATE = (
    "<nav>Jobs Companies Salaries</nav>"
    "<div>We are an equal opportunity employer and consider all qualified "
    "applicants without regard to race.</div>"
    "<footer>Powered by Greenhouse. Privacy policy. Terms of service.</footer>"
)


# ---------------------------------------------------------------------------
# Boards and page shapes
# ---------------------------------------------------------------------------

GREENHOUSE_FULL = GoldenSource(
    key="greenhouse_full",
    title="Video Editor",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting",
        "title":"Video Editor","employmentType":"FULL_TIME",
        "hiringOrganization":{"@type":"Organization","name":"Northwind Studios",
        "description":"A studio producing weekly explainer videos for learners."},
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
        "addressLocality":"Bengaluru","addressRegion":"Karnataka","addressCountry":"IN"}},
        "baseSalary":{"@type":"MonetaryAmount","currency":"INR","value":
        {"@type":"QuantitativeValue","minValue":40000,"maxValue":60000,"unitText":"MONTH"}},
        "experienceRequirements":{"@type":"OccupationalExperienceRequirements",
        "monthsOfExperience":36}}""",
        "<h1>Video Editor</h1><p>Edit weekly explainers.</p>" + _BOILERPLATE,
        "Video Editor",
    ),
    established={
        "engagement_type": "full_time",
        "budget_currency": "INR",
        "budget_amount": 40000,
        "budget_max": 60000,
        "budget_unit": "per month",
        "compensation_mode": "range",
        "work_mode": "onsite",
        "experience_level": "3–5 years",
        "about_channel": "studio",
    },
    absent=("platforms", "start_timing"),
    note="A complete board listing. Almost nothing should be asked.",
)

SCHEMA_ORG_REMOTE = GoldenSource(
    key="schema_org_remote",
    title="Thumbnail Designer",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting",
        "title":"Thumbnail Designer","employmentType":"CONTRACTOR",
        "jobLocationType":"TELECOMMUTE",
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
        "addressLocality":"Mumbai","addressCountry":"IN"}},
        "hiringOrganization":{"@type":"Organization",
        "description":"A gaming channel publishing daily highlights and shorts."}}""",
        "<h1>Thumbnail Designer</h1><p>Remote role.</p>" + _BOILERPLATE,
        "Thumbnail Designer",
    ),
    established={"engagement_type": "ongoing_freelance", "work_mode": "remote"},
    absent=("budget_amount", "start_timing"),
    note="Remote must not inherit the office address as the job location.",
)

MISLABELLED_INTERNSHIP = GoldenSource(
    key="mislabelled_internship",
    title="AI Graphics Designer and Video Editor Intern 6 months onsite",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting",
        "title":"AI Graphics Designer and Video Editor Intern 6 months onsite",
        "employmentType":"FULL_TIME",
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
        "addressLocality":"Bangalore","addressRegion":"Karnataka","addressCountry":"IN"}}}""",
        "<h1>Internship Details</h1><p>Duration: 6 Months. "
        "Stipend: 15,000 per month. Work Mode: Onsite. "
        "Office Location: Brookefield, Bengaluru.</p>" + _BOILERPLATE,
        "AI Graphics Designer and Video Editor Intern 6 months onsite",
    ),
    established={
        "engagement_type": "internship",
        "work_mode": "onsite",
        "duration_value": 6,
    },
    contested=("location",),
    note="The real reported page. Its own structured data mislabels the engagement.",
)

SPARSE_LISTING = GoldenSource(
    key="sparse_listing",
    title="Editor wanted",
    pasted_text="Editor wanted for our channel. Get in touch.",
    established={},
    absent=(
        "budget_amount",
        "budget_unit",
        "compensation_mode",
        "work_mode",
        "engagement_type",
        "location",
    ),
    note="Genuinely says almost nothing. Asking here is correct behaviour.",
)

DETAILED_PASTE = GoldenSource(
    key="detailed_paste",
    title="Senior Video Editor",
    pasted_text=(
        "Senior Video Editor - Remote (India only)\n"
        "Finance Simplified is a YouTube channel explaining personal finance.\n"
        "Edit two long-form videos per week and six Instagram Reels.\n"
        "Requirements: 4-6 years editing experience. Premiere Pro, After Effects.\n"
        "Pay: 60,000 INR per month. Two revision rounds per video.\n"
        "There is no trial task. Apply on CreatorJobs with your reel."
    ),
    established={},
    absent=(),
    note="Rich pasted text. Used for the paste path rather than structured signals.",
)

BOILERPLATE_ONLY = GoldenSource(
    key="boilerplate_only",
    title="Designer",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting","title":"Designer",
        "hiringOrganization":{"@type":"Organization",
        "description":"We are an equal opportunity employer. Powered by Greenhouse."}}""",
        "<h1>Designer</h1>" + _BOILERPLATE,
        "Designer",
    ),
    established={},
    absent=("about_channel",),
    note="Board furniture must never be pre-filled as employer context.",
)

MULTI_JOB_PAGE = GoldenSource(
    key="multi_job_page",
    title="Motion Designer",
    html=_page(
        """[{"@context":"https://schema.org","@type":"WebSite","name":"Board"},
        {"@context":"https://schema.org","@type":"JobPosting","title":"Motion Designer",
        "employmentType":"PART_TIME",
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
        "addressLocality":"Pune","addressCountry":"IN"}}}]""",
        "<h1>Motion Designer</h1><aside>Other jobs: Video Editor, Copywriter</aside>"
        + _BOILERPLATE,
        "Motion Designer",
    ),
    established={"engagement_type": "part_time", "work_mode": "onsite"},
    absent=("budget_amount",),
    note="A board page listing other roles must not confuse the one being imported.",
)

MALFORMED_STRUCTURED_DATA = GoldenSource(
    key="malformed_structured_data",
    title="Scriptwriter",
    html=(
        "<html><head><title>Scriptwriter</title>"
        '<script type="application/ld+json">{"@type":"JobPosting", broken</script>'
        "</head><body><h1>Scriptwriter</h1><p>Write two scripts a week.</p>"
        + _BOILERPLATE
        + "</body></html>"
    ),
    established={},
    absent=("budget_amount", "work_mode"),
    note="A broken block must cost nothing and must not be treated as facts.",
)

CORPUS: tuple[GoldenSource, ...] = (
    GREENHOUSE_FULL,
    SCHEMA_ORG_REMOTE,
    MISLABELLED_INTERNSHIP,
    SPARSE_LISTING,
    DETAILED_PASTE,
    BOILERPLATE_ONLY,
    MULTI_JOB_PAGE,
    MALFORMED_STRUCTURED_DATA,
)
