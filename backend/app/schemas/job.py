from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


JobStatus = Literal["draft", "published", "paused", "closed", "archived"]
#: ``approximate`` is additive and needs no migration: the column is a plain
#: string, so existing rows keep whatever they already had. It exists because
#: "About ₹20,000 a month" is a fourth distinct fact — not exactly 20,000, not a
#: range of 20,000-20,000, and not negotiable — and collapsing it into any of
#: those claims a precision the employer declined to give.
CompensationMode = Literal["fixed", "range", "negotiable", "approximate"]
BudgetUnit = Literal[
    "per hour",
    "per day",
    "per deliverable",
    "per video",
    "per short",
    "per thumbnail",
    "per script",
    "per episode",
    "per post",
    "per project",
    "per week",
    "per month",
    "per year",
    "commission",
    "mixed",
    "custom",
]
EngagementType = Literal[
    "one_time_project",
    "ongoing_freelance",
    "retainer",
    "part_time",
    "full_time",
    "fixed_term",
    "internship",
]
TurnaroundUnit = Literal["hours", "business_days", "calendar_days", "weeks"]
TurnaroundBasis = Literal["per_deliverable", "batch", "first_draft", "final_delivery"]
WorkMode = Literal["remote", "hybrid", "onsite"]
ApplicationMode = Literal["internal", "external"]
DeliverableType = Literal[
    "long_form_video", "short", "thumbnail", "script", "podcast_episode",
    "community_post", "social_post", "newsletter", "livestream", "audio_asset",
    "design_asset", "research_brief", "voice_over", "other",
]
DeliverableFrequency = Literal[
    "one_time", "per_day", "per_week", "per_month", "per_video", "per_episode",
    "every_two_weeks", "ongoing", "other",
]
SkillKey = Literal[
    "video_editing", "short_form_editing", "storytelling", "motion_graphics",
    "color_grading", "audio_editing", "thumbnail_design", "graphic_design",
    "scriptwriting", "copywriting", "research", "seo", "channel_strategy",
    "community_management", "project_management", "ugc_creation", "voice_over",
]
RevisionPolicy = Literal["fixed", "unlimited", "negotiable", "not_applicable"]
SourceInputType = Literal[
    "raw_footage", "script", "research", "creative_brief", "brand_guidelines",
    "reference_videos", "thumbnail_assets", "music_or_stock_subscription", "voice_over",
    "project_files", "analytics_access", "account_access", "product_footage", "other",
]
CreativeAutonomy = Literal[
    "follow_established_style", "guided_by_references", "collaborative_direction",
    "own_creative_approach", "varies_by_assignment", "not_applicable",
]
LanguagePriority = Literal["required", "preferred"]
LanguageProficiency = Literal["native_or_fluent", "professional", "conversational", "basic"]
LanguagePurpose = Literal[
    "speaking", "writing", "reading", "content_understanding", "audience_fluency",
]
TrialStatus = Literal["none", "paid", "unpaid", "undecided"]
TrialEffortUnit = Literal["hours", "days", "deliverables"]
TrialCompensationBasis = Literal["flat", "per_hour", "per_deliverable", "custom"]
TrialWorkUsage = Literal["evaluation_only", "may_use_privately", "may_publish"]
TrialPortfolioPermission = Literal["allowed", "not_allowed", "with_permission"]
TrialAttribution = Literal["credited", "not_credited", "not_applicable", "to_be_agreed"]
StartTiming = Literal["immediate", "within_two_weeks", "specific_date", "flexible"]
DurationType = Literal["ongoing", "fixed_period", "project_based", "until_date", "flexible"]
DurationUnit = Literal["weeks", "months"]
HiringProcessStageType = Literal[
    "application_review", "portfolio_review", "screening_call", "interview", "assessment",
    "paid_trial", "unpaid_trial", "final_discussion", "offer", "other",
]
EmployerContextType = Literal["creator", "agency", "brand", "production_house", "other"]

