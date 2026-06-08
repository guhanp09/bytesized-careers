from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_profile_service
from app.schemas import RoleListResponse, RoleQuestionsResponse
from app.services.profile_service import ProfileNotFoundError, ProfileService

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("", response_model=RoleListResponse, summary="List all supported creator roles")
async def list_roles(
    service: ProfileService = Depends(get_profile_service),
) -> RoleListResponse:
    return RoleListResponse(items=await service.list_roles())


@router.get(
    "/{role_id}/questions",
    response_model=RoleQuestionsResponse,
    summary="List clarification questions for a role",
)
async def list_role_questions(
    role_id: UUID,
    service: ProfileService = Depends(get_profile_service),
) -> RoleQuestionsResponse:
    try:
        return await service.list_role_questions(role_id=role_id)
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
