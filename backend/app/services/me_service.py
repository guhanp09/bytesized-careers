from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from app.core.account_types import PublicAccountType
from app.core.config import settings
from app.core.oauth_credentials import (
    OAuthCredentialConfigurationError,
    OAuthCredentialDecryptionError,
)
from app.core.oauth_scopes import (
    GOOGLE_YOUTUBE_READONLY_SCOPE,
    has_google_youtube_read_scope,
)
from app.core.onboarding_intent import (
    OnboardingIntent,
    normalize_onboarding_intent,
    onboarding_intent_from_legacy_account_type,
)
from app.models import OAuthAccount, User, YouTubeChannel
from app.repositories.auth_repository import AuthRepository
from app.services.google_oauth_refresh import (
    GoogleOAuthRefreshRejectedError,
    GoogleOAuthRefreshResult,
    GoogleOAuthRefreshUnavailableError,
    refresh_google_oauth_token,
)
from app.services.google_oauth_revocation import (
    GoogleOAuthRevocationResult,
    GoogleOAuthRevocationStatus,
    revoke_google_oauth_token,
)
from app.services.youtube_service import (
    YouTubeAPIError,
    YouTubeReauthRequiredError,
    fetch_user_youtube_channels,
)

logger = logging.getLogger(__name__)


async def _refresh_google_token_from_settings(
    refresh_token: str,
) -> GoogleOAuthRefreshResult:
    client_id = (settings.google_client_id or "").strip()
    client_secret = (
        settings.google_client_secret.get_secret_value()
        if settings.google_client_secret is not None
        else ""
    )
    if not client_id or not client_secret:
        raise GoogleOAuthRefreshUnavailableError(
            "Google token refresh is not configured"
        )
    return await refresh_google_oauth_token(
        refresh_token,
        client_id=client_id,
        client_secret=client_secret,
    )


@dataclass(frozen=True, slots=True)
class YouTubeDisconnectOutcome:
    provider_revocation: GoogleOAuthRevocationStatus
    channel_links_removed: int


