"""Why a question was asked — or, more usefully, why one was not.

Every defect in this feature has looked identical from the recruiter's seat: the
assistant asks for something the page already said. The causes were never the
same twice — an extraction that timed out, a control the mapper could not build,
a legacy field path, an enum that failed to translate, an answer written to the
wrong store. What they shared was that nothing could tell you *why* the question
existed, so each one had to be diagnosed from scratch.

This module gives every question a recorded reason drawn from a closed set. A
question with no legitimate reason is a product defect, and can now be detected
as one rather than argued about.

Nothing here is recruiter-facing. These are internal categories for tests and
development diagnostics; the words a recruiter reads are written elsewhere.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

#: Legitimate reasons a question may exist.
AskReason = Literal[
    "conflict_requires_decision",
    "consequential_inference_requires_confirmation",
    "genuinely_absent_required_field",
    "active_conditional_requirement",
    "relevant_optional_improvement",
]

#: Reasons a question must not exist. Each of these was a real shipped bug.
SuppressionReason = Literal[
    "source_value_available",
    "recruiter_value_available",
    "suppressed_by_dependency",
    "unsupported_or_internal_field",
    "provider_failure_not_questionable",
]

Reason = AskReason | SuppressionReason

ASK_REASONS: Final[frozenset[str]] = frozenset(
    {
        "conflict_requires_decision",
        "consequential_inference_requires_confirmation",
        "genuinely_absent_required_field",
        "active_conditional_requirement",
        "relevant_optional_improvement",
    }
)

SUPPRESSION_REASONS: Final[frozenset[str]] = frozenset(
    {
        "source_value_available",
        "recruiter_value_available",
        "suppressed_by_dependency",
        "unsupported_or_internal_field",
        "provider_failure_not_questionable",
    }
)


@dataclass(frozen=True)
class QuestionDecision:
    """One field, and the single reason it is or is not being asked."""

    field_path: str
    asked: bool
    reason: Reason

    def __post_init__(self) -> None:
        expected = ASK_REASONS if self.asked else SUPPRESSION_REASONS
        if self.reason not in expected:
            raise ValueError(
                f"{self.reason!r} cannot explain asked={self.asked} "
                f"for {self.field_path!r}"
            )


def decide(
    field_path: str,
    *,
    has_recruiter_answer: bool,
    has_effective_value: bool,
    is_conflicted: bool,
    is_suppressed: bool,
    is_supported: bool,
    is_active_conditional: bool,
    requires_confirmation: bool,
    kind: str | None,
    provider_failed: bool = False,
) -> QuestionDecision:
    """Resolve one field to a single, explainable outcome.

    Order matters and encodes the product rules. A recruiter's own answer beats
    everything; a value already present beats asking for it again; and a failed
    provider stage is never a reason to interrogate anyone — that case has no
    business reaching the question queue at all, and is named here so a test can
    prove it does not.
    """

    if provider_failed:
        # The invariant: a failed extraction is a failure, not a source of
        # questions. Manufacturing a queue from an empty result is what turned
        # a provider timeout into the recruiter's data-entry task.
        return QuestionDecision(field_path, False, "provider_failure_not_questionable")
    if not is_supported or kind is None:
        return QuestionDecision(field_path, False, "unsupported_or_internal_field")
    if has_recruiter_answer:
        return QuestionDecision(field_path, False, "recruiter_value_available")
    if is_suppressed:
        return QuestionDecision(field_path, False, "suppressed_by_dependency")
    if is_conflicted:
        # Two evidenced values that disagree. Only a person can choose.
        return QuestionDecision(field_path, True, "conflict_requires_decision")
    if has_effective_value:
        if requires_confirmation:
            return QuestionDecision(
                field_path, True, "consequential_inference_requires_confirmation"
            )
        return QuestionDecision(field_path, False, "source_value_available")
    if kind == "optional":
        return QuestionDecision(field_path, True, "relevant_optional_improvement")
    if is_active_conditional:
        return QuestionDecision(field_path, True, "active_conditional_requirement")
    return QuestionDecision(field_path, True, "genuinely_absent_required_field")


def false_questions(decisions: list[QuestionDecision]) -> list[QuestionDecision]:
    """Questions that should never have been asked.

    A question is false when its field already had an answer available. Used by
    tests and the development diagnostic to turn "the bot feels unintelligent"
    into a number that can be driven to zero.
    """

    return [
        decision
        for decision in decisions
        if decision.asked and decision.reason not in ASK_REASONS
    ]
