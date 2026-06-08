from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.core.account_types import AccountType
from app.core.onboarding_intent import OnboardingIntent
from app.schemas.creator_profile import ContentStyleRead, RoleAnswerSummary, RoleRead
from app.schemas.profile_capabilities import ProfileCapabilities

AvatarMode = Literal["generic", "youtube_channel"]
PortfolioStatus = Literal["now", "past"]
PortfolioSourceType = Literal["youtube", "custom", "website", "drive", "behance", "instagram", "vimeo", "other"]
PortfolioVerificationStatus = Literal["youtube_metadata_verified", "manual", "unverified"]
PortfolioVisibility = Literal["public", "private"]
PortfolioPublishStatus = Literal["draft", "published"]
PublicJobSection = Literal["active", "past"]
AvailabilityStatus = Literal["available", "selective", "unavailable"]
ProjectTypePreference = Literal["oneOff", "retainer", "either"]
HiringType = Literal[
    "individual creator",
    "creator agency",
    "influencer marketing agency",
    "social media agency",
    "brand",
    "production house",
    "other",
]
HiringPrimaryPlatform = Literal["YouTube", "Instagram", "Both"]
HiringVerificationStatus = Literal["unverified", "verified", "rejected"]


class PrivacySettings(BaseModel):
    show_bio: bool = True
    show_links: bool = True
    show_skills: bool = True
    show_location: bool = False
    show_availability: bool = False
    show_youtube_badge: bool = True


class SocialYouTubeConnection(BaseModel):
    connected: bool = False
    channel_id: str | None = None
    channel_title: str | None = None
    channel_handle: str | None = None
    channel_avatar_url: str | None = None
    channel_url: str | None = None


class SocialInstagramConnection(BaseModel):
    connected: bool = False
    handle: str | None = None
    url: str | None = None


class SocialConnections(BaseModel):
    youtube: SocialYouTubeConnection = Field(default_factory=SocialYouTubeConnection)
    instagram: SocialInstagramConnection = Field(default_factory=SocialInstagramConnection)


class ProfileStats(BaseModel):
    jobs_posted_count: int = 0
    jobs_completed_count: int = 0
    projects_count: int = 0
    reviews_count: int = 0


class ReviewsSummary(BaseModel):
    avg_rating: float = 0.0
    review_count: int = 0


class ProfileExperienceItem(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=120)
    organization_name: str = Field(min_length=1, max_length=160)
    organization_url: str | None = Field(default=None, max_length=1024)
    organization_logo_url: str | None = Field(default=None, max_length=1024)
    platform: str | None = Field(default=None, max_length=64)
    work_type: str | None = Field(default=None, max_length=64)
    work_mode: str | None = Field(default=None, max_length=64)
    start_month: str | None = Field(default=None, max_length=20)
    start_year: str | None = Field(default=None, max_length=4)
    end_month: str | None = Field(default=None, max_length=20)
    end_year: str | None = Field(default=None, max_length=4)
    is_current: bool = False
    description: str | None = Field(default=None, max_length=500)
    tools: list[str] = Field(default_factory=list)


class CollaborationPreferences(BaseModel):
    project_type_preference: ProjectTypePreference | None = None
    turnaround: str | None = None
    revisions: str | None = None
    working_hours: str | None = None
    tools: str | None = None


class HiringInfo(BaseModel):
    hiring_type: HiringType | None = None
    website_or_social_url: str | None = None
    primary_platform: HiringPrimaryPlatform | None = None
    channels_or_pages_managed: str | None = None
    verification_status: HiringVerificationStatus = "unverified"


