"""Finding the right company's website, or finding none.

Enrichment could previously describe a brand only when the account had already
registered its site. Everything else left the recruiter to research their own
company, which is the manual work this product exists to remove. Discovery lifts
that limit, and the whole of this file is about lifting it without lifting the
safety.

Two properties carry the risk, and both are worse than a blank field:

**The wrong company.** "Pulse" is a fitness studio, a payments company and a
health system. A name alone cannot choose between them, so resolution consumes
the job's own context and returns a verdict — and two plausible candidates
produce nothing.

**Search prose reaching a candidate.** A result snippet is a search engine's
description of a page. It discovers *which URL*; the URL is then fetched through
the accepted safe fetcher and grounded exactly as a registered one would be.

The ladder tests below are as much about cost as correctness: a job whose own
page introduces the company must not cause a search, because the answer was
already retrieved.
"""

from __future__ import annotations

import pytest

from app.core.brand_discovery import (
    BrandContext,
    DiscoveryResult,
    accept_discovery,
    brand_name_fingerprint,
    brand_names_equivalent,
    discovered_page_matches_identity,
    host_of,
    looks_official,
    source_copy_matches_identity,
)
from app.core.brand_identity import resolve_brand_identity
from app.services.brand_enrichment_service import (
    BrandEnrichmentService,
    brand_evidence_from_source_page,
    import_brand_inputs_for_job,
)

BRAND = "Finance Simplified"
OFFICIAL = "https://financesimplified.example"

EVIDENCE = (
    "Finance Simplified publishes personal finance videos aimed at helping young "
    "adults understand money, budgeting and investing. The channel produces "
    "explainers and short videos across YouTube and Instagram for viewers new to "
    "managing their own finances."
)
GROUNDED = "Finance Simplified publishes personal finance videos for young adults."


class _Summarizer:
    def __init__(self, reply: str | None = GROUNDED) -> None:
        self.reply = reply
        self.calls = 0

    async def summarize(
        self, *, brand_name: str, evidence: str, **_context
    ) -> str | None:
        self.calls += 1
        return self.reply


class _Fetcher:
    def __init__(self, text: str = EVIDENCE, *, error: Exception | None = None) -> None:
        self.text = text
        self.error = error
        self.calls = 0
        self.urls: list[str] = []

    async def fetch(self, url: str):
        self.calls += 1
        self.urls.append(url)
        if self.error:
            raise self.error

        class _R:
            normalized_text = self.text
            final_url = url

        return _R()


