from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.account_types import AccountType, PublicAccountType
from app.core.onboarding_intent import OnboardingIntent
from app.schemas.profile_capabilities import ProfileCapabilities


class MeYouTubeChannelRead(BaseModel):
    id: uuid.UUID
    channel_id: str
    title: str
    thumbnail_url: str | None = None


class MeRead(BaseModel):
    id: uuid.UUID
    email: EmailStr
    username: str | None = None
    display_name: str | None = None
    account_type: AccountType = "TALENT"
    account_type_selected_at: datetime | None = None
    onboarding_intent: OnboardingIntent = "DECIDE_LATER"
    onboarding_intent_selected_at: datetime | None = None
    profile_capabilities: ProfileCapabilities = Field(default_factory=ProfileCapabilities)
    email_verified: bool
    verified_youtube_channels: list[MeYouTubeChannelRead]


class AccountTypeUpdateRequest(BaseModel):
    account_type: PublicAccountType


class OnboardingIntentUpdateRequest(BaseModel):
    onboarding_intent: OnboardingIntent


class YouTubeChannelsResponse(BaseModel):
    channels: list[MeYouTubeChannelRead]


class YouTubeRefreshResponse(BaseModel):
    status: str = "ok"
    channels: list[MeYouTubeChannelRead]
