from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import bearer_scheme, get_db
from app.db.qa_scenarios import public_scenarios
from app.schemas.auth import AuthUserRead
from app.schemas.qa import (
    QaExitResponse,
    QaPersonaListResponse,
    QaScenarioItem,
    QaScenarioListResponse,
    QaScenarioRestoreRequest,
    QaScenarioRestoreResponse,
    QaSessionExitRequest,
    QaSessionRefreshRequest,
    QaSessionResponse,
    QaSessionSwitchRequest,
    QaStatusResponse,
)
from app.services.qa_persona_service import (
    QaControllerContext,
    QaPersonaService,
    resolve_qa_controller,
)

router = APIRouter(prefix="/qa", tags=["qa"])


async def get_qa_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db),
) -> QaControllerContext:
    if credentials is None:
        # resolve_qa_controller owns the intentionally opaque 404 contract.
        return await resolve_qa_controller(session, "")
    return await resolve_qa_controller(session, credentials.credentials)


def get_service(
    context: QaControllerContext = Depends(get_qa_context),
    session: AsyncSession = Depends(get_db),
) -> QaPersonaService:
    return QaPersonaService(session, context)


@router.get("/personas", response_model=QaPersonaListResponse)
async def list_personas(
    service: QaPersonaService = Depends(get_service),
) -> QaPersonaListResponse:
    return QaPersonaListResponse(
        controller=AuthUserRead.model_validate(service.context.controller),
        personas=await service.list_personas(),
    )


@router.get("/scenarios", response_model=QaScenarioListResponse)
async def list_scenarios(
    _service: QaPersonaService = Depends(get_service),
) -> QaScenarioListResponse:
    return QaScenarioListResponse(
        scenarios=[QaScenarioItem.model_validate(item) for item in public_scenarios()]
    )


@router.get("/status", response_model=QaStatusResponse)
async def qa_status(service: QaPersonaService = Depends(get_service)) -> QaStatusResponse:
    return QaStatusResponse.model_validate(await service.status())


@router.post("/session/switch", response_model=QaSessionResponse)
async def switch_persona(
    payload: QaSessionSwitchRequest,
    service: QaPersonaService = Depends(get_service),
) -> QaSessionResponse:
    return await service.issue_session(payload.persona_key)


@router.post("/session/refresh", response_model=QaSessionResponse)
async def refresh_persona(
    payload: QaSessionRefreshRequest,
    service: QaPersonaService = Depends(get_service),
) -> QaSessionResponse:
    return await service.issue_session(
        payload.persona_key,
        session_id=payload.qa_session_id,
        audit_action="qa.persona.refresh",
    )


@router.post("/session/exit", response_model=QaExitResponse)
async def exit_persona(
    payload: QaSessionExitRequest,
    service: QaPersonaService = Depends(get_service),
) -> QaExitResponse:
    await service.exit_session(payload.qa_session_id, payload.persona_key)
    return QaExitResponse()


@router.post("/scenarios/{key}/restore", response_model=QaScenarioRestoreResponse)
async def restore_scenario(
    key: str,
    payload: QaScenarioRestoreRequest,
    service: QaPersonaService = Depends(get_service),
) -> QaScenarioRestoreResponse:
    result = await service.restore_scenario(key, payload.confirmation)
    return QaScenarioRestoreResponse(
        scenario=key,
        restored_at=datetime.now(UTC),
        result=result,
    )