class _Finder:
    """A stand-in search layer. Returns whatever verdict the test dictates."""

    def __init__(self, result: DiscoveryResult, *, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls = 0
        self.contexts: list[BrandContext] = []

    async def find_official_site(self, context: BrandContext) -> DiscoveryResult:
        self.calls += 1
        self.contexts.append(context)
        if self.error:
            raise self.error
        return self.result


def _identity(**overrides):
    base = {
        "display_name": BRAND,
        "official_url": None,
        "verification_status": "VERIFIED",
    }
    base.update(overrides)
    return resolve_brand_identity(**base)


def _service(*, finder=None, summarizer=None, fetcher=None):
    summarizer = summarizer or _Summarizer()
    fetcher = fetcher or _Fetcher()
    service = BrandEnrichmentService(summarizer, fetcher=fetcher, finder=finder)
    return service, summarizer, fetcher


class TestASearchResultIsNotAnIdentity:
    @pytest.mark.parametrize(
        "url",
        [
            "https://en.wikipedia.org/wiki/Pulse",
            "https://www.crunchbase.com/organization/pulse",
            "https://www.linkedin.com/company/pulse",
            "https://www.glassdoor.com/Overview/pulse",
            "https://boards.greenhouse.io/pulse",
            "https://jobs.lever.co/pulse",
            "https://www.simplyhired.co.in/company/pulse",
            "http://127.0.0.1/internal",
            "http://[::1]/internal",
            "http://metadata.internal/latest",
            "http://localhost/admin",
        ],
    )
    def test_a_page_about_a_company_is_not_the_company(self, url: str) -> None:
        # These may describe the right organisation and are still somebody else
        # writing about it. Grounding a brand's own introduction in a directory
        # entry is how a stale or wrong description gets published.
        assert not looks_official(url)

    def test_the_board_the_job_came_from_is_never_the_brand(self) -> None:
        # The transport is not the employer. "About Greenhouse" under a job
        # posted through Greenhouse is the failure this prevents.
        context = BrandContext(name="Pulse", source_host="myworkday.example")

        assert not looks_official("https://myworkday.example/pulse", source_host="myworkday.example")
        assert not looks_official("https://careers.myworkday.example", source_host="myworkday.example")
        assert accept_discovery(
            DiscoveryResult("verified_match", "https://myworkday.example/pulse"),
            context=context,
        ).verdict == "ambiguous"

    def test_a_confident_verdict_naming_no_site_is_refused(self) -> None:
        refused = accept_discovery(
            DiscoveryResult("verified_match", None), context=BrandContext(name=BRAND)
        )

        assert refused.verdict == "no_match"

    def test_a_brands_own_site_passes(self) -> None:
        assert looks_official(OFFICIAL)
        assert host_of(OFFICIAL) == "financesimplified.example"

    @pytest.mark.parametrize(
        ("left", "right"),
        [
            ("Finance Simplified, Pvt. Ltd.", "Finance Simplified"),
            ("A.C.M.E. Ltd", "ACME"),
            ("Birth-Marque", "Birth Marque"),
        ],
    )
    def test_punctuation_and_legal_suffix_variants_are_the_same_identity(
        self, left: str, right: str
    ) -> None:
        assert brand_names_equivalent(left, right)

    def test_meaningful_name_words_are_not_mistaken_for_legal_suffixes(self) -> None:
        assert brand_name_fingerprint("Studio One") == "studioone"
        assert not brand_names_equivalent("Studio One", "One")

    def test_partial_or_neighboring_names_are_not_fuzzy_matched(self) -> None:
        assert not brand_names_equivalent("Finance Simplified India", BRAND)
        assert not brand_names_equivalent("Pulse Health", "Pulse Payments")


@pytest.mark.asyncio
class TestTheLadderStopsAtTheCheapestAnswer:
    async def test_recruiter_text_costs_nothing(self) -> None:
        finder = _Finder(DiscoveryResult("verified_match", OFFICIAL))
        service, summarizer, fetcher = _service(finder=finder)

        result = await service.enrich(_identity(), existing_about="We make videos.")

        assert result.outcome == "already_written"
        assert (finder.calls, fetcher.calls, summarizer.calls) == (0, 0, 0)

    async def test_a_held_description_costs_nothing(self) -> None:
        finder = _Finder(DiscoveryResult("verified_match", OFFICIAL))
        service, summarizer, fetcher = _service(finder=finder)
        identity = _identity(existing_description="Finance Simplified makes money explainers.")

        result = await service.enrich(identity, existing_about=None)

        assert result.outcome == "success_existing_description"
        assert (finder.calls, fetcher.calls, summarizer.calls) == (0, 0, 0)

    async def test_a_company_introduction_on_the_job_page_avoids_the_web(self) -> None:
        finder = _Finder(DiscoveryResult("verified_match", OFFICIAL))
        service, summarizer, fetcher = _service(finder=finder)
        source = "Video Editor\n\nAbout us\n" + EVIDENCE + "\n\nResponsibilities\nEdit videos."

        result = await service.enrich(_identity(), existing_about=None, source_text=source)

        assert result.outcome == "success_source_page"
        assert result.about == GROUNDED
        # The answer was already retrieved. Searching for it would be waste and
        # another chance to find the wrong company.
        assert finder.calls == 0
        assert fetcher.calls == 0
        assert summarizer.calls == 1

    async def test_source_company_copy_is_not_used_for_a_different_selected_identity(
        self,
    ) -> None:
        finder = _Finder(DiscoveryResult("verified_match", "https://elsewhere.example"))
        service, summarizer, fetcher = _service(finder=finder)
        source = (
            "Video Editor\n\nAbout Nabbe\n"
            "Nabbe builds recruitment software for employers and agencies seeking "
            "people across several industries and locations around the world."
        )
        context = BrandContext(name=BRAND, source_employer="Nabbe")

        result = await service.enrich(
            _identity(official_url=OFFICIAL),
            existing_about=None,
            source_text=source,
            context=context,
        )

        assert result.outcome == "success_official_site"
        assert result.about == GROUNDED
        assert fetcher.urls == [OFFICIAL]
        assert finder.calls == 0
        assert summarizer.calls == 1

    async def test_source_company_punctuation_variant_avoids_search(self) -> None:
        finder = _Finder(DiscoveryResult("verified_match", OFFICIAL))
        service, summarizer, fetcher = _service(finder=finder)
        source = "Video Editor\n\nAbout us\n" + EVIDENCE
        context = BrandContext(
            name=BRAND,
            source_employer="Finance-Simplified Pvt. Ltd.",
        )

        result = await service.enrich(
            _identity(), existing_about=None, source_text=source, context=context
        )

        assert result.outcome == "success_source_page"
        assert (finder.calls, fetcher.calls, summarizer.calls) == (0, 0, 1)

    async def test_a_registered_site_is_used_without_searching(self) -> None:
        finder = _Finder(DiscoveryResult("verified_match", "https://elsewhere.example"))
        service, summarizer, fetcher = _service(finder=finder)

        result = await service.enrich(_identity(official_url=OFFICIAL), existing_about=None)

        assert result.outcome == "success_official_site"
        assert finder.calls == 0
        assert fetcher.urls == [OFFICIAL]
        assert summarizer.calls == 1

    async def test_discovery_runs_only_when_no_site_is_registered(self) -> None:
        finder = _Finder(DiscoveryResult("high_confidence_match", OFFICIAL))
        service, summarizer, fetcher = _service(finder=finder)

        result = await service.enrich(_identity(), existing_about=None)

        assert result.outcome == "success_official_site"
        assert finder.calls == 1
        # Discovery chose the URL; the accepted fetcher retrieved it, and the
        # grounding path is the same one a registered URL takes.
        assert fetcher.urls == [OFFICIAL]
        assert summarizer.calls == 1


@pytest.mark.asyncio
class TestAmbiguityProducesNothing:
    async def test_an_ambiguous_brand_is_left_blank(self) -> None:
        finder = _Finder(DiscoveryResult("ambiguous", None, "two plausible companies"))
        service, summarizer, fetcher = _service(finder=finder)

        result = await service.enrich(_identity(), existing_about=None)

        assert result.outcome == "ambiguous_brand"
        assert result.about is None
        # Nothing was fetched and nothing was written: a blank field costs a
        # paragraph, the wrong company's description costs the recruiter's
        # credibility.
        assert fetcher.calls == 0 and summarizer.calls == 0

    async def test_an_ambiguous_verdict_cannot_smuggle_a_candidate_url(self) -> None:
        finder = _Finder(
            DiscoveryResult("ambiguous", OFFICIAL, "two plausible companies")
        )
        service, summarizer, fetcher = _service(finder=finder)

        result = await service.enrich(_identity(), existing_about=None)

        assert result.outcome == "ambiguous_brand"
        assert result.about is None
        assert fetcher.calls == 0 and summarizer.calls == 0

    async def test_no_match_is_left_blank(self) -> None:
        finder = _Finder(DiscoveryResult("no_match", None, "nothing found"))
        service, _, fetcher = _service(finder=finder)

        result = await service.enrich(_identity(), existing_about=None)

        assert result.about is None
        assert fetcher.calls == 0

    async def test_a_confident_verdict_pointing_at_an_aggregator_is_refused(self) -> None:
        finder = _Finder(
            DiscoveryResult("verified_match", "https://www.crunchbase.com/organization/x")
        )
        service, summarizer, fetcher = _service(finder=finder)

        result = await service.enrich(_identity(), existing_about=None)

        # The finder was confident. The server does not have to agree.
        assert result.about is None
        assert fetcher.calls == 0 and summarizer.calls == 0

    async def test_a_failing_finder_is_harmless(self) -> None:
        finder = _Finder(DiscoveryResult("no_match"), error=RuntimeError("search down"))
        service, _, fetcher = _service(finder=finder)

        result = await service.enrich(_identity(), existing_about=None)

        assert result.about is None
        assert result.outcome == "error"
        assert fetcher.calls == 0

    async def test_without_a_finder_behaviour_is_exactly_as_before(self) -> None:
        service, summarizer, fetcher = _service(finder=None)

        result = await service.enrich(_identity(), existing_about=None)

        # A name with no registered site was — and without a finder still is —
        # the end of the road. Discovery is what changes that, and it is opt-in.
        assert result.outcome == "no_reliable_identity"
        assert fetcher.calls == 0 and summarizer.calls == 0


class TestSearchIsGivenEnoughToDisambiguate:
    def test_a_bare_name_is_never_the_only_query(self) -> None:
        context = BrandContext(
            name="Pulse",
            industry_terms=("health", "technology"),
            location="Boston",
            known_identifiers=("@pulsehealth",),
        )
        queries = context.query_terms()

        # The most qualified query runs first, so a caller that stops at the
        # first usable answer stops at the best-disambiguated one.
        assert "health" in queries[0]
        assert any("@pulsehealth" in query for query in queries)
        assert any("Boston" in query for query in queries)
        assert all('"Pulse"' in query for query in queries)

    def test_a_nameless_context_asks_nothing(self) -> None:
        assert BrandContext(name="   ").query_terms() == []

    def test_a_common_name_cannot_use_location_to_mask_the_wrong_industry(self) -> None:
        context = BrandContext(
            name="Pulse",
            industry_terms=("health technology",),
            location="Boston",
        )
        wrong_page = (
            "Pulse is a payments company in Boston offering merchant accounts "
            "and transaction software to retailers and banking customers."
        )

        assert not discovered_page_matches_identity(
            context=context,
            evidence=wrong_page,
            final_url="https://pulse.example",
            verdict="verified_match",
        )

    def test_account_owned_handle_can_corroborate_a_common_name(self) -> None:
        context = BrandContext(
            name="Pulse",
            known_identifiers=("@pulsehealth", "youtube @pulsehealth"),
        )

        assert discovered_page_matches_identity(
            context=context,
            evidence=(
                "Pulse Health shares patient education and health technology "
                "updates from the @pulsehealth channel."
            ),
            final_url="https://pulse.example/about",
            verdict="high_confidence_match",
        )

    def test_a_common_name_requires_context_on_the_fetched_page(self) -> None:
        context = BrandContext(name="Pulse", industry_terms=("health technology",))
        right_page = (
            "Pulse develops health technology for clinical teams and patients, "
            "with care coordination software for hospitals and health systems."
        )

        assert discovered_page_matches_identity(
            context=context,
            evidence=right_page,
            final_url="https://pulse.example",
            verdict="high_confidence_match",
        )

    @pytest.mark.parametrize("name", ["Pulse", "Nova", "Studio One", "Creator Lab"])
    def test_common_or_generic_names_without_context_fail_closed(self, name: str) -> None:
        assert not discovered_page_matches_identity(
            context=BrandContext(name=name),
            evidence=(
                f"{name} provides products and services for customers through its "
                "online platform and works with teams across several markets."
            ),
            final_url=f"https://{brand_name_fingerprint(name)}.example",
            verdict="verified_match",
        )

    def test_a_distinctive_exact_name_can_be_corroborated_without_job_words(self) -> None:
        assert discovered_page_matches_identity(
            context=BrandContext(name=BRAND),
            evidence=EVIDENCE,
            final_url=OFFICIAL,
            verdict="verified_match",
        )

    def test_a_structured_source_employer_outranks_incidental_page_mentions(self) -> None:
        assert not source_copy_matches_identity(
            brand_name=BRAND,
            source_employer="Nabbe",
            evidence=f"Nabbe partners with {BRAND} on occasional projects.",
        )


class TestBrandCopyOnTheJobPage:
    @pytest.mark.parametrize(
        "heading",
        ["About us", "About the company", "Who we are", "Our channel", "Our mission"],
    )
    def test_a_company_section_is_recognised(self, heading: str) -> None:
        source = f"Video Editor\n\n{heading}\n{EVIDENCE}\n\nResponsibilities\nEdit."

        assert "personal finance videos" in brand_evidence_from_source_page(source)

    def test_role_sections_are_not_brand_copy(self) -> None:
        source = (
            "Video Editor\n\nResponsibilities\n"
            "Edit four videos a month and write captions for each of them.\n"
        )

        assert brand_evidence_from_source_page(source) == ""

    def test_legal_boilerplate_is_not_brand_copy(self) -> None:
        source = (
            "Video Editor\n\nAbout us\n"
            "We are an equal opportunity employer and consider all applicants "
            "without regard to any protected characteristic whatsoever.\n"
        )

        # True of the company and useless to a candidate deciding whether to
        # apply — and not what the employer wrote as an introduction.
        assert brand_evidence_from_source_page(source) == ""

    def test_no_source_text_is_not_an_error(self) -> None:
        assert brand_evidence_from_source_page(None) == ""
        assert brand_evidence_from_source_page("") == ""


@pytest.mark.asyncio
class TestPrivateImportContext:
    async def test_source_and_native_context_are_bounded_and_server_owned(self) -> None:
        class _Source:
            original_text = "Private imported source " * 10_000
            final_source_url = "https://www.simplyhired.co.in/job/123"
            source_url = "https://redirect.example/job/123"
            retrieval_metadata = {
                "structured_context": {
                    "employer_name": "Finance Simplified",
                    "industry": ["Personal finance", "Education"],
                    "job_title": "Video Editor",
                    "role_location": "Chennai, Tamil Nadu, IN",
                }
            }

        class _Result:
            def scalar_one_or_none(self):
                return _Source()

        class _Session:
            async def execute(self, _statement):
                return _Result()

        class _Job:
            id = object()
            content_niches = ["Education", "Money"]
            content_genres = ["Explainer"]
            primary_role_name_snapshot = "Video Editor"
            role_specialization = None
            title = "Senior Video Editor"
            location = "Remote"

        class _Identity:
            display_name = " Finance   Simplified "
            platform = "youtube"
            handle = "@financesimplified"

        source_text, context = await import_brand_inputs_for_job(
            _Session(), _Job(), _Identity()
        )

        assert source_text is not None and len(source_text) == 120_000
        assert context.name == BRAND
        assert context.source_employer == BRAND
        assert context.source_host == "simplyhired.co.in"
        assert context.location == "Chennai, Tamil Nadu, IN"
        assert context.industry_terms == (
            "Personal finance",
            "Education",
            "Money",
            "Explainer",
        )
        assert context.role_terms[:2] == ("Video Editor", "Senior Video Editor")
        assert context.known_identifiers == (
            "@financesimplified",
            "youtube @financesimplified",
        )

    async def test_native_job_context_still_exists_without_an_import_source(self) -> None:
        class _Result:
            def scalar_one_or_none(self):
                return None

        class _Session:
            async def execute(self, _statement):
                return _Result()

        class _Job:
            id = object()
            content_niches = ["Gaming"]
            content_genres = []
            primary_role_name_snapshot = "Thumbnail Designer"
            role_specialization = None
            title = "YouTube Thumbnail Designer"
            location = "Remote"

        class _Identity:
            display_name = "Creator Lab"

        source_text, context = await import_brand_inputs_for_job(
            _Session(), _Job(), _Identity()
        )

        assert source_text is None
        assert context.source_employer is None
        assert context.source_host is None
        assert context.industry_terms == ("Gaming",)
        assert context.role_terms == (
            "Thumbnail Designer",
            "YouTube Thumbnail Designer",
        )
