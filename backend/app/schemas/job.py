from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


JobStatus = Literal["draft", "published", "archived"]
BudgetUnit = Literal["per project", "per month"]


class JobReferenceVideo(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    url: HttpUrl

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class JobBase(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    category: str = Field(default="Editing", min_length=2, max_length=64)
    location: str | None = Field(default=None, max_length=255)

    budget_amount: Decimal | None = Field(default=None, ge=0)
    budget_max: Decimal | None = Field(default=None, ge=0)
    budget_currency: str = Field(default="INR", min_length=3, max_length=3)
    budget_unit: BudgetUnit = "per project"

    experience_level: str | None = Field(default=None, max_length=64)
    platforms: list[str] = Field(default_factory=list)
    start_timeframe: str | None = Field(default=None, max_length=32)

    about_channel: str | None = None
    responsibilities: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)
    how_to_apply: str | None = None
    reference_videos: list[HttpUrl | JobReferenceVideo] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)

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

    views: int = Field(default=0, ge=0)
    applicants: int = Field(default=0, ge=0)
    response_rate: int = Field(default=0, ge=0, le=100)

    status: JobStatus = "draft"

    @field_validator("budget_currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        return value.upper()

    @field_validator("platforms", "responsibilities", "requirements", "tags")
    @classmethod
    def strip_items(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if item and item.strip()]

    @model_validator(mode="after")
    def validate_budget_range(self) -> "JobBase":
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
    budget_currency: str | None = Field(default=None, min_length=3, max_length=3)
    budget_unit: BudgetUnit | None = None

    experience_level: str | None = Field(default=None, max_length=64)
    platforms: list[str] | None = None
    start_timeframe: str | None = Field(default=None, max_length=32)

    about_channel: str | None = None
    responsibilities: list[str] | None = None
    requirements: list[str] | None = None
    how_to_apply: str | None = None
    reference_videos: list[HttpUrl | JobReferenceVideo] | None = None
    tags: list[str] | None = None

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

    views: int | None = Field(default=None, ge=0)
    applicants: int | None = Field(default=None, ge=0)
    response_rate: int | None = Field(default=None, ge=0, le=100)

    status: JobStatus | None = None

    @field_validator("budget_currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.upper()

    @model_validator(mode="after")
    def validate_budget_range(self) -> "JobUpdate":
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
    created_at: datetime
    updated_at: datetime


class JobListResponse(BaseModel):
    items: list[JobRead]
    total: int
    limit: int
    offset: int
