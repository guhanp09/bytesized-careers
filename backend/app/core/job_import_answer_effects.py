"""What a recruiter's answer means for the rest of the draft.

An answer is a structured fact, not a chat message. Saying "there is no trial"
should silently remove four downstream questions; saying "the team is in India"
should *propose* INR rather than quietly setting it.

The split this module enforces:

  direct        the answer settles the field outright, or a dependent field has
                only one possible value once the answer is known
  suggestion    the implication is probably right but changes what a candidate
                sees, so the recruiter confirms it explicitly
  suppression   a question that can no longer be relevant, and must not be asked

Consequential values never take the ``direct`` path. Currency is the canonical
example: a location makes a currency likely, never certain, and showing pay in
the wrong currency misleads every candidate who reads the listing.

The module cannot emit anything outside ``JOB_IMPORT_FIELD_POLICIES``, which is
what stops it from ever expressing an inference about a person rather than a job.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Final

from app.core.job_import_inference import country_from_location, currency_for_country
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES


@dataclass(frozen=True)
class AnswerSuggestion:
    """A likely implication the recruiter must confirm before it is used."""

    field_path: str
    value: object
    rationale_code: str
    #: Recruiter-facing, contextual, and always phrased as a question.
    explanation: str


@dataclass(frozen=True)
class AnswerEffect:
    direct_values: dict[str, object] = field(default_factory=dict)
    suggestions: list[AnswerSuggestion] = field(default_factory=list)
    suppressed_fields: frozenset[str] = frozenset()

    def is_empty(self) -> bool:
        return not (self.direct_values or self.suggestions or self.suppressed_fields)


#: Questions that stop making sense once a trial is ruled out.
_TRIAL_DESCENDANTS: Final[frozenset[str]] = frozenset(
    {
        "trial_scope",
        "trial_effort_value",
        "trial_effort_unit",
        "trial_compensation_amount",
        "trial_compensation_currency",
        "trial_compensation_basis",
        "trial_work_usage",
        "trial_portfolio_permission",
        "trial_attribution",
        "unpaid_trial_confirmed",
    }
)

#: Only asked when applications leave CreatorJobs.
_EXTERNAL_APPLICATION_FIELDS: Final[frozenset[str]] = frozenset({"external_apply_url"})

#: Only asked when the role is not fully remote.
_ONSITE_FIELDS: Final[frozenset[str]] = frozenset({"location"})


def _known(field_path: str) -> bool:
    return field_path in JOB_IMPORT_FIELD_POLICIES


def _filtered(paths: frozenset[str]) -> frozenset[str]:
    """Nothing outside the supported field registry may be touched."""

    return frozenset(path for path in paths if _known(path))


def effects_for_answer(
    field_path: str,
    value: object,
    *,
    canonical_values: dict[str, object] | None = None,
) -> AnswerEffect:
    """Derive what else this answer settles, proposes, or makes irrelevant."""

    values = canonical_values or {}

    if field_path == "trial_status":
        if value == "none":
            # Every trial term is moot. Asking about trial pay after being told
            # there is no trial is the exact "AI wasn't listening" failure.
            return AnswerEffect(suppressed_fields=_filtered(_TRIAL_DESCENDANTS))
        return AnswerEffect()

    if field_path == "application_mode":
        if value == "internal":
            return AnswerEffect(suppressed_fields=_filtered(_EXTERNAL_APPLICATION_FIELDS))
        return AnswerEffect()

    if field_path == "work_mode":
        if value == "remote":
            # A remote role has no worksite to name.
            return AnswerEffect(suppressed_fields=_filtered(_ONSITE_FIELDS))
        return AnswerEffect()

    if field_path == "compensation_mode":
        if value == "negotiable":
            # An open figure has no minimum or maximum to state.
            return AnswerEffect(
                suppressed_fields=_filtered(frozenset({"budget_amount", "budget_max"}))
            )
        if value == "fixed":
            return AnswerEffect(suppressed_fields=_filtered(frozenset({"budget_max"})))
        return AnswerEffect()

    if field_path in {"location", "candidate_location_scope"}:
        return _location_effects(value, values)

    if field_path == "revision_policy":
        if value in {"unlimited", "negotiable", "not_applicable"}:
            return AnswerEffect(
                suppressed_fields=_filtered(frozenset({"revision_rounds"}))
            )
        return AnswerEffect()

    if field_path == "duration_type":
        if value == "ongoing":
            return AnswerEffect(
                suppressed_fields=_filtered(
                    frozenset({"duration_value", "duration_unit", "engagement_end_date"})
                )
            )
        return AnswerEffect()

    if field_path == "start_timing":
        if value != "specific_date":
            return AnswerEffect(suppressed_fields=_filtered(frozenset({"start_date"})))
        return AnswerEffect()

    return AnswerEffect()


def _location_effects(
    value: object, canonical_values: dict[str, object]
) -> AnswerEffect:
    """A stated location makes a currency likely — never certain.

    Deliberately a suggestion. Pay shown in the wrong currency misleads every
    candidate who reads the listing, so the recruiter confirms it in words.
    """

    if not isinstance(value, str) or not value.strip():
        return AnswerEffect()

    # A currency the recruiter already settled is never second-guessed.
    if canonical_values.get("budget_currency"):
        return AnswerEffect()

    country_code = country_from_location(value)
    if country_code is None:
        return AnswerEffect()
    currency = currency_for_country(country_code)
    if not currency:
        return AnswerEffect()
    # Quote the recruiter's own words back rather than a resolved country name:
    # it reads as listening, and it cannot misname a place they described.
    spoken_location = " ".join(value.split())[:80]

    # No amount means no currency question worth asking yet.
    has_amount = any(
        canonical_values.get(path) not in (None, "")
        for path in ("budget_amount", "budget_max")
    )
    if not has_amount:
        return AnswerEffect()

    return AnswerEffect(
        suggestions=[
            AnswerSuggestion(
                field_path="budget_currency",
                value=currency,
                rationale_code="location_implies_currency",
                explanation=(
                    f"You said this role is based in {spoken_location}, but the source "
                    f"does not label the pay. Should candidates see it in {currency}?"
                ),
            )
        ]
    )


def suppressed_by_answers(
    answers: dict[str, object],
    *,
    canonical_values: dict[str, object] | None = None,
) -> frozenset[str]:
    """Every field made irrelevant by the answers so far.

    Used by the question queue so a suppressed field can never be selected, no
    matter which code path proposes it.
    """

    suppressed: set[str] = set()
    for field_path, value in answers.items():
        suppressed |= effects_for_answer(
            field_path, value, canonical_values=canonical_values
        ).suppressed_fields
    return frozenset(suppressed)