CREATOR_CONTEXT_FIELDS = ("content_niches", "content_genres", "formats_hired_for")
LIST_FIELDS = (
    "platforms",
    "responsibilities",
    "requirements",
    "application_requirements",
    "tags",
    "languages",
    "tools",
    "required_tool_keys",
    "other_required_tools",
    "required_skill_keys",
    "preferred_skill_keys",
    "other_required_skills",
    "other_preferred_skills",
)
MAX_CREATOR_CONTEXT_ITEMS = 12
MAX_CREATOR_CONTEXT_ITEM_LENGTH = 40


def normalize_creator_context_items(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for raw in value:
        normalized = " ".join(str(raw).split())[:MAX_CREATOR_CONTEXT_ITEM_LENGTH]
        if not normalized or normalized.casefold() in seen:
            continue
        seen.add(normalized.casefold())
        out.append(normalized)
        if len(out) >= MAX_CREATOR_CONTEXT_ITEMS:
            break
    return out


def normalize_list_items(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for raw in value:
        normalized = " ".join(str(raw).split())
        if not normalized or normalized.casefold() in seen:
            continue
        seen.add(normalized.casefold())
        out.append(normalized)
    return out


class JobReferenceTimestampNote(BaseModel):
    id: str | None = Field(default=None, max_length=80)
    time: str = Field(min_length=1, max_length=16)
    seconds: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=220)


class JobReferenceVideo(BaseModel):
    id: str | None = Field(default=None, max_length=80)
    title: str | None = Field(default=None, max_length=255)
    url: HttpUrl
    thumbnail_url: HttpUrl | None = None
    platform: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=400)
    what_to_reference: str | None = Field(default=None, max_length=400)
    timestamp_notes: list[JobReferenceTimestampNote] = Field(default_factory=list, max_length=8)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("platform", "description", "what_to_reference")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or None


class JobDeliverable(BaseModel):
    type: DeliverableType
    custom_type: str | None = Field(default=None, max_length=80)
    quantity: int = Field(gt=0, le=10000)
    frequency: DeliverableFrequency
    custom_frequency: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=255)

    @field_validator("custom_type", "custom_frequency", "notes", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.split()) or None

    @model_validator(mode="after")
    def validate_custom_values(self) -> JobDeliverable:
        if self.type == "other" and not self.custom_type:
            raise ValueError("custom_type is required when deliverable type is other")
        if self.type != "other" and self.custom_type is not None:
            raise ValueError("custom_type is only valid for other deliverables")
        if self.frequency == "other" and not self.custom_frequency:
            raise ValueError("custom_frequency is required when frequency is other")
        if self.frequency != "other" and self.custom_frequency is not None:
            raise ValueError("custom_frequency is only valid for other frequencies")
        return self


class JobSourceInput(BaseModel):
    type: SourceInputType
    custom_label: str | None = Field(default=None, max_length=80)
    sensitive_access_confirmed: bool = False

    @field_validator("custom_label", mode="before")
    @classmethod
    def normalize_custom_label(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.split()) or None

    @model_validator(mode="after")
    def validate_source_input(self) -> JobSourceInput:
        if self.type == "other" and not self.custom_label:
            raise ValueError("custom_label is required when source input type is other")
        if self.type != "other" and self.custom_label is not None:
            raise ValueError("custom_label is only valid for other source inputs")
        if self.type in {"analytics_access", "account_access"} and not self.sensitive_access_confirmed:
            raise ValueError("sensitive access must be explicitly confirmed")
        return self


