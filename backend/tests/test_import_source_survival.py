"""Does the employer's own sentence reach the reader at all?

Everything downstream of extraction is now guaranteed: a source-evidenced fact
survives reconciliation, native conversion, persistence and the candidate page,
and a detector that finds nothing cannot erase one that did. All of that begins
*after* the text arrives, and this file is about the part before it.

The audit that produced it found a live defect immediately. ``<header>`` was
dropped wherever it appeared, and job boards put the title, the employer and the
pay chip inside the posting's own header. So "Up to ₹20,000 a month" could be
removed from the source before the provider was asked to read anything — a class
of failure no amount of model capability can recover from, and one that looks
exactly like the model failing to understand the page.

Two properties are asserted here.

**Sentinels.** A unique string placed in each kind of markup a real page uses
must appear in the normalised text. If it does not, the fact is gone at
``FETCH_LOSS`` / ``NORMALIZATION_LOSS`` and nothing later matters.

**Metamorphic equivalence.** The same page written twelve different ways —
minified, entity-encoded, wrapped in extra divs, split across inline spans — has
the same facts. Normalisation may reformat; it may not lose.

Ground truth is the sentinel itself, never anything the normaliser returns.
"""

from __future__ import annotations

import pytest

from app.core.job_import_labelled_fields import labelled_facts
from app.services.job_url_fetcher import normalize_public_job_html

URL = "https://example.invalid/jobs/video-editor"

#: One unique sentence per markup shape. Unique so a match cannot come from
#: somewhere else on the page.
SENTINELS: tuple[tuple[str, str, str], ...] = (
    (
        "ordinary paragraph",
        "SENTINEL_PARAGRAPH_4417",
        "<main><p>SENTINEL_PARAGRAPH_4417</p></main>",
    ),
    (
        "labelled field",
        "SENTINEL_LABELLED_2210",
        "<main><p><strong>Salary</strong>: SENTINEL_LABELLED_2210</p></main>",
    ),
    (
        "definition list",
        "SENTINEL_DL_8841",
        "<main><dl><dt>Compensation</dt><dd>SENTINEL_DL_8841</dd></dl></main>",
    ),
    (
        "table cell",
        "SENTINEL_TABLE_9002",
        "<main><table><tr><th>Pay</th><td>SENTINEL_TABLE_9002</td></tr></table></main>",
    ),
    (
        "nested spans",
        "SENTINEL_SPANS_5520",
        "<main><p><span>SENTINEL_</span><span>SPANS_</span><span>5520</span></p></main>",
    ),
    (
        "list item",
        "SENTINEL_LIST_1180",
        "<main><ul><li>SENTINEL_LIST_1180</li></ul></main>",
    ),
    (
        "heading then body",
        "SENTINEL_HEADING_7742",
        "<main><h2>About the pay</h2><p>SENTINEL_HEADING_7742</p></main>",
    ),
    (
        "inline tags inside a sentence",
        "SENTINEL_INLINE_3355",
        "<main><p>Rate is <b>SENTINEL_INLINE_3355</b> for this role.</p></main>",
    ),
    (
        "posting header inside main",
        "SENTINEL_HEADER_6613",
        "<main><header><h1>Video Editor</h1><p>SENTINEL_HEADER_6613</p></header></main>",
    ),
    (
        "posting header inside article",
        "SENTINEL_ARTICLE_9021",
        "<article><header><p>SENTINEL_ARTICLE_9021</p></header></article>",
    ),
    (
        "deeply wrapped",
        "SENTINEL_WRAPPED_4408",
        "<main><div><div><div><div><p>SENTINEL_WRAPPED_4408</p></div></div></div></div></main>",
    ),
    (
        "details/summary",
        "SENTINEL_DETAILS_3140",
        "<main><details><summary>More</summary><p>SENTINEL_DETAILS_3140</p></details></main>",
    ),
)


def _normalized(body: str) -> str:
    html = f"<html><head><title>Video Editor</title></head><body>{body}</body></html>"
    text, _title, _metadata = normalize_public_job_html(html, final_url=URL)
    return text


class TestAFactInTheMarkupReachesTheReader:
    @pytest.mark.parametrize(
        ("shape", "sentinel", "body"), SENTINELS, ids=[case[0] for case in SENTINELS]
    )
    def test_the_sentinel_survives_normalization(
        self, shape: str, sentinel: str, body: str
    ) -> None:
        text = _normalized(body)

        assert sentinel in text, (
            f"NORMALIZATION_LOSS: {shape} — the employer's own text was removed "
            f"before any reader saw it.\nNormalised to: {text!r}"
        )

    def test_the_sentinels_are_actually_unique(self) -> None:
        # A guard on the guard: two shapes sharing a sentinel would let one
        # cover for the other.
        sentinels = [sentinel for _shape, sentinel, _body in SENTINELS]

        assert len(set(sentinels)) == len(sentinels)


