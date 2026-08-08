"""A corpus of sanitized job pages, composed rather than transcribed.

Six hand-written fixtures cover six shapes. The web has more than six shapes, and
the defects that have escaped this project were all shape defects: a definition
list that a site minified onto one line, a US address whose components were
classified by position, a rate written with an article instead of a slash.

Hand-authoring fifty pages would produce fifty variations of whatever the author
was already thinking about. So a page here is *composed* from independent
structural choices — how the markup is shaped, where the data lives, what noise
surrounds it, which fields the employer supplied — and the corpus is the product
of those choices. Every page carries machine-readable ground truth, so a test can
ask what the page says rather than accepting whatever came out.

Nothing is copied from a real listing. The structures are real; the words are not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.job_url_fetcher import normalize_public_job_html

# --------------------------------------------------------------------------
# The independent dimensions a page varies along
# --------------------------------------------------------------------------

#: How the labelled facts are marked up.
MARKUP_SHAPES = (
    "definition_list",
    "table",
    "div_grid",
    "inline_paragraphs",
    "strong_labels",
    "nested_spans",
    "siblings",
    "unordered_list",
)

#: Where the facts live.
DATA_LOCATIONS = (
    "labelled_only",
    "json_ld_only",
    "labelled_and_json_ld_agree",
    "labelled_contradicts_json_ld",
    "prose_only",
)

#: What surrounds the job on the page.
NOISE_KINDS = ("none", "related_jobs", "footer_address", "recommendations", "everything")

#: How the source is served.
SERIALIZATIONS = ("pretty", "minified", "no_newlines", "extra_whitespace")

#: Which facts the employer actually supplied.
COMPLETENESS = ("rich", "no_compensation", "no_location", "sparse")


@dataclass(frozen=True)
class GroundTruth:
    """What the page says, independent of anything that reads it."""

    title: str
    employer: str
    budget_amount: int | None
    budget_currency: str | None
    budget_unit: str | None
    engagement_type: str | None
    city: str | None


@dataclass(frozen=True)
class CorpusPage:
    ident: str
    html: str
    truth: GroundTruth
    dimensions: dict[str, str] = field(default_factory=dict)

    def text(self) -> str:
        normalized, _title, _metadata = normalize_public_job_html(
            self.html, final_url=f"https://example.invalid/jobs/{self.ident}"
        )
        return normalized

    def metadata(self) -> dict[str, Any]:
        _text, _title, metadata = normalize_public_job_html(
            self.html, final_url=f"https://example.invalid/jobs/{self.ident}"
        )
        return metadata


_ROWS = {
    "definition_list": lambda rows: "<dl>"
    + "".join(f"<dt>{label}</dt><dd>{value}</dd>" for label, value in rows)
    + "</dl>",
    "table": lambda rows: "<table><tbody>"
    + "".join(f"<tr><th>{label}</th><td>{value}</td></tr>" for label, value in rows)
    + "</tbody></table>",
    "div_grid": lambda rows: "".join(
        f'<div class="row"><div class="k">{label}</div>'
        f'<div class="v">{value}</div></div>'
        for label, value in rows
    ),
    "inline_paragraphs": lambda rows: "".join(
        f"<p>{label}: {value}</p>" for label, value in rows
    ),
    "strong_labels": lambda rows: "".join(
        f"<p><strong>{label}:</strong> {value}</p>" for label, value in rows
    ),
    "nested_spans": lambda rows: "".join(
        f"<div><span><span>{label}</span></span>: <span>{value}</span></div>"
        for label, value in rows
    ),
    "siblings": lambda rows: "".join(
        f"<div>{label}</div><div>{value}</div>" for label, value in rows
    ),
    "unordered_list": lambda rows: "<ul>"
    + "".join(f"<li>{label}: {value}</li>" for label, value in rows)
    + "</ul>",
}

_NOISE = {
    "none": "",
    "related_jobs": (
        "<section><h2>Similar jobs</h2><article><h3>Senior Video Editor</h3>"
        "<dl><dt>Compensation</dt><dd>INR 95000 per month</dd>"
        "<dt>Type</dt><dd>Full-time</dd>"
        "<dt>Location</dt><dd>Mumbai, Maharashtra, IN</dd></dl></article></section>"
    ),
    "footer_address": (
        "<footer><p>Northgate Media Pvt Ltd, Building 4, Suite 300, "
        "Gurugram, Haryana, IN</p></footer>"
    ),
    "recommendations": (
        "<aside><h2>Recommended for you</h2><article><h3>Lead Motion Designer</h3>"
        "<p>Salary: INR 140000 per month</p><p>Location: Pune, Maharashtra, IN</p>"
        "</article></aside>"
    ),
}
_NOISE["everything"] = "".join(
    _NOISE[key] for key in ("related_jobs", "footer_address", "recommendations")
)


def _serialize(html: str, style: str) -> str:
    if style == "minified":
        return "".join(line.strip() for line in html.splitlines())
    if style == "no_newlines":
        return html.replace("\n", " ")
    if style == "extra_whitespace":
        return html.replace("><", ">   \n\n   <")
    return html


def build_page(
    *,
    ident: str,
    markup: str,
    location: str,
    noise: str,
    serialization: str,
    completeness: str,
) -> CorpusPage:
    """One page, from one combination of structural choices."""

    title = f"Content Creator {ident}"
    employer = f"Larkfield {ident} Studio"
    amount = None if completeness == "no_compensation" else 5000
    currency = None if amount is None else "INR"
    unit = None if amount is None else "per month"
    city = None if completeness in {"no_location", "sparse"} else "Chennai"
    engagement = None if completeness == "sparse" else "Freelance"

    rows: list[tuple[str, str]] = []
    if amount is not None:
        rows.append(("Compensation", f"INR {amount} per month"))
    if engagement is not None:
        rows.append(("Type", engagement))
    if city is not None:
        rows.append(("Location", f"{city}, Tamil Nadu, IN"))

    # `labelled_contradicts_json_ld` is the shape that produced the reported
    # failure: markup written by a syndicator, copy written by the employer.
    json_ld_engagement = "INTERN" if location == "labelled_contradicts_json_ld" else None
    include_labels = location in {
        "labelled_only",
        "labelled_and_json_ld_agree",
        "labelled_contradicts_json_ld",
    }
    include_json_ld = location in {
        "json_ld_only",
        "labelled_and_json_ld_agree",
        "labelled_contradicts_json_ld",
    }

    head = "<head><title>Job</title>"
    if include_json_ld:
        head += (
            '<script type="application/ld+json">'
            f'{{"@context":"https://schema.org","@type":"JobPosting",'
            f'"title":"{title}",'
            f'"hiringOrganization":{{"@type":"Organization","name":"{employer}"}}'
            + (f',"employmentType":"{json_ld_engagement}"' if json_ld_engagement else "")
            + "}</script>"
        )
    head += "</head>"

    body = f"<h1>{title}</h1>\n<p>{employer}</p>\n"
    if include_labels and rows:
        body += _ROWS[markup](rows) + "\n"
    if location == "prose_only":
        prose = [f"We are hiring a content creator at {employer}."]
        if amount is not None:
            prose.append(f"The role pays INR {amount} per month.")
        if city is not None:
            prose.append(f"You will work from our {city} office.")
        body += "<p>" + " ".join(prose) + "</p>\n"
    body += (
        "<h2>About the role</h2>\n<p>Own our social presence.</p>\n"
        "<h2>Responsibilities</h2>\n<ul><li>Concept and edit Reels.</li>"
        "<li>Write captions.</li><li>Report weekly.</li></ul>\n"
        "<h2>Requirements</h2>\n<p>Basic editing in CapCut.</p>\n"
    )
    body += _NOISE[noise]

    html = _serialize(f"<html>{head}<body>\n{body}</body></html>", serialization)

    # Ground truth follows the employer's own copy where the two disagree,
    # because that is the product's stated precedence.
    truth_engagement = None
    if engagement is not None and include_labels:
        truth_engagement = "ongoing_freelance"
    elif json_ld_engagement == "INTERN" and not include_labels:
        truth_engagement = "internship"

    return CorpusPage(
        ident=ident,
        html=html,
        truth=GroundTruth(
            title=title,
            employer=employer,
            budget_amount=amount if include_labels or location == "prose_only" else None,
            budget_currency=currency if include_labels else None,
            budget_unit=unit if include_labels else None,
            engagement_type=truth_engagement,
            city=city,
        ),
        dimensions={
            "markup": markup,
            "location": location,
            "noise": noise,
            "serialization": serialization,
            "completeness": completeness,
        },
    )


def corpus() -> list[CorpusPage]:
    """Structurally distinct pages, one per meaningful combination.

    Deliberately not the full Cartesian product — 8 × 5 × 5 × 4 × 4 is 3,200
    pages that would mostly differ in ways nothing reads. This walks the
    dimensions so that every value of every dimension appears many times and in
    varied company, which is what makes an interaction visible.
    """

    pages: list[CorpusPage] = []
    index = 0
    for markup_index, markup in enumerate(MARKUP_SHAPES):
        for location_index, location in enumerate(DATA_LOCATIONS):
            for serialization_index, serialization in enumerate(SERIALIZATIONS):
                index += 1
                pages.append(
                    build_page(
                        ident=f"P{index:03d}",
                        markup=markup,
                        location=location,
                        noise=NOISE_KINDS[
                            (markup_index + location_index) % len(NOISE_KINDS)
                        ],
                        serialization=serialization,
                        completeness=COMPLETENESS[
                            (location_index + serialization_index) % len(COMPLETENESS)
                        ],
                    )
                )
    return pages


CORPUS = corpus()
