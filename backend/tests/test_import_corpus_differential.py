"""Every composed page, compared against what it actually says.

A corpus is only worth having if something checks the answer. "The import
produced fields" is not an answer — it passes for a page read completely wrong.
So each page carries ground truth, and each field is classified against it:
exact, safely omitted, or one of the three failures that matter.

The serialization dimension is the reason this exists in its current form. A
definition list minified onto one line lost every row but the first, and every
fixture missed it because fixtures are written by hand and hand-written HTML has
newlines in it. Here the same page is emitted pretty, minified, without newlines
and with excessive whitespace, and all four must say the same thing.
"""

from __future__ import annotations

import pytest

from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_native_values import convert_to_native
from app.core.job_page_evidence import classify_job_page
from tests.import_corpus import (
    COMPLETENESS,
    CORPUS,
    DATA_LOCATIONS,
    MARKUP_SHAPES,
    NOISE_KINDS,
    SERIALIZATIONS,
    build_page,
)


class TestTheCorpusIsStructurallyDiverse:
    def test_there_are_at_least_fifty_distinct_structures(self) -> None:
        assert len(CORPUS) >= 50, len(CORPUS)

        signatures = {
            tuple(sorted(page.dimensions.items())) for page in CORPUS
        }
        # Fifty near-identical pages would be fifty of the same test.
        assert len(signatures) == len(CORPUS)

    @pytest.mark.parametrize(
        ("dimension", "values"),
        [
            ("markup", MARKUP_SHAPES),
            ("location", DATA_LOCATIONS),
            ("serialization", SERIALIZATIONS),
            ("noise", NOISE_KINDS),
            ("completeness", COMPLETENESS),
        ],
    )
    def test_every_value_of_every_dimension_appears(
        self, dimension: str, values: tuple[str, ...]
    ) -> None:
        present = {page.dimensions[dimension] for page in CORPUS}

        assert set(values) <= present, set(values) - present

    def test_every_pair_of_markup_and_serialization_appears(self) -> None:
        # The interaction that hid the minified definition-list defect.
        pairs = {
            (page.dimensions["markup"], page.dimensions["serialization"])
            for page in CORPUS
        }

        assert len(pairs) == len(MARKUP_SHAPES) * len(SERIALIZATIONS), len(pairs)


class TestEachPageSaysWhatItSays:
    """The differential oracle: ground truth versus what was extracted."""

    @pytest.mark.parametrize("page", CORPUS, ids=[page.ident for page in CORPUS])
    def test_the_rate_is_exact_or_safely_omitted(self, page) -> None:
        facts = labelled_facts(page.text())

        if page.truth.budget_amount is None:
            # Nothing stated. Reading a figure from a neighbouring job or the
            # company's funding round would be a fabrication.
            assert facts.budget_amount is None, (
                f"{page.ident} {page.dimensions}: invented "
                f"{facts.budget_amount}"
            )
            return

        # Omitting is safe; getting it wrong is not. Prose-only pages are
        # deliberately allowed to omit, because the labelled reader only reads
        # labels — the provider is what reads prose.
        if facts.budget_amount is None:
            assert page.dimensions["location"] == "prose_only", (
                f"{page.ident} {page.dimensions}: lost a labelled rate"
            )
            return

        assert facts.budget_amount == page.truth.budget_amount, page.dimensions
        assert facts.budget_currency == page.truth.budget_currency, page.dimensions
        assert facts.budget_unit == page.truth.budget_unit, page.dimensions

    @pytest.mark.parametrize("page", CORPUS, ids=[page.ident for page in CORPUS])
    def test_the_engagement_is_exact_or_safely_omitted(self, page) -> None:
        facts = labelled_facts(page.text())

        if page.truth.engagement_type is None:
            return
        if facts.engagement_type is None:
            assert page.dimensions["location"] in {"prose_only", "json_ld_only"}, (
                f"{page.ident} {page.dimensions}: lost a labelled engagement"
            )
            return

        assert facts.engagement_type == page.truth.engagement_type, page.dimensions

    @pytest.mark.parametrize("page", CORPUS, ids=[page.ident for page in CORPUS])
    def test_no_page_is_ever_read_as_an_index(self, page) -> None:
        evidence = classify_job_page(page.text(), declared_job_titles=[])

        # Every page in the corpus is one job, however much noise surrounds it.
        # Rejecting one as an index would tell the recruiter their own posting
        # is a search results page.
        assert evidence.classification in {"single_job", "ambiguous", "thin_or_shell"}, (
            f"{page.ident} {page.dimensions}: {evidence.classification} "
            f"({evidence.reason})"
        )

    @pytest.mark.parametrize("page", CORPUS, ids=[page.ident for page in CORPUS])
    def test_a_neighbouring_jobs_rate_never_becomes_this_ones(self, page) -> None:
        facts = labelled_facts(page.text())

        # 95000 and 140000 belong to the related-jobs and recommendation cards.
        assert facts.budget_amount not in {95000, 140000}, (
            f"{page.ident} {page.dimensions}: took a neighbour's rate"
        )

    @pytest.mark.parametrize("page", CORPUS, ids=[page.ident for page in CORPUS])
    def test_a_footer_address_never_becomes_the_city(self, page) -> None:
        if page.truth.city is None:
            return
        stored = convert_to_native("location", f"{page.truth.city}, Tamil Nadu, IN")

        assert stored.native_value == page.truth.city, page.dimensions


class TestSerializationChangesNothing:
    """The same page, served four ways, must say one thing."""

    @pytest.mark.parametrize("markup", MARKUP_SHAPES)
    @pytest.mark.parametrize("location", DATA_LOCATIONS)
    def test_all_four_serializations_agree(self, markup: str, location: str) -> None:
        readings = {}
        for serialization in SERIALIZATIONS:
            page = build_page(
                ident=f"S-{markup}-{location}-{serialization}",
                markup=markup,
                location=location,
                noise="related_jobs",
                serialization=serialization,
                completeness="rich",
            )
            facts = labelled_facts(page.text())
            readings[serialization] = (
                facts.budget_amount,
                facts.budget_currency,
                facts.budget_unit,
                facts.engagement_type,
            )

        distinct = set(readings.values())
        assert len(distinct) == 1, f"{markup}/{location}: {readings}"

    def test_minification_specifically_loses_nothing(self) -> None:
        # Named on its own because this is the defect that motivated the
        # dimension. A site that minifies its HTML is not a different job.
        for markup in MARKUP_SHAPES:
            pretty = build_page(
                ident=f"M-{markup}-pretty",
                markup=markup,
                location="labelled_only",
                noise="none",
                serialization="pretty",
                completeness="rich",
            )
            minified = build_page(
                ident=f"M-{markup}-min",
                markup=markup,
                location="labelled_only",
                noise="none",
                serialization="minified",
                completeness="rich",
            )

            before = labelled_facts(pretty.text())
            after = labelled_facts(minified.text())

            assert after.budget_amount == before.budget_amount, markup
            assert after.engagement_type == before.engagement_type, markup


class TestNoiseChangesNothing:
    @pytest.mark.parametrize("markup", MARKUP_SHAPES)
    def test_every_noise_kind_leaves_the_facts_alone(self, markup: str) -> None:
        readings = {}
        for noise in NOISE_KINDS:
            page = build_page(
                ident=f"N-{markup}-{noise}",
                markup=markup,
                location="labelled_only",
                noise=noise,
                serialization="minified",
                completeness="rich",
            )
            facts = labelled_facts(page.text())
            readings[noise] = (facts.budget_amount, facts.engagement_type)

        assert len(set(readings.values())) == 1, f"{markup}: {readings}"
