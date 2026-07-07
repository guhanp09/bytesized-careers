from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

JobStatus = Literal["draft", "published", "paused", "closed", "archived"]
BudgetUnit = Literal["per project", "per month"]
ApplicationMode = Literal["internal", "external"]
CREATOR_CONTEXT_FIELDS = ("content_niches", "content_genres", "formats_hired_for")
MAX_CREATOR_CONTEXT_ITEMS = 12
MAX_CREATOR_CONTEXT_ITEM_LENGTH = 40


def normalize_creator_context_items(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for raw in value:
        if raw is None:
            continue
        normalized = " ".join(str(raw).split())
        if not normalized:
            continue
        normalized = normalized[:MAX_CREATOR_CONTEXT_ITEM_LENGTH]
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(normalized)
        if len(out) >= MAX_CREATOR_CONTEXT_ITEMS:
            break
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
        normalized = value.strip()
        return normalized or None

    @field_validator("platform", "description", "what_to_reference")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class JobBase(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    category: str = Field(default="Editing", min_length=2, max_length=64)
    location: str | None = Field(default=None, max_length=255)

    budget_amount: Decimal | None = Field(default=None, ge=0)
    budget_max: Decimal | None = Field(default=None, ge=0)
    budget_note: str | None = Field(default=None, max_length=64)
    budget_currency: str = Field(default="INR", min_length=3, max_length=3)
    budget_unit: BudgetUnit = "per project"

    experience_level: str | None = Field(default=None, max_length=64)
    platforms: list[str] = Field(default_factory=list)
    start_timeframe: str | None = Field(default=None, max_length=32)
    work_mode: str | None = Field(default=None, max_length=32)
    contract_type: str | None = Field(default=None, max_length=64)
    timezone_overlap: str | None = Field(default=None, max_length=128)
    weekly_hours: str | None = Field(default=None, max_length=64)
    application_mode: ApplicationMode = "internal"
    external_apply_url: HttpUrl | None = None
    deadline_at: datetime | None = None

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

    youtube_channel_id: str | None = Field(default=None, max_length=255)
    is_verified: bool = False

    channel_name: str | None = Field(default=None, max_length=255)
    channel_logo_url: HttpUrl | None = None
    channel_subscribers: int | None = Field(default=None, ge=0)
    channel_profile_slug: str | None = Field(default=None, max_length=255)

    posted_by_agency: bool = False
    agency_profile_slug: str | None = Field(default=None, max_length=255)
    posted_platform: str | None = Field(default=None, max_length=32)
    posted_youtube_channel_id: str | None = Field(default=None, max_length=255)
    hiring_identity_id: uuid.UUID | None = None

    views: int = Field(default=0, ge=0)
    applicants: int = Field(default=0, ge=0)
    response_rate: int = Field(default=0, ge=0, le=100)

    status: JobStatus = "draft"
    featured_until: datetime | None = None
    paused_at: datetime | None = None
    closed_at: datetime | None = None

    @field_validator("budget_currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        return value.upper()

    @field_validator("budget_note")
    @classmethod
    def normalize_budget_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("platforms", "responsibilities", "requirements", "application_requirements", "tags")
    @classmethod
    def strip_items(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if item and item.strip()]

    @field_validator(*CREATOR_CONTEXT_FIELDS)
    @classmethod
    def normalize_creator_context(cls, value: list[str]) -> list[str]:
        return normalize_creator_context_items(value) or []

    @model_validator(mode="after")
    def validate_budget_range(self) -> JobBase:
        if (
            self.budget_amount is not None
            and self.budget_max is not None
            and self.budget_max < self.budget_amount
        ):
            raise ValueError("budget_max must be greater than or equal to budget_amount")
        return self


class JobCreate(JobBase):
    pass


class JobUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=255)
    category: str | None = Field(default=None, min_length=2, max_length=64)
    location: str | None = Field(default=None, max_length=255)

    budget_amount: Decimal | None = Field(default=None, ge=0)
    budget_max: Decimal | None = Field(default=None, ge=0)
    budget_note: str | None = Field(default=None, max_length=64)
    budget_currency: str | None = Field(default=None, min_length=3, max_length=3)
    budget_unit: BudgetUnit | None = None

    experience_level: str | None = Field(default=None, max_length=64)
    platforms: list[str] | None = None
    start_timeframe: str | None = Field(default=None, max_length=32)
    work_mode: str | None = Field(default=None, max_length=32)
    contract_type: str | None = Field(default=None, max_length=64)
    timezone_overlap: str | None = Field(default=None, max_length=128)
    weekly_hours: str | None = Field(default=None, max_length=64)
    application_mode: ApplicationMode | None = None
    external_apply_url: HttpUrl | None = None
    deadline_at: datetime | None = None

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

    youtube_channel_id: str | None = Field(default=None, max_length=255)
    is_verified: bool | None = None

    channel_name: str | None = Field(default=None, max_length=255)
    channel_logo_url: HttpUrl | None = None
    channel_subscribers: int | None = Field(default=None, ge=0)
    channel_profile_slug: str | None = Field(default=None, max_length=255)

    posted_by_agency: bool | None = None
    agency_profile_slug: str | None = Field(default=None, max_length=255)
    posted_platform: str | None = Field(default=None, max_length=32)
    posted_youtube_channel_id: str | None = Field(default=None, max_length=255)
    hiring_identity_id: uuid.UUID | None = None

    views: int | None = Field(default=None, ge=0)
    applicants: int | None = Field(default=None, ge=0)
    response_rate: int | None = Field(default=None, ge=0, le=100)

    status: JobStatus | None = None
    featured_until: datetime | None = None
    paused_at: datetime | None = None
    closed_at: datetime | None = None

    @field_validator("budget_currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.upper()

    @field_validator("budget_note")
    @classmethod
    def normalize_budget_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator(*CREATOR_CONTEXT_FIELDS)
    @classmethod
    def normalize_creator_context(cls, value: list[str] | None) -> list[str] | None:
        return normalize_creator_context_items(value)

    @model_validator(mode="after")
    def validate_budget_range(self) -> JobUpdate:
        if (
            self.budget_amount is not None
            and self.budget_max is not None
            and self.budget_max < self.budget_amount
        ):
            raise ValueError("budget_max must be greater than or equal to budget_amount")
        return self


class JobRead(JobBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    posted_by_user_id: uuid.UUID | None = None
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
