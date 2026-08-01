from __future__ import annotations

import pytest

from app.core.job_import_inference import (
    country_from_location,
    currency_for_country,
    import_decision_policy,
    infer_compensation_currency,
)


@pytest.mark.parametrize(
    ("location", "country", "currency"),
    [
        ("New York, United States", "US", "USD"),
        ("Bengaluru, India", "IN", "INR"),
        ("London", "GB", "GBP"),
        ("Germany", "DE", "EUR"),
        ("Poland", "PL", "PLN"),
        ("Toronto", "CA", "CAD"),
    ],
)
def test_country_and_currency_resolver_uses_authoritative_local_data(
    location: str,
    country: str,
    currency: str,
) -> None:
    resolved_country = country_from_location(location)
    assert resolved_country == country
    assert currency_for_country(resolved_country) == currency


@pytest.mark.parametrize(
    "location",
    [
        "Remote worldwide",
        "Anywhere in the world",
        "United States and Canada",
        "Global remote",
        "",
    ],
)
def test_ambiguous_or_global_locations_remain_unknown(location: str) -> None:
    assert country_from_location(location) is None


def test_role_location_wins_over_employer_location() -> None:
    decision = infer_compensation_currency(
        explicit_currency=None,
        amount_present=True,
        role_location="India",
        work_mode="onsite",
        employer_location="United States",
    )

    assert decision.currency == "INR"
    assert decision.origin == "contextual_inference"
    assert decision.confidence == "high"
    assert decision.rationale_code == "currency_from_role_country"


def test_local_employer_country_is_only_used_for_local_work() -> None:
    local = infer_compensation_currency(
        explicit_currency=None,
        amount_present=True,
        role_location=None,
        work_mode="hybrid",
        employer_location="Germany",
    )
    remote = infer_compensation_currency(
        explicit_currency=None,
        amount_present=True,
        role_location=None,
        work_mode="remote",
        employer_location="Germany",
    )

    assert local.currency == "EUR"
    assert local.rationale_code == "currency_from_local_employer_country"
    assert remote.currency is None


def test_explicit_currency_wins_and_reports_context_conflict() -> None:
    decision = infer_compensation_currency(
        explicit_currency="inr",
        amount_present=True,
        role_location="United States",
    )

    assert decision.currency == "INR"
    assert decision.origin == "explicit"
    assert decision.conflict_currency == "USD"


def test_currency_is_not_added_without_an_amount_or_location() -> None:
    without_amount = infer_compensation_currency(
        explicit_currency=None,
        amount_present=False,
        role_location="United States",
    )
    without_location = infer_compensation_currency(
        explicit_currency=None,
        amount_present=True,
        role_location=None,
    )

    assert without_amount.currency is None
    assert without_location.currency is None


def test_currency_resolver_has_no_url_or_browser_locale_input() -> None:
    # A .com URL or the recruiter's locale cannot accidentally influence this API.
    decision = infer_compensation_currency(
        explicit_currency=None,
        amount_present=True,
        role_location=None,
        work_mode="remote",
    )
    assert decision.currency is None


def test_field_policy_separates_safe_semantic_and_explicit_only_values() -> None:
    role = import_decision_policy("primary_role_key")
    amount = import_decision_policy("budget_amount")
    currency = import_decision_policy("budget_currency")
    seniority = import_decision_policy("experience_level")

    assert "semantic_inference" in role.allowed_origins
    assert role.auto_fill_confidence == "high"
    assert amount.allowed_origins == frozenset({"explicit"})
    assert amount.risk == "high"
    assert currency.allowed_origins == frozenset({"explicit", "contextual_inference"})
    assert seniority.auto_fill_confidence is None
    assert seniority.suggestion_confidence == "medium"
