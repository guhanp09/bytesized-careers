from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.marketplace import ReportStatus, ReportTargetType

# ---------------------------------------------------------------------------
# Shared fragments
# ---------------------------------------------------------------------------


class AdminUserRef(BaseModel):
    """Compact person reference used across admin payloads."""

    id: uuid.UUID
    display_name: str | None = None
    username: str | None = None
    email: str | None = None


class AdminPage(BaseModel):
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------


class AdminOverviewResponse(BaseModel):
    env: str
    email_mode: str
    email_delivery_enabled: bool
    users_total: int
    users_new_7d: int
    users_suspended: int
    jobs_by_status: dict[str, int]
    jobs_deleted: int
    talent_by_status: dict[str, int]
    talent_deleted: int
    applications_total: int
    applications_new_7d: int
    interests_total: int
    interests_new_7d: int
    messages_total: int
    reports_open: int
    verifications_pending: int
    entitlements_active: int


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class AdminUserItem(BaseModel):
    id: uuid.UUID
    email: str
    username: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    account_type: str
    email_verified: bool
    suspended_at: datetime | None = None
    suspension_reason: str | None = None
    last_active_at: datetime | None = None
    created_at: datetime
    jobs_count: int
    talent_listings_count: int
    applications_sent_count: int
    profile_reports_count: int


class AdminUserListResponse(AdminPage):
    items: list[AdminUserItem]


class AdminIdentitySummary(BaseModel):
    id: uuid.UUID
    type: str
    platform: str
    display_name: str
    handle: str | None = None
    url: str | None = None
    proof_url: str | None = None
    verification_status: str
    verification_method: str
    verification_attempt_count: int
    verification_last_error: str | None = None
    verified_at: datetime | None = None
    created_at: datetime


class AdminEntitlementItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    kind: str
    target_type: str | None = None
    target_id: str | None = None
    source: str
    status: str
    expires_at: datetime | None = None
    created_at: datetime


class AdminReportItem(BaseModel):
    id: uuid.UUID
    target_type: ReportTargetType
    target_id: str
    category: str
    note: str | None = None
    status: ReportStatus
    action: str | None = None
    admin_note: str | None = None
    resolved_by_user_id: uuid.UUID | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    reporter: AdminUserRef | None = None
    # Hydration so the queue never shows bare UUIDs.
    target_label: str | None = None
    target_status: str | None = None
    target_owner: AdminUserRef | None = None
    # Other reports (any status) against the same target — repeat-report signal.
    sibling_count: int = 0


class AdminReportListResponse(AdminPage):
    items: list[AdminReportItem]


class AdminUserDetailResponse(BaseModel):
    user: AdminUserItem
    hiring_verification_status: str | None = None
    onboarding_intent: str | None = None
    interests_sent_count: int
    applications_received_count: int
    portfolio_items_count: int
    identities: list[AdminIdentitySummary]
    entitlements: list[AdminEntitlementItem]
    # Reports about this user's profile or any of their listings.
    reports_about: list[AdminReportItem]
    recent_audit: list[AdminAuditLogItem]


class AdminSuspendRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=3000)


class AdminUnsuspendRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=3000)


class AdminWarnRequest(BaseModel):
    title: str = Field(default="A notice about your CreatorJobs account", min_length=3, max_length=255)
    body: str = Field(min_length=3, max_length=3000)
    action_url: str | None = Field(default=None, max_length=1024)


# ---------------------------------------------------------------------------
# Listings
# ---------------------------------------------------------------------------


