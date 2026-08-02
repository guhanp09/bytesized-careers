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

QuestionKind = Literal["mandatory", "confirmation", "optional"]

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
    suppressed_fields: frozenset[str],
    active_conditional_fields: frozenset[str],
) -> QuestionValidation:
    """Decide whether a proposed question may be shown to the recruiter.

    Refusal is silent by design: an invalid proposal is a provider defect, not
    something a recruiter should be asked to interpret.
    """

    path = proposal.field_path

    if path in PROHIBITED_QUESTION_FIELDS:
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
    dismissed_fields: frozenset[str] = frozenset(),
) -> list[QueueCandidate]:
    """Every field that still legitimately needs a recruiter, best first.

    ``missing_fields`` maps field path to its missing requirement. The result is
    ordered but not truncated; the caller takes the head, because only one
    question is ever active.
    """

    candidates: list[QueueCandidate] = []
    seen: set[str] = set()

    def eligible(path: str) -> bool:
        if path in seen or path in answered_fields or path in suppressed_fields:
            return False
        if path in dismissed_fields:
            return False
        if path in PROHIBITED_QUESTION_FIELDS or path in SYSTEM_OWNED_IMPORT_FIELDS:
            return False
        if path in LEGACY_COMPATIBILITY_IMPORT_FIELDS:
            return False
        return path in JOB_IMPORT_FIELD_POLICIES

    for path in sorted(conflicted_fields):
        if not eligible(path):
            continue
        seen.add(path)
        candidates.append(QueueCandidate(path, "confirmation", _CONFLICT_PRIORITY))

    for path, requirement in sorted(missing_fields.items()):
        if not eligible(path):
            continue
        policy = JOB_IMPORT_FIELD_POLICIES[path]
        if (
            policy.missing_requirement == "conditionally_required"
            and path not in active_conditional_fields
        ):
            continue
        seen.add(path)
        kind: QuestionKind = (
            "optional" if requirement in {"recommended", "optional"} else "mandatory"
        )
        candidates.append(
            QueueCandidate(path, kind, _REQUIREMENT_PRIORITY.get(requirement, 40))
        )

    candidates.sort(key=lambda candidate: (candidate.priority, candidate.field_path))
    return candidates


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


def mandatory_work_remains(queue: list[QueueCandidate]) -> bool:
    """Whether anything still blocks building the private native draft."""

    return any(candidate.kind != "optional" for candidate in queue)
