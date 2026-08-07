"""Two ways a good page can still produce a bad draft.

The first is collateral loss: one malformed field in a provider reply taking
unrelated valid extraction down with it. A page full of work produced "No work
details added yet", and separately one stray field name discarded a
twenty-three-field extraction.

The second is contamination: a page that is mostly one job but carries other
jobs around it — recommendations, a sidebar, a careers list. Reading the wrong
one, or blending several, produces a draft nobody wrote.
"""

from __future__ import annotations

import pytest

from app.core.job_page_evidence import classify_job_page

POSTING = """
Senior Video Editor
About the role
Cut long-form documentary episodes for a weekly series.
Responsibilities
Edit episodes, build rough cuts, hand off for colour.
Qualifications
3+ years of experience with Premiere Pro and After Effects.
Benefits
Health cover and paid time off.
"""

RECOMMENDATIONS = "\n".join(
    f"{title}\nAcme Studio\nRemote\n"
    for title in ("Motion Designer", "Producer", "Colourist", "Sound Editor")
)


class TestOneBadFieldCannotEraseTheRest:
    """Salvage per field, except where security says otherwise."""

    def test_an_unknown_field_name_is_dropped_not_fatal(self) -> None:
        from app.core.job_import_policy import (
            LEGACY_COMPATIBILITY_IMPORT_FIELDS,
            SYSTEM_OWNED_IMPORT_FIELDS,
            import_field_policy,
        )

        # The salvage rule keys on "unknown and not privileged", so a future
        # extraction field cannot take a good reply down with it.
        assert import_field_policy("some_future_field") is None
        assert "some_future_field" not in SYSTEM_OWNED_IMPORT_FIELDS
        assert "some_future_field" not in LEGACY_COMPATIBILITY_IMPORT_FIELDS

    @pytest.mark.parametrize(
        "field_path", ["status", "hiring_verification_status_snapshot"]
    )
    def test_a_server_owned_reach_still_refuses_the_whole_reply(
        self, field_path: str
    ) -> None:
        from app.core.job_import_policy import SYSTEM_OWNED_IMPORT_FIELDS

        # A model asking to publish a job, or to claim a verified identity, is
        # asking for authority it must never have. Salvage must not soften this.
        assert field_path in SYSTEM_OWNED_IMPORT_FIELDS

    def test_an_unusable_value_does_not_block_the_explicit_fact(self) -> None:
        from app.services.job_import_service import JobImportService

        # An overlong experience string cannot reach the 64-character column, so
        # it must not stand in the way of the value that can.
        overlong = "x" * 120
        assert JobImportService._structured_value_may_fill(
            {
                "field_path": "experience_level",
                "provenance_state": "extracted_from_source",
                "review_status": "pending",
                "proposed_value": overlong,
            }
        )

    def test_a_rejected_value_does_not_block_it_either(self) -> None:
        from app.services.job_import_service import JobImportService

        assert JobImportService._structured_value_may_fill(
            {
                "field_path": "work_mode",
                "provenance_state": "extracted_from_source",
                "review_status": "pending",
                "proposed_value": "whatever the team prefers",
            }
        )


class TestNeighbouringJobsDoNotContaminate:
    def test_a_posting_with_recommendations_beside_it_still_imports(self) -> None:
        # Recommendation cards are normal furniture on a detail page. Rejecting
        # every page that has them would reject most real listings.
        evidence = classify_job_page(
            POSTING + RECOMMENDATIONS, declared_job_titles=["Senior Video Editor"]
        )

        assert evidence.classification == "single_job"

    def test_the_same_posting_declared_twice_is_one_job(self) -> None:
        evidence = classify_job_page(
            POSTING, declared_job_titles=["Senior Video Editor", "Senior Video Editor"]
        )

        assert evidence.classification == "single_job"

    def test_several_distinct_postings_are_refused(self) -> None:
        evidence = classify_job_page(
            POSTING,
            declared_job_titles=["Senior Video Editor", "Motion Designer", "Producer"],
        )

        assert evidence.classification == "multi_job_or_index"
        assert not evidence.may_extract

    def test_a_careers_list_is_refused_even_with_one_detailed_card(self) -> None:
        listing = (
            "Jobs at Acme\nCurrent openings\n13 jobs\nFilter by team\nSort by date\n"
            + RECOMMENDATIONS
            + POSTING
        )

        assert classify_job_page(listing).classification == "multi_job_or_index"

    def test_a_search_page_is_refused(self) -> None:
        search = (
            "Remote Video Editor Jobs\nPost a Job\nFilter by salary\n"
            "Showing 40 results\nLoad more\n" + RECOMMENDATIONS + "Skills\nBenefits\n"
        )

        assert classify_job_page(search).classification == "multi_job_or_index"

    def test_only_a_single_job_may_ever_be_extracted(self) -> None:
        for titles in (["A", "B"], ["A", "B", "C"]):
            assert not classify_job_page(POSTING, declared_job_titles=titles).may_extract
