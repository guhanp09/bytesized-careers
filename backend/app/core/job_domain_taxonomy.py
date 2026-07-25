from __future__ import annotations

from typing import Final, Literal


CREATOR_JOB_PLATFORMS: Final[tuple[str, ...]] = (
    "youtube",
    "instagram",
)

CREATOR_JOB_FORMATS: Final[tuple[str, ...]] = (
    "Long-form video",
    "Shorts/Reels",
    "Thumbnails",
    "Scripts",
    "Hooks",
    "Voice-over",
    "Motion graphics",
    "Captions",
    "Repurposed clips",
    "Channel research",
    "Content strategy",
    "Podcast editing",
    "Social posts",
    "YouTube packaging",
    "Ad creatives",
)

DELIVERABLE_TYPES: Final[tuple[str, ...]] = (
    "long_form_video",
    "short",
    "thumbnail",
    "script",
    "podcast_episode",
    "community_post",
    "social_post",
    "newsletter",
    "livestream",
    "audio_asset",
    "design_asset",
    "research_brief",
    "voice_over",
    "other",
)

DELIVERABLE_FREQUENCIES: Final[tuple[str, ...]] = (
    "one_time",
    "per_day",
    "per_week",
    "per_month",
    "per_video",
    "per_episode",
    "every_two_weeks",
    "ongoing",
    "other",
)

OUTPUT_COMPENSATION_UNITS: Final[frozenset[str]] = frozenset(
    {
        "per deliverable",
        "per video",
        "per short",
        "per thumbnail",
        "per script",
        "per episode",
        "per post",
    }
)

SKILL_KEYS: Final[tuple[str, ...]] = (
    "video_editing",
    "short_form_editing",
    "storytelling",
    "motion_graphics",
    "color_grading",
    "audio_editing",
    "thumbnail_design",
    "graphic_design",
    "scriptwriting",
    "copywriting",
    "research",
    "seo",
    "channel_strategy",
    "community_management",
    "project_management",
    "ugc_creation",
    "voice_over",
)

REVISION_POLICIES: Final[tuple[str, ...]] = (
    "fixed",
    "unlimited",
    "negotiable",
    "not_applicable",
)

SOURCE_INPUT_TYPES: Final[tuple[str, ...]] = (
    "raw_footage",
    "script",
    "research",
    "creative_brief",
    "brand_guidelines",
    "reference_videos",
    "thumbnail_assets",
    "music_or_stock_subscription",
    "voice_over",
    "project_files",
    "analytics_access",
    "account_access",
    "product_footage",
    "other",
)

SENSITIVE_SOURCE_INPUT_TYPES: Final[frozenset[str]] = frozenset(
    {"analytics_access", "account_access"}
)

CREATIVE_AUTONOMY_LEVELS: Final[tuple[str, ...]] = (
    "follow_established_style",
    "guided_by_references",
    "collaborative_direction",
    "own_creative_approach",
    "varies_by_assignment",
    "not_applicable",
)

LANGUAGE_PRIORITIES: Final[tuple[str, ...]] = ("required", "preferred")
LANGUAGE_PROFICIENCIES: Final[tuple[str, ...]] = (
    "native_or_fluent",
    "professional",
    "conversational",
    "basic",
)
LANGUAGE_PURPOSES: Final[tuple[str, ...]] = (
    "speaking",
    "writing",
    "reading",
    "content_understanding",
    "audience_fluency",
)

TRIAL_STATUSES: Final[tuple[str, ...]] = ("none", "paid", "unpaid", "undecided")
TRIAL_EFFORT_UNITS: Final[tuple[str, ...]] = ("hours", "days", "deliverables")
TRIAL_COMPENSATION_BASES: Final[tuple[str, ...]] = (
    "flat",
    "per_hour",
    "per_deliverable",
    "custom",
)
TRIAL_WORK_USAGE: Final[tuple[str, ...]] = (
    "evaluation_only",
    "may_use_privately",
    "may_publish",
)
TRIAL_PORTFOLIO_PERMISSIONS: Final[tuple[str, ...]] = (
    "allowed",
    "not_allowed",
    "with_permission",
)
TRIAL_ATTRIBUTION_TERMS: Final[tuple[str, ...]] = (
    "credited",
    "not_credited",
    "not_applicable",
    "to_be_agreed",
)

