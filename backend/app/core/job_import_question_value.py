"""Whether a question is worth interrupting someone for.

Question *eligibility* asks whether an answer is genuinely missing. That is a
factual test, and the corpus already holds it at zero false questions. This is
the separate test the product actually needs: given that the answer really is
absent, is asking now worth the interruption?

The two are not the same, and conflating them is how an assistant turns into a
second form. A source that omits a publishing detail has not created a problem
worth stopping for — the recruiter is about to open the Post Job editor, which
has a proper control for it, more room, and no conversational overhead.

So absence alone never earns a question. A field earns one only when the answer
changes how the listing is *read* — what a candidate would understand about the
pay, the eligibility, or the commitment — or when only the recruiter can decide
it. Everything else is offered, deferred, or resolved without asking.
"""

from __future__ import annotations

from typing import Final, Literal

#: What to do with a field whose value is genuinely absent.
QuestionValue = Literal[
    "essential_now",
    "helpful_optional",
    "leave_for_post_job",
    "deterministic_fallback",
]

#: Fields whose absence materially changes how a candidate reads the listing.
#:
#: The test applied to each: if this stays blank, could a candidate reasonably
#: misunderstand the offer, or waste their time applying for something they are
#: not eligible for? Money, eligibility and unpaid work all pass. Almost nothing
#: else does.
INTERPRETATION_CRITICAL: Final[frozenset[str]] = frozenset(
    {
        # A figure without a currency or a period is not a number anyone can act
        # on, and reading it wrongly costs the candidate real time.
        "compensation_mode",
        "budget_currency",
        "budget_unit",
        "budget_amount",
        "budget_max",
        # Who can actually take the job.
        "work_mode",
        "location",
        # Unpaid work asked of a candidate, and on what terms.
        "trial_work_usage",
        "trial_portfolio_permission",
        "unpaid_trial_confirmed",
        # How the commitment should be understood.
        "engagement_type",
        # The listing has to be identifiable at all.
        "title",
    }
)

#: Worth offering, never worth stopping for.
#:
#: Each of these improves a listing and none of them changes what the offer *is*.
#: They are raised as suggestions, capped, and skippable in one click.
WORTH_OFFERING: Final[frozenset[str]] = frozenset(
    {
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
        # Useful for a candidate judging availability, but a listing without it
        # is not misleading — and the editor asks for it in context anyway.
        "start_timing",
    }
)

#: Prose the recruiter would have to compose, which chat is the wrong place for.
#:
#: These are publication blockers, and they are still required — by Post Job, at
#: publish time, in a textarea with room to write and the listing visible beside
#: it. Asking for a paragraph inside a chat bubble to satisfy that validation
#: early turns preparation into a writing exercise, and it is the one shape of
#: question most likely to make someone abandon the flow.
#:
#: ``about_channel`` is the case that forced the decision. Employer context
#: raises candidate confidence; it does not change what the offer *is*, so
#: nothing about the listing is misread without it.
LONG_FORM_DEFERRED: Final[frozenset[str]] = frozenset(
    {"about_channel", "responsibilities", "requirements"}
)

#: Resolved internally rather than asked about.
#:
#: ``primary_role_key`` is the case that made this necessary. Its values are an
#: internal creator taxonomy of roughly thirty crafts; putting that to someone as
#: a chat question is a worse version of the picker they are about to see, and on
#: a job outside the marketplace's scope — a financial analyst, say — there is no
#: honest answer at all. It is derived from the title where the title says so,
#: and otherwise left to the editor, which has the real control.
RESOLVED_INTERNALLY: Final[frozenset[str]] = frozenset({"primary_role_key"})


def question_value(field_path: str, *, is_conflict: bool = False) -> QuestionValue:
    """Decide what an absent field is worth.

    A genuine conflict is always essential regardless of the field: two evidenced
    readings mean the source itself is unclear, and only a person can say which
    one candidates should see. That is the one case where even a low-value field
    earns an interruption, because leaving it wrong is worse than asking.
    """

    if is_conflict:
        return "essential_now"
    if field_path in RESOLVED_INTERNALLY:
        return "deterministic_fallback"
    if field_path in LONG_FORM_DEFERRED:
        return "leave_for_post_job"
    if field_path in INTERPRETATION_CRITICAL:
        return "essential_now"
    if field_path in WORTH_OFFERING:
        return "helpful_optional"
    return "leave_for_post_job"


def may_interrupt(field_path: str, *, is_conflict: bool = False) -> bool:
    """Whether this field may stop the recruiter inside the conversation."""

    return question_value(field_path, is_conflict=is_conflict) == "essential_now"