class AdminJobItem(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    is_verified: bool
    channel_name: str | None = None
    category: str | None = None
    location: str | None = None
    deleted_at: datetime | None = None
    created_at: datetime
    owner: AdminUserRef | None = None
    applications_count: int
    reports_count: int


class AdminJobListResponse(AdminPage):
    items: list[AdminJobItem]


class AdminTalentListingItem(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    primary_role: str | None = None
    location: str | None = None
    deleted_at: datetime | None = None
    created_at: datetime
    owner: AdminUserRef | None = None
    interests_count: int
    reports_count: int


class AdminTalentListingListResponse(AdminPage):
    items: list[AdminTalentListingItem]


AdminListingStateAction = Literal["pause", "unpause", "hide", "unhide", "close"]


class AdminListingStateRequest(BaseModel):
    action: AdminListingStateAction
    reason: str = Field(min_length=3, max_length=3000)


# ---------------------------------------------------------------------------
# Reports (admin resolution)
# ---------------------------------------------------------------------------

# The enforced action vocabulary (docs/ADMIN_PANEL_PLAN.md §7.2/§10). The old
# endpoint accepted any string; this is the enum-backed replacement.
AdminReportAction = Literal[
    "dismiss",
    "no_action",
    "pause_listing",
    "hide_listing",
    "hide_review",
    "restore_review",
    "warn_user",
    "suspend_user",
    "reopen",
]


class AdminReportResolveRequest(BaseModel):
    action: AdminReportAction
    admin_note: str | None = Field(default=None, max_length=3000)
    # Message delivered to the affected user for warn_user (required there) and
    # used as the suspension reason for suspend_user (falls back to admin_note).
    user_note: str | None = Field(default=None, max_length=3000)


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


class AdminIdentityItem(AdminIdentitySummary):
    owner: AdminUserRef | None = None
    jobs_count: int = 0


class AdminIdentityListResponse(AdminPage):
    items: list[AdminIdentityItem]


class AdminIdentityDecisionRequest(BaseModel):
    decision: Literal["approve", "reject", "revoke"]
    # Required for reject/revoke; surfaced to the owner via their identity card.
    reason: str | None = Field(default=None, max_length=3000)


# ---------------------------------------------------------------------------
# Conversations (Tier 1 metadata + Tier 2 reported view)
# ---------------------------------------------------------------------------


class AdminApplicationItem(BaseModel):
    id: uuid.UUID
    status: str
    created_at: datetime
    updated_at: datetime
    job_id: uuid.UUID | None = None
    job_title: str | None = None
    applicant: AdminUserRef | None = None
    owner: AdminUserRef | None = None


class AdminApplicationListResponse(AdminPage):
    items: list[AdminApplicationItem]


class AdminInterestItem(BaseModel):
    id: uuid.UUID
    status: str
    created_at: datetime
    updated_at: datetime
    listing_id: uuid.UUID | None = None
    listing_title: str | None = None
    recruiter: AdminUserRef | None = None
    owner: AdminUserRef | None = None


class AdminInterestListResponse(AdminPage):
    items: list[AdminInterestItem]


class AdminAbuseSignalRow(BaseModel):
    user: AdminUserRef
    count: int


class AdminAbuseSignalsResponse(BaseModel):
    days: int
    top_interest_senders: list[AdminAbuseSignalRow]
    top_applicants: list[AdminAbuseSignalRow]


class AdminConversationMessage(BaseModel):
    id: uuid.UUID
    sender: AdminUserRef | None = None
    body: str
    kind: str | None = None
    hidden: bool = False
    created_at: datetime


class AdminReportedConversationResponse(BaseModel):
    report_id: uuid.UUID
    conversation_id: uuid.UUID
    context_type: str
    participants: list[AdminUserRef]
    reported_message_id: uuid.UUID | None = None
    messages: list[AdminConversationMessage]


class AdminMessageModerationRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=3000)
    report_id: uuid.UUID | None = None


# ---------------------------------------------------------------------------
# Platform
# ---------------------------------------------------------------------------


class AdminNoticeRequest(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    title: str = Field(min_length=3, max_length=255)
    body: str = Field(min_length=3, max_length=3000)
    action_url: str | None = Field(default=None, max_length=1024)


class AdminNoticeResponse(BaseModel):
    delivered: int


class AdminEntitlementListResponse(AdminPage):
    items: list[AdminEntitlementItem]


class AdminEntitlementRevokeRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=3000)


class AdminRegistryEvent(BaseModel):
    key: str
    category: str
    recipient: str
    priority: str
    default_channels: list[str]
    wired: bool
    notes: str | None = None


class AdminOutboxItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    to_email: str
    event_key: str
    subject: str
    preview: str | None = None
    status: str
    error: str | None = None
    created_at: datetime
    processed_at: datetime | None = None


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


class AdminAuditLogItem(BaseModel):
    id: uuid.UUID
    actor: AdminUserRef | None = None
    action: str
    target_type: str
    target_id: str
    target_label: str | None = None
    before_json: dict | None = None
    after_json: dict | None = None
    justification: str | None = None
    report_id: uuid.UUID | None = None
    created_at: datetime


class AdminAuditLogListResponse(AdminPage):
    items: list[AdminAuditLogItem]


# Forward-reference resolution (AdminUserDetailResponse references AdminAuditLogItem).
AdminUserDetailResponse.model_rebuild()
