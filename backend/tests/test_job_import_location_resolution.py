"""Two stated locations: the same place, or a real disagreement?

A live import produced the case this exists for. The page's structured data said
"Bangalore, Karnataka, IN"; its visible text said "Office Location: Brookefield,
Bengaluru". One office, described twice — a renamed city and a neighbourhood
inside it — and the recruiter was asked to arbitrate as though the post had
contradicted itself.

Everything asserted here comes from an explicit rule. There is no fuzzy matching
and no geocoding call, because a wrong equivalence silently relocates somebody's
job, and that is worse than one extra click.
"""

from __future__ import annotations

import pytest

from app.core.job_import_location_resolution import (
    CITY_ALIASES,
    KNOWN_LOCALITIES,
    parse_location,
    resolve_locations,
)

# ---------------------------------------------------------------------------
# 1-5. Established city renamings
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("older", "current", "expected"),
    [
        ("Bangalore", "Bengaluru", "Bengaluru, Karnataka, India"),
        ("Bombay", "Mumbai", "Mumbai, Maharashtra, India"),
        ("Madras", "Chennai", "Chennai, Tamil Nadu, India"),
        ("Calcutta", "Kolkata", "Kolkata, West Bengal, India"),
    ],
)
def test_an_established_renaming_is_one_place(
    older: str, current: str, expected: str
) -> None:
    resolution = resolve_locations([older, current])
    assert resolution.relation == "alias_equivalent"
    assert resolution.recommended == expected
    assert resolution.alias_applied, "the rule used must be recorded"


def test_the_alias_registry_stays_small_and_bidirectional() -> None:
    """Not a gazetteer. Every entry is a claim that two words name one place."""

    assert len(CITY_ALIASES) <= 40, "this list is growing into a guessing table"
    for canonical in CITY_ALIASES.values():
        assert canonical.casefold() in CITY_ALIASES, f"{canonical} is not resolvable"
        assert CITY_ALIASES[canonical.casefold()] == canonical


# ---------------------------------------------------------------------------
# 2, 8. Specificity and containment
# ---------------------------------------------------------------------------


def test_the_reported_case_recommends_the_more_specific_office() -> None:
    resolution = resolve_locations(
        ["Bangalore, Karnataka, IN", "Brookefield, Bengaluru"]
    )
    assert resolution.relation == "same_city_different_specificity"
    assert resolution.recommended == "Brookefield, Bengaluru, Karnataka, India"
    # The less specific reading stays available; nothing is taken away.
    assert "Bengaluru, Karnataka, India" in resolution.alternatives
    assert resolution.containment_rule == "curated_locality"


def test_containment_is_never_inferred_from_resemblance() -> None:
    """An unknown first component must not be promoted into a neighbourhood."""

    resolution = resolve_locations(["Bengaluru, Karnataka", "Bangalore"])
    assert resolution.containment_rule is None
    assert resolution.recommended == "Bengaluru, Karnataka, India"


def test_every_curated_locality_names_a_city_we_know() -> None:
    for locality, city in KNOWN_LOCALITIES.items():
        assert city.casefold() in CITY_ALIASES, f"{locality} points at unknown {city}"


# ---------------------------------------------------------------------------
# 6, 7. Safe normalisation only
# ---------------------------------------------------------------------------


def test_punctuation_and_casing_alone_are_not_a_disagreement() -> None:
    resolution = resolve_locations(["bengaluru , karnataka", "Bengaluru, Karnataka"])
    assert resolution.relation in {"normalized_equivalent", "alias_equivalent"}
    assert resolution.recommended == "Bengaluru, Karnataka, India"


def test_a_country_code_expands_to_a_name_a_candidate_would_read() -> None:
    resolution = resolve_locations(
        ["Bengaluru, KA, IN", "Bengaluru, Karnataka, India"]
    )
    assert resolution.recommended == "Bengaluru, Karnataka, India"
    assert parse_location("Bengaluru, KA, IN").country == "India"
    assert parse_location("New York, US").country == "United States"


# ---------------------------------------------------------------------------
# 11-13. Genuine disagreement
# ---------------------------------------------------------------------------


def test_two_different_cities_recommend_nothing() -> None:
    resolution = resolve_locations(["Bengaluru", "Hyderabad"])
    assert resolution.relation == "genuinely_conflicting"
    assert resolution.recommended is None
    assert len(resolution.alternatives) == 2


def test_two_different_countries_recommend_nothing() -> None:
    resolution = resolve_locations(["New York, US", "London, UK"])
    assert resolution.relation == "genuinely_conflicting"
    assert resolution.recommended is None


def test_an_unrecognised_place_is_offered_rather_than_guessed() -> None:
    """A likely typo is not something to silently correct."""

    resolution = resolve_locations(["Bangalre", "Bengaluru"])
    assert resolution.recommended is None or resolution.relation != "alias_equivalent"
    assert "Bangalre" in " ".join(resolution.alternatives)


