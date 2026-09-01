from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import (
    authenticated_rate_limit,
    get_current_user,
    get_optional_current_user,
    get_profile_service,
)
from app.core.rate_limit import OUTBOUND_FETCH_LIMIT
from app.models import User
from app.schemas import (
    AuthStatusResponse,
    PortfolioItemCreate,
    PortfolioItemRead,
    PortfolioItemUpdate,
    PortfolioLinkPreviewRequest,
    PortfolioLinkPreviewResponse,
    PortfolioListResponse,
    PortfolioYouTubeCreateRequest,
    PortfolioYouTubePreviewRequest,
    PortfolioYouTubePreviewResponse,
)
from app.services.link_preview_service import LinkPreviewValidationError, preview_portfolio_link
from app.services.profile_service import (
    PortfolioItemNotFoundError,
    ProfileService,
    ProfileValidationError,
)
from app.services.youtube_service import YouTubeAPIError

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


def _youtube_error_status(error: YouTubeAPIError) -> int:
    message = str(error).lower()
    if "not configured" in message:
        return status.HTTP_503_SERVICE_UNAVAILABLE
    if "unavailable" in message or "not found" in message or "private" in message or "deleted" in message:
        return status.HTTP_404_NOT_FOUND
    return status.HTTP_502_BAD_GATEWAY


@router.post(
    "/link-preview",
    response_model=PortfolioLinkPreviewResponse,
    summary="Preview public metadata for a portfolio work link",
)
async def preview_link_portfolio_item(
    payload: PortfolioLinkPreviewRequest,
    _limit: None = authenticated_rate_limit(OUTBOUND_FETCH_LIMIT),
    current_user: User = Depends(get_current_user),
) -> PortfolioLinkPreviewResponse:
    _ = current_user
    try:
        return await preview_portfolio_link(payload.url)
    except LinkPreviewValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/youtube/preview",
    response_model=PortfolioYouTubePreviewResponse,
    summary="Preview public YouTube metadata before saving portfolio item",
)
async def preview_youtube_portfolio_item(
    payload: PortfolioYouTubePreviewRequest,
    _limit: None = authenticated_rate_limit(OUTBOUND_FETCH_LIMIT),
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> PortfolioYouTubePreviewResponse:
    _ = current_user
    try:
        return await service.preview_portfolio_youtube(url=payload.url)
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except YouTubeAPIError as exc:
        raise HTTPException(status_code=_youtube_error_status(exc), detail=str(exc)) from exc


@router.post(
    "/youtube",
    response_model=PortfolioItemRead,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest a YouTube video into authenticated user's portfolio",
)
async def create_portfolio_item_from_youtube(
    payload: PortfolioYouTubeCreateRequest,
    _limit: None = authenticated_rate_limit(OUTBOUND_FETCH_LIMIT),
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> PortfolioItemRead:
    try:
        row = await service.create_portfolio_from_youtube(current_user, payload=payload)
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except YouTubeAPIError as exc:
        raise HTTPException(status_code=_youtube_error_status(exc), detail=str(exc)) from exc
    return PortfolioItemRead.model_validate(row)


@router.get(
    "/items",
    response_model=PortfolioListResponse,
    summary="List portfolio proof items",
)
async def list_portfolio_items(
    user_id: str = Query(default="me"),
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> PortfolioListResponse:
    if user_id == "me":
        rows = await service.list_portfolio_by_user(user_id=current_user.id, include_private=True)
    else:
        try:
            requested_user_id = UUID(user_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user_id") from exc
        rows = await service.list_portfolio_by_user(
            user_id=requested_user_id,
            include_private=requested_user_id == current_user.id,
        )
    return PortfolioListResponse(items=[PortfolioItemRead.model_validate(item) for item in rows])


@router.post(
    "/items",
    response_model=PortfolioItemRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create portfolio proof item",
)
async def create_portfolio_item(
    payload: PortfolioItemCreate,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> PortfolioItemRead:
    try:
        row = await service.create_my_portfolio_item(current_user, payload)
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PortfolioItemRead.model_validate(row)


@router.patch(
    "/items/{item_id}",
    response_model=PortfolioItemRead,
    summary="Update portfolio proof item",
)
async def update_portfolio_item(
    item_id: UUID,
    payload: PortfolioItemUpdate,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> PortfolioItemRead:
    try:
        row = await service.update_my_portfolio_item(current_user, item_id=item_id, payload=payload)
    except PortfolioItemNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PortfolioItemRead.model_validate(row)


@router.delete(
    "/items/{item_id}",
    response_model=AuthStatusResponse,
    summary="Delete portfolio proof item",
)
async def delete_portfolio_item(
    item_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> AuthStatusResponse:
    try:
        await service.delete_my_portfolio_item(current_user, item_id=item_id)
    except PortfolioItemNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AuthStatusResponse(status="ok")


@router.get(
    "/{user_id}",
    response_model=PortfolioListResponse,
    summary="List portfolio items for a user",
)
async def list_portfolio_items_by_user(
    user_id: UUID,
    current_user: User | None = Depends(get_optional_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> PortfolioListResponse:
    include_private = bool(current_user and current_user.id == user_id)
    rows = await service.list_portfolio_by_user(user_id=user_id, include_private=include_private)
    return PortfolioListResponse(items=[PortfolioItemRead.model_validate(item) for item in rows])