class ProfileRead(BaseModel):
    id: uuid.UUID
    email: EmailStr
    account_type: AccountType = "TALENT"
    account_type_selected_at: datetime | None = None
    onboarding_intent: OnboardingIntent = "DECIDE_LATER"
    onboarding_intent_selected_at: datetime | None = None
    username: str | None = None
    username_change_count: int
    username_last_changed_at: datetime | None = None
    display_name: str | None = None
    headline: str | None = None
    skills: list[str] = Field(default_factory=list)
    public_links: list[str] = Field(default_factory=list)
    experience: list[ProfileExperienceItem] = Field(default_factory=list)
    availability_status: AvailabilityStatus = "selective"
    location: str | None = None
    timezone: str | None = None
    avatar_mode: AvatarMode = "generic"
    avatar_url: str | None = None
    avatar_youtube_channel_id: str | None = None
    social_connections: SocialConnections = Field(default_factory=SocialConnections)
    stats: ProfileStats = Field(default_factory=ProfileStats)
    reviews: ReviewsSummary = Field(default_factory=ReviewsSummary)
    collaboration_preferences: CollaborationPreferences = Field(
        default_factory=CollaborationPreferences
    )
    hiring_info: HiringInfo = Field(default_factory=HiringInfo)
    roles: list[RoleRead] = Field(default_factory=list)
    role_answers_summary: list[RoleAnswerSummary] = Field(default_factory=list)
    content_style: ContentStyleRead = Field(default_factory=ContentStyleRead)
    privacy_settings: PrivacySettings
    profile_capabilities: ProfileCapabilities = Field(default_factory=ProfileCapabilities)
    can_change_username: bool
    username_next_change_at: datetime | None = None


class ProfileUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=20)
    display_name: str | None = Field(default=None, max_length=255)
    headline: str | None = Field(default=None, max_length=160)
    skills: list[str] | None = None
    public_links: list[str] | None = None
    experience: list[ProfileExperienceItem] | None = None
    availability_status: AvailabilityStatus | None = None
    location: str | None = Field(default=None, max_length=255)
    timezone: str | None = Field(default=None, max_length=64)
    avatar_mode: AvatarMode | None = None
    avatar_youtube_channel_id: str | None = Field(default=None, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=1024)
    instagram_handle: str | None = Field(default=None, max_length=255)
    instagram_url: str | None = Field(default=None, max_length=1024)
    project_type_preference: ProjectTypePreference | None = None
    collaboration_turnaround: str | None = Field(default=None, max_length=255)
    collaboration_revisions: str | None = Field(default=None, max_length=255)
    collaboration_working_hours: str | None = Field(default=None, max_length=255)
    collaboration_tools: str | None = Field(default=None, max_length=255)
    hiring_type: HiringType | None = None
    hiring_website_or_social_url: str | None = Field(default=None, max_length=1024)
    hiring_primary_platform: HiringPrimaryPlatform | None = None
    hiring_channels_or_pages_managed: str | None = None


class AvatarUploadRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=100)
    data_url: str


class PrivacyUpdateRequest(BaseModel):
    show_bio: bool | None = None
    show_links: bool | None = None
    show_skills: bool | None = None
    show_location: bool | None = None
    show_availability: bool | None = None
    show_youtube_badge: bool | None = None


class PortfolioItemBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    source_type: PortfolioSourceType = "custom"
    source_url: str | None = Field(default=None, max_length=2048)
    role_id: uuid.UUID | None = None
    role_name: str | None = Field(default=None, max_length=255)
    role: str | None = Field(default=None, max_length=255)
    user_role_in_project: str | None = Field(default=None, max_length=255)
    description: str | None = None
    contribution_summary: str | None = None
    timeframe: PortfolioStatus | None = None
    status: PortfolioStatus = "now"
    portfolio_status: PortfolioStatus = "now"
    media_url: str | None = Field(default=None, max_length=1024)
    metrics: str | None = None
    youtube_url: str | None = Field(default=None, max_length=2048)
    thumbnail_url: str | None = Field(default=None, max_length=2048)
    thumbnail_options: list[dict[str, object]] = Field(default_factory=list)
    channel_name: str | None = Field(default=None, max_length=255)
    channel_id: str | None = Field(default=None, max_length=255)
    views: int | None = None
    published_date: datetime | None = None
    published_at: datetime | None = None
    duration: str | None = Field(default=None, max_length=64)
    retention_percent: float | None = None
    links: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    contribution_tags: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    public_metrics: dict[str, object] = Field(default_factory=dict)
    manual_metrics: dict[str, object] = Field(default_factory=dict)
    verification_status: PortfolioVerificationStatus = "manual"
    visibility: PortfolioVisibility = "public"
    publish_status: PortfolioPublishStatus = "published"
    is_featured: bool = False
    is_public: bool = True


