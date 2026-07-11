from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.auth import AuthUserRead


class QaPersonaItem(BaseModel):
    key: str
    label: str
    displayName: str
    accountType: str
    modes: list[str]
    description: str
    coverage: list[str]
    startRoute: str
    caution: str | None = None


class QaPersonaListResponse(BaseModel):
    controller: AuthUserRead
    personas: list[QaPersonaItem]


class QaScenarioItem(BaseModel):
    key: str
    title: str
    purpose: str
    personas: list[str]
    startRoute: str
    confirmation: str
    danger: bool = False


class QaScenarioListResponse(BaseModel):
    scenarios: list[QaScenarioItem]


class QaSessionSwitchRequest(BaseModel):
    persona_key: str = Field(min_length=1, max_length=64)


class QaSessionRefreshRequest(QaSessionSwitchRequest):
    qa_session_id: UUID


class QaSessionExitRequest(BaseModel):
    qa_session_id: UUID
    persona_key: str = Field(min_length=1, max_length=64)


class QaSessionResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    access_token_expires_at: int | None = None
    qa_session_id: UUID
    persona_key: str
    user: AuthUserRead


class QaExitResponse(BaseModel):
    ok: bool = True


class QaScenarioRestoreRequest(BaseModel):
    confirmation: str = Field(min_length=1, max_length=128)


class QaScenarioRestoreResponse(BaseModel):
    status: str = "restored"
    scenario: str
    restored_at: datetime
    result: dict[str, object]


class QaStatusResponse(BaseModel):
    enabled: bool
    environment: str
    controllerEmail: str
    activePersonaKey: str | None = None
    qaSessionId: UUID | None = None
    personaCount: int
    scenarioCount: int
    fixturesHealthy: bool
