from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_profile_service
from app.schemas import PublicJobsListResponse, PublicPortfolioListResponse, PublicProfileResponse
from app.services.profile_service import (
    ProfileNotFoundError,
    ProfileService,
    ProfileValidationError,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/{username}/public-profile",
    response_model=PublicProfileResponse,
    summary="Get public profile by username",
)
async def get_public_profile(
    username: str,
    service: ProfileService = Depends(get_profile_service),
) -> PublicProfileResponse:
    try:
        return await service.get_public_profile(username)
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/{username}/jobs",
    response_model=PublicJobsListResponse,
    summary="List public jobs by username",
)
async def get_public_profile_jobs(
    username: str,
    tab: str = Query(default="active", pattern="^(active|past)$"),
    service: ProfileService = Depends(get_profile_service),
) -> PublicJobsListResponse:
    try:
        return await service.list_public_jobs(username, tab=tab)
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/{username}/portfolio",
    response_model=PublicPortfolioListResponse,
    summary="List public portfolio items by username",
)
async def get_public_profile_portfolio(
    username: str,
    tab: str = Query(default="now", pattern="^(now|past)$"),
    service: ProfileService = Depends(get_profile_service),
) -> PublicPortfolioListResponse:
    try:
        return await service.list_public_portfolio(username, tab=tab)
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
