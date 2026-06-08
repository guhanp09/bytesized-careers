from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

HiringIdentityType = Literal["INDIVIDUAL_CHANNEL", "AGENCY_REPRESENTED_CHANNEL"]
HiringIdentityPlatform = Literal["YOUTUBE", "INSTAGRAM"]
HiringIdentityVerificationStatus = Literal["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"]
HiringIdentityVerificationMethod = Literal[
    "YOUTUBE_OAUTH",
    "INSTAGRAM_LINK_IN_BIO",
    "MANUAL_ADMIN_REVIEW",
    "VERIFICATION_CODE",
    "NONE",
]


class HiringIdentityBase(BaseModel):
    type: HiringIdentityType
    platform: HiringIdentityPlatform
    display_name: str = Field(min_length=2, max_length=255)
    handle: str | None = Field(default=None, max_length=255)
    url: HttpUrl | None = None
    avatar_url: HttpUrl | None = None
    description: str | None = None
    managed_by_agency_name: str | None = Field(default=None, max_length=255)
    is_agency_represented: bool = False
    proof_url: HttpUrl | None = None

    @model_validator(mode="after")
    def align_agency_fields(self) -> HiringIdentityBase:
        if self.type == "AGENCY_REPRESENTED_CHANNEL":
            self.is_agency_represented = True
        if self.type == "INDIVIDUAL_CHANNEL":
            self.is_agency_represented = False
        return self


class HiringIdentityCreate(HiringIdentityBase):
    pass


class HiringIdentityUpdate(BaseModel):
    type: HiringIdentityType | None = None
    platform: HiringIdentityPlatform | None = None
    display_name: str | None = Field(default=None, min_length=2, max_length=255)
    handle: str | None = Field(default=None, max_length=255)
    url: HttpUrl | None = None
    avatar_url: HttpUrl | None = None
    description: str | None = None
    managed_by_agency_name: str | None = Field(default=None, max_length=255)
    is_agency_represented: bool | None = None
    proof_url: HttpUrl | None = None


class HiringIdentityVerificationRequest(BaseModel):
    proof_url: HttpUrl | None = None


class HiringIdentityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID
    type: HiringIdentityType
    platform: HiringIdentityPlatform
    display_name: str
    handle: str | None = None
    url: str | None = None
    avatar_url: str | None = None
    description: str | None = None
    managed_by_agency_name: str | None = None
    is_agency_represented: bool
    verification_status: HiringIdentityVerificationStatus
    verification_method: HiringIdentityVerificationMethod
    verification_code: str | None = None
    proof_url: str | None = None
    verified_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class HiringIdentitiesResponse(BaseModel):
    items: list[HiringIdentityRead] = Field(default_factory=list)


class HiringIdentityVerificationResponse(BaseModel):
    identity: HiringIdentityRead
    message: str