class TestPageChromeIsStillRemoved:
    """The rule that dropping header/footer was written for still holds."""

    @pytest.mark.parametrize(
        ("shape", "body"),
        [
            ("site masthead", "<header><p>CHROME_1</p></header><main><p>Body</p></main>"),
            ("site footer", "<main><p>Body</p></main><footer><p>CHROME_1</p></footer>"),
            ("navigation", "<main><nav><p>CHROME_1</p></nav><p>Body</p></main>"),
            ("a form", "<main><form><p>CHROME_1</p></form><p>Body</p></main>"),
            (
                "cookie banner",
                '<main><div class="cookie-consent"><p>CHROME_1</p></div><p>Body</p></main>',
            ),
            (
                "aria-hidden duplicate",
                '<main><p aria-hidden="true">CHROME_1</p><p>Body</p></main>',
            ),
        ],
    )
    def test_chrome_does_not_reach_the_reader(self, shape: str, body: str) -> None:
        assert "CHROME_1" not in _normalized(body), shape

    def test_a_responsive_duplicate_keeps_the_visible_copy(self) -> None:
        # Real pages ship both layouts and hide one. The visible copy must
        # survive and the hidden one must not be read twice.
        text = _normalized(
            '<main><div aria-hidden="true"><p>Up to ₹20,000 a month</p></div>'
            "<div><p>Up to ₹20,000 a month</p></div></main>"
        )

        assert text.count("Up to ₹20,000 a month") == 1, text


#: The same job, written twelve ways. Facts must be identical across all of them.
EQUIVALENT_PAGES: tuple[tuple[str, str], ...] = (
    (
        "pretty",
        """
        <main>
          <header>
            <h1>Freelance Video Editor</h1>
            <p>Up to ₹20,000 a month</p>
            <p>Remote</p>
          </header>
          <p>Job Type: Freelance</p>
          <h2>What you will do</h2>
          <ul><li>Edit reels each week.</li></ul>
        </main>
        """,
    ),
    (
        "minified",
        "<main><header><h1>Freelance Video Editor</h1><p>Up to ₹20,000 a month</p>"
        "<p>Remote</p></header><p>Job Type: Freelance</p><h2>What you will do</h2>"
        "<ul><li>Edit reels each week.</li></ul></main>",
    ),
    (
        "inline split",
        "<main><header><h1>Freelance <span>Video</span> Editor</h1>"
        "<p>Up to <span>₹20,000</span> a month</p><p>Remote</p></header>"
        "<p>Job <b>Type</b>: Freelance</p><h2>What you will do</h2>"
        "<ul><li>Edit reels each week.</li></ul></main>",
    ),
    (
        "entities",
        "<main><header><h1>Freelance Video Editor</h1>"
        "<p>Up&nbsp;to&nbsp;&#8377;20,000 a month</p><p>Remote</p></header>"
        "<p>Job Type: Freelance</p><h2>What you will do</h2>"
        "<ul><li>Edit reels each week.</li></ul></main>",
    ),
    (
        "deep wrappers",
        "<main><div><div><header><div><h1>Freelance Video Editor</h1>"
        "<div><p>Up to ₹20,000 a month</p></div><p>Remote</p></div></header></div>"
        "<div><p>Job Type: Freelance</p></div></div><h2>What you will do</h2>"
        "<ul><li>Edit reels each week.</li></ul></main>",
    ),
    (
        "definition list",
        "<main><h1>Freelance Video Editor</h1><dl>"
        "<dt>Salary</dt><dd>Up to ₹20,000 a month</dd>"
        "<dt>Location</dt><dd>Remote</dd>"
        "<dt>Job Type</dt><dd>Freelance</dd></dl>"
        "<h2>What you will do</h2><ul><li>Edit reels each week.</li></ul></main>",
    ),
    (
        "table",
        "<main><h1>Freelance Video Editor</h1><table>"
        "<tr><th>Salary</th><td>Up to ₹20,000 a month</td></tr>"
        "<tr><th>Location</th><td>Remote</td></tr>"
        "<tr><th>Job Type</th><td>Freelance</td></tr></table>"
        "<h2>What you will do</h2><ul><li>Edit reels each week.</li></ul></main>",
    ),
    (
        "with page chrome around it",
        "<header><p>SiteName</p></header><nav><p>Jobs</p></nav>"
        "<main><header><h1>Freelance Video Editor</h1>"
        "<p>Up to ₹20,000 a month</p><p>Remote</p></header>"
        "<p>Job Type: Freelance</p><h2>What you will do</h2>"
        "<ul><li>Edit reels each week.</li></ul></main>"
        "<footer><p>Terms</p></footer>",
    ),
    (
        "whitespace heavy",
        "<main>\n\n   <header>\n\n     <h1>Freelance Video Editor</h1>\n\n"
        "     <p>   Up to ₹20,000 a month   </p>\n\n     <p>Remote</p>\n\n"
        "   </header>\n\n   <p>Job Type: Freelance</p>\n\n"
        "   <h2>What you will do</h2>\n   <ul><li>Edit reels each week.</li></ul>\n</main>",
    ),
)


