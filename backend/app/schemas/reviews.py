from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

EngagementSourceType = Literal["job_application", "talent_interest"]
EngagementStatus = Literal[
    "ready_to_start",
    "start_pending",
    "active",
    "completion_pending",
    "completed",
    "ended_after_start",
    "cancelled_before_start",
]
EngagementAction = Literal[
    "request_start",
    "confirm_start",
    "decline_start",
    "cancel_before_start",
    "request_completion",
    "confirm_completion",
    "flag_completion_issue",
    "write_review",
    "edit_review",
]
ReviewDirection = Literal["recruiter_to_talent", "talent_to_recruiter"]
ReviewState = Literal["not_eligible", "available", "submitted", "published", "expired"]
ProfileReviewMode = Literal["talent", "hiring"]


class ReviewSummary(BaseModel):
    avg_rating: float = 0.0
    review_count: int = 0


class PublicReviewItem(BaseModel):
    id: uuid.UUID
    reviewer_name: str
    reviewer_avatar_url: str | None = None
    reviewer_role: str | None = None
    relationship_label: str = "Verified engagement"
    rating: int = Field(ge=1, le=5)
    body: str = ""
    created_at: datetime
    verified: bool = True


class ProfileReviewCollection(BaseModel):
    summary: ReviewSummary = Field(default_factory=ReviewSummary)
    items: list[PublicReviewItem] = Field(default_factory=list)


class ReviewsByMode(BaseModel):
    talent: ProfileReviewCollection = Field(default_factory=ProfileReviewCollection)
    hiring: ProfileReviewCollection = Field(default_factory=ProfileReviewCollection)


#: Payment lifecycle, wholly separate from EngagementStatus and from the
#: application lifecycle. Nothing transitions because of a value here.
PaymentState = Literal[
    "not_applicable",
    "setup_pending",
    "funding_pending",
    "funded",
    "work_in_progress",
    "release_requested",
    "released",
    "disputed",
    "refunded",
    "expired",
]


class EngagementSummary(BaseModel):
    id: uuid.UUID
    source_type: EngagementSourceType
    source_record_id: uuid.UUID
    status: EngagementStatus
    context_label: str
    counterpart_name: str
    started_at: datetime | None = None
    response_due_at: datetime | None = None
    finalized_at: datetime | None = None
    review_window_ends_at: datetime | None = None
    available_actions: list[EngagementAction] = Field(default_factory=list)
    review_state: ReviewState = "not_eligible"
    # Payment, reported separately from the engagement's own status. None means
    # nothing has been asserted — which is every engagement today — and is not
    # the same claim as "not_applicable".
    payment_state: PaymentState | None = None
    payment_state_updated_at: datetime | None = None
    payment_note: str | None = None


class StartResponseRequest(BaseModel):
    decision: Literal["confirm", "not_started"]


class CompletionRequest(BaseModel):
    outcome: Literal["completed", "ended_after_start"]
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def clean_note(cls, value: str | None) -> str | None:
        cleaned = (value or "").strip()
        return cleaned or None


class CompletionResponseRequest(BaseModel):
    decision: Literal["confirm", "needs_attention"]
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_issue_note(self) -> CompletionResponseRequest:
        self.note = (self.note or "").strip() or None
        if self.decision == "needs_attention" and (not self.note or len(self.note) < 10):
            raise ValueError("Add a short note explaining what needs attention.")
        return self


class ReviewUpsertRequest(BaseModel):
    overall_rating: int = Field(ge=1, le=5)
    dimension_ratings: dict[str, int] = Field(default_factory=dict)
    public_feedback: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_feedback(self) -> ReviewUpsertRequest:
        self.public_feedback = (self.public_feedback or "").strip() or None
        if self.overall_rating <= 2 and len(self.public_feedback or "") < 20:
            raise ValueError("Add at least 20 characters of context for a low rating.")
        for rating in self.dimension_ratings.values():
            if rating < 1 or rating > 5:
                raise ValueError("Dimension ratings must be between 1 and 5.")
        return self


class MyReviewRead(BaseModel):
    id: uuid.UUID
    engagement_id: uuid.UUID
    direction: ReviewDirection
    overall_rating: int
    dimension_ratings: dict[str, int] = Field(default_factory=dict)
    public_feedback: str | None = None
    status: Literal["submitted", "published", "hidden"]
    submitted_at: datetime
    published_at: datetime | None = None
    editable: bool = False


class ReviewOpportunity(BaseModel):
    engagement: EngagementSummary
    direction: ReviewDirection
    my_review: MyReviewRead | None = None


class ReviewWorkspaceResponse(BaseModel):
    mode: ProfileReviewMode
    received: ProfileReviewCollection = Field(default_factory=ProfileReviewCollection)
    opportunities: list[ReviewOpportunity] = Field(default_factory=list)
    written: list[ReviewOpportunity] = Field(default_factory=list)