START_TIMINGS: Final[tuple[str, ...]] = (
    "immediate",
    "within_two_weeks",
    "specific_date",
    "flexible",
)
DURATION_TYPES: Final[tuple[str, ...]] = (
    "ongoing",
    "fixed_period",
    "project_based",
    "until_date",
    "flexible",
)
DURATION_UNITS: Final[tuple[str, ...]] = ("weeks", "months")

HIRING_PROCESS_STAGES: Final[tuple[str, ...]] = (
    "application_review",
    "portfolio_review",
    "screening_call",
    "interview",
    "assessment",
    "paid_trial",
    "unpaid_trial",
    "final_discussion",
    "offer",
    "other",
)

EMPLOYER_CONTEXT_TYPES: Final[tuple[str, ...]] = (
    "creator",
    "agency",
    "brand",
    "production_house",
    "other",
)

AIConfirmationPolicy = Literal[
    "extract_when_explicit",
    "suggest_with_recruiter_confirmation",
    "explicit_recruiter_confirmation_required",
    "server_owned_never_infer",
    "legacy_compatibility_never_import",
]

# This policy is consumed by the private job-import readiness service. It remains
# provider-neutral: values describe CreatorJobs authority rules, not any model's
# confidence or response format.
AI_FIELD_CONFIRMATION_POLICY: Final[dict[str, AIConfirmationPolicy]] = {
    "title": "extract_when_explicit",
    "primary_role_key": "suggest_with_recruiter_confirmation",
    "role_specialization": "suggest_with_recruiter_confirmation",
    "location": "extract_when_explicit",
    "experience_level": "extract_when_explicit",
    "platforms": "extract_when_explicit",
    "start_timeframe": "extract_when_explicit",
    "work_mode": "extract_when_explicit",
    "engagement_type": "suggest_with_recruiter_confirmation",
    "timezone_overlap": "extract_when_explicit",
    "turnaround_value": "explicit_recruiter_confirmation_required",
    "turnaround_unit": "explicit_recruiter_confirmation_required",
    "turnaround_basis": "suggest_with_recruiter_confirmation",
    "application_mode": "explicit_recruiter_confirmation_required",
    "external_apply_url": "extract_when_explicit",
    "about_channel": "extract_when_explicit",
    "responsibilities": "extract_when_explicit",
    "requirements": "extract_when_explicit",
    "reference_videos": "extract_when_explicit",
    "tags": "suggest_with_recruiter_confirmation",
    "languages": "legacy_compatibility_never_import",
    "content_niches": "suggest_with_recruiter_confirmation",
    "content_genres": "suggest_with_recruiter_confirmation",
    "formats_hired_for": "suggest_with_recruiter_confirmation",
    "required_tool_keys": "extract_when_explicit",
    "other_required_tools": "extract_when_explicit",
    "deliverables": "extract_when_explicit",
    "deliverables.type": "extract_when_explicit",
    "deliverables.custom_type": "extract_when_explicit",
    "deliverables.quantity": "extract_when_explicit",
    "deliverables.frequency": "extract_when_explicit",
    "deliverables.custom_frequency": "extract_when_explicit",
    "deliverables.notes": "extract_when_explicit",
    "required_skill_keys": "suggest_with_recruiter_confirmation",
    "preferred_skill_keys": "suggest_with_recruiter_confirmation",
    "other_required_skills": "extract_when_explicit",
    "other_preferred_skills": "extract_when_explicit",
    "required_skills_note": "extract_when_explicit",
    "preferred_skills_note": "extract_when_explicit",
    "revision_policy": "extract_when_explicit",
    "revision_rounds": "extract_when_explicit",
    "revision_notes": "extract_when_explicit",
    "source_inputs": "suggest_with_recruiter_confirmation",
    "source_inputs.type.account_access": "explicit_recruiter_confirmation_required",
    "source_inputs.type.analytics_access": "explicit_recruiter_confirmation_required",
    "source_inputs.custom_label": "extract_when_explicit",
    "source_inputs.sensitive_access_confirmed": "explicit_recruiter_confirmation_required",
    "source_inputs_notes": "extract_when_explicit",
    "creative_autonomy": "suggest_with_recruiter_confirmation",
    "creative_autonomy_notes": "extract_when_explicit",
    "language_requirements": "legacy_compatibility_never_import",
    "language_requirements.language": "legacy_compatibility_never_import",
    "language_requirements.priority": "legacy_compatibility_never_import",
    "language_requirements.proficiency": "legacy_compatibility_never_import",
    "language_requirements.purposes": "legacy_compatibility_never_import",
    "language_requirements.notes": "legacy_compatibility_never_import",
    "trial_status": "explicit_recruiter_confirmation_required",
    "trial_scope": "extract_when_explicit",
    "trial_effort_value": "explicit_recruiter_confirmation_required",
    "trial_effort_unit": "explicit_recruiter_confirmation_required",
    "trial_compensation_amount": "explicit_recruiter_confirmation_required",
    "trial_compensation_currency": "explicit_recruiter_confirmation_required",
    "trial_compensation_basis": "explicit_recruiter_confirmation_required",
    "trial_work_usage": "explicit_recruiter_confirmation_required",
    "trial_portfolio_permission": "explicit_recruiter_confirmation_required",
    "trial_attribution": "explicit_recruiter_confirmation_required",
    "unpaid_trial_confirmed": "explicit_recruiter_confirmation_required",
    "trial_notes": "extract_when_explicit",
    "start_timing": "suggest_with_recruiter_confirmation",
    "start_date": "explicit_recruiter_confirmation_required",
    "duration_type": "extract_when_explicit",
    "duration_value": "extract_when_explicit",
    "duration_unit": "extract_when_explicit",
    "engagement_end_date": "explicit_recruiter_confirmation_required",
    "deadline_at": "explicit_recruiter_confirmation_required",
    "hiring_process": "extract_when_explicit",
    "hiring_process.stage": "extract_when_explicit",
    "hiring_process.custom_label": "extract_when_explicit",
    "hiring_process.notes": "extract_when_explicit",
    "hiring_process_notes": "extract_when_explicit",
    "application_requirements": "suggest_with_recruiter_confirmation",
    "screening_questions": "extract_when_explicit",
    "screening_questions.prompt": "extract_when_explicit",
    "screening_questions.required": "suggest_with_recruiter_confirmation",
    "screening_questions.response_guidance": "extract_when_explicit",
    "how_to_apply": "extract_when_explicit",
    "compensation_mode": "explicit_recruiter_confirmation_required",
    "budget_amount": "explicit_recruiter_confirmation_required",
    "budget_max": "explicit_recruiter_confirmation_required",
    "budget_currency": "explicit_recruiter_confirmation_required",
    "budget_unit": "explicit_recruiter_confirmation_required",
    "budget_unit_custom": "explicit_recruiter_confirmation_required",
    "budget_note": "explicit_recruiter_confirmation_required",
    "expected_weekly_hours_min": "explicit_recruiter_confirmation_required",
    "expected_weekly_hours_max": "explicit_recruiter_confirmation_required",
    "employer_context_type": "explicit_recruiter_confirmation_required",
    "category": "server_owned_never_infer",
    "contract_type": "server_owned_never_infer",
    "weekly_hours": "server_owned_never_infer",
    "hiring_identity_id": "server_owned_never_infer",
    "primary_role_id": "server_owned_never_infer",
    "primary_role_name_snapshot": "server_owned_never_infer",
    "posted_by_user_id": "server_owned_never_infer",
    "listing_schema_version": "server_owned_never_infer",
    "status": "server_owned_never_infer",
    "is_verified": "server_owned_never_infer",
    "views": "server_owned_never_infer",
    "applicants": "server_owned_never_infer",
    "response_rate": "server_owned_never_infer",
    "featured_until": "server_owned_never_infer",
    "hiring_verification_status_snapshot": "server_owned_never_infer",
}
