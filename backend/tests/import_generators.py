"""Deterministic generators for import assurance.

Hand-picked strings keep missing things. ``₹500000 annually`` survived several
rounds of compensation tests not because anyone reasoned wrongly about it but
because nobody happened to write it down — the ``a`` in "annually" collided with
the ``a`` in "₹5,000 a month" and no example exercised the overlap.

So these build surface forms *from* semantics rather than listing them. A
compensation fact is an amount, a currency and a period; every way a job page
can write that is a rendering of the same object, and parsing any rendering must
return the object it came from. That is a property, and a property finds the
combination nobody thought of.

Everything is seeded and reproducible. A failure prints the semantic object and
the exact string, so a generated failure is as debuggable as a written one.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Iterator

# --------------------------------------------------------------------------
# Compensation
# --------------------------------------------------------------------------

#: How each currency can be written, and what it must normalise to.
CURRENCY_FORMS: dict[str, tuple[str, ...]] = {
    "INR": ("₹", "INR", "Rs", "Rs."),
    "USD": ("$", "USD", "US$"),
    "GBP": ("£", "GBP"),
    "EUR": ("€", "EUR"),
}

#: How each period can be written, and the unit it must normalise to.
PERIOD_FORMS: dict[str, tuple[str, ...]] = {
    "per hour": ("hour", "hr", "hourly", "/hr", "/ hr", "per hour", "an hour"),
    "per day": ("day", "daily", "/day", "per day", "a day"),
    "per week": ("week", "weekly", "/week", "per week", "a week"),
    "per month": (
        "month",
        "monthly",
        "/mo",
        "/ mo",
        "/month",
        "per month",
        "a month",
        "mo",
    ),
    "per year": (
        "year",
        "yearly",
        "annual",
        "annually",
        "/year",
        "/yr",
        "per year",
        "per annum",
        "a year",
    ),
    "per project": ("project", "per project", "/project"),
    "per video": ("video", "per video", "/video"),
}

AMOUNTS: tuple[tuple[int, tuple[str, ...]], ...] = (
    (500, ("500", "500")),
    (5000, ("5000", "5,000")),
    (50000, ("50000", "50,000")),
    (500000, ("500000", "500,000")),
    (80000, ("80000", "80,000")),
    (40, ("40", "40")),
)


@dataclass(frozen=True)
class Compensation:
    """One compensation fact, independent of how a page writes it."""

    amount: int
    currency: str
    unit: str

    def describe(self) -> str:
        return f"{self.amount} {self.currency} {self.unit}"


@dataclass(frozen=True)
class CompensationCase:
    semantics: Compensation
    text: str
    #: Everything needed to reproduce this exact case from the seed.
    recipe: str


def compensation_cases(*, seed: int = 20260808, limit: int = 1200) -> list[CompensationCase]:
    """Every currency × period × amount × spacing rendering, deterministically.

    Enumerated first and sampled only if the product exceeds ``limit``, so a
    small limit still covers every currency and period rather than clustering.
    """

    cases: list[CompensationCase] = []
    for currency, currency_forms in CURRENCY_FORMS.items():
        for unit, period_forms in PERIOD_FORMS.items():
            for amount, amount_forms in AMOUNTS:
                for currency_form in currency_forms:
                    for period_form in period_forms:
                        for amount_form in amount_forms:
                            for gap in ("", " "):
                                text = (
                                    f"{currency_form}{gap}{amount_form} {period_form}"
                                    if not period_form.startswith("/")
                                    else f"{currency_form}{gap}{amount_form}{period_form}"
                                )
                                cases.append(
                                    CompensationCase(
                                        semantics=Compensation(amount, currency, unit),
                                        text=text,
                                        recipe=(
                                            f"{currency}/{unit}/{amount} "
                                            f"[{currency_form}|{amount_form}|{period_form}|gap={len(gap)}]"
                                        ),
                                    )
                                )
    if len(cases) <= limit:
        return cases
    return random.Random(seed).sample(cases, limit)


#: Wording that names no figure at all. Parsing must return nothing.
NON_NUMERIC_COMPENSATION: tuple[str, ...] = (
    "Negotiable",
    "Competitive",
    "Depending on experience",
    "DOE",
    "Open to discussion",
    "Commensurate with experience",
    "As per industry standards",
    "Best in industry",
    "Unpaid",
    "TBD",
    "To be discussed",
)

#: A figure that is not what the job pays. None of these may become a rate.
NOT_THE_CANDIDATES_PAY: tuple[str, ...] = (
    "Our company raised $12,000,000 last year.",
    "We manage campaign budgets of ₹50,00,000 per month for clients.",
    "Previous salary of ₹30,000 per month will be verified.",
    "Reimbursement of ₹2,000 per month for internet.",
    "For example, a video that costs $500 per video to produce.",
    "Similar jobs pay ₹95,000 / mo.",
)


# --------------------------------------------------------------------------
# Experience
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ExperienceCase:
    text: str
    #: The smallest number of years the source commits to, if any.
    floor: float | None
    #: The largest, if the source states one. ``None`` means open-ended.
    ceiling: float | None
    recipe: str


def experience_cases(*, seed: int = 20260808, limit: int = 600) -> list[ExperienceCase]:
    """Surface forms for experience, with the bounds each one actually states.

    The bounds are the point. "5+" has a floor and no ceiling, so any native
    representation implying one is a narrowing — which is exactly how "25 years"
    became "5–8" once.
    """

    cases: list[ExperienceCase] = []

    def add(text: str, floor: float | None, ceiling: float | None, recipe: str) -> None:
        cases.append(ExperienceCase(text, floor, ceiling, recipe))

    numbers = (0, 1, 2, 3, 5, 8, 10, 25, 30)
    words = {1: "one", 2: "two", 3: "three", 5: "five", 8: "eight", 10: "ten"}

    for value in numbers:
        for noun in ("year", "years", "yr", "yrs"):
            add(f"{value} {noun}", value, value, f"exact-{value}-{noun}")
            add(f"{value}+ {noun}", value, None, f"open-{value}-{noun}")
            add(f"at least {value} {noun}", value, None, f"atleast-{value}-{noun}")
            add(f"minimum {value} {noun}", value, None, f"min-{value}-{noun}")
            add(f"minimum of {value} {noun}", value, None, f"minof-{value}-{noun}")
            add(f"more than {value} {noun}", value, None, f"morethan-{value}-{noun}")
            add(f"up to {value} {noun}", None, value, f"upto-{value}-{noun}")
            add(f"maximum {value} {noun}", None, value, f"max-{value}-{noun}")
            add(f"less than {value} {noun}", None, value, f"lessthan-{value}-{noun}")
        if value in words:
            add(f"at least {words[value]} years", value, None, f"word-atleast-{value}")
            add(f"minimum of {words[value]} years", value, None, f"word-minof-{value}")

    for low, high in ((2, 3), (3, 5), (5, 8), (8, 10), (1, 2), (10, 15)):
        for dash in ("-", "–", " to ", " - "):
            add(f"{low}{dash}{high} years", low, high, f"range-{low}{dash}{high}")

    for months in (6, 12, 18, 24, 60):
        add(f"{months} months", months / 12, months / 12, f"months-{months}")
        add(f"at least {months} months", months / 12, None, f"months-atleast-{months}")
        add(f"minimum {months} months", months / 12, None, f"months-min-{months}")

    # Qualitative seniority states no number at all. Any number is invented.
    for word in (
        "senior",
        "junior",
        "entry-level",
        "fresher",
        "experienced",
        "expert",
        "mid-level",
        "lead",
    ):
        add(word, None, None, f"qualitative-{word}")

    if len(cases) <= limit:
        return cases
    return random.Random(seed).sample(cases, limit)


# --------------------------------------------------------------------------
# Location and work mode
# --------------------------------------------------------------------------

#: Words that describe how work happens, never where it happens.
WORK_MODE_WORDS: tuple[tuple[str, str | None], ...] = (
    ("Remote", "remote"),
    ("remote", "remote"),
    ("REMOTE", "remote"),
    ("Remote-friendly", None),
    ("Remote friendly", None),
    ("Remote-first", None),
    ("Fully remote", None),
    ("Work from home", None),
    ("WFH", None),
    ("Anywhere", None),
    ("Distributed", None),
    ("Hybrid", "hybrid"),
    ("On-site", "onsite"),
    ("Onsite", "onsite"),
    ("In-office", "onsite"),
)

#: Real places, and what part of them is the city.
PLACES: tuple[tuple[str, str | None], ...] = (
    ("India", None),
    ("United States", None),
    ("UK", None),
    ("Chennai", "Chennai"),
    ("Chennai, Tamil Nadu", "Chennai"),
    ("Chennai, Tamil Nadu, IN", "Chennai"),
    ("Bengaluru, Karnataka, IN", "Bengaluru"),
    ("Coimbatore, Coimbatore district, IN", "Coimbatore"),
    ("New York, NY", "New York"),
    ("Tysons Corner, VA", "Tysons Corner"),
    ("Boston, MA", "Boston"),
    ("London", "London"),
    ("London or Manchester", None),
    ("Remote across the US", None),
)

#: Names that look like places and are not.
NOT_PLACES: tuple[str, ...] = (
    "Larkfield Studio",
    "Acme Media Pvt Ltd",
    "Head Office",
    "Registered office",
    "Building 4",
    "Suite 300",
    "IST",
    "GMT+5:30",
    "Asia/Kolkata",
)


# --------------------------------------------------------------------------
# Engagement
# --------------------------------------------------------------------------

ENGAGEMENT_WORDS: tuple[tuple[str, str | None], ...] = (
    ("Full-time", "full_time"),
    ("Full time", "full_time"),
    ("FULL_TIME", "full_time"),
    ("Permanent", "full_time"),
    ("Part-time", "part_time"),
    ("Part time", "part_time"),
    ("Freelance", "ongoing_freelance"),
    ("Ongoing freelance", "ongoing_freelance"),
    ("Contract", "fixed_term"),
    ("Fixed-term", "fixed_term"),
    ("Internship", "internship"),
    ("Intern", "internship"),
    ("Retainer", "retainer"),
    # Deliberately unsupported. None of these may be forced into an enum.
    ("Volunteer", None),
    ("Temporary", None),
    ("Casual", None),
    ("Apprenticeship", None),
    ("Secondment", None),
)

#: Compounds where one descriptor decides the structure of the engagement.
ENGAGEMENT_COMPOUNDS: tuple[tuple[str, str], ...] = (
    ("Part-time / Freelance", "ongoing_freelance"),
    ("Freelance / Part-time", "ongoing_freelance"),
    ("Freelance, part time", "ongoing_freelance"),
    ("Part-time freelance", "ongoing_freelance"),
    ("Fixed-term contract", "fixed_term"),
    ("Full-time contract", "fixed_term"),
    ("Contract / Full-time", "fixed_term"),
)


# --------------------------------------------------------------------------
# Labelled DOM shapes — one fact, many trees
# --------------------------------------------------------------------------


def labelled_dom_variants(label: str, value: str) -> Iterator[tuple[str, str]]:
    """Every markup shape a site uses to print one labelled row.

    Yields ``(shape_name, html)``. Same semantics, different tree: a reader that
    handles definition lists and not tables would hand a table site's decision
    back to whichever evidence it does understand, and the failure looks exactly
    like the one the labelled reader was built to fix.
    """

    yield "inline", f"<p>{label}: {value}</p>"
    yield "inline-no-colon", f"<p>{label} {value}</p>"
    yield "inline-dash", f"<p>{label} - {value}</p>"
    yield "inline-endash", f"<p>{label} – {value}</p>"
    yield "strong-label", f"<p><strong>{label}:</strong> {value}</p>"
    yield "b-label", f"<p><b>{label}</b> {value}</p>"
    yield "nested-spans", f"<div><span><span>{label}</span></span>: <span>{value}</span></div>"
    yield "definition-list", f"<dl><dt>{label}</dt><dd>{value}</dd></dl>"
    yield "table", f"<table><tr><th>{label}</th><td>{value}</td></tr></table>"
    yield "grid-divs", f'<div class="row"><div>{label}</div><div>{value}</div></div>'
    yield "siblings", f"<div>{label}</div><div>{value}</div>"
    yield "deep-wrapper", (
        f"<section><div><div><div><span>{label}:</span>"
        f"<span>{value}</span></div></div></div></section>"
    )
    yield "nbsp", f"<p>{label}:&nbsp;{value}</p>"
    yield "entities", f"<p>{label}:&#32;{value}</p>"
    yield "line-break", f"<p>{label}:<br/>{value}</p>"
    yield "extra-whitespace", f"<p>   {label}   :   {value}   </p>"
    yield "responsive-duplicate", (
        f'<div class="desktop"><dl><dt>{label}</dt><dd>{value}</dd></dl></div>'
        f'<div class="mobile"><dl><dt>{label}</dt><dd>{value}</dd></dl></div>'
    )
    yield "aria-hidden-duplicate", (
        f"<dl><dt>{label}</dt><dd>{value}</dd></dl>"
        f'<div aria-hidden="true"><dl><dt>{label}</dt><dd>{value}</dd></dl></div>'
    )


#: Noise a real page carries around the job it is actually about.
PAGE_NOISE: dict[str, str] = {
    "similar-jobs": (
        "<section><h2>Similar jobs</h2>"
        "<article><h3>Senior Video Editor</h3>"
        "<dl><dt>Compensation</dt><dd>₹95,000 / mo</dd>"
        "<dt>Type</dt><dd>Full-time</dd>"
        "<dt>Location</dt><dd>Mumbai, Maharashtra, IN</dd></dl></article></section>"
    ),
    "recommendations": (
        "<aside><h2>Recommended for you</h2>"
        "<article><h3>Lead Motion Designer</h3>"
        "<p>Salary: ₹1,40,000 / mo</p>"
        "<p>Location: Pune, Maharashtra, IN</p></article></aside>"
    ),
    "footer-address": (
        "<footer><p>Northgate Media Pvt Ltd, Building 4, Suite 300, "
        "Gurugram, Haryana, IN</p><p>Registered office: Delhi</p></footer>"
    ),
    "company-boilerplate": (
        "<section><h2>About us</h2><p>Founded in 1998, we have 25 years of "
        "history and raised $12,000,000 last year.</p></section>"
    ),
}
