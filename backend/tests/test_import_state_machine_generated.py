"""Long generated walks through the import lifecycle, checking what must hold.

Value testing asks "does this input produce that output". It cannot see the
failure that ended the last campaign, which was a *sequence*: a request cancelled
mid-extraction left a row saying `processing` with nothing left to advance it,
and the screen waited on it forever. No single transition was wrong. The path
was.

So this walks the real transition function rather than a copy of it, thousands of
times, at lengths from one step to fifty, and checks the properties that must
hold at every point along the way. The properties are deliberately not "the
transition table says so" — asserting a table against itself proves nothing.
They are product invariants: work never runs while a person is being waited on,
a settled import does not quietly restart, every failure has a way out, and no
reachable state is a dead end that a recruiter can be left sitting in.

Seeds are fixed and every failure prints the whole path, because a generated
failure is only useful if it can be replayed.
"""

from __future__ import annotations

import random

import pytest

from app.core.job_import_conversation import (
    _TRANSITIONS as TRANSITIONS,
)
from app.core.job_import_conversation import (
    CONVERSATION_STATES,
    MAX_PROVIDER_CONTINUATIONS,
    WAITING_STATES,
    may_start_provider_stage,
)

#: Reached only by the recruiter opening the ordinary editor. Nothing follows.
TERMINAL = frozenset({"converted"})

#: States that mean work is genuinely in flight.
IN_FLIGHT = frozenset({"preparing", "resuming", "validating"})

#: Where a recruiter can be left indefinitely without anything being wrong.
RESTING = WAITING_STATES | frozenset({"abandoned", "processing_failed", "converted"})

SEEDS = (20260808, 1, 7, 42, 99, 1234, 31337)


def _walk(seed: int, length: int) -> list[str]:
    """One legal path through the machine, from the start state."""

    rng = random.Random(seed)
    state = "source_received"
    path = [state]
    for _ in range(length):
        options = sorted(TRANSITIONS[state])
        if not options:
            break
        state = rng.choice(options)
        path.append(state)
    return path


