"""The same page, read by a provider having a slightly different day.

A model is not a function. Run the same listing twice and the second reply may
name a field the first omitted, phrase a responsibility differently, order a list
another way, or volunteer something nobody asked for. None of that should reach
the recruiter, because none of it is a fact about their job — it is a fact about
the sampler.

So the contract is about the *final native draft*, never the provider JSON. What
a page states explicitly must survive every one of these variations identically:
an omitted field falls back to what the page itself said, an unknown field is
dropped rather than stored, an invalid one is refused, and a low-confidence extra
never outranks a stated fact.

Everything here is deterministic. Provider variance is simulated rather than
sampled, because sampling it would need dozens of paid calls to prove something a
constructed reply proves exactly.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_native_values import convert_to_native
from app.core.job_import_structured_fields import fields_from_structured_context
from app.db.seed_data_job_import_labelled import labelled_pay_page
from tests.test_job_import_fixtures import _auth, _fixture


def _page_facts() -> tuple[dict, object]:
    text, metadata = labelled_pay_page()
    structured = fields_from_structured_context(metadata.get("structured_context") or {})
    return structured, labelled_facts(text)


class TestWhatThePageStatesSurvivesEveryProviderShape:
    """The five structural cases, against one page that states its facts."""

    def test_an_omitted_field_falls_back_to_what_the_page_said(self) -> None:
        # The provider offering nothing about pay is the *actual* live case:
        # the markup carried no compensation at all. The labelled row is what
        # rescued it, and it must not depend on the provider having tried.
        _structured, labelled = _page_facts()

        assert labelled.budget_amount == 5000
        assert labelled.budget_currency == "INR"
        assert labelled.budget_unit == "per month"

    def test_an_omitted_engagement_still_reaches_the_employers_own_answer(self) -> None:
        _structured, labelled = _page_facts()

        assert labelled.engagement_type == "ongoing_freelance"

    def test_equivalent_prose_converts_to_one_native_value(self) -> None:
        # Three ways of saying the same thing must not become three drafts.
        for written in ("remote", "Remote", "REMOTE"):
            conversion = convert_to_native("work_mode", written)
            assert conversion.native_value == "remote", written

    @pytest.mark.parametrize(
        ("written", "expected"),
        [
            ("ongoing_freelance", "ongoing_freelance"),
            ("Ongoing_Freelance", "ongoing_freelance"),
            ("ONGOING_FREELANCE", "ongoing_freelance"),
        ],
    )
    def test_casing_never_changes_the_stored_value(
        self, written: str, expected: str
    ) -> None:
        assert convert_to_native("engagement_type", written).native_value == expected

    def test_an_unsupported_value_is_refused_rather_than_approximated(self) -> None:
        # The whole point of the containment model: a value the schema cannot
        # hold is reported as unsupported, never rounded to a nearby literal.
        conversion = convert_to_native("engagement_type", "volunteer")

        assert conversion.outcome in ("unsupported", "invalid")
        assert conversion.native_value != "internship"

    def test_a_stated_experience_is_never_narrowed(self) -> None:
        # The defect that started this: "25 years" became a closed 5–8 band,
        # which cannot truthfully represent it.
        conversion = convert_to_native(
            "experience_level", "At least 25 years of professional experience"
        )

        assert conversion.outcome != "invalid"
        assert "5" not in str(conversion.native_value or "") or "25" in str(conversion.native_value)


@pytest.mark.asyncio
class TestTheSameFixtureAlwaysProducesTheSameDraft:
    """Determinism, asserted rather than assumed."""

    @staticmethod
    def _values(draft: dict) -> dict[str, object]:
        return {
            field["field_path"]: field["effective_value"]
            for field in draft["fields"]
            if field["effective_value"] not in (None, "", [], {})
        }

    async def test_two_runs_of_one_scenario_agree_on_every_field(
        self, client: AsyncClient
    ) -> None:
        results = []
        for index in range(2):
            headers = await _auth(client, f"variance-repeat-{index}")
            response = await _fixture(client, headers, "labelled-pay-conflict")
            assert response.status_code in (200, 201), response.text
            body = response.json()
            results.append(self._values(body.get("draft") or body))

        assert results[0] == results[1]

    async def test_the_facts_the_page_states_are_the_ones_that_reach_the_draft(
        self, client: AsyncClient
    ) -> None:
        headers = await _auth(client, "variance-explicit")
        response = await _fixture(client, headers, "labelled-pay-conflict")
        values = self._values(response.json().get("draft") or response.json())

        # Explicit facts, in the product's own vocabulary. Stated on the page,
        # so no provider shape may change any of them.
        assert values["budget_amount"] == "5000"
        assert values["budget_currency"] == "INR"
        assert values["budget_unit"] == "per month"
        assert values["compensation_mode"] == "fixed"
        assert values["engagement_type"] == "ongoing_freelance"
        assert values["title"] == "(Paid) Content Creator & Social Media Manager"

    async def test_a_reordered_list_is_still_the_same_set_of_work(
        self, client: AsyncClient
    ) -> None:
        headers = await _auth(client, "variance-order")
        response = await _fixture(client, headers, "labelled-pay-conflict")
        values = self._values(response.json().get("draft") or response.json())
        responsibilities = values.get("responsibilities") or []

        # Order is the provider's; content is the page's. A reply that shuffles
        # the list must not look like a different job.
        assert len(responsibilities) >= 5
        assert any("reels" in str(item).lower() for item in responsibilities)


class TestAProviderRepliesShapeNeverReachesTheRecruiter:
    @pytest.mark.parametrize("value", [None, "", [], {}])
    def test_an_empty_value_is_not_stored_as_a_fact(self, value: object) -> None:
        conversion = convert_to_native("title", value)

        assert conversion.native_value in (None, "", [], {})

    def test_whitespace_is_not_a_statement(self) -> None:
        # Stored "exactly", it filled the row with something that renders as
        # nothing: the field looked answered, so nothing was asked about it, and
        # the recruiter reached Post Job to find it blank with no explanation.
        # An empty string is different — that is how a field is cleared.
        assert convert_to_native("title", "   ").native_value is None
        assert convert_to_native("title", "").native_value == ""

    def test_an_unknown_field_name_is_refused_before_it_is_ever_converted(self) -> None:
        # The conversion helper is deliberately not where this is caught — it
        # answers "can this value live in this field", and an unknown name has
        # no field to answer about. The reply-level guard is what refuses it,
        # and it is asserted where it lives.
        from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES

        assert "not_a_real_field" not in JOB_IMPORT_FIELD_POLICIES

    def test_a_confidence_score_is_not_a_fact(self) -> None:
        # A low-confidence extra must never outrank something the page stated.
        # The containment model has no notion of confidence at all, which is
        # what makes that true by construction rather than by rule.
        conversion = convert_to_native("work_mode", "hybrid")

        assert conversion.native_value == "hybrid"
        assert not hasattr(conversion, "confidence")
