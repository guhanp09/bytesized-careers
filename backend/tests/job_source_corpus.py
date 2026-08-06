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
    #: A realistic reading of the page's prose, as a model would return it.
    #:
    #: The corpus runs twice: once with nothing from the model, proving the
    #: deterministic layer alone carries the draft; and once with this, proving
    #: precedence between a visible statement and a structured claim. Facts that
    #: only exist in prose are declared here rather than pretended to be
    #: deterministic.
    model_fields: dict[str, object] = field(default_factory=dict)
    #: Values the page states two ways, as competing candidates with evidence.
    model_conflicts: dict[str, tuple[object, ...]] = field(default_factory=dict)
    #: Facts only reachable once the model has read the prose.
    established_with_model: dict[str, object] = field(default_factory=dict)

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
    model_conflicts={
        "location": ("Bangalore, Karnataka, IN", "Brookefield, Bengaluru"),
    },
    contested=("location",),
    note="The real reported page. Its own structured data mislabels the engagement, "
    "and names the office at two levels of detail.",
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

# ---------------------------------------------------------------------------
# Board shapes without structured data: the model reads the prose, and the
# deterministic layer must not contradict or discard it.
# ---------------------------------------------------------------------------

GREENHOUSE_NO_JSONLD = GoldenSource(
    key="greenhouse_no_jsonld",
    title="Podcast Editor",
    html=(
        "<html><head><title>Podcast Editor</title></head><body>"
        "<h1>Podcast Editor</h1>"
        "<div><h2>About Northwind Audio</h2><p>We produce a weekly interview "
        "podcast about climate technology for a general audience.</p></div>"
        "<h2>What you'll do</h2><ul><li>Edit two episodes per week</li>"
        "<li>Clean dialogue and balance levels</li></ul>"
        "<h2>Details</h2><p>Full-time. Remote. USD 4,000 per month.</p>"
        + _BOILERPLATE
        + "</body></html>"
    ),
    model_fields={
        "engagement_type": "full_time",
        "work_mode": "remote",
        "budget_amount": 4000,
        "budget_currency": "USD",
        "budget_unit": "per month",
        "about_channel": "We produce a weekly interview podcast about climate technology.",
    },
    established_with_model={
        "engagement_type": "full_time",
        "work_mode": "remote",
        "budget_amount": 4000,
        "budget_currency": "USD",
        "budget_unit": "per month",
        "compensation_mode": "fixed",
    },
    absent=("start_timing", "platforms"),
    note="A board page with no machine-readable data at all.",
)

GREENHOUSE_CONTRADICTORY = GoldenSource(
    key="greenhouse_contradictory",
    title="Scriptwriter",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting","title":"Scriptwriter",
        "employmentType":"FULL_TIME","jobLocationType":"TELECOMMUTE"}""",
        "<h1>Scriptwriter</h1><p>This is a part-time contract role, three days "
        "a week onsite in our Pune studio.</p>" + _BOILERPLATE,
        "Scriptwriter",
    ),
    model_conflicts={
        "work_mode": ("remote", "onsite"),
        "engagement_type": ("full_time", "part_time"),
    },
    contested=("work_mode", "engagement_type"),
    absent=("budget_amount",),
    note="Structured data and visible prose genuinely disagree. Ask, with options.",
)

LEVER_POSTING = GoldenSource(
    key="lever_posting",
    title="Social Media Manager",
    html=(
        "<html><head><title>Social Media Manager</title></head><body>"
        "<div class='posting-headline'><h2>Social Media Manager</h2>"
        "<div class='sort-by-time'><span>Bengaluru</span><span>Marketing</span>"
        "<span>Full-time</span></div></div>"
        "<div class='section'><h3>About us</h3><p>Loop Studio runs short-form "
        "channels for consumer brands across Instagram and YouTube.</p></div>"
        "<div class='section'><h3>Requirements</h3><ul><li>Three years managing "
        "brand social accounts</li></ul></div>"
        "<div class='section'><h3>Compensation</h3><p>INR 90,000 per month</p></div>"
        "<footer>Powered by Lever. Privacy policy.</footer></body></html>"
    ),
    model_fields={
        "engagement_type": "full_time",
        "location": "Bengaluru",
        "budget_amount": 90000,
        "budget_currency": "INR",
        "budget_unit": "per month",
        "platforms": ["instagram", "youtube"],
    },
    established_with_model={
        "engagement_type": "full_time",
        "budget_amount": 90000,
        "budget_currency": "INR",
        "budget_unit": "per month",
        "compensation_mode": "fixed",
        "platforms": ["instagram", "youtube"],
    },
    absent=("start_timing",),
    note="Lever's grouped-section shape with board furniture in the footer.",
)

ASHBY_POSTING = GoldenSource(
    key="ashby_posting",
    title="Creator Strategist",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting",
        "title":"Creator Strategist","employmentType":"FULL_TIME",
        "jobLocationType":"TELECOMMUTE",
        "hiringOrganization":{"@type":"Organization",
        "description":"A creator-economy studio helping founders build audiences."},
        "baseSalary":{"@type":"MonetaryAmount","currency":"USD","value":
        {"@type":"QuantitativeValue","value":90000,"unitText":"YEAR"}}}""",
        "<h1>Creator Strategist</h1><p>Own channel strategy end to end.</p>"
        "<footer>Powered by Ashby</footer>",
        "Creator Strategist",
    ),
    established={
        "engagement_type": "full_time",
        "work_mode": "remote",
        "budget_amount": 90000,
        "budget_currency": "USD",
        "budget_unit": "per year",
        "compensation_mode": "fixed",
    },
    absent=("platforms",),
    note="A single salary figure must settle fixed mode without asking.",
)

