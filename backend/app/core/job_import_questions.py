"""Which question the assistant may ask next, and whether it is allowed to.

Two responsibilities, deliberately in one place:

1. **Validation.** A model may *propose* the next question; the server decides
   whether it is askable. A proposal naming a prohibited field, an already
   answered field, an inactive conditional, or a field CreatorJobs owns is
   rejected without ever reaching the recruiter.

2. **Fallback.** The workflow must keep working when the model proposes nothing
   valid. The deterministic queue picks the highest-priority field from
   authoritative review state, so the conversation never stalls on a bad
   proposal.

Nothing here decides publication validity — that stays with native validation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from app.core.job_import_policy import (
    JOB_IMPORT_FIELD_POLICIES,
    LEGACY_COMPATIBILITY_IMPORT_FIELDS,
    SYSTEM_OWNED_IMPORT_FIELDS,
    import_field_policy,
)
from app.core.job_import_question_value import question_value

QuestionKind = Literal["mandatory", "confirmation", "optional"]

#: Fields the assistant must settle before it can claim the draft is prepared.
#:
#: The test is *interpretation*, not publication. Each of these changes how the
#: rest of the source should be read, or would materially mislead a candidate if
#: left blank — a pay figure with no currency, a role with no stated work mode,
#: an application route nobody chose. Publication has its own, larger checklist;
#: this is deliberately not that list.
ESSENTIAL_CONVERSATION_FIELDS: Final[frozenset[str]] = frozenset(
    {
        # Money read wrongly is the most damaging kind of wrong. The amounts
        # are here because a source that names two different figures is exactly
        # the case a candidate would be misled by, and a contradiction about the
        # number itself is not something to settle on their behalf.
        "compensation_mode",
        "budget_currency",
        "budget_unit",
        "budget_amount",
        "budget_max",
        # Who can actually take the job.
        "work_mode",
        "location",
        # When a source explicitly says there is a trial, its candidate-safety
        # terms have to be clear. An absent trial is not itself a question.
        "trial_work_usage",
        "trial_portfolio_permission",
        "unpaid_trial_confirmed",
        # How the engagement is meant to be understood.
        "engagement_type",
        # Identity of the work itself.
        "title",
    }
)

#: Fields a newer field has replaced, so asking about them writes into a control
#: the recruiter can no longer see.
#:
#: ``start_timeframe`` is the case that proved the point: the recruiter chose a
#: start window in the conversation, the answer was stored and carried into the
#: job, and the editor rendered nothing — because on a v3 listing that field
#: exists only as a read-only note for older listings. Publication accepts either
#: field, so asking the live one costs nothing and is the only one that shows.
#:
#: The rule this encodes: never ask for a value the recruiter cannot then edit.
SUPERSEDED_QUESTION_FIELDS: Final[frozenset[str]] = frozenset({"start_timeframe"})

#: Decided by the platform, so never a question.
#:
#: Applications always run through CreatorJobs: that is how the workspace,
#: screening and messaging hold together, so there is nothing for a recruiter to
#: choose. Asking would offer a decision that does not exist, and external_apply_url
#: only ever mattered as the follow-up to the answer "somewhere else".
PLATFORM_DECIDED_FIELDS: Final[frozenset[str]] = frozenset(
    {"application_mode", "external_apply_url"}
)


#: Improvements worth offering, in the order they tend to matter.
#:
#: Every one of these makes a listing better without being needed to understand
#: it, so each is skippable and none may block the handoff.
OPTIONAL_CONVERSATION_FIELDS: Final[tuple[str, ...]] = (
    # Useful for judging availability, never needed to read the offer correctly.
    "start_timing",
    # First, because these two are the attributes candidates filter on hardest
    # and both are visible on the earliest Post Job pages. Optional rather than
    # essential: a listing still reads correctly without them, so they may be
    # offered but must never hold up the handoff.
    "experience_level",
    "content_niches",
    "deliverables",
    "source_inputs",
    "revision_policy",
    "turnaround_value",
    "creative_autonomy",
    "hiring_process",
    "reference_videos",
    "expected_weekly_hours_min",
)

#: How many optional suggestions the assistant may raise in one session.
#:
#: Three is a suggestion; ten is an interrogation. The remainder are perfectly
#: good fields to fill in later during ordinary editing.
MAX_OPTIONAL_SUGGESTIONS: Final[int] = 3


def conversation_question_kind(
    field_path: str, requirement: str, *, is_conflict: bool = False
) -> QuestionKind | None:
    """Classify a field for the assistant conversation, or None to leave it out.

    Returning None is the common case and the important one: most of the 91
    writable fields are neither needed to interpret the source nor a high-value
    improvement, and belong in ordinary manual editing rather than in a
    conversation the recruiter has to sit through.
    """

    if field_path in PLATFORM_DECIDED_FIELDS:
        # Not the recruiter's call, so not a question — whatever its
        # publication requirement says.
        return None
    if field_path in SUPERSEDED_QUESTION_FIELDS:
        # A successor field owns this now. Asking here would collect an answer
        # the editor cannot show, which reads to the recruiter as the answer
        # being ignored.
        return None
    value = question_value(field_path, is_conflict=is_conflict)
    if value == "deterministic_fallback":
        # Resolved internally or left to the editor's own control. Never a
        # question, however the requirement is classified.
        return None
    if value == "leave_for_post_job":
        # Deliberately outranks the publication-blocker fallback below. Being
        # required to publish is not a reason to interrupt preparation: the
        # editor asks for it in context, with room to answer properly.
        return None
    if field_path in ESSENTIAL_CONVERSATION_FIELDS or value == "essential_now":
        return "mandatory"
    if field_path in OPTIONAL_CONVERSATION_FIELDS or value == "helpful_optional":
        return "optional"
    if requirement == "publication_blocker":
        # A publication blocker nobody classified is still the recruiter's to
        # decide — but it is an offer, not an interruption. Publication
        # validation remains the authority and asks again at the right moment.
        return "optional"
    return None

#: Never askable, whatever the model proposes.
#:
#: Language requirements are absent from listings by product decision, and
#: screening questions are private hiring configuration — neither belongs in an
#: import conversation.
PROHIBITED_QUESTION_FIELDS: Final[frozenset[str]] = frozenset(
    {"languages", "language_requirements", "screening_questions"}
)

#: Why a proposal was refused. Bounded, enum-ish, safe to persist as diagnostics.
QuestionRejection = Literal[
    "unknown_field",
    "prohibited_field",
    "server_owned_field",
    "legacy_field",
    "already_answered",
    "already_resolved",
    "suppressed_by_answer",
    "inactive_conditional",
    "answer_shape_mismatch",
    "not_recruiter_answerable",
]


@dataclass(frozen=True)
class ProposedQuestion:
    """A question proposed by the provider, before the server has vetted it."""

    field_path: str
    question: str
    explanation: str
    kind: QuestionKind = "mandatory"


@dataclass(frozen=True)
class QuestionValidation:
    accepted: ProposedQuestion | None
    rejection: QuestionRejection | None = None

    @property
    def ok(self) -> bool:
        return self.accepted is not None


def validate_proposed_question(
    proposal: ProposedQuestion,
    *,
    answered_fields: frozenset[str],
    resolved_fields: frozenset[str] = frozenset(),
    suppressed_fields: frozenset[str],
    active_conditional_fields: frozenset[str],
) -> QuestionValidation:
    """Decide whether a proposed question may be shown to the recruiter.

    Refusal is silent by design: an invalid proposal is a provider defect, not
    something a recruiter should be asked to interpret.
    """

    path = proposal.field_path

    if (
        path in PROHIBITED_QUESTION_FIELDS
        or path in PLATFORM_DECIDED_FIELDS
        or path in SUPERSEDED_QUESTION_FIELDS
    ):
        return QuestionValidation(None, "prohibited_field")
    if path in SYSTEM_OWNED_IMPORT_FIELDS:
        return QuestionValidation(None, "server_owned_field")
    if path in LEGACY_COMPATIBILITY_IMPORT_FIELDS:
        return QuestionValidation(None, "legacy_field")

    policy = import_field_policy(path)
    if policy is None:
        return QuestionValidation(None, "unknown_field")

    if path in answered_fields:
        # Re-asking a settled question is the clearest possible signal that the
        # assistant is not listening.
        return QuestionValidation(None, "already_answered")
    if path in resolved_fields:
        # Extracted and safely interpreted facts are answers too. A provider is
        # allowed to improve extraction, but never to turn a settled field back
        # into administrative work for the recruiter.
        return QuestionValidation(None, "already_resolved")
    if path in suppressed_fields:
        return QuestionValidation(None, "suppressed_by_answer")

    if (
        policy.missing_requirement == "conditionally_required"
        and path not in active_conditional_fields
    ):
        return QuestionValidation(None, "inactive_conditional")

    if not proposal.question.strip() or not proposal.explanation.strip():
        return QuestionValidation(None, "answer_shape_mismatch")

    return QuestionValidation(proposal)


#: Deterministic priority. Lower sorts first.
#:
#: Mirrors the product's own ordering: a contradiction that could mislead a
#: candidate outranks a blocker, which outranks an active conditional, which
#: outranks anything merely recommended.
_REQUIREMENT_PRIORITY: Final[dict[str, int]] = {
    "publication_blocker": 10,
    "conditionally_required": 20,
    "recommended": 30,
    "optional": 40,
}

_CONFLICT_PRIORITY: Final[int] = 0

#: A source-backed machine suggestion for a required field is more useful than
#: an empty question, but it still needs a person to confirm it when the
#: confidence policy did not allow automatic settlement.
_REQUIRED_SUGGESTION_PRIORITY: Final[int] = 5

#: Where a conflict lands when the field itself is only ever an offer. Behind
#: every requirement, so an optional contradiction can never lead the queue.
_OPTIONAL_PRIORITY: Final[int] = 50


@dataclass(frozen=True)
class QueueCandidate:
    field_path: str
    kind: QuestionKind
    priority: int


def deterministic_question_queue(
    *,
    conflicted_fields: frozenset[str],
    missing_fields: dict[str, str],
    answered_fields: frozenset[str],
    suppressed_fields: frozenset[str],
    active_conditional_fields: frozenset[str],
    suggested_fields: dict[str, str] | None = None,
    dismissed_fields: frozenset[str] = frozenset(),
) -> list[QueueCandidate]:
    """Every field that still legitimately needs a recruiter, best first.

    ``missing_fields`` maps field path to its missing requirement. The result is
    ordered but not truncated; the caller takes the head, because only one
    question is ever active.
    """

    candidates: list[QueueCandidate] = []
    seen: set[str] = set()
    suggested_fields = suggested_fields or {}

    def eligible(path: str) -> bool:
        if path in seen or path in answered_fields or path in suppressed_fields:
            return False
        if path in dismissed_fields:
            return False
        if path in PROHIBITED_QUESTION_FIELDS or path in SYSTEM_OWNED_IMPORT_FIELDS:
            return False
        if path in PLATFORM_DECIDED_FIELDS or path in SUPERSEDED_QUESTION_FIELDS:
            return False
        if path in LEGACY_COMPATIBILITY_IMPORT_FIELDS:
            return False
        return path in JOB_IMPORT_FIELD_POLICIES

    for path in sorted(conflicted_fields):
        if not eligible(path):
            continue
        # A conflict still has to earn its place in the conversation. The
        # priority order says "consequential conflicts first", and a
        # contradiction about a field nobody needs to interpret the source is
        # not consequential — it would otherwise outrank pay and application
        # routing purely for being a conflict. Post Job's review still surfaces
        # it; it just does not stop the assistant.
        policy = JOB_IMPORT_FIELD_POLICIES[path]
        kind = conversation_question_kind(path, policy.missing_requirement)
        if kind is None:
            continue
        seen.add(path)
        if kind == "optional":
            # Being contradicted does not promote a field the listing reads
            # fine without. It is still worth raising, but behind everything
            # the source genuinely has to settle.
            candidates.append(QueueCandidate(path, "optional", _OPTIONAL_PRIORITY))
            continue
        candidates.append(QueueCandidate(path, "confirmation", _CONFLICT_PRIORITY))

    for path, requirement in sorted(suggested_fields.items()):
        if not eligible(path):
            continue
        policy = JOB_IMPORT_FIELD_POLICIES[path]
        if (
            policy.missing_requirement == "conditionally_required"
            and path not in active_conditional_fields
        ):
            continue
        kind = conversation_question_kind(path, requirement)
        if kind is None:
            continue
        seen.add(path)
        if kind == "optional":
            # Unlike a blank optional field, this is a grounded interpretation
            # of source data. Offer it without making it essential; the shared
            # optional cap still prevents a second form from appearing.
            candidates.append(QueueCandidate(path, "optional", _OPTIONAL_PRIORITY))
            continue
        candidates.append(
            QueueCandidate(path, "confirmation", _REQUIRED_SUGGESTION_PRIORITY)
        )

    for path, requirement in sorted(missing_fields.items()):
        if not eligible(path):
            continue
        policy = JOB_IMPORT_FIELD_POLICIES[path]
        if (
            policy.missing_requirement == "conditionally_required"
            and path not in active_conditional_fields
        ):
            continue
        kind = conversation_question_kind(path, requirement)
        if kind is None:
            # Not needed to understand the source and not a chosen improvement.
            # Ordinary Post Job editing is the right place for it.
            continue
        if kind == "optional":
            # An absent optional improvement is not a conversation. Optional
            # conflicts and grounded suggestions can still be offered, but the
            # assistant never manufactures questions from a blank field.
            continue
        seen.add(path)
        candidates.append(
            QueueCandidate(path, kind, _REQUIREMENT_PRIORITY.get(requirement, 40))
        )

    candidates.sort(key=lambda candidate: (candidate.priority, candidate.field_path))

    essential = [item for item in candidates if item.kind != "optional"]
    optional = [item for item in candidates if item.kind == "optional"]
    # Rank optional suggestions by the product's own ordering, then cap them.
    optional.sort(
        key=lambda item: (
            OPTIONAL_CONVERSATION_FIELDS.index(item.field_path)
            if item.field_path in OPTIONAL_CONVERSATION_FIELDS
            else len(OPTIONAL_CONVERSATION_FIELDS)
        )
    )
    return essential + optional[:MAX_OPTIONAL_SUGGESTIONS]


def next_question_field(
    *,
    conflicted_fields: frozenset[str],
    missing_fields: dict[str, str],
    answered_fields: frozenset[str],
    suppressed_fields: frozenset[str],
    active_conditional_fields: frozenset[str],
    dismissed_fields: frozenset[str] = frozenset(),
) -> QueueCandidate | None:
    queue = deterministic_question_queue(
        conflicted_fields=conflicted_fields,
        missing_fields=missing_fields,
        answered_fields=answered_fields,
        suppressed_fields=suppressed_fields,
        active_conditional_fields=active_conditional_fields,
        dismissed_fields=dismissed_fields,
    )
    return queue[0] if queue else None


def essential_work_remains(queue: list[QueueCandidate]) -> bool:
    """Whether the assistant still needs an answer to understand this job."""

    return any(candidate.kind != "optional" for candidate in queue)


def assistant_preparation_complete(queue: list[QueueCandidate]) -> bool:
    """Whether the assistant has finished preparing, essential *and* optional.

    Deliberately independent of ``can_apply_to_native_draft``. A private native
    draft can exist almost from the start; that says nothing about whether the
    assistant has finished the conversation it began. Conflating the two is what
    made the handoff fire while questions were still open.
    """

    return not queue
