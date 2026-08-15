from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps import get_current_user, get_me_service, get_profile_service
from app.core.rate_limit import MARKETPLACE_ACTION_LIMIT, rate_limit
from app.models import User
from app.schemas import (
    AccountTypeUpdateRequest,
    AuthStatusResponse,
    AvatarUploadRequest,
    HiringIdentitiesResponse,
    HiringIdentityCreate,
    HiringIdentityRead,
    HiringIdentityUpdate,
    HiringIdentityVerificationCheckRequest,
    HiringIdentityVerificationRequest,
    HiringIdentityVerificationResponse,
    MeRead,
    MeYouTubeChannelRead,
    OnboardingIntentUpdateRequest,
    OrganizationPageRequest,
    OrganizationPageResponse,
    PortfolioItemCreate,
    PortfolioItemRead,
    PortfolioItemUpdate,
    PortfolioListResponse,
    PrivacyUpdateRequest,
    ProfileRead,
    ProfileUpdateRequest,
    YouTubeChannelsResponse,
    YouTubeDisconnectResponse,
    YouTubeRefreshResponse,
)
from app.services.me_service import (
    MeService,
    YouTubeAPIError,
    YouTubeReauthRequiredError,
)
from app.services.organization_page_service import (
    OrganizationPageError,
    read_organization_page,
)
from app.services.profile_service import (
    PortfolioItemNotFoundError,
    ProfileNotFoundError,
    ProfileService,
    ProfileValidationError,
)

router = APIRouter(prefix="/me", tags=["me"])


def _channels_to_response(channels: list[object]) -> list[MeYouTubeChannelRead]:
    return [
        MeYouTubeChannelRead(
            id=channel.id,
            channel_id=channel.channel_id,
            title=channel.title,
            thumbnail_url=channel.thumbnail_url,
        )
        for channel in channels
    ]


@router.get("", response_model=MeRead, summary="Current authenticated user")
async def get_me(
    current_user: User = Depends(get_current_user),
    service: MeService = Depends(get_me_service),
    profile_service: ProfileService = Depends(get_profile_service),
) -> MeRead:
    channels = await service.list_user_youtube_channels(current_user)
    profile_capabilities = await profile_service.get_profile_capabilities(current_user)
    return MeRead(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        display_name=current_user.display_name,
        account_type=current_user.account_type,
        account_type_selected_at=current_user.account_type_selected_at,
        onboarding_intent=current_user.onboarding_intent,
        onboarding_intent_selected_at=current_user.onboarding_intent_selected_at,
        profile_capabilities=profile_capabilities,
        email_verified=current_user.email_verified_at is not None,
        verified_youtube_channels=_channels_to_response(channels),
    )


@router.patch(
    "/account-type",
    response_model=MeRead,
    summary="Deprecated compatibility endpoint for onboarding intent",
    description="Maps old TALENT/EMPLOYER/BOTH inputs to non-restrictive onboarding intent. ADMIN is never self-selectable.",
)
async def update_account_type(
    payload: AccountTypeUpdateRequest,
    current_user: User = Depends(get_current_user),
    service: MeService = Depends(get_me_service),
    profile_service: ProfileService = Depends(get_profile_service),
) -> MeRead:
    user = await service.update_account_type(current_user, payload.account_type)
    channels = await service.list_user_youtube_channels(user)
    profile_capabilities = await profile_service.get_profile_capabilities(user)
    return MeRead(
        id=user.id,
        email=user.email,
        username=user.username,
        display_name=user.display_name,
        account_type=user.account_type,
        account_type_selected_at=user.account_type_selected_at,
        onboarding_intent=user.onboarding_intent,
        onboarding_intent_selected_at=user.onboarding_intent_selected_at,
        profile_capabilities=profile_capabilities,
        email_verified=user.email_verified_at is not None,
        verified_youtube_channels=_channels_to_response(channels),
    )