WORKDAY_SHELL = GoldenSource(
    key="workday_shell",
    title="Motion Designer",
    html=_page(
        """{"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList"},
        {"@type":"JobPosting","title":"Motion Designer","employmentType":"PART_TIME",
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
        "addressLocality":"Gurgaon","addressRegion":"Haryana","addressCountry":"IN"}},
        "hiringOrganization":{"@type":"Organization",
        "description":"An in-house brand team producing campaign films."}}]}""",
        "<div id='root'></div><noscript>Enable JavaScript</noscript>"
        "<h1>Motion Designer</h1><p>Requisition R-4471. Gurgaon. Gurgaon.</p>"
        + _BOILERPLATE,
        "Motion Designer",
    ),
    established={"engagement_type": "part_time", "work_mode": "onsite"},
    absent=("budget_amount", "start_timing"),
    note="A client-rendered shell whose public payload is still readable, with "
    "a repeated location that must not become a conflict.",
)

SMARTRECRUITERS_POSTING = GoldenSource(
    key="smartrecruiters_posting",
    title="Graphic Designer",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting",
        "title":"Graphic Designer","employmentType":"CONTRACTOR",
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
        "addressLocality":"Chennai","addressCountry":"IN"}},
        "datePosted":"2026-07-01","validThrough":"2026-09-30",
        "hiringOrganization":{"@type":"Organization",
        "description":"A design studio serving education publishers."}}""",
        "<h1>Graphic Designer</h1><h2>Job Description</h2><p>Design covers and "
        "social assets.</p><h2>Qualifications</h2><p>Two years in publishing.</p>"
        + _BOILERPLATE,
        "Graphic Designer",
    ),
    established={"engagement_type": "ongoing_freelance", "work_mode": "onsite"},
    absent=("budget_amount",),
    note="Description and qualifications must survive boilerplate stripping.",
)

CUSTOM_PROSE_PAGE = GoldenSource(
    key="custom_prose_page",
    title="Video Editor for a cooking channel",
    html=(
        "<html><head><title>Video Editor for a cooking channel</title></head><body>"
        "<nav>Home About Careers</nav>"
        "<h1>Video Editor for a cooking channel</h1>"
        "<h2>About Saffron Kitchen</h2><p>We publish weekly recipe films on "
        "YouTube for home cooks in India.</p>"
        "<h2>The work</h2><ul><li>Edit one 12-minute film each week</li>"
        "<li>Cut three Shorts from each film</li></ul>"
        "<h2>Terms</h2><p>We pay 35,000 rupees per month. Fully remote within "
        "India. Start as soon as possible.</p>"
        "<footer>Privacy policy. Terms of service.</footer></body></html>"
    ),
    model_fields={
        "budget_amount": 35000,
        "budget_currency": "INR",
        "budget_unit": "per month",
        "work_mode": "remote",
        "start_timing": "immediate",
        "platforms": ["youtube"],
        "about_channel": "We publish weekly recipe films on YouTube for home cooks.",
    },
    established_with_model={
        "budget_amount": 35000,
        "budget_currency": "INR",
        "budget_unit": "per month",
        "compensation_mode": "fixed",
        "work_mode": "remote",
        "start_timing": "immediate",
        "platforms": ["youtube"],
    },
    absent=("engagement_type",),
    note="A custom employer page with no structured data and pay in prose.",
)

AMOUNT_WITHOUT_CURRENCY = GoldenSource(
    key="amount_without_currency",
    title="Thumbnail Designer",
    pasted_text=(
        "Thumbnail Designer for a gaming channel.\n"
        "We pay 500 per thumbnail. Remote."
    ),
    model_fields={"budget_amount": 500, "budget_unit": "per thumbnail", "work_mode": "remote"},
    established_with_model={
        "budget_amount": 500,
        "budget_unit": "per thumbnail",
        "compensation_mode": "fixed",
    },
    absent=("budget_currency",),
    note="Amount and unit known, currency genuinely absent: ask only currency.",
)

CURRENCY_WITHOUT_UNIT = GoldenSource(
    key="currency_without_unit",
    title="Scriptwriter",
    pasted_text="Scriptwriter wanted. Budget is INR 20,000. Remote role.",
    model_fields={"budget_amount": 20000, "budget_currency": "INR", "work_mode": "remote"},
    established_with_model={
        "budget_amount": 20000,
        "budget_currency": "INR",
        "compensation_mode": "fixed",
    },
    absent=("budget_unit",),
    note="Amount and currency known, unit genuinely absent: ask only the unit.",
)

PAY_RANGE_PASTE = GoldenSource(
    key="pay_range_paste",
    title="Creator Strategist",
    pasted_text=(
        "Creator Strategist. Compensation: USD 80,000 to 100,000 per year. "
        "Fully remote."
    ),
    model_fields={
        "budget_amount": 80000,
        "budget_max": 100000,
        "budget_currency": "USD",
        "budget_unit": "per year",
        "work_mode": "remote",
    },
    established_with_model={
        "budget_amount": 80000,
        "budget_max": 100000,
        "compensation_mode": "range",
        "budget_currency": "USD",
    },
    note="Two ordered amounts settle range mode without asking.",
)

NEGOTIABLE_PAY = GoldenSource(
    key="negotiable_pay",
    title="Social Media Manager",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting",
        "title":"Social Media Manager","employmentType":"PART_TIME",
        "baseSalary":"Not disclosed",
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
        "addressLocality":"Mumbai","addressCountry":"IN"}}}""",
        "<h1>Social Media Manager</h1><p>Pay is negotiable.</p>" + _BOILERPLATE,
        "Social Media Manager",
    ),
    established={"compensation_mode": "negotiable", "engagement_type": "part_time"},
    absent=("budget_amount",),
    note="A page that declines to state pay has answered the question.",
)

