"""The canonical scenario generator.

These hold the properties that make one generator safe to depend on from two
consumers: that it is deterministic, that its cross-references are real, that
the coverage a QA brief asks for is actually present, and that a manifest which
does not match this build fails loudly instead of half-loading.
"""

from __future__ import annotations

import json
import tempfile
from collections import Counter
from pathlib import Path

import pytest

from app.db.creator_scenarios import (
    MANIFEST_VERSION,
    SCENARIO_NAMES,
    ManifestError,
    check_backend_enums,
    check_version,
    generate,
    manifest_json,
    scenario_id,
    validate,
    write_all,
)
from app.db.creator_scenarios.generator import RETIRED_JOB_KEYS, SCENARIO_SEEDS
from app.db.creator_scenarios.heroes import hero_keys
from app.db.creator_scenarios.schema import PAYMENT_STATES

MANIFEST_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "creator_scenarios" / "generated"


def _all_manifests():
    return [generate(name) for name in SCENARIO_NAMES]


# --- determinism ------------------------------------------------------------


@pytest.mark.parametrize("scenario", SCENARIO_NAMES)
def test_the_same_seed_produces_byte_identical_output(scenario: str) -> None:
    # Byte-identical, not "equivalent": the manifests are committed, so any
    # instability shows up as a phantom diff on every unrelated branch.
    assert manifest_json(generate(scenario)) == manifest_json(generate(scenario))


@pytest.mark.parametrize("scenario", SCENARIO_NAMES)
def test_the_committed_manifest_matches_what_the_generator_produces(scenario: str) -> None:
    committed = (MANIFEST_DIR / f"{scenario}.json").read_text(encoding="utf-8")
    assert committed == manifest_json(generate(scenario)), (
        f"{scenario}.json is stale or was hand-edited. "
        "Run: python -m app.db.creator_scenarios"
    )


def test_regeneration_into_a_fresh_directory_reproduces_the_committed_files() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        write_all(Path(tmp))
        for scenario in SCENARIO_NAMES:
            assert (Path(tmp) / f"{scenario}.json").read_bytes() == (
                MANIFEST_DIR / f"{scenario}.json"
            ).read_bytes(), scenario


def test_a_different_seed_produces_meaningfully_different_records() -> None:
    # Guards the opposite failure: a "deterministic" generator that ignores its
    # seed would pass every test above while producing one dataset forever.
    from app.db.creator_scenarios.generator import Builder, _bulk

    def run(seed: int) -> list[str]:
        builder = Builder("default", seed, "probe")
        recruiter = builder.recruiter(0)
        job = builder.job(recruiter, 1)
        _bulk(
            builder, count=8, job=job, recruiter=recruiter,
            stage_cycle=("new", "reviewing", "hired"), talent_base=1, key_prefix="probe", salt=seed,
        )
        return [r.engagement.payment_state for r in builder.relationships if r.engagement]

    assert run(1) != run(3)


def test_identifiers_are_keyed_by_meaning_not_by_position() -> None:
    # The scenario index and any bookmarked QA URL depend on this: adding a
    # record must not renumber the ones around it.
    assert scenario_id("relationship", "default", "hero:payment-disputed") == scenario_id(
        "relationship", "default", "hero:payment-disputed"
    )
    assert scenario_id("relationship", "default", "a") != scenario_id("relationship", "default", "b")
    assert scenario_id("relationship", "busy", "a") != scenario_id("relationship", "default", "a")


# --- structure --------------------------------------------------------------


@pytest.mark.parametrize("scenario", SCENARIO_NAMES)
def test_every_manifest_validates(scenario: str) -> None:
    validate(generate(scenario))


def test_the_manifest_vocabularies_match_the_live_backend() -> None:
    # Restating the enums keeps the manifest readable, but a retired backend
    # status that the manifest kept seeding would be silently invalid data.
    check_backend_enums()


def test_an_unknown_manifest_version_is_refused_rather_than_guessed() -> None:
    with pytest.raises(ManifestError) as excinfo:
        check_version(MANIFEST_VERSION + 1)
    assert "not supported" in str(excinfo.value)


def test_a_broken_cross_reference_fails_loudly() -> None:
    manifest = generate("edge")
    manifest.relationships[0].job_id = "not-a-real-job"
    with pytest.raises(ManifestError) as excinfo:
        validate(manifest)
    assert "unknown job" in str(excinfo.value)


