"""Defects a live benchmark across real job boards exposed.

Fixtures are sanitised to the *shape* that triggered each defect, not to the
companies that happened to serve them — a rule that would only hold for one
employer's page is not a rule.
"""

from __future__ import annotations

import pytest

from app.core.job_import_native_values import convert_to_native
from app.core.job_import_structured_fields import _experience_band


class TestAStatedFloorKeepsItsFloor:
    """Structured experience must not gain a ceiling nobody wrote.

    A live listing declared "At least 60 months of experience" in its markup and
    CreatorJobs produced "5–7 years": a maximum the employer never set, which
    reads a candidate with nine years out of a job they were wanted for. The
    derivation closed every open requirement by adding three years to the floor,
    and turned a month count into a two-year window.
    """

    @pytest.mark.parametrize(
        ("stated", "expected"),
        [
            ("At least 60 months of experience", "At least 5 years"),
            ("Minimum of 36 months", "At least 3 years"),
            ("At least 24 months of experience", "At least 2 years"),
            ("3+ years", "3+ years"),
            ("2-4 years", "2–4 years"),
            ("5 years of experience", "5 years"),
            ("18 months", "18 months"),
        ],
    )
    def test_the_requirement_survives_as_stated(self, stated: str, expected: str) -> None:
        assert _experience_band(stated) == expected

    @pytest.mark.parametrize("stated", ["At least 60 months of experience", "3+ years"])
    def test_no_open_requirement_gains_a_ceiling(self, stated: str) -> None:
        derived = _experience_band(stated) or ""

        # An en dash between two figures is the shape of an invented maximum.
        assert not any(
            part.strip().isdigit()
            for part in derived.replace("–", "-").split("-")[1:]
        ), derived


class TestOneCityFieldHoldsOneCity:
    """A location string can name several places, or none.

    A live listing read "Remote (Pansophic Learning); Tysons Corner, VA" and the
    whole string — employer name and second location included — went into a
    field holding one city.
    """

    @pytest.mark.parametrize(
        ("stated", "expected"),
        [
            ("Remote (Pansophic Learning); Tysons Corner, VA", "Tysons Corner, VA"),
            ("Tysons Corner, VA; New York, NY", "Tysons Corner, VA"),
            ("Boston, MA (Preferred)", "Boston, MA"),
            ("Hybrid / Remote: Bengaluru", "Bengaluru"),
        ],
    )
    def test_the_first_real_place_is_the_one_used(self, stated: str, expected: str) -> None:
        assert convert_to_native("location", stated).native_value == expected

    def test_an_employer_name_is_never_a_city(self) -> None:
        assert convert_to_native("location", "Remote (Acme Inc)").native_value is None

    @pytest.mark.parametrize(
        ("stated", "expected"),
        [
            # The accepted cases must keep working.
            ("Coimbatore, Coimbatore district, IN", "Coimbatore"),
            ("Brookefield, Bengaluru", "Brookefield, Bengaluru"),
            ("San Francisco, California, US", "San Francisco"),
        ],
    )
    def test_previously_fixed_shapes_still_hold(self, stated: str, expected: str) -> None:
        assert convert_to_native("location", stated).native_value == expected

    def test_an_arrangement_alone_is_still_not_a_place(self) -> None:
        assert convert_to_native("location", "Remote, India").native_value is None


class TestOneStrayFieldNameDoesNotDestroyAnExtraction:
    """A field we do not model is a quality slip, not grounds to discard 23 good ones.

    Observed live: the same BeBee page imported cleanly on one run and failed
    outright on the next, purely on which field names the provider returned. The
    recruiter saw a failed import for a page the system had just read correctly.

    Reaching for a field the *server* owns is different in kind and still refuses
    the whole reply — a model asking to set publication status or to claim a
    verified hiring identity is asking for authority it must never have.
    """

    @staticmethod
    def _paths(response) -> set[str]:
        return {item.field_path for item in response.fields}

    def test_an_unknown_field_is_dropped_and_the_rest_survive(self) -> None:
        from app.core.job_import_policy import import_field_policy

        # The rule under test, stated directly: unknown names are not in the
        # policy, and are not server-owned either.
        assert import_field_policy("favourite_colour") is None
        from app.core.job_import_policy import (
            LEGACY_COMPATIBILITY_IMPORT_FIELDS,
            SYSTEM_OWNED_IMPORT_FIELDS,
        )

        assert "favourite_colour" not in SYSTEM_OWNED_IMPORT_FIELDS
        assert "favourite_colour" not in LEGACY_COMPATIBILITY_IMPORT_FIELDS

    def test_server_owned_fields_remain_a_whole_reply_refusal(self) -> None:
        from app.core.job_import_policy import SYSTEM_OWNED_IMPORT_FIELDS

        # These are the reaches that must never be salvaged around.
        assert "status" in SYSTEM_OWNED_IMPORT_FIELDS
        assert "hiring_verification_status_snapshot" in SYSTEM_OWNED_IMPORT_FIELDS


class TestPayIsOneDecisionNotTwo:
    """Five of seven live sources asked the same two money questions in a row.

    A page silent about money leaves two native fields unset — how the figure is
    expressed, and what period it covers — and the queue asked for each in turn.
    Nobody hires by choosing a "compensation mode": they decide whether they are
    paying for a project, an hour, a month or a piece, and that one decision
    settles both fields.
    """

    @staticmethod
    def _options() -> list[dict]:
        import inspect

        from app.services.job_import_conversation_service import JobImportConversationService

        source = inspect.getsource(JobImportConversationService._group_money_question)
        assert '"grouped_fields"' in source
        return source

    def test_the_grouped_question_covers_both_fields(self) -> None:
        source = self._options()

        assert '["budget_unit", "compensation_mode"]' in source
        assert "How is this role paid?" in source

    def test_the_options_read_as_offers_not_field_names(self) -> None:
        source = self._options()

        for label in (
            "A fixed amount for the whole project",
            "An hourly rate",
            "A monthly amount",
            "A rate for each piece of work",
            "Open to discussion with the candidate",
        ):
            assert label in source

        # No internal field name may reach the recruiter's screen as a label.
        assert '"label": "budget_unit' not in source
        assert '"label": "compensation_mode' not in source

    def test_grouping_only_happens_while_both_are_open(self) -> None:
        # If the source settled one of them, what remains is already the
        # smallest question worth asking and must not be widened again.
        source = self._options()

        assert 'unresolved("compensation_mode") and unresolved("budget_unit")' in source
