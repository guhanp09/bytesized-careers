"""One fact, many markup trees, and the same answer from all of them.

A site chooses a definition list, a table, nested spans or bare siblings for
reasons that have nothing to do with the job. If the reader understands one shape
and not another, then whether a recruiter is asked about their own stated salary
depends on their applicant tracking system's CSS framework — and the failure
looks exactly like the one the labelled reader was built to prevent.

That is a metamorphic property: transformations which do not change what a page
*says* must not change what is extracted. It is stronger than a fixture, because
a fixture proves one tree and this proves the class.

The second half tests transformations that *should* change exactly one thing.
Changing "/mo" to "per month" must change nothing; changing "monthly" to "hourly"
must change the unit and nothing else. Testing only the invariant half would miss
accidental coupling, where an unrelated field moves because two readers share
state they should not.
"""

from __future__ import annotations

import pytest

from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_page_evidence import classify_job_page
from app.services.job_url_fetcher import normalize_public_job_html
from tests.import_generators import PAGE_NOISE, labelled_dom_variants

URL = "https://example.invalid/jobs/metamorphic"

BASE_BODY = """
<h1>Content Creator &amp; Social Media Manager</h1>
<p>Larkfield Studio</p>
{rows}
<h2>About the role</h2>
<p>Own our social presence across Instagram, X and YouTube Shorts.</p>
<h2>Responsibilities</h2>
<ul><li>Concept, shoot and edit 4-6 Reels per month.</li>
<li>Design static feed and carousel posts.</li>
<li>Write captions and short-form copy.</li></ul>
<h2>Requirements</h2>
<p>Basic video editing in CapCut or InShot.</p>
"""


def _page(rows: str, *, noise: str = "") -> str:
    html = (
        "<html><head><title>Content Creator</title></head><body>"
        + BASE_BODY.format(rows=rows)
        + noise
        + "</body></html>"
    )
    text, _title, _metadata = normalize_public_job_html(html, final_url=URL)
    return text


COMPENSATION_SHAPES = list(labelled_dom_variants("Compensation", "₹5,000 / mo"))
ENGAGEMENT_SHAPES = list(labelled_dom_variants("Type", "Part-time / Freelance"))


class TestTheSameRateInEveryMarkupShape:
    @pytest.mark.parametrize(
        ("shape", "rows"), COMPENSATION_SHAPES, ids=[name for name, _ in COMPENSATION_SHAPES]
    )
    def test_the_rate_survives_the_tree_it_was_written_in(
        self, shape: str, rows: str
    ) -> None:
        facts = labelled_facts(_page(rows))

        assert facts.budget_amount == 5000, f"{shape}: {facts}"
        assert facts.budget_currency == "INR", shape
        assert facts.budget_unit == "per month", shape

    def test_every_shape_agrees_with_every_other(self) -> None:
        # Stated as one assertion as well as many, because "they all pass" and
        # "they all agree" are different claims and only the second is the
        # property. A reader could pass each case while normalising two shapes
        # to different-but-individually-plausible values.
        results = {
            shape: labelled_facts(_page(rows))
            for shape, rows in COMPENSATION_SHAPES
        }
        distinct = {
            (facts.budget_amount, facts.budget_currency, facts.budget_unit)
            for facts in results.values()
        }

        assert len(distinct) == 1, {
            shape: (f.budget_amount, f.budget_currency, f.budget_unit)
            for shape, f in results.items()
        }


class TestTheSameEngagementInEveryMarkupShape:
    @pytest.mark.parametrize(
        ("shape", "rows"), ENGAGEMENT_SHAPES, ids=[name for name, _ in ENGAGEMENT_SHAPES]
    )
    def test_the_engagement_survives_the_tree(self, shape: str, rows: str) -> None:
        assert labelled_facts(_page(rows)).engagement_type == "ongoing_freelance", shape

    def test_every_shape_agrees(self) -> None:
        distinct = {
            labelled_facts(_page(rows)).engagement_type for _shape, rows in ENGAGEMENT_SHAPES
        }

        assert distinct == {"ongoing_freelance"}, distinct


class TestNoiseChangesNothing:
    """A page carries other people's jobs, a footer and boilerplate."""

    @pytest.mark.parametrize("noise_name", sorted(PAGE_NOISE))
    def test_neighbouring_content_does_not_move_the_rate(self, noise_name: str) -> None:
        rows = "<dl><dt>Compensation</dt><dd>₹5,000 / mo</dd></dl>"
        facts = labelled_facts(_page(rows, noise=PAGE_NOISE[noise_name]))

        # ₹95,000 and ₹1,40,000 belong to somebody else's job; $12,000,000 is
        # the company's funding round.
        assert facts.budget_amount == 5000, f"{noise_name}: {facts.budget_amount}"

    @pytest.mark.parametrize("noise_name", sorted(PAGE_NOISE))
    def test_neighbouring_content_does_not_move_the_engagement(
        self, noise_name: str
    ) -> None:
        rows = "<dl><dt>Type</dt><dd>Part-time / Freelance</dd></dl>"
        facts = labelled_facts(_page(rows, noise=PAGE_NOISE[noise_name]))

        assert facts.engagement_type == "ongoing_freelance", noise_name

    def test_all_the_noise_at_once_still_leaves_one_job(self) -> None:
        rows = (
            "<dl><dt>Compensation</dt><dd>₹5,000 / mo</dd>"
            "<dt>Type</dt><dd>Part-time / Freelance</dd></dl>"
        )
        page = _page(rows, noise="".join(PAGE_NOISE.values()))
        facts = labelled_facts(page)

        assert facts.budget_amount == 5000
        assert facts.engagement_type == "ongoing_freelance"