def test_an_unknown_scenario_name_is_refused() -> None:
    with pytest.raises(ValueError) as excinfo:
        generate("staging")
    assert "Unknown scenario" in str(excinfo.value)


def test_no_manifest_stores_a_preformatted_timestamp() -> None:
    """Every instant is an offset; the consumer materialises the real date.

    A stored ISO string would freeze the dataset in the month it was generated
    and break byte-identical regeneration the following day.
    """

    for scenario in SCENARIO_NAMES:
        payload = (MANIFEST_DIR / f"{scenario}.json").read_text(encoding="utf-8")
        for needle in ("T00:00:00", "Z\"", "202", "GMT", "ago"):
            if needle == "202":
                # A bare year would mean a date leaked into copy or a field.
                assert '"2024' not in payload and '"2025' not in payload and '"2026' not in payload, scenario
            else:
                assert needle not in payload or needle == "Z\"", scenario


# --- coverage ---------------------------------------------------------------


def test_default_meets_the_volume_minimums() -> None:
    stats = generate("default").stats
    assert stats["jobs"] >= 15
    assert stats["applications"] + stats["hiring_requests"] >= 150
    assert stats["conversations"] >= 60
    assert stats["actors"] >= 60


def test_busy_carries_the_pagination_and_counting_cases() -> None:
    manifest = generate("busy")
    per_job = Counter(rel.job_id for rel in manifest.relationships if rel.job_id)
    counts = sorted(per_job.values(), reverse=True)
    assert counts[0] >= 200, "a job with 200+ applicants is the pagination case"
    assert 47 in counts, "the 47-applicant case"
    assert 1 in counts, "the single-applicant case"
    # A job with no applicants at all cannot appear in the counter, so it is
    # checked against the job list instead.
    with_applicants = set(per_job)
    assert any(job.id not in with_applicants for job in manifest.jobs), "the zero-applicant case"
    assert len({job.owner_id for job in manifest.jobs}) >= 1
    longest = max(len(rel.messages) for rel in manifest.relationships)
    assert longest >= 40, "a conversation long enough to test scrolling"


def test_every_payment_state_has_at_least_five_records() -> None:
    counts: Counter[str] = Counter()
    for manifest in _all_manifests():
        for rel in manifest.relationships:
            if rel.engagement and rel.engagement.payment_state:
                counts[rel.engagement.payment_state] += 1
    missing = {state: counts.get(state, 0) for state in PAYMENT_STATES if counts.get(state, 0) < 5}
    assert not missing, f"payment states under five records: {missing}"


def test_every_lifecycle_stage_has_at_least_five_records() -> None:
    counts: Counter[str] = Counter()
    for manifest in _all_manifests():
        for rel in manifest.relationships:
            counts[rel.stage] += 1
    required = ("new", "reviewing", "interviewing", "hired", "rejected", "withdrawn", "archived",
                "accepted", "declined", "shortlisted")
    missing = {stage: counts.get(stage, 0) for stage in required if counts.get(stage, 0) < 5}
    assert not missing, f"stages under five records: {missing}"


def test_both_relationship_directions_are_represented() -> None:
    # Direction changes what a backend status *means* to each side, so a
    # dataset with only applications cannot exercise the mapping at all.
    for name in ("default", "talent", "recruiter"):
        manifest = generate(name)
        kinds = {rel.kind for rel in manifest.relationships}
        assert kinds == {"application", "hiring_request"}, f"{name} carries only {kinds}"


def test_legacy_shortlisted_is_seeded_both_privately_and_communicated() -> None:
    manifest = generate("default")
    shortlisted = [rel for rel in manifest.relationships if rel.stage == "shortlisted"]
    assert shortlisted, "no legacy Shortlisted records"
    assert any(rel.participant_stage == "shortlisted" for rel in shortlisted), "none communicated"
    assert any(rel.participant_stage != "shortlisted" for rel in shortlisted), "none private"
    # Every legacy row says why it exists, so nobody mistakes it for a state the
    # current rules can still produce.
    assert all(rel.historical for rel in shortlisted)