# ---------------------------------------------------------------------------
# 9, 10. Work mode
# ---------------------------------------------------------------------------


def test_a_remote_role_is_not_relocated_to_the_employers_office() -> None:
    """The office address describes the employer, not where the work happens.

    Recommending it would quietly turn a remote job into an on-site one in the
    listing candidates read.
    """

    resolution = resolve_locations(
        ["Bangalore, Karnataka, IN", "Brookefield, Bengaluru"], work_mode="remote"
    )
    assert resolution.recommended is None
    assert "remote_scope_preserved" in resolution.normalization_applied
    # The source values remain available for a recruiter who wants one.
    assert len(resolution.alternatives) == 2


def test_a_hybrid_role_keeps_a_workplace_location() -> None:
    resolution = resolve_locations(
        ["Bangalore, Karnataka, IN", "Brookefield, Bengaluru"], work_mode="hybrid"
    )
    assert resolution.recommended == "Brookefield, Bengaluru, Karnataka, India"


def test_an_onsite_role_prefers_the_workplace() -> None:
    resolution = resolve_locations(
        ["Bangalore, Karnataka, IN", "Brookefield, Bengaluru"], work_mode="onsite"
    )
    assert resolution.recommended == "Brookefield, Bengaluru, Karnataka, India"


# ---------------------------------------------------------------------------
# Shape and safety
# ---------------------------------------------------------------------------


def test_a_single_candidate_needs_no_arbitration() -> None:
    resolution = resolve_locations(["Brookefield, Bengaluru"])
    assert resolution.relation == "exact_equivalent"
    assert resolution.recommended == "Brookefield, Bengaluru, Karnataka, India"


def test_nothing_is_claimed_without_candidates() -> None:
    assert resolve_locations([]).relation == "insufficient_information"
    assert resolve_locations(["", "   "]).recommended is None


def test_the_recommendation_is_always_one_of_the_offered_choices() -> None:
    """The control must never recommend something it cannot then accept."""

    for candidates in (
        ["Bangalore, Karnataka, IN", "Brookefield, Bengaluru"],
        ["Bombay", "Mumbai"],
        ["Bengaluru, KA, IN", "Bengaluru, Karnataka, India"],
    ):
        resolution = resolve_locations(candidates)
        assert resolution.recommended in resolution.alternatives


def test_a_recommendation_fits_the_native_location_field() -> None:
    """Post Job stores location as a bounded string; a suggestion must fit it."""

    from app.schemas.job import JobCreate

    limit = next(
        item.max_length
        for item in JobCreate.model_fields["location"].metadata
        if hasattr(item, "max_length")
    )
    resolution = resolve_locations(
        ["Bangalore, Karnataka, IN", "Brookefield, Bengaluru"]
    )
    for option in [resolution.recommended, *resolution.alternatives]:
        assert option is not None and len(option) <= limit


def test_the_audit_record_is_bounded_and_explains_itself() -> None:
    audit = resolve_locations(
        ["Bangalore, Karnataka, IN", "Brookefield, Bengaluru"]
    ).audit()
    assert audit["relation"] == "same_city_different_specificity"
    assert audit["containment_rule"] == "curated_locality"
    assert len(audit["alternatives"]) <= 8