class PortfolioItemCreate(PortfolioItemBase):
    pass


class PortfolioYouTubePreviewRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class PortfolioYouTubePreviewResponse(BaseModel):
    source_type: Literal["youtube"] = "youtube"
    source_url: str
    video_id: str
    title: str
    description: str | None = None
    description_snippet: str | None = None
    thumbnail_url: str | None = None
    thumbnail_options: list[dict[str, object]] = Field(default_factory=list)
    channel_name: str | None = None
    channel_id: str | None = None
    published_at: datetime | None = None
    view_count: int | None = None
    like_count: int | None = None
    comment_count: int | None = None
    duration_iso: str | None = None
    duration_label: str | None = None
    public_metrics: dict[str, object] = Field(default_factory=dict)
    verification_status: Literal["youtube_metadata_verified"] = "youtube_metadata_verified"


PortfolioLinkPreviewSourceType = Literal[
    "youtube",
    "vimeo",
    "drive",
    "google_docs",
    "notion",
    "behance",
    "instagram",
    "tiktok",
    "website",
    "external_link",
    "unknown",
]
PortfolioLinkPreviewConfidence = Literal["high", "medium", "low"]
PortfolioLinkPreviewStatus = Literal["ok", "partial", "manual_required"]


class PortfolioLinkPreviewRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class PortfolioLinkPreviewPublicMetrics(BaseModel):
    views: int | None = None
    likes: int | None = None
    comments: int | None = None
    duration: str | None = None


class PortfolioLinkPreviewResponse(BaseModel):
    source_type: PortfolioLinkPreviewSourceType
    source_url: str
    canonical_url: str
    title: str = ""
    description: str = ""
    thumbnail_url: str = ""
    provider_name: str = ""
    author_name: str = ""
    published_at: datetime | None = None
    embed_html: str | None = None
    public_metrics: PortfolioLinkPreviewPublicMetrics = Field(default_factory=PortfolioLinkPreviewPublicMetrics)
    confidence: PortfolioLinkPreviewConfidence = "low"
    status: PortfolioLinkPreviewStatus = "manual_required"
    manual_required_fields: list[str] = Field(default_factory=list)


class PortfolioItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    source_type: PortfolioSourceType | None = None
    source_url: str | None = Field(default=None, max_length=2048)
    role_id: uuid.UUID | None = None
    role_name: str | None = Field(default=None, max_length=255)
    role: str | None = Field(default=None, max_length=255)
    user_role_in_project: str | None = Field(default=None, max_length=255)
    description: str | None = None
    contribution_summary: str | None = None
    timeframe: PortfolioStatus | None = None
    status: PortfolioStatus | None = None
    portfolio_status: PortfolioStatus | None = None
    media_url: str | None = Field(default=None, max_length=1024)
    metrics: str | None = None
    youtube_url: str | None = Field(default=None, max_length=2048)
    thumbnail_url: str | None = Field(default=None, max_length=2048)
    thumbnail_options: list[dict[str, object]] | None = None
    channel_name: str | None = Field(default=None, max_length=255)
    channel_id: str | None = Field(default=None, max_length=255)
    views: int | None = None
    published_date: datetime | None = None
    published_at: datetime | None = None
    duration: str | None = Field(default=None, max_length=64)
    retention_percent: float | None = None
    links: list[str] | None = None
    tags: list[str] | None = None
    contribution_tags: list[str] | None = None
    tools: list[str] | None = None
    public_metrics: dict[str, object] | None = None
    manual_metrics: dict[str, object] | None = None
    verification_status: PortfolioVerificationStatus | None = None
    visibility: PortfolioVisibility | None = None
    publish_status: PortfolioPublishStatus | None = None
    is_featured: bool | None = None
    is_public: bool | None = None


