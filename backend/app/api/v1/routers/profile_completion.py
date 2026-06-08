from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_profile_service
from app.models import User
from app.schemas import ProfileCompletionResponse
from app.services.profile_service import ProfileService

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get(
    "/completion",
    response_model=ProfileCompletionResponse,
    summary="Get completion status for authenticated user's creator profile",
)
async def get_profile_completion(
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> ProfileCompletionResponse:
    return await service.get_profile_completion(current_user)
