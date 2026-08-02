"""The checkpointed conversation state machine.

The assistant alternates between working and asking. This module owns the rule
that makes that safe: **a provider stage may only start from a state that is not
waiting**, and reaching ``waiting_for_recruiter`` is what stops the workflow.

Keeping the transition table here — pure, importable, with no database or
provider dependency — is what lets the pause guarantee be tested directly rather
than inferred from service behaviour.

This is a second, narrower axis layered on top of ``processing_status``. That
column keeps its exact existing meaning; nothing here rewrites it.
"""

from __future__ import annotations

from typing import Final, Literal

ConversationState = Literal[
    # A source exists; no provider work has been attempted yet.
    "source_received",
    # A bounded provider stage is genuinely in flight right now.
    "preparing",
    # Stopped. One question is active. No provider work may run.
    "waiting_for_recruiter",
    # An answer arrived and was persisted; the next bounded stage may start.
    "resuming",
    # Deterministic post-stage work: merging, dependency recomputation.
    "validating",
    # Mandatory work is done; only optional improvements remain.
    "optional_improvements",
    # Enough is known to build the private native draft.
    "ready_for_native_draft",
    # A native draft exists. The ordinary Post Job editor owns it now.
    "converted",
    # A real failure, distinct from waiting.
    "processing_failed",
    # Inactive but resumable. Never a dead end.
    "abandoned",
]

CONVERSATION_STATES: Final[tuple[ConversationState, ...]] = (
    "source_received",
    "preparing",
    "waiting_for_recruiter",
    "resuming",
    "validating",
    "optional_improvements",
    "ready_for_native_draft",
    "converted",
    "processing_failed",
    "abandoned",
)

#: States in which the workflow is stopped and waiting on a person.
#:
#: Membership here is the pause guarantee. A provider stage started from one of
#: these states would be exactly the bug this design exists to prevent.
WAITING_STATES: Final[frozenset[ConversationState]] = frozenset(
    {"waiting_for_recruiter", "optional_improvements"}
)

#: States from which a bounded provider stage may legitimately begin.
#:
#: Deliberately small. Note that ``waiting_for_recruiter`` is absent, and so is
#: ``validating`` — deterministic merging never needs the provider.
PROVIDER_STARTABLE_STATES: Final[frozenset[ConversationState]] = frozenset(
    {"source_received", "resuming"}
)

#: Terminal states. Nothing resumes from these without an explicit new draft.
TERMINAL_STATES: Final[frozenset[ConversationState]] = frozenset({"converted"})

#: Hard ceiling on provider continuations for one draft.
#:
#: A pathological question loop would otherwise bill indefinitely. On reaching
#: the bound the workflow falls back to the deterministic queue and manual
#: completion; it never fails the recruiter's draft.
MAX_PROVIDER_CONTINUATIONS: Final[int] = 8

_TRANSITIONS: Final[dict[ConversationState, frozenset[ConversationState]]] = {
    "source_received": frozenset({"preparing", "processing_failed", "abandoned"}),
    "preparing": frozenset(
        {
            "waiting_for_recruiter",
            "validating",
            "ready_for_native_draft",
            "optional_improvements",
            "processing_failed",
            # A browser that closed mid-stage leaves the draft resumable.
            "abandoned",
        }
    ),
    "waiting_for_recruiter": frozenset(
        {
            # The only exits: an answer, the recruiter walking away, going manual.
            "resuming",
            "abandoned",
            "ready_for_native_draft",
            "converted",
            "processing_failed",
        }
    ),
    "resuming": frozenset(
        {"preparing", "validating", "waiting_for_recruiter", "processing_failed", "abandoned"}
    ),
    "validating": frozenset(
        {
            "waiting_for_recruiter",
            "optional_improvements",
            "ready_for_native_draft",
            "processing_failed",
            "abandoned",
        }
    ),
    "optional_improvements": frozenset(
        {"resuming", "ready_for_native_draft", "abandoned", "converted"}
    ),
    "ready_for_native_draft": frozenset(
        {"converted", "waiting_for_recruiter", "optional_improvements", "abandoned"}
    ),
    "converted": frozenset(),
    # A failure is recoverable: retry re-enters preparation.
    "processing_failed": frozenset({"resuming", "source_received", "abandoned"}),
    # Coming back is always allowed, and lands exactly where the recruiter left.
    "abandoned": frozenset(
        {
            "resuming",
            "waiting_for_recruiter",
            "optional_improvements",
            "ready_for_native_draft",
            "source_received",
        }
    ),
}


def is_waiting(state: ConversationState | None) -> bool:
    """True when the workflow is stopped on a person, so no work may run."""

    return state in WAITING_STATES


def may_start_provider_stage(
    state: ConversationState | None,
    *,
    continuation_count: int,
) -> bool:
    """Whether a bounded provider stage may begin right now.

    This is the single gate every provider call passes through. It answers "no"
    while waiting, after conversion, on failure, and once the continuation
    ceiling is reached.
    """

    if state is None or state not in PROVIDER_STARTABLE_STATES:
        return False
    return continuation_count < MAX_PROVIDER_CONTINUATIONS


def can_transition(
    current: ConversationState | None, target: ConversationState
) -> bool:
    if current is None:
        # An unstarted draft may only enter at the beginning.
        return target in {"source_received", "processing_failed", "abandoned"}
    return target in _TRANSITIONS.get(current, frozenset())


def assert_transition(
    current: ConversationState | None, target: ConversationState
) -> ConversationState:
    if not can_transition(current, target):
        raise ValueError(
            f"Illegal conversation transition: {current or 'unstarted'} -> {target}"
        )
    return target


def resume_state_for(state: ConversationState | None) -> ConversationState:
    """Where a returning recruiter lands.

    Coming back never restarts the conversation and never re-runs the provider;
    it restores whatever the recruiter was last looking at.
    """

    if state is None:
        return "source_received"
    if state == "abandoned":
        # The stored state is the pause; abandonment is only a marker on top of
        # it, so a returning recruiter resumes the question they left.
        return "waiting_for_recruiter"
    return state
