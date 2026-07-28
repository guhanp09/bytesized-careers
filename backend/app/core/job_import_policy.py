from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from app.core.job_domain_taxonomy import (
    AI_FIELD_CONFIRMATION_POLICY,
    AIConfirmationPolicy,
)

MissingRequirement = Literal[
    "publication_blocker",
    "conditionally_required",
    "recommended",
    "optional",
]
ReviewSection = Literal[
    "basics",
    "compensation",
    "work",
    "description",
    "skills_tools",
    "terms",
    "application",
    "identity",
]


@dataclass(frozen=True)
class JobImportFieldPolicy:
    field_path: str
    native_field: str | None
    confirmation_policy: AIConfirmationPolicy
    missing_requirement: MissingRequirement
    review_section: ReviewSection
    custom_values_allowed: bool = False
    nested_confirmation_policies: tuple[
        tuple[str, AIConfirmationPolicy], ...
    ] = ()


_SUPPORTED_NATIVE_FIELDS: Final[tuple[str, ...]] = (
    "title",
    "role_specialization",
    "location",
    "compensation_mode",
    "budget_amount",
    "budget_max",
    "budget_note",
    "budget_currency",
    "budget_unit",
    "budget_unit_custom",
    "experience_level",
    "platforms",
    "start_timeframe",
    "work_mode",
    "engagement_type",
    "timezone_overlap",
    "expected_weekly_hours_min",
    "expected_weekly_hours_max",
    "turnaround_value",
    "turnaround_unit",
    "turnaround_basis",
    "application_mode",
    "external_apply_url",
    "deadline_at",
    "start_timing",
    "start_date",
    "duration_type",
    "duration_value",
    "duration_unit",
    "engagement_end_date",
    "about_channel",
    "responsibilities",
    "requirements",
    "application_requirements",
    "how_to_apply",
    "reference_videos",
    "tags",
    "content_niches",
    "content_genres",
    "formats_hired_for",
    "required_tool_keys",
    "other_required_tools",
    "deliverables",
    "required_skill_keys",
    "preferred_skill_keys",
    "other_required_skills",
    "other_preferred_skills",
    "required_skills_note",
    "preferred_skills_note",
    "revision_policy",
    "revision_rounds",
    "revision_notes",
    "source_inputs",
    "source_inputs_notes",
    "creative_autonomy",
    "creative_autonomy_notes",
    "trial_status",
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
    "trial_notes",
    "hiring_process",
    "hiring_process_notes",
    "employer_context_type",
)

_PUBLICATION_BLOCKERS: Final[frozenset[str]] = frozenset(
    {
        "title",
        "primary_role_key",
        "engagement_type",
        "platforms",
        "work_mode",
        "about_channel",
        "responsibilities",
        "requirements",
        "start_timeframe",
        "application_mode",
        "compensation_mode",
        "budget_unit",
    }
)
_CONDITIONAL_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "role_specialization",
        "location",
        "budget_amount",
        "budget_max",
        "budget_note",
        "budget_currency",
        "budget_unit_custom",
        "expected_weekly_hours_min",
        "expected_weekly_hours_max",
        "turnaround_value",
        "turnaround_unit",
        "turnaround_basis",
        "external_apply_url",
        "deadline_at",
        "deliverables",
        "revision_rounds",
        "source_inputs",
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
        "start_date",
        "duration_value",
        "duration_unit",
        "engagement_end_date",
    }
)
_RECOMMENDED_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "required_skill_keys",
        "preferred_skill_keys",
        "required_tool_keys",
        "revision_policy",
        "creative_autonomy",
        "trial_status",
        "duration_type",
        "hiring_process",
        "employer_context_type",
    }
)

