"""The executable semantic/control inventory for every importable job field.

The field registry, native schema, inference policy, and conversation controls
used to describe overlapping contracts separately. This projection composes
those accepted sources into one complete matrix. It is intentionally generated:
adding an importable field without semantics now fails a test instead of quietly
giving Luna an unexplained JSON key or Bea an arbitrary control.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from app.core.job_import_answer_shapes import answer_shape_for
from app.core.job_import_field_descriptions import describe
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
from app.core.job_import_question_value import question_value

AnswerClassification = Literal[
    "strict_enum",
    "enum_plus_custom",
    "structured_open",
    "free_text",
    "derived",
    "server_owned",
]

_PLATFORM_DECIDED_FIELDS = frozenset({"application_mode", "external_apply_url"})
_EXPLICIT_PENDING_SOURCE_INPUT_PATHS = frozenset(
    {
        "source_inputs.type.account_access",
        "source_inputs.type.analytics_access",
    }
)
_PROVIDER_FORBIDDEN_NESTED_PATHS = frozenset(
    {"source_inputs.sensitive_access_confirmed"}
)

_APPLICATION_FIELD_FORBIDDEN_SEMANTICS: dict[str, tuple[str, ...]] = {
    "application_mode": (
        "Never extract or suggest an application route; CreatorJobs always "
        "sets this server-side.",
    ),
    "external_apply_url": (
        "Never emit an external application URL, email address, phone number, "
        "handle, or destination.",
    ),
    "application_requirements": (
        "Emit only supplied canonical application-requirement keys, never prose "
        "or destinations.",
        "Do not turn an evaluative question into an application-material requirement.",
    ),
    "screening_questions": (
        "Emit only source-stated evaluative prompts; never invent requiredness "
        "or rejection logic.",
        "Do not turn a resume, portfolio, cover letter, rate, availability, or "
        "other standard material request into a screening question.",
    ),
    "how_to_apply": (
        "Never include an external destination, contact detail, URL, email "
        "address, phone number, handle, or source-platform route.",
        "Do not repeat a material already represented by application_requirements "
        "or a prompt represented by screening_questions.",
    ),
}


@dataclass(frozen=True)
class JobImportIntelligenceRow:
    field_path: str
    meaning: str
    answer_classification: AnswerClassification
    custom_values_allowed: bool
    inference_risk: str
    allowed_origins: tuple[str, ...]
    explicit_evidence_required: bool
    missing_requirement: str
    provider_visible: bool
    forbidden_semantics: tuple[str, ...]
    source_patterns: tuple[str, ...]
    deterministic_coverage: str
    safe_inference_rule: str
    conflict_authority: str
    question_eligibility: str
    question_type: str | None
    validator: str
    persistence: str
    presentation: str
    nested_fields: tuple[str, ...]
    historic_regressions: tuple[str, ...]
    regression_coverage: tuple[str, ...]


@dataclass(frozen=True)
class JobImportNestedIntelligenceRow:
    field_path: str
    parent_field: str
    confirmation_policy: str
    provider_visible: bool
    validator: str
    presentation: str
    forbidden_semantics: tuple[str, ...]


_STRUCTURED_OR_LABELLED_FIELDS = frozenset(
    {
        "title",
        "about_channel",
        "engagement_type",
        "work_mode",
        "location",
        "compensation_mode",
        "budget_amount",
        "budget_max",
        "budget_currency",
        "budget_unit",
        "experience_level",
        "responsibilities",
        "requirements",
    }
)
_SEMANTIC_FALLBACK_FIELDS = frozenset(
    {
        "primary_role_key",
        "content_niches",
        "budget_currency",
        "location",
        "application_requirements",
        "how_to_apply",
        "expected_weekly_hours_min",
        "expected_weekly_hours_max",
    }
)

_SOURCE_PATTERN_HINTS: dict[str, tuple[str, ...]] = {
    "experience_level": (
        "Dedicated labelled Experience/Experience required row",
        "Explicit years/months requirement in role prose",
    ),
    "location": (
        "JobPosting jobLocation/applicantLocationRequirements",
        "Title/location row/candidate-geography corroboration",
    ),
    "application_requirements": (
        "Explicit resume, cover-letter, portfolio, sample, rate or availability request",
    ),
    "how_to_apply": (
        "Residual material instruction after removing every destination and contact route",
    ),
    "expected_weekly_hours_min": (
        "Explicit weekly hours or entailed days-per-week × hours-per-day schedule",
    ),
    "expected_weekly_hours_max": (
        "Explicit weekly-hours ceiling or exact entailed weekly schedule",
    ),
}

_HISTORIC_REGRESSIONS: dict[str, tuple[str, ...]] = {
    "experience_level": (
        "exact 1–2 years narrowed to 1–3 years",
        "one-option conflict question",
        "open minimum coerced to a preset band",
    ),
    "location": (
        "neighbourhood/state/country blob stored as city",
        "Remote India lost its geographic restriction",
    ),
    "application_requirements": (
        "resume and cover letter removed together with an external route",
    ),
    "how_to_apply": (
        "email/job-board destination leaked into candidate copy",
    ),
    "deliverables": ("quantity=1 and monthly cadence fabricated by Bea",),
    "source_inputs": ("sensitive access offered without recruiter confirmation",),
}

_REGRESSION_COVERAGE: dict[str, tuple[str, ...]] = {
    "experience_level": (
        "tests/test_job_import_experience_conflict_regression.py",
        "tests/test_job_import_source_corpus.py",
    ),
    "location": (
        "tests/test_job_import_location_resolution.py",
        "tests/test_job_import_source_corpus.py",
    ),
    "application_requirements": (
        "tests/test_job_application_classification.py",
        "tests/test_application_end_to_end.py",
    ),
    "how_to_apply": ("tests/test_job_application_instructions.py",),
    "deliverables": ("tests/test_job_import_structured_answer_contract.py",),
    "source_inputs": ("tests/test_job_import_structured_answer_contract.py",),
    "hiring_process": ("tests/test_job_import_structured_answer_contract.py",),
}


def _answer_classification(field_path: str) -> AnswerClassification:
    policy = JOB_IMPORT_FIELD_POLICIES[field_path]
    if field_path in _PLATFORM_DECIDED_FIELDS:
        return "server_owned"
    shape = answer_shape_for(field_path)
    if shape.item_key is not None:
        return "structured_open"
    if policy.custom_values_allowed and shape.choices:
        return "enum_plus_custom"
    if shape.kind in {"choice", "multi_choice"}:
        return "strict_enum"
    if shape.kind in {"number", "date", "url"} or shape.is_list:
        return "structured_open"
    return "free_text"


def _forbidden_semantics(field_path: str) -> tuple[str, ...]:
    policy = JOB_IMPORT_FIELD_POLICIES[field_path]
    restrictions = list(_APPLICATION_FIELD_FORBIDDEN_SEMANTICS.get(field_path, ()))
    if policy.allowed_origins == frozenset({"explicit"}):
        restrictions.append(
            "Do not infer, default, broaden, or derive this field; emit it only "
            "from explicit source evidence."
        )
    for nested_path, confirmation_policy in policy.nested_confirmation_policies:
        if confirmation_policy == "explicit_recruiter_confirmation_required":
            if nested_path in _EXPLICIT_PENDING_SOURCE_INPUT_PATHS:
                restrictions.append(
                    f"{nested_path} may be extracted only from explicit source evidence; "
                    "leave sensitive access confirmation pending for the recruiter."
                )
            else:
                restrictions.append(
                    f"Never populate {nested_path}; it is a recruiter-owned confirmation."
                )
    return tuple(dict.fromkeys(restrictions))


def _deterministic_coverage(field_path: str) -> str:
    if field_path in _PLATFORM_DECIDED_FIELDS:
        return "server_owned"
    if field_path in _STRUCTURED_OR_LABELLED_FIELDS:
        return "structured_or_labelled_source"
    if field_path in _SEMANTIC_FALLBACK_FIELDS:
        return "bounded_semantic_fallback"
    return "provider_primary_with_server_validation"


def _safe_inference_rule(field_path: str) -> str:
    origins = JOB_IMPORT_FIELD_POLICIES[field_path].allowed_origins
    if origins == frozenset({"explicit"}):
        return "Explicit source evidence only; no inference, default or narrowing."
    if "contextual_inference" in origins:
        return (
            "Auto-fill only a high-confidence value logically entailed by corroborating "
            "source context; a merely plausible reading remains a suggestion."
        )
    if "semantic_inference" in origins:
        return (
            "Preserve explicit facts; semantic interpretation may be suggested, and may "
            "auto-fill only where the field's confidence policy explicitly permits it."
        )
    return "No inference is permitted."


def _question_type(field_path: str) -> str | None:
    if field_path in _PLATFORM_DECIDED_FIELDS:
        return None
    value = question_value(field_path)
    if value in {"leave_for_post_job", "deterministic_fallback"}:
        return None
    return answer_shape_for(field_path).kind


def _presentation(field_path: str) -> str:
    if field_path in _PLATFORM_DECIDED_FIELDS:
        return "server-owned routing; never source-controlled candidate copy"
    if field_path == "screening_questions":
        return "private to applicant and recruiter messaging; absent from the public job"
    return "candidate-visible when relevant after recruiter review and publication"


@lru_cache(maxsize=1)
def intelligence_matrix() -> dict[str, JobImportIntelligenceRow]:
    if not JOB_IMPORT_FIELD_POLICIES:
        raise RuntimeError("Job-import intelligence matrix cannot be empty")
    rows: dict[str, JobImportIntelligenceRow] = {}
    for field_path, policy in JOB_IMPORT_FIELD_POLICIES.items():
        meaning = describe(field_path)
        if not meaning or not meaning.strip():
            raise RuntimeError(f"Missing job-import field meaning for {field_path}")
        rows[field_path] = JobImportIntelligenceRow(
            field_path=field_path,
            meaning=meaning,
            answer_classification=_answer_classification(field_path),
            custom_values_allowed=policy.custom_values_allowed,
            inference_risk=policy.inference_risk,
            allowed_origins=tuple(sorted(policy.allowed_origins)),
            explicit_evidence_required=policy.explicit_evidence_required,
            missing_requirement=policy.missing_requirement,
            provider_visible=field_path not in _PLATFORM_DECIDED_FIELDS,
            forbidden_semantics=_forbidden_semantics(field_path),
            source_patterns=_SOURCE_PATTERN_HINTS.get(
                field_path,
                ("JobPosting structured data, labelled rows, and role-specific prose",),
            ),
            deterministic_coverage=_deterministic_coverage(field_path),
            safe_inference_rule=_safe_inference_rule(field_path),
            conflict_authority=(
                "Recruiter answer > dedicated labelled job fact > job-specific "
                "structured fact > evidence-backed interpretation > heuristic."
            ),
            question_eligibility=question_value(field_path),
            question_type=_question_type(field_path),
            validator=(
                "active role catalog lookup"
                if field_path == "primary_role_key"
                else f"JobUpdate.{policy.native_field} plus conversation answer validation"
            ),
            persistence=(
                "resolved primary_role_id/name snapshot"
                if field_path == "primary_role_key"
                else str(policy.native_field)
            ),
            presentation=_presentation(field_path),
            nested_fields=tuple(path for path, _rule in policy.nested_confirmation_policies),
            historic_regressions=_HISTORIC_REGRESSIONS.get(field_path, ()),
            regression_coverage=_REGRESSION_COVERAGE.get(field_path, ()),
        )
    return rows


def intelligence_for(field_path: str) -> JobImportIntelligenceRow:
    try:
        return intelligence_matrix()[field_path]
    except KeyError as exc:  # pragma: no cover - callers iterate the registry
        raise RuntimeError(f"Unknown job-import field {field_path}") from exc


@lru_cache(maxsize=1)
def nested_intelligence_matrix() -> dict[str, JobImportNestedIntelligenceRow]:
    """Every nested confirmation boundary, projected beside its parent field."""

    rows: dict[str, JobImportNestedIntelligenceRow] = {}
    for parent, policy in JOB_IMPORT_FIELD_POLICIES.items():
        for field_path, confirmation_policy in policy.nested_confirmation_policies:
            rows[field_path] = JobImportNestedIntelligenceRow(
                field_path=field_path,
                parent_field=parent,
                confirmation_policy=confirmation_policy,
                provider_visible=(
                    parent not in _PLATFORM_DECIDED_FIELDS
                    and field_path not in _PROVIDER_FORBIDDEN_NESTED_PATHS
                ),
                validator=f"JobUpdate.{policy.native_field} nested schema",
                presentation=_presentation(parent),
                forbidden_semantics=(
                    (
                        "Extract only from explicit source evidence and leave sensitive "
                        "access confirmation pending for the recruiter.",
                    )
                    if field_path in _EXPLICIT_PENDING_SOURCE_INPUT_PATHS
                    else (
                        (
                            "Recruiter confirmation is required; Luna must never assert "
                            "this value.",
                        )
                        if confirmation_policy == "explicit_recruiter_confirmation_required"
                        else ()
                    )
                ),
            )
    return rows
