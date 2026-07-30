from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.job import JobRead
from app.schemas.marketplace import TalentListingRead

SearchDomain = Literal["jobs", "talent"]
SearchConstraintStrength = Literal["hard", "preferred"]


class SearchCompensationIntent(BaseModel):
    amount: float = Field(gt=0)
    operator: Literal["approx", "under", "over"]
    currency: str | None = Field(default=None, max_length=3)
    unit: str | None = Field(default=None, max_length=32)


class SearchTurnaroundIntent(BaseModel):
    value: int | None = Field(default=None, gt=0)
    unit: Literal["hours", "days", "weeks"] | None = None
    fast: bool = False


class SearchIntentRead(BaseModel):
    version: Literal[1] = 1
    domain: SearchDomain
    query: str
    roles: list[str] = Field(default_factory=list)
    role_labels: list[str] = Field(default_factory=list)
    specializations: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    tool_labels: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    platforms: list[str] = Field(default_factory=list)
    formats: list[str] = Field(default_factory=list)
    genres: list[str] = Field(default_factory=list)
    niches: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    work_modes: list[str] = Field(default_factory=list)
    engagement_types: list[str] = Field(default_factory=list)
    availability: list[str] = Field(default_factory=list)
    compensation: SearchCompensationIntent | None = None
    weekly_hours: float | None = Field(default=None, gt=0, le=168)
    turnaround: SearchTurnaroundIntent | None = None
    experience_years_min: int | None = Field(default=None, ge=0, le=80)
    hard_constraints: list[str] = Field(default_factory=list)
    preferred_constraints: list[str] = Field(default_factory=list)
    free_text_terms: list[str] = Field(default_factory=list)
    corrections: list[str] = Field(default_factory=list)


class JobSearchMatch(BaseModel):
    item: JobRead
    score: float
    reasons: list[str] = Field(default_factory=list, max_length=5)
    matched_all_recognized: bool


class TalentSearchMatch(BaseModel):
    item: TalentListingRead
    score: float
    reasons: list[str] = Field(default_factory=list, max_length=5)
    matched_all_recognized: bool


class JobDeepSearchResponse(BaseModel):
    domain: Literal["jobs"] = "jobs"
    intent: SearchIntentRead
    items: list[JobSearchMatch]
    total: int
    limit: int
    offset: int
    no_exact_match: bool = False


class TalentDeepSearchResponse(BaseModel):
    domain: Literal["talent"] = "talent"
    intent: SearchIntentRead
    items: list[TalentSearchMatch]
    total: int
    limit: int
    offset: int
    no_exact_match: bool = False