class JobLanguageRequirement(BaseModel):
    language: str = Field(min_length=2, max_length=80)
    priority: LanguagePriority
    proficiency: LanguageProficiency | None = None
    purposes: list[LanguagePurpose] = Field(min_length=1, max_length=5)
    notes: str | None = Field(default=None, max_length=255)

    @field_validator("language")
    @classmethod
    def normalize_language(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("notes", mode="before")
    @classmethod
    def normalize_notes(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.split()) or None


class JobHiringProcessStage(BaseModel):
    stage: HiringProcessStageType
    custom_label: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=255)

    @field_validator("custom_label", "notes", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.split()) or None

    @model_validator(mode="after")
    def validate_custom_stage(self) -> JobHiringProcessStage:
        if self.stage == "other" and not self.custom_label:
            raise ValueError("custom_label is required when hiring stage is other")
        if self.stage != "other" and self.custom_label is not None:
            raise ValueError("custom_label is only valid for other hiring stages")
        return self


class JobScreeningQuestion(BaseModel):
    prompt: str = Field(min_length=3, max_length=500)
    required: bool = True
    response_guidance: str | None = Field(default=None, max_length=255)

    @field_validator("prompt", "response_guidance", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.split()) or None


class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=255)
    category: str | None = Field(default=None, min_length=2, max_length=64)
    primary_role_id: uuid.UUID | None = None
    role_specialization: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=255)

    compensation_mode: CompensationMode | None = None
    budget_amount: Decimal | None = Field(default=None, gt=0)
    budget_max: Decimal | None = Field(default=None, gt=0)
    budget_note: str | None = Field(default=None, max_length=255)
    budget_currency: str | None = Field(default=None, min_length=3, max_length=3)
    budget_unit: BudgetUnit | None = None
    budget_unit_custom: str | None = Field(default=None, max_length=64)

    experience_level: str | None = Field(default=None, max_length=64)
    platforms: list[str] = Field(default_factory=list)
    start_timeframe: str | None = Field(default=None, max_length=32)
    work_mode: WorkMode | None = None
    engagement_type: EngagementType | None = None
    contract_type: str | None = Field(default=None, max_length=64)
    timezone_overlap: str | None = Field(default=None, max_length=128)
    weekly_hours: str | None = Field(default=None, max_length=64)
    expected_weekly_hours_min: Decimal | None = Field(default=None, gt=0, le=168)
    expected_weekly_hours_max: Decimal | None = Field(default=None, gt=0, le=168)
    turnaround_value: int | None = Field(default=None, gt=0)
    turnaround_unit: TurnaroundUnit | None = None
    turnaround_basis: TurnaroundBasis | None = None
    application_mode: ApplicationMode = "internal"
    external_apply_url: HttpUrl | None = None
    deadline_at: datetime | None = None
    start_timing: StartTiming | None = None
    start_date: date | None = None
    duration_type: DurationType | None = None
    duration_value: int | None = Field(default=None, gt=0, le=120)
    duration_unit: DurationUnit | None = None
    engagement_end_date: date | None = None

    about_channel: str | None = None
    responsibilities: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)
    application_requirements: list[str] = Field(default_factory=list)
    how_to_apply: str | None = None
    reference_videos: list[HttpUrl | JobReferenceVideo] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    content_niches: list[str] = Field(default_factory=list)
    content_genres: list[str] = Field(default_factory=list)
    formats_hired_for: list[str] = Field(default_factory=list)
    tools: list[str] | None = None
    required_tool_keys: list[str] | None = None
    other_required_tools: list[str] | None = None
    deliverables: list[JobDeliverable] | None = Field(default=None, max_length=20)
    required_skill_keys: list[SkillKey] | None = Field(default=None, max_length=30)
    preferred_skill_keys: list[SkillKey] | None = Field(default=None, max_length=30)
    other_required_skills: list[str] | None = Field(default=None, max_length=30)
    other_preferred_skills: list[str] | None = Field(default=None, max_length=30)
    required_skills_note: str | None = Field(default=None, max_length=1000)
    preferred_skills_note: str | None = Field(default=None, max_length=1000)
    revision_policy: RevisionPolicy | None = None
    revision_rounds: int | None = Field(default=None, gt=0, le=100)
    revision_notes: str | None = Field(default=None, max_length=1000)
    source_inputs: list[JobSourceInput] | None = Field(default=None, max_length=30)
    source_inputs_notes: str | None = Field(default=None, max_length=1000)
    creative_autonomy: CreativeAutonomy | None = None
    creative_autonomy_notes: str | None = Field(default=None, max_length=1000)
    language_requirements: list[JobLanguageRequirement] | None = Field(default=None, max_length=30)
    trial_status: TrialStatus | None = None
    trial_scope: str | None = Field(default=None, max_length=1000)
    trial_effort_value: Decimal | None = Field(default=None, gt=0, le=10000)
    trial_effort_unit: TrialEffortUnit | None = None
    trial_compensation_amount: Decimal | None = Field(default=None, gt=0)
    trial_compensation_currency: str | None = Field(default=None, min_length=3, max_length=3)
    trial_compensation_basis: TrialCompensationBasis | None = None
    trial_work_usage: TrialWorkUsage | None = None
    trial_portfolio_permission: TrialPortfolioPermission | None = None
    trial_attribution: TrialAttribution | None = None
    unpaid_trial_confirmed: bool | None = None
    trial_notes: str | None = Field(default=None, max_length=1000)
    hiring_process: list[JobHiringProcessStage] | None = Field(default=None, max_length=20)
    hiring_process_notes: str | None = Field(default=None, max_length=1000)
    screening_questions: list[JobScreeningQuestion] | None = Field(default=None, max_length=20)
    employer_context_type: EmployerContextType | None = None

    youtube_channel_id: str | None = Field(default=None, max_length=255)
    channel_name: str | None = Field(default=None, max_length=255)
    channel_logo_url: HttpUrl | None = None
    channel_subscribers: int | None = Field(default=None, ge=0)
    channel_profile_slug: str | None = Field(default=None, max_length=255)
    posted_platform: str | None = Field(default=None, max_length=32)
    posted_youtube_channel_id: str | None = Field(default=None, max_length=255)
    hiring_identity_id: uuid.UUID | None = None
    status: JobStatus = "draft"

    @field_validator("title")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator(
        "role_specialization",
        "location",
        "budget_note",
        "budget_unit_custom",
        "start_timeframe",
        "contract_type",
        "timezone_overlap",
        "weekly_hours",
        "about_channel",
        "how_to_apply",
        "required_skills_note",
        "preferred_skills_note",
        "revision_notes",
        "source_inputs_notes",
        "creative_autonomy_notes",
        "trial_scope",
        "trial_notes",
        "hiring_process_notes",
        mode="before",
    )
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.split()) or None

    @field_validator("budget_currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        return value.upper() if value else None

    @field_validator("trial_compensation_currency")
    @classmethod
    def normalize_trial_currency(cls, value: str | None) -> str | None:
        return value.upper() if value else None

    @field_validator(*LIST_FIELDS)
    @classmethod
    def strip_items(cls, value: list[str] | None) -> list[str] | None:
        return normalize_list_items(value)

    @field_validator(*CREATOR_CONTEXT_FIELDS)
    @classmethod
    def normalize_creator_context(cls, value: list[str]) -> list[str]:
        return normalize_creator_context_items(value) or []

    @model_validator(mode="after")
    def validate_ranges(self) -> JobCreate:
        if self.budget_amount is not None and self.budget_max is not None and self.budget_max < self.budget_amount:
            raise ValueError("budget_max must be greater than or equal to budget_amount")
        if (
            self.expected_weekly_hours_min is not None
            and self.expected_weekly_hours_max is not None
            and self.expected_weekly_hours_max < self.expected_weekly_hours_min
        ):
            raise ValueError("expected_weekly_hours_max must be greater than or equal to expected_weekly_hours_min")
        return self


class JobUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=3, max_length=255)
    category: str | None = Field(default=None, min_length=2, max_length=64)
    primary_role_id: uuid.UUID | None = None
    role_specialization: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=255)

    compensation_mode: CompensationMode | None = None
    budget_amount: Decimal | None = Field(default=None, gt=0)
    budget_max: Decimal | None = Field(default=None, gt=0)
    budget_note: str | None = Field(default=None, max_length=255)
    budget_currency: str | None = Field(default=None, min_length=3, max_length=3)
    budget_unit: BudgetUnit | None = None
    budget_unit_custom: str | None = Field(default=None, max_length=64)

    experience_level: str | None = Field(default=None, max_length=64)
    platforms: list[str] | None = None
    start_timeframe: str | None = Field(default=None, max_length=32)
    work_mode: WorkMode | None = None
    engagement_type: EngagementType | None = None
    contract_type: str | None = Field(default=None, max_length=64)
    timezone_overlap: str | None = Field(default=None, max_length=128)
    weekly_hours: str | None = Field(default=None, max_length=64)
    expected_weekly_hours_min: Decimal | None = Field(default=None, gt=0, le=168)
    expected_weekly_hours_max: Decimal | None = Field(default=None, gt=0, le=168)
    turnaround_value: int | None = Field(default=None, gt=0)
    turnaround_unit: TurnaroundUnit | None = None
    turnaround_basis: TurnaroundBasis | None = None
    application_mode: ApplicationMode | None = None
    external_apply_url: HttpUrl | None = None
    deadline_at: datetime | None = None
    start_timing: StartTiming | None = None
    start_date: date | None = None
    duration_type: DurationType | None = None
    duration_value: int | None = Field(default=None, gt=0, le=120)
    duration_unit: DurationUnit | None = None
    engagement_end_date: date | None = None

    about_channel: str | None = None
    responsibilities: list[str] | None = None
    requirements: list[str] | None = None
    application_requirements: list[str] | None = None
    how_to_apply: str | None = None
    reference_videos: list[HttpUrl | JobReferenceVideo] | None = None
    tags: list[str] | None = None
    languages: list[str] | None = None
    content_niches: list[str] | None = None
    content_genres: list[str] | None = None
    formats_hired_for: list[str] | None = None
    tools: list[str] | None = None
    required_tool_keys: list[str] | None = None
    other_required_tools: list[str] | None = None
    deliverables: list[JobDeliverable] | None = Field(default=None, max_length=20)
    required_skill_keys: list[SkillKey] | None = Field(default=None, max_length=30)
    preferred_skill_keys: list[SkillKey] | None = Field(default=None, max_length=30)
    other_required_skills: list[str] | None = Field(default=None, max_length=30)
    other_preferred_skills: list[str] | None = Field(default=None, max_length=30)
    required_skills_note: str | None = Field(default=None, max_length=1000)
    preferred_skills_note: str | None = Field(default=None, max_length=1000)
    revision_policy: RevisionPolicy | None = None
    revision_rounds: int | None = Field(default=None, gt=0, le=100)
    revision_notes: str | None = Field(default=None, max_length=1000)
    source_inputs: list[JobSourceInput] | None = Field(default=None, max_length=30)
    source_inputs_notes: str | None = Field(default=None, max_length=1000)
    creative_autonomy: CreativeAutonomy | None = None
    creative_autonomy_notes: str | None = Field(default=None, max_length=1000)
    language_requirements: list[JobLanguageRequirement] | None = Field(default=None, max_length=30)
    trial_status: TrialStatus | None = None
    trial_scope: str | None = Field(default=None, max_length=1000)
    trial_effort_value: Decimal | None = Field(default=None, gt=0, le=10000)
    trial_effort_unit: TrialEffortUnit | None = None
    trial_compensation_amount: Decimal | None = Field(default=None, gt=0)
    trial_compensation_currency: str | None = Field(default=None, min_length=3, max_length=3)
    trial_compensation_basis: TrialCompensationBasis | None = None
    trial_work_usage: TrialWorkUsage | None = None
    trial_portfolio_permission: TrialPortfolioPermission | None = None
    trial_attribution: TrialAttribution | None = None
    unpaid_trial_confirmed: bool | None = None
    trial_notes: str | None = Field(default=None, max_length=1000)
    hiring_process: list[JobHiringProcessStage] | None = Field(default=None, max_length=20)
    hiring_process_notes: str | None = Field(default=None, max_length=1000)
    screening_questions: list[JobScreeningQuestion] | None = Field(default=None, max_length=20)
    employer_context_type: EmployerContextType | None = None

    youtube_channel_id: str | None = Field(default=None, max_length=255)
    channel_name: str | None = Field(default=None, max_length=255)
    channel_logo_url: HttpUrl | None = None
    channel_subscribers: int | None = Field(default=None, ge=0)
    channel_profile_slug: str | None = Field(default=None, max_length=255)
    posted_platform: str | None = Field(default=None, max_length=32)
    posted_youtube_channel_id: str | None = Field(default=None, max_length=255)
    hiring_identity_id: uuid.UUID | None = None
    status: JobStatus | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        return " ".join(value.split()) if value is not None else None

    @field_validator(
        "role_specialization",
        "location",
        "budget_note",
        "budget_unit_custom",
        "start_timeframe",
        "contract_type",
        "timezone_overlap",
        "weekly_hours",
        "about_channel",
        "how_to_apply",
        "required_skills_note",
        "preferred_skills_note",
        "revision_notes",
        "source_inputs_notes",
        "creative_autonomy_notes",
        "trial_scope",
        "trial_notes",
        "hiring_process_notes",
        mode="before",
    )
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.split()) or None

    @field_validator("budget_currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        return value.upper() if value else None

    @field_validator("trial_compensation_currency")
    @classmethod
    def normalize_trial_currency(cls, value: str | None) -> str | None:
        return value.upper() if value else None

    @field_validator(*LIST_FIELDS)
    @classmethod
    def strip_items(cls, value: list[str] | None) -> list[str] | None:
        return normalize_list_items(value)

    @field_validator(*CREATOR_CONTEXT_FIELDS)
    @classmethod
    def normalize_creator_context(cls, value: list[str] | None) -> list[str] | None:
        return normalize_creator_context_items(value)

    @model_validator(mode="after")
    def validate_ranges(self) -> JobUpdate:
        if self.budget_amount is not None and self.budget_max is not None and self.budget_max < self.budget_amount:
            raise ValueError("budget_max must be greater than or equal to budget_amount")
        if (
            self.expected_weekly_hours_min is not None
            and self.expected_weekly_hours_max is not None
            and self.expected_weekly_hours_max < self.expected_weekly_hours_min
        ):
            raise ValueError("expected_weekly_hours_max must be greater than or equal to expected_weekly_hours_min")
        return self


class JobRead(JobCreate):
    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: uuid.UUID
    category: str | None = None
    listing_schema_version: int
    primary_role_name_snapshot: str | None = None
    budget_unit: str | None = None
    work_mode: str | None = None
    engagement_type: str | None = None
    turnaround_unit: str | None = None
    turnaround_basis: str | None = None
    posted_by_user_id: uuid.UUID | None = None
    posted_by_agency: bool = False
    agency_profile_slug: str | None = None
    is_verified: bool = False
    views: int = 0
    applicants: int = 0
    response_rate: int = 0
    featured_until: datetime | None = None
    paused_at: datetime | None = None
    closed_at: datetime | None = None
    deleted_at: datetime | None = None
    hiring_display_name_snapshot: str | None = None
    hiring_platform_snapshot: str | None = None
    hiring_verification_status_snapshot: str | None = None
    hiring_external_url_snapshot: str | None = None
    managed_by_agency_name_snapshot: str | None = None
    created_at: datetime
    updated_at: datetime


class JobListResponse(BaseModel):
    items: list[JobRead]
    total: int
    limit: int
    offset: int