class TestTransformationsThatMustChangeNothing:
    """Rewordings a page could make without changing what it offers."""

    BASELINE = "<dl><dt>Compensation</dt><dd>₹5,000 / mo</dd></dl>"

    @pytest.mark.parametrize(
        "rewritten",
        [
            "<dl><dt>Compensation</dt><dd>₹5,000 per month</dd></dl>",
            "<dl><dt>Compensation</dt><dd>₹5,000 monthly</dd></dl>",
            "<dl><dt>Compensation</dt><dd>₹5,000 a month</dd></dl>",
            "<dl><dt>Compensation</dt><dd>INR 5,000 / mo</dd></dl>",
            "<dl><dt>Compensation</dt><dd>Rs 5,000 / mo</dd></dl>",
            "<dl><dt>Salary</dt><dd>₹5,000 / mo</dd></dl>",
            "<dl><dt>Pay</dt><dd>₹5,000 / mo</dd></dl>",
            "<dl><dt>Compensation</dt><dd>₹5000/mo</dd></dl>",
            "<p><strong>Compensation:</strong>&nbsp;₹5,000 / mo</p>",
        ],
    )
    def test_an_equivalent_rewording_produces_an_equivalent_fact(
        self, rewritten: str
    ) -> None:
        baseline = labelled_facts(_page(self.BASELINE))
        rewrite = labelled_facts(_page(rewritten))

        assert (
            rewrite.budget_amount,
            rewrite.budget_currency,
            rewrite.budget_unit,
        ) == (
            baseline.budget_amount,
            baseline.budget_currency,
            baseline.budget_unit,
        ), rewritten


class TestTransformationsThatMustChangeExactlyOneThing:
    """Accidental coupling is what this catches."""

    ROWS = (
        "<dl><dt>Compensation</dt><dd>{pay}</dd>"
        "<dt>Type</dt><dd>{engagement}</dd></dl>"
    )

    def _facts(self, *, pay: str, engagement: str):
        return labelled_facts(_page(self.ROWS.format(pay=pay, engagement=engagement)))

    def test_changing_the_period_changes_only_the_period(self) -> None:
        before = self._facts(pay="₹5,000 / mo", engagement="Part-time / Freelance")
        after = self._facts(pay="₹5,000 / hr", engagement="Part-time / Freelance")

        assert before.budget_unit == "per month"
        assert after.budget_unit == "per hour"
        assert after.budget_amount == before.budget_amount
        assert after.budget_currency == before.budget_currency
        assert after.engagement_type == before.engagement_type

    def test_changing_the_amount_changes_only_the_amount(self) -> None:
        before = self._facts(pay="₹5,000 / mo", engagement="Part-time / Freelance")
        after = self._facts(pay="₹8,000 / mo", engagement="Part-time / Freelance")

        assert (before.budget_amount, after.budget_amount) == (5000, 8000)
        assert after.budget_unit == before.budget_unit
        assert after.budget_currency == before.budget_currency
        assert after.engagement_type == before.engagement_type

    def test_changing_the_currency_changes_only_the_currency(self) -> None:
        before = self._facts(pay="₹5,000 / mo", engagement="Part-time / Freelance")
        after = self._facts(pay="$5,000 / mo", engagement="Part-time / Freelance")

        assert (before.budget_currency, after.budget_currency) == ("INR", "USD")
        assert after.budget_amount == before.budget_amount
        assert after.budget_unit == before.budget_unit

    def test_changing_the_engagement_leaves_the_pay_alone(self) -> None:
        before = self._facts(pay="₹5,000 / mo", engagement="Part-time / Freelance")
        after = self._facts(pay="₹5,000 / mo", engagement="Internship")

        assert before.engagement_type == "ongoing_freelance"
        assert after.engagement_type == "internship"
        assert (after.budget_amount, after.budget_currency, after.budget_unit) == (
            before.budget_amount,
            before.budget_currency,
            before.budget_unit,
        )


class TestThePageIsStillOneJobInEveryShape:
    @pytest.mark.parametrize(
        ("shape", "rows"), COMPENSATION_SHAPES, ids=[name for name, _ in COMPENSATION_SHAPES]
    )
    def test_markup_shape_does_not_change_what_kind_of_page_this_is(
        self, shape: str, rows: str
    ) -> None:
        evidence = classify_job_page(_page(rows), declared_job_titles=[])

        # A single posting must not read as an index because its labelled rows
        # happened to be siblings rather than a definition list.
        assert evidence.classification == "single_job", f"{shape}: {evidence.reason}"
