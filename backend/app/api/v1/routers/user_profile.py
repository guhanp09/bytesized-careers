from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user, get_profile_service
from app.models import User
from app.schemas import (
    ContentStyleRead,
    ContentStyleUpsertRequest,
    UserRoleAnswersResponse,
    UserRoleAnswersUpsertRequest,
    UserRolesResponse,
    UserRolesUpsertRequest,
)
from app.services.profile_service import ProfileService, ProfileValidationError

router = APIRouter(prefix="/user", tags=["user"])


@router.get("/roles", response_model=UserRolesResponse, summary="Get current user's selected roles")
async def get_user_roles(
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> UserRolesResponse:
    return UserRolesResponse(items=await service.get_user_roles(current_user))


@router.post("/roles", response_model=UserRolesResponse, summary="Set current user's selected roles")
async def upsert_user_roles(
    payload: UserRolesUpsertRequest,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> UserRolesResponse:
    try:
        rows = await service.set_user_roles(current_user, payload)
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return UserRolesResponse(items=rows)


@router.get(
    "/role-answers",
    response_model=UserRoleAnswersResponse,
    summary="Get current user's role clarification answers",
)
async def get_user_role_answers(
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> UserRoleAnswersResponse:
    rows = await service.get_user_role_answers(current_user)
    return UserRoleAnswersResponse(items=rows)


@router.post(
    "/role-answers",
    response_model=UserRoleAnswersResponse,
    summary="Upsert current user's role clarification answers",
)
async def upsert_user_role_answers(
    payload: UserRoleAnswersUpsertRequest,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> UserRoleAnswersResponse:
    try:
        rows = await service.upsert_user_role_answers(current_user, payload)
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return UserRoleAnswersResponse(items=rows)


@router.get(
    "/content-style",
    response_model=ContentStyleRead,
    summary="Get current user's content style profile",
)
async def get_user_content_style(
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> ContentStyleRead:
    return await service.get_user_content_style(current_user)


@router.post(
    "/content-style",
    response_model=ContentStyleRead,
    summary="Upsert current user's content style profile",
)
async def upsert_user_content_style(
    payload: ContentStyleUpsertRequest,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> ContentStyleRead:
    try:
        return await service.upsert_user_content_style(current_user, payload)
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