class TestTheSameJobWrittenAnyWayMeansTheSameThing:
    @pytest.mark.parametrize(
        ("shape", "body"), EQUIVALENT_PAGES, ids=[case[0] for case in EQUIVALENT_PAGES]
    )
    def test_the_pay_fact_is_identical_across_renderings(
        self, shape: str, body: str
    ) -> None:
        facts = labelled_facts(_normalized(body))

        # Ground truth is the page's own sentence, written here by hand: a
        # ceiling of twenty thousand rupees a month, and no floor.
        assert facts.budget_max == 20_000, f"{shape}: max is {facts.budget_max}"
        assert facts.budget_amount is None, f"{shape}: invented a floor"
        assert facts.budget_currency == "INR", shape
        assert facts.budget_unit == "per month", shape

    @pytest.mark.parametrize(
        ("shape", "body"), EQUIVALENT_PAGES, ids=[case[0] for case in EQUIVALENT_PAGES]
    )
    def test_the_engagement_is_identical_across_renderings(
        self, shape: str, body: str
    ) -> None:
        assert labelled_facts(_normalized(body)).engagement_type == "ongoing_freelance", shape

    @pytest.mark.parametrize(
        ("shape", "body"), EQUIVALENT_PAGES, ids=[case[0] for case in EQUIVALENT_PAGES]
    )
    def test_every_rendering_keeps_the_work_description(
        self, shape: str, body: str
    ) -> None:
        text = _normalized(body)

        assert "Edit reels each week." in text, shape
        assert "Remote" in text, shape
        assert "Freelance Video Editor" in text, shape


class TestStructureThatOtherReadersDependOn:
    """Separation is a fact too.

    Two normalisation defects survived the first mutation run because every
    assertion so far only asked whether text was *present*. Text can be present
    and still unreadable: a label fused to its value, or a heading fused to the
    paragraph beneath it, changes what every downstream reader sees while the
    characters all remain.
    """

    def test_a_heading_is_its_own_line(self) -> None:
        text = _normalized(
            "<main><h2>Responsibilities</h2><p>Edit reels each week.</p>"
            "<h2>Requirements</h2><p>Three years of editing.</p></main>"
        )
        lines = text.splitlines()

        # Body-section detection and the neighbour-card boundary both work by
        # recognising a heading line. A heading welded to the sentence after it
        # is invisible to them, and the boundary that stops a neighbouring
        # listing's salary is one of the things they decide.
        assert "Responsibilities" in lines, text
        assert "Requirements" in lines, text
        assert not any(
            line.startswith("Responsibilities") and len(line) > len("Responsibilities")
            for line in lines
        ), text

    def test_adjacent_headings_do_not_fuse(self) -> None:
        text = _normalized("<main><h1>Freelance Video Editor</h1><h2>Finance Simplified</h2></main>")

        # A title followed immediately by a subtitle is ordinary posting markup.
        # Without headings separating, the job title and the employer become one
        # unreadable token and both facts are lost at once.
        assert "EditorFinance" not in text, text
        assert "Freelance Video Editor" in text.splitlines(), text
        assert "Finance Simplified" in text.splitlines(), text

    def test_a_heading_followed_by_bare_text_still_separates(self) -> None:
        text = _normalized("<main><h2>Responsibilities</h2>Edit reels each week.</main>")

        assert "ResponsibilitiesEdit" not in text, text

    def test_cells_in_a_row_stay_separable(self) -> None:
        text = _normalized(
            "<main><table><tr>"
            "<td>Location</td><td>Chennai</td>"
            "<td>Job Type</td><td>Freelance</td>"
            "</tr></table></main>"
        )

        # A multi-column fact table is common on job pages. With cells run
        # together the row becomes "LocationChennaiJob TypeFreelance", where
        # neither the labels nor the values can be recovered.
        assert "ChennaiJob" not in text, text
        assert "LocationChennai" not in text, text

    def test_a_labelled_row_still_reads_as_label_and_value(self) -> None:
        facts = labelled_facts(
            _normalized(
                "<main><table>"
                "<tr><th>Job Type</th><td>Freelance</td></tr>"
                "<tr><th>Salary</th><td>Up to ₹20,000 a month</td></tr>"
                "</table></main>"
            )
        )

        assert facts.engagement_type == "ongoing_freelance"
        assert facts.budget_max == 20_000
