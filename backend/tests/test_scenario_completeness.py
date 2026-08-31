"""The completeness contract, and proof that each of its guards can fail.

A validator nobody has watched reject anything is a validator you are trusting
on faith. Every guard below is exercised twice: once against the real corpus,
which must pass, and once against a corpus with exactly one thing broken, which
must name that one thing.

Breaking one field at a time is the point. A guard that only fires when three
things are wrong at once will not catch the single regression that actually
happens, and a suite that mutates broadly can pass while the specific guard it
claims to cover is dead code.
"""

from __future__ import annotations

import copy
from collections.abc import Callable
from typing import Any

import pytest

from app.db.creator_scenarios import ManifestError, generate, validate
from app.db.creator_scenarios.generator import SCENARIO_BUILDERS
from app.db.creator_scenarios.validation import (
    EVIDENCE_FLOOR,
    NORMAL_SCENARIOS,
    check_timezone_coverage,
)

Mutate = Callable[[Any], None]


@pytest.fixture(scope="module")
def corpus() -> dict[str, Any]:
    """Every scenario, generated once. Generation itself now validates."""
    return {name: generate(name) for name in sorted(SCENARIO_BUILDERS)}


def _first_talent(manifest: Any) -> tuple[Any, Any]:
    """The first live application, as (applicant, relationship)."""
    live = [rel for rel in manifest.relationships if not rel.archived]
    talent = next(actor for actor in manifest.actors if actor.id == live[0].talent_id)
    return talent, live[0]


# --- the corpus itself ------------------------------------------------------


def test_every_scenario_generates_and_validates(corpus: dict[str, Any]) -> None:
    # Generation calls validate(), so reaching here is already the assertion;
    # this states it rather than leaving it implied by the fixture.
    for name, manifest in corpus.items():
        validate(manifest)
        # `empty` is the one scenario whose correctness *is* emptiness.
        if name != "empty":
            assert manifest.relationships, f"{name} has no relationships to review"


def test_normal_scenarios_carry_a_complete_applicant(corpus: dict[str, Any]) -> None:
    for name in sorted(NORMAL_SCENARIOS):
        manifest = corpus[name]
        by_id = {actor.id: actor for actor in manifest.actors}
        for rel in manifest.relationships:
            if rel.archived:
                continue
            talent = by_id[rel.talent_id]
            assert talent.bio, f"{name}: {talent.username} has no biography"
            assert talent.timezone, f"{name}: {talent.username} has no timezone"
            assert talent.skills, f"{name}: {talent.username} lists no skills"
            assert talent.tools, f"{name}: {talent.username} lists no tools"


def test_normal_scenario_applicants_clear_the_evidence_floor(
    corpus: dict[str, Any],
) -> None:
    for name in sorted(NORMAL_SCENARIOS):
        manifest = corpus[name]
        owned: dict[str, int] = {}
        for item in manifest.portfolio:
            owned[item.owner_id] = owned.get(item.owner_id, 0) + 1
        thin = [
            rel.talent_id
            for rel in manifest.relationships
            if not rel.archived and owned.get(rel.talent_id, 0) < EVIDENCE_FLOOR
        ]
        assert not thin, f"{name}: {len(thin)} applicants below the evidence floor"


def test_edge_keeps_its_deliberate_gaps(corpus: dict[str, Any]) -> None:
    # The floor is a rule about normal data, not a claim that empty profiles
    # never happen. `edge` exists to render exactly those, so a contract that
    # scrubbed them would delete the cases QA most needs.
    manifest = corpus["edge"]
    owned: dict[str, int] = {}
    for item in manifest.portfolio:
        owned[item.owner_id] = owned.get(item.owner_id, 0) + 1
    thin = [
        rel.talent_id
        for rel in manifest.relationships
        if not rel.archived and owned.get(rel.talent_id, 0) < EVIDENCE_FLOOR
    ]
    assert thin, "edge no longer contains a thin-evidence applicant to test against"


def test_every_location_in_the_pool_resolves_to_a_timezone() -> None:
    # The map was silently half-wrong once: it keyed on invented city names, so
    # real locations fell through to None and the guard above never ran.
    check_timezone_coverage()


# --- one broken thing at a time --------------------------------------------


def _blank_bio(manifest: Any) -> None:
    _first_talent(manifest)[0].bio = None


def _blank_timezone(manifest: Any) -> None:
    _first_talent(manifest)[0].timezone = None


def _no_skills(manifest: Any) -> None:
    _first_talent(manifest)[0].skills = []


def _no_tools(manifest: Any) -> None:
    _first_talent(manifest)[0].tools = []


def _no_handle(manifest: Any) -> None:
    _first_talent(manifest)[0].username = ""


def _unroutable_handle(manifest: Any) -> None:
    _first_talent(manifest)[0].username = "Has Space"


def _duplicate_handle(manifest: Any) -> None:
    manifest.actors[1].username = manifest.actors[0].username