class MeService:
    def __init__(
        self,
        repository: AuthRepository,
        google_token_revoker: Callable[
            [str], Awaitable[GoogleOAuthRevocationResult]
        ]
        | None = None,
        google_token_refresher: Callable[
            [str], Awaitable[GoogleOAuthRefreshResult]
        ]
        | None = None,
    ):
        self.repository = repository
        self.google_token_revoker = google_token_revoker or revoke_google_oauth_token
        self.google_token_refresher = (
            google_token_refresher or _refresh_google_token_from_settings
        )

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

    async def refresh_youtube_channels(self, user: User) -> list[YouTubeChannel]:
        locked_user = await self.repository.get_user_by_id_for_update(user.id)
        if locked_user is None:  # pragma: no cover - authenticated row cannot vanish normally
            raise RuntimeError("Authenticated user no longer exists")
        oauth = await self.repository.get_oauth_account_for_user_for_update(
            user_id=locked_user.id,
            provider="google",
        )
        if oauth is None:
            raise YouTubeReauthRequiredError("youtube_reauth_required")
        if not has_google_youtube_read_scope(oauth.scope):
            raise YouTubeReauthRequiredError("youtube_reauth_required")
        credentials = self.repository.get_oauth_credential_values(oauth)
        if not credentials.access_token:
            raise YouTubeReauthRequiredError("youtube_reauth_required")

        now_epoch = int(datetime.now(UTC).timestamp())
        access_token = credentials.access_token
        refreshed = False
        if oauth.expires_at is not None and oauth.expires_at <= now_epoch + 60:
            access_token = await self._refresh_google_access_token(
                user=locked_user,
                oauth=oauth,
                refresh_token=credentials.refresh_token,
            )
            refreshed = True

        try:
            channels = await fetch_user_youtube_channels(access_token)
        except YouTubeReauthRequiredError:
            if credentials.refresh_token and not refreshed:
                access_token = await self._refresh_google_access_token(
                    user=locked_user,
                    oauth=oauth,
                    refresh_token=credentials.refresh_token,
                )
                try:
                    channels = await fetch_user_youtube_channels(access_token)
                except YouTubeReauthRequiredError as exc:
                    await self._invalidate_youtube_authority(
                        user=locked_user,
                        oauth=oauth,
                        action="youtube_credentials_invalidated",
                        provider_revocation_status="already_invalid",
                    )
                    await self.repository.commit()
                    raise YouTubeReauthRequiredError(
                        "youtube_reauth_required"
                    ) from exc
                except YouTubeAPIError:
                    # Google may rotate a refresh token. Preserve the new pair
                    # even when the subsequent YouTube read is temporarily
                    # unavailable; channel links remain untouched.
                    await self.repository.commit()
                    raise
            else:
                await self._invalidate_youtube_authority(
                    user=locked_user,
                    oauth=oauth,
                    action="youtube_credentials_invalidated",
                    provider_revocation_status="already_invalid",
                )
                await self.repository.commit()
                raise
        except YouTubeAPIError:
            if refreshed:
                # As above, a rotated refresh token must survive a transient
                # downstream outage. No channel mutation has happened yet.
                await self.repository.commit()
            raise

        await self.repository.delete_user_youtube_channel_links(
            user_id=locked_user.id
        )
        for item in channels:
            channel_row = await self.repository.upsert_youtube_channel(
                channel_id=item.channel_id,
                title=item.title,
                thumbnail_url=item.thumbnail_url,
            )
            await self.repository.ensure_user_youtube_channel_link(
                user_id=locked_user.id,
                youtube_channel_id=channel_row.id,
            )

        # Keep display name useful for creator-facing surfaces when user signed in via Google.
        if not locked_user.display_name and channels:
            locked_user.display_name = channels[0].title

        await self.repository.commit()
        logger.info(
            "youtube_channels_refreshed",
            extra={
                "user_id": str(locked_user.id),
                "channel_count": len(channels),
            },
        )
        return await self.repository.list_user_youtube_channels(user_id=locked_user.id)

    async def _refresh_google_access_token(
        self,
        *,
        user: User,
        oauth: OAuthAccount,
        refresh_token: str | None,
    ) -> str:
        if not refresh_token:
            await self._invalidate_youtube_authority(
                user=user,
                oauth=oauth,
                action="youtube_credentials_invalidated",
                provider_revocation_status="already_invalid",
            )
            await self.repository.commit()
            raise YouTubeReauthRequiredError("youtube_reauth_required")
        try:
            refreshed = await self.google_token_refresher(refresh_token)
        except GoogleOAuthRefreshRejectedError as exc:
            await self._invalidate_youtube_authority(
                user=user,
                oauth=oauth,
                action="youtube_credentials_invalidated",
                provider_revocation_status="already_invalid",
            )
            await self.repository.commit()
            raise YouTubeReauthRequiredError("youtube_reauth_required") from exc
        except GoogleOAuthRefreshUnavailableError as exc:
            raise YouTubeAPIError(
                "YouTube authorization provider is temporarily unavailable"
            ) from exc

        await self.repository.upsert_oauth_account(
            user_id=user.id,
            provider="google",
            provider_account_id=oauth.provider_account_id,
            access_token=refreshed.access_token,
            refresh_token=refreshed.refresh_token,
            expires_at=refreshed.expires_at,
            scope=GOOGLE_YOUTUBE_READONLY_SCOPE,
            store_credentials=True,
        )
        return refreshed.access_token

    async def _invalidate_youtube_authority(
        self,
        *,
        user: User,
        oauth: OAuthAccount,
        action: str,
        provider_revocation_status: GoogleOAuthRevocationStatus,
    ) -> int:
        await self.repository.clear_oauth_credentials(oauth)
        channel_links_removed = await self.repository.delete_user_youtube_channel_links(
            user_id=user.id
        )
        if user.avatar_mode == "youtube_channel":
            user.avatar_mode = "generic"
            user.avatar_youtube_channel_id = None
        await self.repository.add_oauth_connection_event(
            user_id=user.id,
            oauth_account_id=oauth.id,
            provider="google",
            action=action,
            provider_revocation_status=provider_revocation_status,
            channel_links_removed=channel_links_removed,
        )
        return channel_links_removed

    async def disconnect_youtube(self, user: User) -> YouTubeDisconnectOutcome:
        """Remove YouTube authority while retaining the verified Google identity link."""

        locked_user = await self.repository.get_user_by_id_for_update(user.id)
        if locked_user is None:  # pragma: no cover - authenticated row cannot vanish normally
            raise RuntimeError("Authenticated user no longer exists")
        oauth = await self.repository.get_oauth_account_for_user_for_update(
            user_id=locked_user.id,
            provider="google",
        )

        provider_revocation: GoogleOAuthRevocationStatus = "not_applicable"
        if oauth is not None:
            token_to_revoke: str | None = None
            try:
                credentials = self.repository.get_oauth_credential_values(oauth)
                token_to_revoke = credentials.refresh_token or credentials.access_token
            except (OAuthCredentialConfigurationError, OAuthCredentialDecryptionError):
                provider_revocation = "unavailable"
                logger.warning(
                    "google_oauth_disconnect_credential_unreadable",
                    extra={"user_id": str(locked_user.id)},
                )

            if token_to_revoke:
                try:
                    provider_revocation = (
                        await self.google_token_revoker(token_to_revoke)
                    ).status
                except Exception:  # pragma: no cover - defensive injected-provider guard
                    provider_revocation = "unavailable"
                    logger.error(
                        "google_oauth_disconnect_revoker_failed",
                        extra={"user_id": str(locked_user.id)},
                    )

        if oauth is not None:
            # Local invalidation is authoritative even when Google is unavailable.
            channel_links_removed = await self._invalidate_youtube_authority(
                user=locked_user,
                oauth=oauth,
                action="youtube_disconnected",
                provider_revocation_status=provider_revocation,
            )
        else:
            channel_links_removed = await self.repository.delete_user_youtube_channel_links(
                user_id=locked_user.id
            )
            if locked_user.avatar_mode == "youtube_channel":
                locked_user.avatar_mode = "generic"
                locked_user.avatar_youtube_channel_id = None
        await self.repository.commit()
        logger.info(
            "google_oauth_youtube_disconnected",
            extra={
                "user_id": str(locked_user.id),
                "provider_revocation_status": provider_revocation,
                "channel_links_removed": channel_links_removed,
            },
        )
        return YouTubeDisconnectOutcome(
            provider_revocation=provider_revocation,
            channel_links_removed=channel_links_removed,
        )

__all__ = [
    "MeService",
    "YouTubeDisconnectOutcome",
    "YouTubeAPIError",
    "YouTubeReauthRequiredError",
]