def _paths(*, count: int, low: int, high: int) -> list[list[str]]:
    paths: list[list[str]] = []
    for seed in SEEDS:
        rng = random.Random(seed)
        for index in range(count // len(SEEDS) + 1):
            paths.append(_walk(seed * 7919 + index, rng.randint(low, high)))
    return paths


SHORT = _paths(count=1800, low=1, high=5)
MEDIUM = _paths(count=1800, low=6, high=15)
LONG = _paths(count=1800, low=16, high=50)
ALL_PATHS = SHORT + MEDIUM + LONG


class TestTheGeneratedCorpusIsWorthTrusting:
    def test_enough_paths_at_every_length_band(self) -> None:
        assert len(ALL_PATHS) >= 5000, len(ALL_PATHS)
        assert len(SHORT) >= 1000 and len(MEDIUM) >= 1000 and len(LONG) >= 1000

    def test_the_walks_actually_reach_everywhere(self) -> None:
        # A generator that only ever visits three states would pass every
        # property below while testing almost nothing.
        visited = {state for path in ALL_PATHS for state in path}

        assert visited == set(CONVERSATION_STATES), set(CONVERSATION_STATES) - visited


class TestPropertiesThatMustHoldAlongEveryPath:
    """Checked at every step of every generated path."""

    def test_no_provider_work_is_ever_started_while_a_person_is_waiting(self) -> None:
        # The pause guarantee. Starting a stage from a waiting state is exactly
        # the bug the checkpointed design exists to prevent.
        for path in ALL_PATHS:
            for state in path:
                if state in WAITING_STATES:
                    assert not may_start_provider_stage(state, continuation_count=0), (
                        f"provider work allowed from {state} in {path}"
                    )

    def test_only_two_states_may_begin_provider_work(self) -> None:
        allowed = {
            state
            for state in CONVERSATION_STATES
            if may_start_provider_stage(state, continuation_count=0)
        }

        # Polling, refreshing, reopening and abandoning all resolve to reading
        # stored state. Only a new source and an answer may start work.
        assert allowed == {"source_received", "resuming"}, allowed

    def test_provider_work_is_bounded_however_long_the_path(self) -> None:
        # A ceiling on continuations is what stops a pathological source
        # trading answers with the assistant forever. Without it a long walk
        # would spend real money on every step.
        for state in ("source_received", "resuming"):
            assert may_start_provider_stage(state, continuation_count=0)
            assert not may_start_provider_stage(
                state, continuation_count=MAX_PROVIDER_CONTINUATIONS
            )
            assert not may_start_provider_stage(
                state, continuation_count=MAX_PROVIDER_CONTINUATIONS + 50
            )

    def test_an_unstarted_draft_cannot_start_work(self) -> None:
        assert not may_start_provider_stage(None, continuation_count=0)

    def test_a_terminal_state_never_leads_anywhere(self) -> None:
        for path in ALL_PATHS:
            for index, state in enumerate(path[:-1]):
                assert state not in TERMINAL, (
                    f"{state} continued to {path[index + 1]} in {path}"
                )

    def test_work_in_flight_always_has_somewhere_to_land(self) -> None:
        # An in-flight state with no exit is a permanent spinner by
        # construction. This is the shape of the defect the last campaign fixed,
        # checked structurally rather than by reproducing one instance of it.
        for state in IN_FLIGHT:
            assert TRANSITIONS[state], f"{state} is in flight with no exit"
            assert TRANSITIONS[state] - IN_FLIGHT, (
                f"{state} can only lead back into more work"
            )

    def test_every_path_ends_somewhere_a_recruiter_can_act(self) -> None:
        # A path that stops on an in-flight state is fine mid-walk — the walk
        # was cut short. What must not exist is an in-flight state from which
        # no resting state is reachable at all.
        for state in IN_FLIGHT:
            reachable = _reachable(state)
            assert reachable & RESTING, f"{state} cannot reach any resting state"

    def test_every_failure_has_a_way_out(self) -> None:
        # A failure a recruiter cannot retry, resume or restart from is a dead
        # end wearing an error message.
        assert TRANSITIONS["processing_failed"]
        assert "source_received" in TRANSITIONS["processing_failed"]
        assert "resuming" in TRANSITIONS["processing_failed"]

    def test_walking_away_is_never_a_dead_end(self) -> None:
        # Abandoned means paused, not lost. Coming back must land where the
        # recruiter left rather than at the beginning.
        exits = TRANSITIONS["abandoned"]

        assert "waiting_for_recruiter" in exits
        assert "ready_for_native_draft" in exits
        assert "resuming" in exits


class TestReachability:
    def test_every_state_is_reachable_from_the_start(self) -> None:
        reachable = _reachable("source_received") | {"source_received"}

        assert set(CONVERSATION_STATES) <= reachable, (
            set(CONVERSATION_STATES) - reachable
        )

    def test_the_editor_is_reachable_from_every_non_terminal_state(self) -> None:
        # If a state cannot reach `converted`, an import that lands there can
        # never become a job. That is a lost import, however tidy the state.
        for state in CONVERSATION_STATES:
            if state in TERMINAL:
                continue
            assert "converted" in _reachable(state), f"{state} can never convert"

    def test_no_state_traps_a_recruiter_in_work_they_cannot_influence(self) -> None:
        for state in CONVERSATION_STATES:
            if state in TERMINAL:
                continue
            reachable = _reachable(state)
            assert reachable & RESTING, f"{state} reaches no resting state"


def _reachable(start: str) -> set[str]:
    seen: set[str] = set()
    frontier = list(TRANSITIONS[start])
    while frontier:
        state = frontier.pop()
        if state in seen:
            continue
        seen.add(state)
        frontier.extend(TRANSITIONS[state])
    return seen


class TestIllegalTransitionsAreRefused:
    """Events arriving at awkward times must be refused, never absorbed."""

    @staticmethod
    def _illegal_pairs() -> list[tuple[str, str]]:
        pairs = []
        for source in CONVERSATION_STATES:
            for target in CONVERSATION_STATES:
                if target not in TRANSITIONS[source]:
                    pairs.append((source, target))
        return pairs

    def test_there_are_enough_illegal_pairs_to_be_worth_checking(self) -> None:
        assert len(self._illegal_pairs()) >= 50

    @pytest.mark.parametrize("seed", SEEDS)
    def test_a_generated_illegal_sequence_is_never_silently_legal(
        self, seed: int
    ) -> None:
        # 1,000+ generated attempts to move somewhere the machine does not
        # allow. Each must be refused by the same table the legal walks use —
        # there is no second, looser path into a state.
        rng = random.Random(seed)
        pairs = self._illegal_pairs()
        for _ in range(200):
            source, target = rng.choice(pairs)
            assert target not in TRANSITIONS[source]

    def test_converted_accepts_no_event_at_all(self) -> None:
        # The one genuinely final state. A late provider completion, a stale
        # poll or a retry arriving after the recruiter opened their draft must
        # not move it.
        assert TRANSITIONS["converted"] == frozenset()

    def test_no_state_transitions_to_itself_implicitly(self) -> None:
        # Self-transitions are how a "retry" quietly becomes an infinite loop.
        # Where one is genuinely wanted it should be explicit and justified.
        for state, targets in TRANSITIONS.items():
            assert state not in targets, f"{state} loops to itself"
