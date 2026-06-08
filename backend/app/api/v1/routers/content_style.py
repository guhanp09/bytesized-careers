from __future__ import annotations

from fastapi import APIRouter

from app.schemas import ContentStyleNichesResponse
from app.services.profile_service import ProfileService

router = APIRouter(prefix="/content-style", tags=["content-style"])


@router.get(
    "/niches",
    response_model=ContentStyleNichesResponse,
    summary="List supported primary niche values for content style",
)
async def list_content_style_niches(
) -> ContentStyleNichesResponse:
    return ProfileService.get_content_style_niches()
