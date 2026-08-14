from __future__ import annotations

import logging
from datetime import UTC, datetime

from app.core.account_types import PublicAccountType
from app.core.onboarding_intent import (
    OnboardingIntent,
    normalize_onboarding_intent,
    onboarding_intent_from_legacy_account_type,
)
from app.models import User, YouTubeChannel
from app.repositories.auth_repository import AuthRepository
from app.schemas.auth import OAuthUpsertRequest
from app.services.youtube_service import (
    YouTubeAPIError,
    YouTubeReauthRequiredError,
    fetch_user_youtube_channels,
)

logger = logging.getLogger(__name__)


class OAuthAccountNotLinkedError(Exception):
    pass


class MeService:
    def __init__(self, repository: AuthRepository):
        self.repository = repository

    async def list_user_youtube_channels(self, user: User) -> list[YouTubeChannel]:
        return await self.repository.list_user_youtube_channels(user_id=user.id)

    async def update_account_type(self, user: User, account_type: PublicAccountType) -> User:
        user.onboarding_intent = onboarding_intent_from_legacy_account_type(account_type)
        user.onboarding_intent_selected_at = datetime.now(UTC)
        await self.repository.commit()
        logger.info(
            "legacy_account_type_mapped_to_onboarding_intent",
            extra={"user_id": str(user.id), "onboarding_intent": user.onboarding_intent},
        )
        return user

    async def update_onboarding_intent(
        self,
        user: User,
        onboarding_intent: OnboardingIntent,
    ) -> User:
        user.onboarding_intent = normalize_onboarding_intent(onboarding_intent)
        user.onboarding_intent_selected_at = datetime.now(UTC)
        await self.repository.commit()
        logger.info(
            "onboarding_intent_updated",
            extra={"user_id": str(user.id), "onboarding_intent": user.onboarding_intent},
        )
        return user

    async def upsert_google_oauth_account(self, user: User, payload: OAuthUpsertRequest) -> None:
        existing = await self.repository.get_oauth_account_for_user(
            user_id=user.id,
            provider="google",
        )
        if existing is None:
            raise OAuthAccountNotLinkedError(
                "Google identity must be verified before credentials can be updated"
            )
        await self.repository.upsert_oauth_account(
            user_id=user.id,
            provider="google",
            provider_account_id=existing.provider_account_id,
            access_token=payload.access_token,
            refresh_token=payload.refresh_token,
            expires_at=payload.expires_at,
            scope=payload.scope,
        )
        await self.repository.commit()
        logger.info(
            "oauth_tokens_saved",
            extra={
                "user_id": str(user.id),
                "provider": "google",
                "has_access_token": bool(payload.access_token),
                "has_refresh_token": bool(payload.refresh_token),
            },
        )

    async def refresh_youtube_channels(self, user: User) -> list[YouTubeChannel]:
        oauth = await self.repository.get_latest_oauth_account_for_user(
            user_id=user.id,
            provider="google",
        )
        if oauth is None or not oauth.access_token:
            raise YouTubeReauthRequiredError("youtube_reauth_required")

        now_epoch = int(datetime.now(UTC).timestamp())
        if oauth.expires_at is not None and oauth.expires_at <= now_epoch and not oauth.refresh_token:
            raise YouTubeReauthRequiredError("youtube_reauth_required")

        channels = await fetch_user_youtube_channels(oauth.access_token)
        for item in channels:
            channel_row = await self.repository.upsert_youtube_channel(
                channel_id=item.channel_id,
                title=item.title,
                thumbnail_url=item.thumbnail_url,
            )
            await self.repository.ensure_user_youtube_channel_link(
                user_id=user.id,
                youtube_channel_id=channel_row.id,
            )

        # Keep display name useful for creator-facing surfaces when user signed in via Google.
        if not user.display_name and channels:
            user.display_name = channels[0].title

        await self.repository.commit()
        logger.info(
            "youtube_channels_refreshed",
            extra={
                "user_id": str(user.id),
                "channel_count": len(channels),
            },
        )
        return await self.repository.list_user_youtube_channels(user_id=user.id)

__all__ = [
    "MeService",
    "OAuthAccountNotLinkedError",
    "YouTubeAPIError",
    "YouTubeReauthRequiredError",
]