NON_CREATOR_ROLE = GoldenSource(
    key="non_creator_role",
    title="Financial Analyst",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting",
        "title":"Financial Analyst","employmentType":"FULL_TIME",
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
        "addressLocality":"Hyderabad","addressCountry":"IN"}},
        "hiringOrganization":{"@type":"Organization",
        "description":"A treasury services firm serving mid-market lenders."}}""",
        "<h1>Financial Analyst</h1><p>Build cash-flow models.</p>" + _BOILERPLATE,
        "Financial Analyst",
    ),
    established={"engagement_type": "full_time", "work_mode": "onsite"},
    absent=("primary_role_key", "platforms"),
    note="No creator craft applies. The role must not be forced to one.",
)

DEADLINE_AND_START = GoldenSource(
    key="deadline_and_start",
    title="Video Editor",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting","title":"Video Editor",
        "employmentType":"CONTRACTOR","validThrough":"2026-12-31",
        "jobLocationType":"TELECOMMUTE",
        "baseSalary":{"@type":"MonetaryAmount","currency":"GBP","value":
        {"@type":"QuantitativeValue","value":250,"unitText":"DAY"}}}""",
        "<h1>Video Editor</h1><p>Freelance cover for parental leave.</p>"
        + _BOILERPLATE,
        "Video Editor",
    ),
    established={
        "engagement_type": "ongoing_freelance",
        "work_mode": "remote",
        "budget_currency": "GBP",
        "budget_amount": 250,
        "budget_unit": "per day",
        "compensation_mode": "fixed",
    },
    absent=("start_timing",),
    note="A daily rate in a non-INR currency.",
)

NO_TRIAL_PASTE = GoldenSource(
    key="no_trial_paste",
    title="Podcast Editor",
    pasted_text=(
        "Podcast Editor for a weekly show. Remote. INR 25,000 per month. "
        "There is no trial task. Apply through CreatorJobs."
    ),
    model_fields={
        "budget_amount": 25000,
        "budget_currency": "INR",
        "budget_unit": "per month",
        "work_mode": "remote",
        "trial_status": "none",
        "application_mode": "internal",
    },
    established_with_model={
        "budget_amount": 25000,
        "budget_currency": "INR",
        "compensation_mode": "fixed",
        "trial_status": "none",
    },
    absent=("engagement_type",),
    note="No trial must suppress every trial descendant.",
)


