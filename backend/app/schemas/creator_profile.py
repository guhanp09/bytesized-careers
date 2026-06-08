from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

RoleQuestionType = Literal["single_select", "multi_select", "text", "number"]


class RoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    version: int = 1
    is_active: bool = True
    popularity_score: int = 0
    category: str
    description: str | None = None


class RoleListResponse(BaseModel):
    items: list[RoleRead] = Field(default_factory=list)


class RoleQuestionOptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    value: str


class RoleQuestionRead(BaseModel):
    id: uuid.UUID
    role_id: uuid.UUID
    label: str
    help_text: str | None = None
    type: RoleQuestionType
    required: bool
    options: list[RoleQuestionOptionRead] = Field(default_factory=list)


class RoleQuestionsResponse(BaseModel):
    role_id: uuid.UUID
    items: list[RoleQuestionRead] = Field(default_factory=list)


class UserRolesUpsertRequest(BaseModel):
    role_ids: list[uuid.UUID] = Field(default_factory=list)


class UserRolesResponse(BaseModel):
    items: list[RoleRead] = Field(default_factory=list)


class UserRoleAnswerWrite(BaseModel):
    role_question_id: uuid.UUID
    answer: Any = None


class UserRoleAnswersUpsertRequest(BaseModel):
    answers: list[UserRoleAnswerWrite] = Field(default_factory=list)


class UserRoleAnswerRead(BaseModel):
    role_question_id: uuid.UUID
    answer: Any = None


class UserRoleAnswersResponse(BaseModel):
    items: list[UserRoleAnswerRead] = Field(default_factory=list)


class RoleAnswerSummary(BaseModel):
    role_question_id: uuid.UUID
    role_name: str
    question_label: str
    answer: Any = None


class ContentStyleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    primary_niche: str | None = None
    format: list[str] = Field(default_factory=list)
    tone: list[str] = Field(default_factory=list)
    target_audience: str | None = None
    editing_complexity: str | None = None


class ContentStyleUpsertRequest(BaseModel):
    primary_niche: str | None = None
    format: list[str] = Field(default_factory=list)
    tone: list[str] = Field(default_factory=list)
    target_audience: str | None = None
    editing_complexity: str | None = None


class ContentStyleNichesResponse(BaseModel):
    items: list[str] = Field(default_factory=list)


class ProfileCompletionResponse(BaseModel):
    completion_percent: int
    missing_required_sections: list[str] = Field(default_factory=list)


class PortfolioYouTubeCreateRequest(BaseModel):
    youtube_url: str = Field(min_length=1, max_length=2048)
    retention_percent: float | None = None
    user_role_in_project: str | None = Field(default=None, max_length=255)
    status: Literal["now", "past"] = "past"
    is_public: bool = True


class PortfolioByUserResponse(BaseModel):
    user_id: uuid.UUID
    items: list[Any] = Field(default_factory=list)


class PortfolioYouTubeMetadata(BaseModel):
    video_id: str
    title: str
    thumbnail_url: str | None = None
    channel_name: str | None = None
    view_count: int | None = None
    published_date: datetime | None = None
    duration: str | None = None