_SECTION_FIELDS: Final[dict[ReviewSection, frozenset[str]]] = {
    "basics": frozenset(
        {
            "title",
            "primary_role_key",
            "role_specialization",
            "platforms",
            "location",
            "work_mode",
            "engagement_type",
            "experience_level",
        }
    ),
    "compensation": frozenset(
        {
            "compensation_mode",
            "budget_amount",
            "budget_max",
            "budget_note",
            "budget_currency",
            "budget_unit",
            "budget_unit_custom",
        }
    ),
    "work": frozenset(
        {
            "start_timeframe",
            "timezone_overlap",
            "expected_weekly_hours_min",
            "expected_weekly_hours_max",
            "turnaround_value",
            "turnaround_unit",
            "turnaround_basis",
            "start_timing",
            "start_date",
            "duration_type",
            "duration_value",
            "duration_unit",
            "engagement_end_date",
            "deliverables",
        }
    ),
    "description": frozenset(
        {
            "about_channel",
            "responsibilities",
            "requirements",
            "reference_videos",
            "tags",
            "content_niches",
            "content_genres",
            "formats_hired_for",
        }
    ),
    "skills_tools": frozenset(
        {
            "required_tool_keys",
            "other_required_tools",
            "required_skill_keys",
            "preferred_skill_keys",
            "other_required_skills",
            "other_preferred_skills",
            "required_skills_note",
            "preferred_skills_note",
        }
    ),
    "terms": frozenset(
        {
            "revision_policy",
            "revision_rounds",
            "revision_notes",
            "source_inputs",
            "source_inputs_notes",
            "creative_autonomy",
            "creative_autonomy_notes",
            "trial_status",
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
            "trial_notes",
        }
    ),
    "application": frozenset(
        {
            "application_mode",
            "external_apply_url",
            "deadline_at",
            "application_requirements",
            "how_to_apply",
            "hiring_process",
            "hiring_process_notes",
        }
    ),
    "identity": frozenset({"employer_context_type"}),
}

_CUSTOM_VALUE_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "role_specialization",
        "budget_unit_custom",
        "other_required_tools",
        "other_required_skills",
        "other_preferred_skills",
        "content_niches",
        "content_genres",
        "formats_hired_for",
    }
)


def _missing_requirement(field_path: str) -> MissingRequirement:
    if field_path in _PUBLICATION_BLOCKERS:
        return "publication_blocker"
    if field_path in _CONDITIONAL_FIELDS:
        return "conditionally_required"
    if field_path in _RECOMMENDED_FIELDS:
        return "recommended"
    return "optional"


def _section(field_path: str) -> ReviewSection:
    for section, fields in _SECTION_FIELDS.items():
        if field_path in fields:
            return section
    raise RuntimeError(f"Missing job-import review section for {field_path}")


def _policy(field_path: str, native_field: str | None) -> JobImportFieldPolicy:
    confirmation_policy = AI_FIELD_CONFIRMATION_POLICY.get(field_path)
    if confirmation_policy is None:
        raise RuntimeError(f"Missing job-import confirmation policy for {field_path}")
    return JobImportFieldPolicy(
        field_path=field_path,
        native_field=native_field,
        confirmation_policy=confirmation_policy,
        missing_requirement=_missing_requirement(field_path),
        review_section=_section(field_path),
        custom_values_allowed=field_path in _CUSTOM_VALUE_FIELDS,
        nested_confirmation_policies=tuple(
            sorted(
                (nested_path, nested_policy)
                for nested_path, nested_policy in AI_FIELD_CONFIRMATION_POLICY.items()
                if nested_path.startswith(f"{field_path}.")
            )
        ),
    )


JOB_IMPORT_FIELD_POLICIES: Final[dict[str, JobImportFieldPolicy]] = {
    "primary_role_key": _policy("primary_role_key", None),
    **{field: _policy(field, field) for field in _SUPPORTED_NATIVE_FIELDS},
}

SYSTEM_OWNED_IMPORT_FIELDS: Final[frozenset[str]] = frozenset(
    field
    for field, policy in AI_FIELD_CONFIRMATION_POLICY.items()
    if policy == "server_owned_never_infer"
)

LEGACY_COMPATIBILITY_IMPORT_FIELDS: Final[frozenset[str]] = frozenset(
    field
    for field, policy in AI_FIELD_CONFIRMATION_POLICY.items()
    if policy == "legacy_compatibility_never_import"
)

AUTO_TRACKED_MISSING_FIELDS: Final[tuple[str, ...]] = tuple(
    field_path
    for field_path, policy in JOB_IMPORT_FIELD_POLICIES.items()
    if policy.missing_requirement != "optional"
)


def import_field_policy(field_path: str) -> JobImportFieldPolicy | None:
    return JOB_IMPORT_FIELD_POLICIES.get(field_path)