# ---------------------------------------------------------------------------
# Craft ambiguity
#
# A page can name a supported craft without naming a practitioner, and it can
# name several at once. Both were invisible: role words were agent nouns, so a
# title of activities matched nothing, and the role was then never asked about
# because policy said it never should be. The recruiter got an empty craft and
# no explanation. These entries hold both halves — read one craft silently, ask
# about several — and the non-creator entry above holds the third case.
# ---------------------------------------------------------------------------

BEBEE_MULTI_CRAFT = GoldenSource(
    key="bebee_multi_craft",
    title="Visual Content Creator - Video Editing, VFX & Animation",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting",
        "title":"Visual Content Creator - Video Editing, VFX & Animation",
        "employmentType":"FULL_TIME",
        "hiringOrganization":{"@type":"Organization","name":"Adithya Global School"},
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
        "addressLocality":"Coimbatore","addressRegion":"Coimbatore district",
        "addressCountry":"IN"}},
        "baseSalary":{"@type":"MonetaryAmount","currency":"INR","value":
        {"@type":"QuantitativeValue","minValue":29167,"maxValue":41667,
        "unitText":"MONTH"}}}""",
        "<h1>Visual Content Creator</h1><h2>Experience</h2><ul><li><strong>25 years"
        "</strong> of professional experience in Video Editing, Motion Graphics, "
        "Animation, or Digital Content Creation.</li></ul>" + _BOILERPLATE,
        "Visual Content Creator - Video Editing, VFX & Animation",
    ),
    established={
        "engagement_type": "full_time",
        "work_mode": "onsite",
        # The district wrapper and country code are not part of a city name.
        "location": "Coimbatore",
        "budget_currency": "INR",
        "budget_amount": 29167,
        "budget_max": 41667,
        "budget_unit": "per month",
        "compensation_mode": "range",
        # The page states 25 years, in a labelled Experience section its own
        # markup omits. That is almost certainly a typo for 2-5, and deciding so
        # is the recruiter's call, so it is carried exactly as written — all the
        # way to the native draft. It was briefly rewritten to "5–8 years" to fit
        # a question's option list mistaken for the field's domain, which is a
        # distortion rather than a normalisation: twenty-five is not five to
        # eight. See test_job_import_semantic_containment.
        "experience_level": "25 years",
    },
    absent=("start_timing", "platforms"),
    contested=("primary_role_key",),
    note=(
        "The page names three crafts and no dominant one, so the craft is the "
        "one thing here worth a question. Everything else it states plainly."
    ),
)

SINGLE_CRAFT_AS_ACTIVITY = GoldenSource(
    key="single_craft_as_activity",
    title="Freelance Motion Graphics for a weekly finance show",
    html=_page(
        """{"@context":"https://schema.org","@type":"JobPosting",
        "title":"Freelance Motion Graphics for a weekly finance show",
        "employmentType":"CONTRACTOR","jobLocationType":"TELECOMMUTE"}""",
        "<h1>Motion Graphics</h1><p>Weekly explainer segments.</p>" + _BOILERPLATE,
        "Freelance Motion Graphics for a weekly finance show",
    ),
    established={"engagement_type": "ongoing_freelance", "work_mode": "remote"},
    absent=("budget_amount", "start_timing"),
    note=(
        "One craft, named as an activity rather than a person. It must be read "
        "silently: a single clear answer is never worth an interruption."
    ),
)

CORPUS: tuple[GoldenSource, ...] = (
    GREENHOUSE_FULL,
    GREENHOUSE_NO_JSONLD,
    GREENHOUSE_CONTRADICTORY,
    LEVER_POSTING,
    ASHBY_POSTING,
    WORKDAY_SHELL,
    SMARTRECRUITERS_POSTING,
    SCHEMA_ORG_REMOTE,
    MISLABELLED_INTERNSHIP,
    CUSTOM_PROSE_PAGE,
    SPARSE_LISTING,
    DETAILED_PASTE,
    BOILERPLATE_ONLY,
    MULTI_JOB_PAGE,
    MALFORMED_STRUCTURED_DATA,
    AMOUNT_WITHOUT_CURRENCY,
    CURRENCY_WITHOUT_UNIT,
    PAY_RANGE_PASTE,
    NEGOTIABLE_PAY,
    NON_CREATOR_ROLE,
    DEADLINE_AND_START,
    NO_TRIAL_PASTE,
    BEBEE_MULTI_CRAFT,
    SINGLE_CRAFT_AS_ACTIVITY,
)