@router.patch(
    "/onboarding-intent",
    response_model=MeRead,
    summary="Update current user's onboarding intent",
    description="Public users can choose a non-restrictive onboarding intent. ADMIN is never self-selectable.",
)
async def update_onboarding_intent(
    payload: OnboardingIntentUpdateRequest,
    current_user: User = Depends(get_current_user),
    service: MeService = Depends(get_me_service),
    profile_service: ProfileService = Depends(get_profile_service),
) -> MeRead:
    user = await service.update_onboarding_intent(current_user, payload.onboarding_intent)
    channels = await service.list_user_youtube_channels(user)
    profile_capabilities = await profile_service.get_profile_capabilities(user)
    return MeRead(
        id=user.id,
        email=user.email,
        username=user.username,
        display_name=user.display_name,
        account_type=user.account_type,
        account_type_selected_at=user.account_type_selected_at,
        onboarding_intent=user.onboarding_intent,
        onboarding_intent_selected_at=user.onboarding_intent_selected_at,
        profile_capabilities=profile_capabilities,
        email_verified=user.email_verified_at is not None,
        verified_youtube_channels=_channels_to_response(channels),
    )


@router.post(
    "/youtube/refresh",
    response_model=YouTubeRefreshResponse,
    summary="Refresh linked YouTube channels from Google OAuth tokens",
)
async def refresh_youtube_channels(
    current_user: User = Depends(get_current_user),
    service: MeService = Depends(get_me_service),
) -> YouTubeRefreshResponse:
    try:
        channels = await service.refresh_youtube_channels(current_user)
    except YouTubeReauthRequiredError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except YouTubeAPIError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return YouTubeRefreshResponse(status="ok", channels=_channels_to_response(channels))


@router.post(
    "/youtube/disconnect",
    response_model=YouTubeDisconnectResponse,
    summary="Disconnect YouTube and revoke stored Google API authority",
)
async def disconnect_youtube(
    current_user: User = Depends(get_current_user),
    service: MeService = Depends(get_me_service),
) -> YouTubeDisconnectResponse:
    outcome = await service.disconnect_youtube(current_user)
    return YouTubeDisconnectResponse(
        provider_revocation=outcome.provider_revocation,
        channel_links_removed=outcome.channel_links_removed,
    )


@router.get(
    "/youtube/channels",
    response_model=YouTubeChannelsResponse,
    summary="List authenticated user's verified YouTube channels",
)
async def list_youtube_channels(
    current_user: User = Depends(get_current_user),
    service: MeService = Depends(get_me_service),
) -> YouTubeChannelsResponse:
    channels = await service.list_user_youtube_channels(current_user)
    return YouTubeChannelsResponse(channels=_channels_to_response(channels))


@router.get(
    "/profile",
    response_model=ProfileRead,
    summary="Get authenticated user's profile settings",
)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> ProfileRead:
    return await service.get_my_profile(current_user)


