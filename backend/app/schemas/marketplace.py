from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.job import JobRead, normalize_creator_context_items
from app.schemas.reviews import EngagementSummary

ApplicationStatus = Literal[
    "new", "reviewing", "shortlisted", "interviewing", "hired", "rejected", "archived", "withdrawn"
]
TalentListingStatus = Literal["draft", "published", "paused", "closed", "archived", "featured"]
TalentInterestStatus = Literal[
    "new", "reviewing", "contacted", "declined", "archived", "withdrawn"
]
ReportTargetType = Literal["job", "talent_listing", "profile", "message", "review"]
ReportStatus = Literal["open", "dismissed", "action_taken"]
# User-facing report reasons. "suspicious" predates the richer set and stays
# valid so old clients/tests keep working; the reason picker offers the rest.
ReportCategory = Literal[
    "spam",
    "scam_or_fraud",
    "harassment",
    "impersonation",
    "off_platform_payment",
    "inappropriate_content",
    "suspicious_or_inaccurate",
    "suspicious",
    "other",
]
EntitlementKind = Literal["job_post", "talent_listing", "featured_job", "featured_talent_listing"]


class SaveJobRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class SavedJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    job_id: uuid.UUID
    note: str | None = None
    job_snapshot: dict = Field(default_factory=dict)
    created_at: datetime


class JobApplicationCreate(BaseModel):
    cover_note: str | None = Field(default=None, max_length=5000)
    portfolio_item_ids: list[str] = Field(default_factory=list)
    first_message_answers: dict = Field(default_factory=dict)


# Owner-side pipeline stages: statuses the manager of a received item may set.
# "withdrawn" stays sender-only (its own endpoint), and "new" is the arrival
# state rather than a stage a manager moves things into.
ManagedApplicationStatus = Literal[
    "reviewing", "shortlisted", "interviewing", "hired", "rejected", "archived"
]
ManagedInterestStatus = Literal["reviewing", "contacted", "declined", "archived"]


class JobApplicationStatusUpdate(BaseModel):
    status: ManagedApplicationStatus

BULK_STATUS_MAX_IDS = 50


class JobApplicationBulkStatusUpdate(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=BULK_STATUS_MAX_IDS)
    status: ManagedApplicationStatus
    # Stage moves are internal tracking by default; informing the other side is
    # an explicit, user-confirmed act (a status-update chat message). The bell
    # notification here is therefore opt-in rather than automatic.
    notify: bool = False


class TalentInterestBulkStatusUpdate(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=BULK_STATUS_MAX_IDS)
    status: ManagedInterestStatus
    notify: bool = False


class ManagerNoteUpdate(BaseModel):
    note: str | None = Field(default=None, max_length=5000)


class InteractionPrivateNoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)

    @field_validator("body")
    @classmethod
    def validate_body(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("Private note cannot be empty")
        return clean


class InteractionPrivateNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    application_id: uuid.UUID | None = None
    talent_interest_id: uuid.UUID | None = None
    body: str
    created_at: datetime


class JobApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    applicant_user_id: uuid.UUID
    job_owner_user_id: uuid.UUID | None = None
    cover_note: str | None = None
    portfolio_item_ids: list[str] = Field(default_factory=list)
    first_message_answers: dict = Field(default_factory=dict)
    applicant_snapshot: dict = Field(default_factory=dict)
    status: ApplicationStatus
    # Job owner's private note. Sender-facing endpoints blank this field.
    manager_note: str | None = None
    created_at: datetime
    updated_at: datetime
    engagement: EngagementSummary | None = None


class TalentListingBase(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    primary_role: str | None = Field(default=None, max_length=128)
    # Legacy range/level string, retained for backward compatibility with old listings.
    experience_level: str | None = Field(default=None, max_length=64)
    # Canonical talent experience: exact whole years.
    experience_years: int | None = Field(default=None, ge=0, le=80)
    roles: list[str] = Field(default_factory=list)
    niche: str | None = Field(default=None, max_length=255)
    content_niches: list[str] = Field(default_factory=list)
    content_genres: list[str] = Field(default_factory=list)
    formats: list[str] = Field(default_factory=list)
    platforms: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    work_mode: str | None = Field(default=None, max_length=64)
    location: str | None = Field(default=None, max_length=255)
    timezone: str | None = Field(default=None, max_length=64)
    availability_status: Literal["available", "selective", "unavailable"] = "selective"
    rate_min: float | None = Field(default=None, ge=0)
    rate_max: float | None = Field(default=None, ge=0)
    rate_currency: str = Field(default="INR", min_length=3, max_length=3)
    rate_note: str | None = Field(default=None, max_length=255)
    open_slots: int | None = Field(default=None, ge=0)
    turnaround: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=5000)
    portfolio_item_ids: list[str] = Field(default_factory=list)
    first_message_requirements: list[str] = Field(default_factory=list)
    first_message_custom_instruction: str | None = Field(default=None, max_length=2000)
    status: TalentListingStatus = "draft"
    is_featured: bool = False
    featured_until: datetime | None = None
    paused_at: datetime | None = None
    closed_at: datetime | None = None

    @field_validator("content_niches", "content_genres", "formats")
    @classmethod
    def normalize_creator_context_lists(cls, value: list[str] | None) -> list[str]:
        return normalize_creator_context_items(value) or []


class TalentListingCreate(TalentListingBase):
    pass


class TalentListingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=255)
    primary_role: str | None = Field(default=None, max_length=128)
    experience_level: str | None = Field(default=None, max_length=64)
    experience_years: int | None = Field(default=None, ge=0, le=80)
    roles: list[str] | None = None
    niche: str | None = Field(default=None, max_length=255)
    content_niches: list[str] | None = None
    content_genres: list[str] | None = None
    formats: list[str] | None = None
    platforms: list[str] | None = None
    tools: list[str] | None = None
    languages: list[str] | None = None
    work_mode: str | None = Field(default=None, max_length=64)
    location: str | None = Field(default=None, max_length=255)
    timezone: str | None = Field(default=None, max_length=64)
    availability_status: Literal["available", "selective", "unavailable"] | None = None
    rate_min: float | None = Field(default=None, ge=0)
    rate_max: float | None = Field(default=None, ge=0)
    rate_currency: str | None = Field(default=None, min_length=3, max_length=3)
    rate_note: str | None = Field(default=None, max_length=255)
    open_slots: int | None = Field(default=None, ge=0)
    turnaround: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=5000)
    portfolio_item_ids: list[str] | None = None
    first_message_requirements: list[str] | None = None
    first_message_custom_instruction: str | None = Field(default=None, max_length=2000)
    status: TalentListingStatus | None = None
    is_featured: bool | None = None
    featured_until: datetime | None = None
    paused_at: datetime | None = None
    closed_at: datetime | None = None

    @field_validator("content_niches", "content_genres", "formats")
    @classmethod
    def normalize_creator_context_lists(cls, value: list[str] | None) -> list[str] | None:
        return normalize_creator_context_items(value)