def test_the_retired_job_ids_are_reused_rather_than_reinvented() -> None:
    for name in ("default", "edge", "talent", "recruiter", "busy"):
        manifest = generate(name)
        legacy = {job.legacy_key for job in manifest.jobs if job.legacy_key}
        assert legacy == set(RETIRED_JOB_KEYS), f"{name} has {legacy}"
        closed = [job for job in manifest.jobs if job.legacy_key]
        assert all(job.status == "closed" for job in closed)
        # A closed job with applicants still on it is the point of keeping them.
        job_ids = {job.id for job in closed}
        assert any(rel.job_id in job_ids for rel in manifest.relationships)


def test_portfolio_coverage_spans_empty_through_very_large() -> None:
    manifest = generate("edge")
    sizes = sorted(len(rel.portfolio_ids) for rel in manifest.relationships)
    assert 0 in sizes
    assert 1 in sizes
    assert max(sizes) >= 20, "a portfolio large enough to need progressive disclosure"
    media = {item.media for item in manifest.portfolio}
    assert {"video", "image", "link"} <= media
    assert any(item.thumbnail_broken for item in manifest.portfolio), "no deliberately broken thumbnail"
    assert any(item.thumbnail_url is None for item in manifest.portfolio), "no missing thumbnail"
    assert any(item.duration_seconds for item in manifest.portfolio)


def test_the_manifest_carries_no_generated_poster_data() -> None:
    # Posters are produced from stable ids by the frontend. Embedding them here
    # would duplicate Phase 3's generator and bloat every manifest.
    for scenario in SCENARIO_NAMES:
        payload = (MANIFEST_DIR / f"{scenario}.json").read_text(encoding="utf-8")
        assert "data:image" not in payload
        assert "linear-gradient" not in payload


def test_transient_ui_conditions_are_kept_out_of_the_lifecycle() -> None:
    manifest = generate("edge")
    assert manifest.client_state, "the edge scenario should carry transient conditions"
    kinds = {entry.kind for entry in manifest.client_state}
    assert {"draft", "send_failed", "broken_image"} <= kinds
    # None of these is a database fact, so none may appear as a stage.
    stages = {rel.stage for rel in manifest.relationships}
    assert not (kinds & stages)


def test_empty_is_genuinely_empty_rather_than_merely_filtered() -> None:
    manifest = generate("empty")
    assert manifest.relationships == []
    assert manifest.jobs == []
    assert manifest.portfolio == []
    # Enough identity to authenticate and load the app, and nothing more.
    assert manifest.actors, "empty still needs an account to sign in as"


def test_every_hero_journey_is_placed_and_indexed() -> None:
    manifest = generate("default")
    indexed = {entry.relationship_id for entry in manifest.index}
    for key in hero_keys():
        rel_id = scenario_id("relationship", "default", f"hero:{key}")
        assert any(rel.id == rel_id for rel in manifest.relationships), f"hero {key} is missing"
        assert rel_id in indexed, f"hero {key} is not in the scenario index"


def test_the_scenario_index_points_at_real_records() -> None:
    for manifest in _all_manifests():
        ids = {rel.id for rel in manifest.relationships}
        for entry in manifest.index:
            assert entry.relationship_id in ids
            assert entry.route.startswith("/")
            assert entry.action_to_test, "an index row with no action is not usable by QA"


def test_canonical_vocabulary_is_used_outside_the_edge_scenario() -> None:
    # One spelling per platform. Three spellings would make the creator filters
    # offer three options for one platform and make coverage meaningless.
    for name in ("default", "talent", "recruiter", "busy"):
        manifest = generate(name)
        platforms = {platform for job in manifest.jobs for platform in job.platforms}
        assert all(platform == platform.lower() for platform in platforms), platforms
        assert "Youtube" not in platforms and "You Tube" not in platforms


def test_seeds_are_fixed_constants_not_derived_from_ordering() -> None:
    assert set(SCENARIO_SEEDS) == set(SCENARIO_NAMES)
    assert len(set(SCENARIO_SEEDS.values())) == len(SCENARIO_NAMES)


def test_manifests_on_disk_parse_and_declare_this_version() -> None:
    for scenario in SCENARIO_NAMES:
        payload = json.loads((MANIFEST_DIR / f"{scenario}.json").read_text(encoding="utf-8"))
        assert payload["version"] == MANIFEST_VERSION
        assert payload["scenario"] == scenario