@router.patch(
    "/profile",
    response_model=ProfileRead,
    summary="Update authenticated user's profile settings",
)
async def update_my_profile(
    payload: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> ProfileRead:
    try:
        return await service.update_my_profile(current_user, payload)
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/avatar",
    response_model=ProfileRead,
    summary="Upload authenticated user's profile avatar",
)
async def upload_my_avatar(
    payload: AvatarUploadRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> ProfileRead:
    try:
        return await service.upload_my_avatar(
            current_user,
            payload,
            public_base_url=str(request.base_url),
        )
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/banner",
    response_model=ProfileRead,
    summary="Upload authenticated user's profile banner (cover image)",
)
async def upload_my_banner(
    payload: AvatarUploadRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> ProfileRead:
    try:
        return await service.upload_my_banner(
            current_user,
            payload,
            public_base_url=str(request.base_url),
        )
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.patch(
    "/privacy",
    response_model=ProfileRead,
    summary="Update authenticated user's profile privacy settings",
)
async def update_my_privacy(
    payload: PrivacyUpdateRequest,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> ProfileRead:
    return await service.update_my_privacy(current_user, payload)


@router.get(
    "/hiring-identities",
    response_model=HiringIdentitiesResponse,
    summary="List authenticated user's hiring identities",
)
async def list_my_hiring_identities(
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> HiringIdentitiesResponse:
    rows = await service.list_my_hiring_identities(current_user)
    return HiringIdentitiesResponse(items=[HiringIdentityRead.model_validate(row) for row in rows])


@router.post(
    "/hiring-identities",
    response_model=HiringIdentityRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create authenticated user's hiring identity",
)
async def create_my_hiring_identity(
    payload: HiringIdentityCreate,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> HiringIdentityRead:
    try:
        row = await service.create_my_hiring_identity(current_user, payload)
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return HiringIdentityRead.model_validate(row)


@router.patch(
    "/hiring-identities/{identity_id}",
    response_model=HiringIdentityRead,
    summary="Update authenticated user's hiring identity",
)
async def update_my_hiring_identity(
    identity_id: UUID,
    payload: HiringIdentityUpdate,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> HiringIdentityRead:
    try:
        row = await service.update_my_hiring_identity(
            current_user, identity_id=identity_id, payload=payload
        )
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return HiringIdentityRead.model_validate(row)


@router.post(
    "/hiring-identities/{identity_id}/request-verification",
    response_model=HiringIdentityVerificationResponse,
    summary="Request verification for authenticated user's hiring identity",
)
async def request_my_hiring_identity_verification(
    identity_id: UUID,
    payload: HiringIdentityVerificationRequest | None = None,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> HiringIdentityVerificationResponse:
    try:
        return await service.request_hiring_identity_verification(
            current_user,
            identity_id=identity_id,
            payload=payload or HiringIdentityVerificationRequest(),
        )
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete(
    "/hiring-identities/{identity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete authenticated user's hiring identity",
)
async def delete_my_hiring_identity(
    identity_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> None:
    try:
        await service.delete_my_hiring_identity(current_user, identity_id=identity_id)
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/hiring-identities/{identity_id}/check-verification",
    response_model=HiringIdentityVerificationResponse,
    summary="Check authenticated user's hiring identity verification code",
)
async def check_my_hiring_identity_verification(
    identity_id: UUID,
    _payload: HiringIdentityVerificationCheckRequest | None = None,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> HiringIdentityVerificationResponse:
    try:
        return await service.check_hiring_identity_bio_verification(
            current_user,
            identity_id=identity_id,
        )
    except ProfileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProfileValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/portfolio",
    response_model=PortfolioListResponse,
    summary="List authenticated user's portfolio items",
)
async def list_my_portfolio(
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> PortfolioListResponse:
    items = await service.list_my_portfolio(current_user)
    return PortfolioListResponse(items=[PortfolioItemRead.model_validate(item) for item in items])


@router.post(
    "/portfolio",
    response_model=PortfolioItemRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create authenticated user's portfolio item",
)
async def create_my_portfolio_item(
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
    "/portfolio/{item_id}",
    response_model=PortfolioItemRead,
    summary="Update authenticated user's portfolio item",
)
async def update_my_portfolio_item(
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
    "/portfolio/{item_id}",
    response_model=AuthStatusResponse,
    summary="Delete authenticated user's portfolio item",
)
async def delete_my_portfolio_item(
    item_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ProfileService = Depends(get_profile_service),
) -> AuthStatusResponse:
    try:
        await service.delete_my_portfolio_item(current_user, item_id=item_id)
    except PortfolioItemNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AuthStatusResponse(status="ok")


@router.post(
    "/organization-page",
    response_model=OrganizationPageResponse,
    summary="Read bounded public metadata for an organization or channel URL",
)
async def read_my_organization_page(
    payload: OrganizationPageRequest,
    _limit: None = rate_limit(MARKETPLACE_ACTION_LIMIT),
    current_user: User = Depends(get_current_user),
) -> OrganizationPageResponse:
    """Fetch a public page the signed-in user named, on the server's terms.

    The retrieval used to happen in the Next runtime, where it resolved DNS
    itself and followed its own redirects. It now goes through the shared
    pinned boundary, and only the handful of fields the resolver uses come back
    — the browser never receives the page.

    An unreadable page is an ordinary outcome, not an error: the caller falls
    back to the identity it can derive from the URL, which is why this answers
    with empty fields rather than a failure status.
    """

    _ = current_user
    try:
        metadata = await read_organization_page(payload.url)
    except OrganizationPageError:
        return OrganizationPageResponse()
    return OrganizationPageResponse(
        final_url=metadata.final_url,
        site_name=metadata.site_name,
        title=metadata.title,
        image_url=metadata.image_url,
        icon_url=metadata.icon_url,
        youtube_channel_id=metadata.youtube_channel_id,
    )