class TalentListingRead(TalentListingBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID
    owner_display_name: str | None = None
    owner_username: str | None = None
    owner_avatar_url: str | None = None
    views: int = 0
    saves: int = 0
    created_at: datetime
    updated_at: datetime


class TalentListingListResponse(BaseModel):
    items: list[TalentListingRead]
    total: int
    limit: int
    offset: int


class SaveTalentListingRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class SavedTalentListingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    talent_listing_id: uuid.UUID
    note: str | None = None
    talent_snapshot: dict = Field(default_factory=dict)
    created_at: datetime


class SavedJobSummaryItem(BaseModel):
    saved: SavedJobRead
    job: JobRead | None = None


class SavedTalentSummaryItem(BaseModel):
    saved: SavedTalentListingRead
    talent: TalentListingRead | None = None


class SavedSummaryResponse(BaseModel):
    jobs: list[SavedJobSummaryItem] = Field(default_factory=list)
    talent: list[SavedTalentSummaryItem] = Field(default_factory=list)


class TalentInterestCreate(BaseModel):
    job_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=3000)
    first_message_answers: dict = Field(default_factory=dict)


class TalentInterestStatusUpdate(BaseModel):
    status: ManagedInterestStatus


class TalentInterestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    talent_listing_id: uuid.UUID
    recruiter_user_id: uuid.UUID
    recruiter_display_name: str | None = None
    recruiter_username: str | None = None
    recruiter_avatar_url: str | None = None
    job_id: uuid.UUID | None = None
    owner_user_id: uuid.UUID
    note: str | None = None
    first_message_answers: dict = Field(default_factory=dict)
    status: TalentInterestStatus
    # Listing owner's (talent's) private note. Sender-facing endpoints blank this field.
    manager_note: str | None = None
    created_at: datetime
    updated_at: datetime
    engagement: EngagementSummary | None = None


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    type: str
    category: str = "system"
    title: str
    body: str | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    action_url: str | None = None
    read_at: datetime | None = None
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationRead]
    unread_count: int


class ActivitySummaryResponse(BaseModel):
    my_jobs: list[JobRead] = Field(default_factory=list)
    my_talent_listings: list[TalentListingRead] = Field(default_factory=list)
    sent_applications: list[JobApplicationRead] = Field(default_factory=list)
    received_applications: list[JobApplicationRead] = Field(default_factory=list)
    received_interests: list[TalentInterestRead] = Field(default_factory=list)
    sent_interests: list[TalentInterestRead] = Field(default_factory=list)
    related_jobs: list[JobRead] = Field(default_factory=list)
    related_talent_listings: list[TalentListingRead] = Field(default_factory=list)


class ReportCreate(BaseModel):
    target_type: ReportTargetType
    target_id: str = Field(min_length=1, max_length=64)
    category: ReportCategory
    note: str | None = Field(default=None, max_length=3000)


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reporter_user_id: uuid.UUID | None = None
    target_type: ReportTargetType
    target_id: str
    category: str
    note: str | None = None
    status: ReportStatus
    admin_note: str | None = None
    resolved_by_user_id: uuid.UUID | None = None
    resolved_at: datetime | None = None
    action: str | None = None
    created_at: datetime
    updated_at: datetime


# Admin resolution schemas live in app/schemas/admin.py (AdminReportResolveRequest,
# enum-enforced actions); the old free-string ReportAdminUpdate is retired.


class LaunchCheckoutRequest(BaseModel):
    kind: EntitlementKind
    target_type: str | None = Field(default=None, max_length=64)
    target_id: str | None = Field(default=None, max_length=64)
    checkout_intent_id: str | None = Field(default=None, max_length=128)


class EntitlementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    kind: str
    target_type: str | None = None
    target_id: str | None = None
    source: str
    status: str
    metadata_json: dict = Field(default_factory=dict)
    expires_at: datetime | None = None
    checkout_intent_id: str | None = None
    created_at: datetime