def _placeholder_name(manifest: Any) -> None:
    _first_talent(manifest)[0].display_name = "Test User"


def _placeholder_bio(manifest: Any) -> None:
    _first_talent(manifest)[0].bio = "Lorem ipsum dolor sit amet"


def _portfolio_without_description(manifest: Any) -> None:
    manifest.portfolio[0].description = None


def _portfolio_owned_by_a_stranger(manifest: Any) -> None:
    manifest.portfolio[0].owner_id = "00000000-0000-0000-0000-000000000000"


def _unsafe_portfolio_url(manifest: Any) -> None:
    manifest.portfolio[0].url = "javascript:alert(1)"


def _application_without_a_job(manifest: Any) -> None:
    _first_talent(manifest)[1].job_id = None


def _below_the_evidence_floor(manifest: Any) -> None:
    talent, _ = _first_talent(manifest)
    manifest.portfolio = [p for p in manifest.portfolio if p.owner_id != talent.id]


def _someone_elses_portfolio(manifest: Any) -> None:
    talent, rel = _first_talent(manifest)
    other = next(p for p in manifest.portfolio if p.owner_id != talent.id)
    rel.portfolio_ids = [other.id]


def _incomplete_hiring_identity(manifest: Any) -> None:
    _, rel = _first_talent(manifest)
    recruiter = next(a for a in manifest.actors if a.id == rel.recruiter_id)
    recruiter.description = None


def _answer_to_an_unasked_question(manifest: Any) -> None:
    for rel in manifest.relationships:
        for message in rel.messages:
            if message.kind == "screening_answers":
                message.metadata["answers"][0]["position"] = 42
                return
    raise AssertionError("no screening answers in the corpus to break")


def _required_question_left_blank(manifest: Any) -> None:
    for rel in manifest.relationships:
        for message in rel.messages:
            if message.kind == "screening_answers":
                message.metadata["answers"][0]["response"] = ""
                message.metadata["answers"][0]["required"] = True
                return
    raise AssertionError("no screening answers in the corpus to break")


def _answers_nobody_asked_for(manifest: Any) -> None:
    # Strip the ask from a conversation that answered it. A record with neither
    # is legitimately quiet, so removing questions anywhere else proves nothing.
    for rel in manifest.relationships:
        kinds = {message.kind for message in rel.messages}
        if {"screening_questions", "screening_answers"} <= kinds:
            rel.messages = [m for m in rel.messages if m.kind != "screening_questions"]
            return
    raise AssertionError("no answered screening in the corpus to break")


GUARDS: tuple[tuple[str, Mutate, str], ...] = (
    ("missing biography", _blank_bio, "has no bio"),
    ("missing timezone", _blank_timezone, "has no timezone"),
    ("empty skills", _no_skills, "empty skills"),
    ("empty tools", _no_tools, "empty tools"),
    ("no profile route", _no_handle, "no username"),
    ("unroutable handle", _unroutable_handle, "invalid profile slug"),
    ("duplicate handle", _duplicate_handle, "duplicate handle"),
    ("placeholder display name", _placeholder_name, "placeholder display_name"),
    ("placeholder biography", _placeholder_bio, "placeholder bio"),
    ("portfolio without description", _portfolio_without_description, "no description"),
    ("portfolio owned by a stranger", _portfolio_owned_by_a_stranger, "unknown owner"),
    ("unsafe portfolio URL", _unsafe_portfolio_url, "malformed URL"),
    ("application with no job", _application_without_a_job, "has no job"),
    ("below the evidence floor", _below_the_evidence_floor, "portfolio"),
    ("another actor's portfolio", _someone_elses_portfolio, "attaches portfolio"),
    ("incomplete hiring identity", _incomplete_hiring_identity, "has no"),
    ("answer to an unasked question", _answer_to_an_unasked_question, "not asked"),
    ("required question blank", _required_question_left_blank, "unanswered"),
    ("answers nobody asked for", _answers_nobody_asked_for, "nobody asked"),
)


@pytest.mark.parametrize("label,mutate,expected", GUARDS, ids=[g[0] for g in GUARDS])
def test_the_guard_rejects_it(
    corpus: dict[str, Any], label: str, mutate: Mutate, expected: str
) -> None:
    broken = copy.deepcopy(corpus["default"])
    mutate(broken)
    with pytest.raises(ManifestError) as caught:
        validate(broken)
    # Naming the specific failure matters as much as failing: a guard that
    # reports somebody else's error sends the next reader to the wrong file.
    assert expected in str(caught.value), (
        f"{label}: validation failed, but not for its own reason:\n{caught.value}"
    )


def test_an_unbroken_copy_still_passes(corpus: dict[str, Any]) -> None:
    # The control. Without it, a validator that rejected everything would score
    # nineteen passes above and be completely useless.
    validate(copy.deepcopy(corpus["default"]))