# ---------------------------------------------------------------------------
# The reported source, end to end.
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_the_shine_source_asks_only_for_the_location_and_offers_an_answer(
    client,
) -> None:
    """The live import that prompted all of this, reproduced deterministically.

    Everything the post stated must be read: the stipend, its unit, how the role
    is paid, and that it is an internship. The one thing genuinely open is which
    of two renderings of the same office candidates should see — and that must
    arrive as a one-click choice, not an empty box.
    """

    from uuid import UUID, uuid4

    from conftest import TestSessionLocal
    from test_job_import_checkpoint import _auth

    from app.repositories.job_import_repository import JobImportRepository
    from app.repositories.job_repository import JobRepository
    from app.schemas.job_import import JobImportExtractionResponse
    from app.services.job_import_service import JobImportService
    from app.services.job_service import JobService

    title = "AI Graphics Designer and Video Editor Intern 6 months onsite"
    headers, owner_id = await _auth(client, "shine-location")
    source = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": title,
            "original_text": (
                f"{title}. Internship Details. Duration: 6 Months. "
                "Stipend: 15,000 per month. Work Mode: Onsite. "
                "Office Location: Brookefield, Bengaluru."
            ),
            "idempotency_key": uuid4().hex,
        },
    )
    draft = await client.post(
        f"/api/v1/job-imports/sources/{source.json()['id']}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": uuid4().hex,
        },
    )
    draft_id = draft.json()["id"]

    def evidenced(field_path: str, value: object, snippet: str) -> dict[str, object]:
        return {
            "field_path": field_path,
            "value": value,
            "provenance": "extracted_from_source",
            "evidence": [{"snippet": snippet}],
        }

    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            UUID(draft_id),
            JobImportExtractionResponse.model_validate(
                {
                    "extraction_schema_version": 1,
                    "target_listing_schema_version": 3,
                    "fields": [
                        evidenced("title", title, title),
                        evidenced("budget_amount", 15000, "Stipend: 15,000 per month"),
                        evidenced("budget_unit", "per month", "15,000 per month"),
                        evidenced("budget_currency", "INR", "Stipend: 15,000"),
                        evidenced("engagement_type", "internship", "Internship Details"),
                        evidenced("work_mode", "onsite", "Work Mode: Onsite"),
                    ],
                    "conflicts": [
                        {
                            "field_path": "location",
                            "values": [
                                {
                                    "value": "Bangalore, Karnataka, IN",
                                    "evidence": [{"snippet": "Bangalore, Karnataka"}],
                                },
                                {
                                    "value": "Brookefield, Bengaluru",
                                    "evidence": [
                                        {"snippet": "Office Location: Brookefield"}
                                    ],
                                },
                            ],
                            "explanation": "The page names the office twice.",
                        }
                    ],
                    "missing_fields": [],
                    "warnings": [],
                }
            ),
            owner_user_id=owner_id,
        )

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text

    asked: list[str] = []
    location_question: dict[str, object] | None = None
    question = begun.json().get("active_question")
    for _ in range(20):
        if question is None:
            break
        asked.append(question["field_path"])
        if question["field_path"] == "location":
            location_question = question
            break
        shape = question.get("answer") or {}
        if shape.get("choices"):
            value: object = shape["choices"][0]
            if shape.get("is_list"):
                key = shape.get("item_key")
                value = [{key: value}] if key else [value]
        elif shape.get("kind") == "number":
            value = 5
        elif shape.get("kind") == "date":
            value = "2027-01-15"
        else:
            value = "Supplied by the location regression check."
        answered = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={"field_path": question["field_path"], "value": value},
        )
        if answered.status_code != 200:
            break
        question = answered.json().get("active_question")

    # Nothing the post stated outright is asked back.
    for settled in (
        "budget_amount",
        "budget_unit",
        "compensation_mode",
        "engagement_type",
    ):
        assert settled not in asked, f"{settled} was on the page and still asked"

    assert location_question is not None, "the open question should be the location"
    recommended = location_question.get("recommended_value")
    assert recommended == "Brookefield, Bengaluru, Karnataka, India"
    offered = [
        item["value"] for item in location_question.get("alternatives") or []
    ]
    assert recommended in offered, "the recommendation must be clickable"
    assert "Bengaluru, Karnataka, India" in offered, "the city-only reading stays"

    # One click settles it, and the answer is accepted by the native field.
    accepted = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={"field_path": "location", "value": recommended},
    )
    assert accepted.status_code == 200, accepted.text

    stored = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    location_row = next(
        item for item in stored["fields"] if item["field_path"] == "location"
    )
    assert location_row["effective_value"] == recommended


@pytest.mark.anyio
async def test_a_recruiter_may_enter_a_location_of_their_own(client) -> None:
    """The recommendation is an offer. A typed answer still wins."""

    from uuid import UUID, uuid4

    from conftest import TestSessionLocal
    from test_job_import_checkpoint import _auth

    from app.repositories.job_import_repository import JobImportRepository
    from app.repositories.job_repository import JobRepository
    from app.schemas.job_import import JobImportExtractionResponse
    from app.services.job_import_service import JobImportService
    from app.services.job_service import JobService

    headers, owner_id = await _auth(client, "location-custom")
    source = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": "Editor",
            "original_text": "Editor role. Office in Bangalore, Karnataka. Brookefield.",
            "idempotency_key": uuid4().hex,
        },
    )
    draft = await client.post(
        f"/api/v1/job-imports/sources/{source.json()['id']}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": uuid4().hex,
        },
    )
    draft_id = draft.json()["id"]
    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            UUID(draft_id),
            JobImportExtractionResponse.model_validate(
                {
                    "extraction_schema_version": 1,
                    "target_listing_schema_version": 3,
                    "fields": [],
                    "conflicts": [
                        {
                            "field_path": "location",
                            "values": [
                                {
                                    "value": "Bangalore, Karnataka, IN",
                                    "evidence": [{"snippet": "Bangalore, Karnataka"}],
                                },
                                {
                                    "value": "Brookefield, Bengaluru",
                                    "evidence": [{"snippet": "Brookefield"}],
                                },
                            ],
                        }
                    ],
                    "missing_fields": [],
                    "warnings": [],
                }
            ),
            owner_user_id=owner_id,
        )
    await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )

    typed = "Whitefield, Bengaluru, Karnataka, India"
    accepted = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
        headers=headers,
        json={"field_path": "location", "value": typed},
    )
    assert accepted.status_code == 200, accepted.text

    stored = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    row = next(item for item in stored["fields"] if item["field_path"] == "location")
    assert row["effective_value"] == typed
    assert row["review_status"] == "edited", "a recruiter answer outranks a suggestion"