class PortfolioItemRead(PortfolioItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def apply_timeframe_fallback(self) -> PortfolioItemRead:
        if self.timeframe is None:
            self.timeframe = self.status
        if self.portfolio_status is None:
            self.portfolio_status = self.status
        if not self.source_url:
            self.source_url = self.youtube_url or self.media_url or (self.links[0] if self.links else None)
        if self.source_type == "custom" and self.youtube_url:
            self.source_type = "youtube"
        if not self.role_name:
            self.role_name = self.role or self.user_role_in_project
        if not self.contribution_summary:
            self.contribution_summary = self.description
        if not self.published_at:
            self.published_at = self.published_date
        if not self.visibility:
            self.visibility = "public" if self.is_public else "private"
        if not self.publish_status:
            self.publish_status = "published"
        if not self.public_metrics:
            next_public_metrics: dict[str, object] = {}
            if self.views is not None:
                next_public_metrics["views"] = self.views
            if self.duration:
                next_public_metrics["duration"] = self.duration
            self.public_metrics = next_public_metrics
        if not self.manual_metrics and self.retention_percent is not None:
            self.manual_metrics = {"retention_percent": self.retention_percent}
        return self


class PortfolioListResponse(BaseModel):
    items: list[PortfolioItemRead]


class PublicJobItem(BaseModel):
    id: uuid.UUID
    title: str
    category: str
    location: str | None = None
    status: str
    created_at: datetime
    channel_name: str | None = None


class PublicTalentListingItem(BaseModel):
    id: uuid.UUID
    title: str
    primary_role: str | None = None
    location: str | None = None
    timezone: str | None = None
    status: str
    is_featured: bool = False
    created_at: datetime


class PublicYouTubeBadge(BaseModel):
    channel_id: str
    title: str
    thumbnail_url: str | None = None


class PublicProfileResponse(BaseModel):
    username: str
    display_name: str
    headline: str | None = None
    avatar_url: str | None = None
    avatar_mode: AvatarMode = "generic"
    skills: list[str] = Field(default_factory=list)
    public_links: list[str] = Field(default_factory=list)
    experience: list[ProfileExperienceItem] = Field(default_factory=list)
    availability_status: AvailabilityStatus = "selective"
    location: str | None = None
    timezone: str | None = None
    social_connections: SocialConnections = Field(default_factory=SocialConnections)
    stats: ProfileStats = Field(default_factory=ProfileStats)
    reviews: ReviewsSummary = Field(default_factory=ReviewsSummary)
    collaboration_preferences: CollaborationPreferences = Field(
        default_factory=CollaborationPreferences
    )
    hiring_info: HiringInfo = Field(default_factory=HiringInfo)
    roles: list[RoleRead] = Field(default_factory=list)
    role_answers_summary: list[RoleAnswerSummary] = Field(default_factory=list)
    content_style: ContentStyleRead = Field(default_factory=ContentStyleRead)
    youtube_badge: PublicYouTubeBadge | None = None
    jobs_active: list[PublicJobItem] = Field(default_factory=list)
    jobs_past: list[PublicJobItem] = Field(default_factory=list)
    portfolio_now: list[PortfolioItemRead] = Field(default_factory=list)
    portfolio_past: list[PortfolioItemRead] = Field(default_factory=list)
    jobs_preview: list[PublicJobItem] = Field(default_factory=list)
    portfolio_preview: list[PortfolioItemRead] = Field(default_factory=list)
    talent_listings_active: list[PublicTalentListingItem] = Field(default_factory=list)
    talent_listings_preview: list[PublicTalentListingItem] = Field(default_factory=list)
    moved_to_username: str | None = None


class PublicJobsListResponse(BaseModel):
    username: str
    tab: PublicJobSection
    items: list[PublicJobItem] = Field(default_factory=list)


class PublicPortfolioListResponse(BaseModel):
    username: str
    tab: PortfolioStatus
    items: list[PortfolioItemRead] = Field(default_factory=list)
