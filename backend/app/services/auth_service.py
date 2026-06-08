from __future__ import annotations

import logging
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from app.core.account_types import PublicAccountType
from app.core.config import settings
from app.core.onboarding_intent import (
    OnboardingIntent,
    normalize_onboarding_intent,
    onboarding_intent_from_legacy_account_type,
)
from app.core.security import create_access_token, hash_password, verify_password
from app.middleware.request_id import get_request_id
from app.models import User
from app.repositories.auth_repository import AuthRepository
from app.schemas.auth import OAuthGoogleExchangeRequest
from app.services.email_service import capture_dev_auth_email, send_auth_email
from app.services.profile_rules import normalize_username, validate_username_format
from app.services.youtube_service import (
    YouTubeAPIError,
    YouTubeReauthRequiredError,
    fetch_user_youtube_channels,
)

logger = logging.getLogger(__name__)


class EmailAlreadyExistsError(Exception):
    pass


class InvalidVerificationTokenError(Exception):
    pass


class InvalidPasswordResetTokenError(Exception):
    pass


class InvalidCredentialsError(Exception):
    pass


class EmailNotVerifiedError(Exception):
    pass


class InvalidUsernameError(Exception):
    pass


class UsernameAlreadyTakenError(Exception):
    pass


@dataclass(frozen=True)
class RegisterResult:
    created_new_user: bool
    verification_url: str | None


class AuthService:
    def __init__(self, repository: AuthRepository):
        self.repository = repository

    @staticmethod
    def normalize_email(email: str) -> str:
        return email.strip().lower()

    async def _validate_available_username(
        self, username: str, *, current_user_id: str | None = None
    ) -> str:
        normalized = normalize_username(username)
        if not validate_username_format(normalized):
            raise InvalidUsernameError(
                "Username must be 3-20 characters, use lowercase letters/numbers/underscore, and cannot start with underscore."
            )
        existing = await self.repository.get_user_by_username(normalized)
        if existing is not None and str(existing.id) != current_user_id:
            raise UsernameAlreadyTakenError("Username is already taken")
        return normalized

    @staticmethod
    def _to_username_seed(value: str | None) -> str | None:
        if not value:
            return None

        candidate = (
            value.strip()
            .lower()
            .replace("@", "")
        )
        candidate = re.sub(r"[^a-z0-9_]+", "_", candidate)
        candidate = re.sub(r"_+", "_", candidate).strip("_")
        candidate = candidate.lstrip("_")
        if not candidate:
            return None
        if len(candidate) < 3:
            candidate = f"{candidate}_creator"
        return candidate[:20]

    async def _next_available_username(self, base_seed: str) -> str:
        base = self._to_username_seed(base_seed) or "creator"
        if len(base) < 3:
            base = "creator"
        base = base[:20]

        if validate_username_format(base):
            existing = await self.repository.get_user_by_username(base)
            if existing is None:
                return base

        for suffix_index in range(2, 10_000):
            suffix = f"_{suffix_index}"
            trimmed = base[: 20 - len(suffix)].rstrip("_")
            if len(trimmed) < 3:
                trimmed = "creator"[: max(0, 20 - len(suffix))]
            candidate = f"{trimmed}{suffix}"[:20]
            if not validate_username_format(candidate):
                continue
            existing = await self.repository.get_user_by_username(candidate)
            if existing is None:
                return candidate

        raise UsernameAlreadyTakenError("Unable to generate an available username")

    async def _build_google_oauth_username(
        self,
        *,
        email: str,
        payload: OAuthGoogleExchangeRequest,
    ) -> str:
        for raw_candidate in (
            payload.youtube_handle,
            payload.youtube_channel_title,
            payload.display_name,
            email.split("@")[0],
        ):
            seed = self._to_username_seed(raw_candidate)
            if not seed:
                continue
            return await self._next_available_username(seed)
        return await self._next_available_username("creator")

    async def _sync_youtube_channels_for_user(
        self,
        *,
        user: User,
        access_token: str | None,
        scope: str | None,
    ) -> int:
        if not access_token:
            return 0
        # Only call YouTube when OAuth scope includes the channel read scope.
        if not scope or "youtube.readonly" not in scope:
            return 0

        try:
            channels = await fetch_user_youtube_channels(access_token)
        except (YouTubeReauthRequiredError, YouTubeAPIError) as exc:
            logger.warning(
                "google_oauth_youtube_sync_skipped",
                extra={"user_id": str(user.id), "reason": str(exc)},
            )
            return 0
        except Exception as exc:  # pragma: no cover - defensive guard for external API failures
            logger.warning(
                "google_oauth_youtube_sync_failed",
                extra={"user_id": str(user.id), "reason": str(exc)},
            )
            return 0

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

        if not user.display_name and channels:
            user.display_name = channels[0].title

        return len(channels)

    @staticmethod
    def _should_log_verification_link() -> bool:
        # Never emit raw verification tokens in production logs.
        if settings.app_env == "production":
            return False
        return settings.app_env == "development" or settings.email_mode == "log"

    async def create_email_verification_token(self, user: User) -> str:
        token = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
        expires_at = now + timedelta(hours=24)
        await self.repository.invalidate_unused_email_verification_tokens_for_user(
            user_id=user.id,
            used_at=now,
        )
        await self.repository.create_email_verification_token(
            user_id=user.id,
            token=token,
            expires_at=expires_at,
        )
        return token

    def log_email_verification_link(
        self,
        *,
        email: str,
        token: str,
        request_id: str | None = None,
    ) -> str | None:
        encoded_token = quote(token, safe="")
        verification_url = f"{settings.frontend_base_url.rstrip('/')}/auth/verify?token={encoded_token}"
        text_body = (
            "Verify your CreatorJobs account by opening this link:\n\n"
            f"{verification_url}\n\n"
            "If you did not create a CreatorJobs account, you can ignore this email."
        )
        if self._should_log_verification_link():
            capture_dev_auth_email(
                to_email=email,
                subject="Verify your CreatorJobs email",
                text_body=text_body,
                link=verification_url,
                email_type="verification",
            )
            # Plain-text for copy/paste safety in local/dev logs.
            print(f"[auth] Email verification link: {verification_url}", flush=True)
            logger.info(
                "[auth] Verification link emitted for %s (request_id=%s)",
                email,
                request_id or get_request_id() or "n/a",
            )
            return verification_url

        send_auth_email(
            to_email=email,
            subject="Verify your CreatorJobs email",
            text_body=text_body,
        )
        logger.info("[auth] Verification token created for %s", email)
        return None

    def log_password_reset_link(
        self,
        *,
        email: str,
        token: str,
        request_id: str | None = None,
    ) -> str | None:
        encoded_token = quote(token, safe="")
        reset_url = f"{settings.frontend_base_url.rstrip('/')}/auth/reset?token={encoded_token}"
        text_body = (
            "Reset your CreatorJobs password by opening this link:\n\n"
            f"{reset_url}\n\n"
            "This link expires in 1 hour. If you did not request this, you can ignore this email."
        )
        if self._should_log_verification_link():
            capture_dev_auth_email(
                to_email=email,
                subject="Reset your CreatorJobs password",
                text_body=text_body,
                link=reset_url,
                email_type="password_reset",
            )
            print(f"[auth] Password reset link: {reset_url}", flush=True)
            logger.info(
                "[auth] Password reset link emitted for %s (request_id=%s)",
                email,
                request_id or get_request_id() or "n/a",
            )
            return reset_url

        send_auth_email(
            to_email=email,
            subject="Reset your CreatorJobs password",
            text_body=text_body,
        )
        logger.info("[auth] Password reset token created for %s", email)
        return None

    async def register_user(
        self,
        *,
        email: str,
        password: str,
        username: str,
        onboarding_intent: OnboardingIntent = "DECIDE_LATER",
        account_type: PublicAccountType | None = None,
    ) -> RegisterResult:
        normalized_email = self.normalize_email(email)
        existing = await self.repository.get_user_by_email(normalized_email)
        normalized_intent = normalize_onboarding_intent(onboarding_intent)
        if account_type is not None and onboarding_intent == "DECIDE_LATER":
            normalized_intent = onboarding_intent_from_legacy_account_type(account_type)

        if existing is not None:
            if existing.email_verified_at is None:
                if existing.onboarding_intent_selected_at is None:
                    existing.onboarding_intent = normalized_intent
                    existing.onboarding_intent_selected_at = datetime.now(UTC)
                token = await self.create_email_verification_token(existing)
                await self.repository.commit()
                verification_url = self.log_email_verification_link(
                    email=existing.email,
                    token=token,
                    request_id=get_request_id(),
                )
                return RegisterResult(created_new_user=False, verification_url=verification_url)
            raise EmailAlreadyExistsError("Email is already registered")

        normalized_username = await self._validate_available_username(username)
        now = datetime.now(UTC)
        user = await self.repository.create_user(
            email=normalized_email,
            username=normalized_username,
            password_hash=hash_password(password),
            email_verified_at=None,
            account_type="TALENT",
            account_type_selected_at=None,
            onboarding_intent=normalized_intent,
            onboarding_intent_selected_at=now,
        )
        token = await self.create_email_verification_token(user)
        await self.repository.commit()
        verification_url = self.log_email_verification_link(
            email=user.email,
            token=token,
            request_id=get_request_id(),
        )
        return RegisterResult(created_new_user=True, verification_url=verification_url)

    async def resend_verification_for_email(self, *, email: str) -> None:
        normalized_email = self.normalize_email(email)
        user = await self.repository.get_user_by_email(normalized_email)
        if user is None or user.email_verified_at is not None:
            return

        token = await self.create_email_verification_token(user)
        await self.repository.commit()
        self.log_email_verification_link(
            email=user.email,
            token=token,
            request_id=get_request_id(),
        )

    async def request_password_reset_for_email(self, *, email: str) -> str | None:
        normalized_email = self.normalize_email(email)
        user = await self.repository.get_user_by_email(normalized_email)
        if user is None or not user.password_hash:
            return None

        now = datetime.now(UTC)
        token = secrets.token_urlsafe(32)
        expires_at = now + timedelta(hours=1)
        await self.repository.invalidate_unused_password_reset_tokens_for_user(
            user_id=user.id,
            used_at=now,
        )
        await self.repository.create_password_reset_token(
            user_id=user.id,
            token=token,
            expires_at=expires_at,
        )
        await self.repository.commit()
        return self.log_password_reset_link(
            email=user.email,
            token=token,
            request_id=get_request_id(),
        )

    async def reset_password(self, *, token: str, password: str) -> User:
        row = await self.repository.get_password_reset_token(token)
        now = datetime.now(UTC)
        if row is None:
            raise InvalidPasswordResetTokenError("Invalid or expired password reset token")
        expires_at = row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if row.used_at is not None or expires_at <= now:
            raise InvalidPasswordResetTokenError("Invalid or expired password reset token")

        user = await self.repository.get_user_by_id(row.user_id)
        if user is None:
            raise InvalidPasswordResetTokenError("Invalid or expired password reset token")

        user.password_hash = hash_password(password)
        row.used_at = now
        await self.repository.invalidate_unused_password_reset_tokens_for_user(
            user_id=user.id,
            used_at=now,
        )
        row.used_at = now
        await self.repository.commit()
        return user

    async def verify_email_token(self, *, token: str) -> User:
        row = await self.repository.get_email_verification_token(token)
        now = datetime.now(UTC)
        if row is None:
            raise InvalidVerificationTokenError("Invalid or expired verification token")
        expires_at = row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if row.used_at is not None or expires_at <= now:
            raise InvalidVerificationTokenError("Invalid or expired verification token")

        user = await self.repository.get_user_by_id(row.user_id)
        if user is None:
            raise InvalidVerificationTokenError("Invalid verification token")

        user.email_verified_at = user.email_verified_at or now
        row.used_at = now
        await self.repository.commit()
        return user

    async def login_with_password(self, *, email: str, password: str) -> tuple[User, str]:
        normalized_email = self.normalize_email(email)
        user = await self.repository.get_user_by_email(normalized_email)
        if user is None or not user.password_hash:
            raise InvalidCredentialsError("Invalid email or password")
        if not verify_password(password, user.password_hash):
            raise InvalidCredentialsError("Invalid email or password")
        if user.email_verified_at is None:
            raise EmailNotVerifiedError("Email is not verified")

        token = create_access_token(subject=str(user.id))
        return user, token

    async def exchange_google_oauth(self, payload: OAuthGoogleExchangeRequest) -> tuple[User, str]:
        email = self.normalize_email(payload.email)
        user = await self.repository.get_user_by_email(email)
        now = datetime.now(UTC)
        incoming_display_name = (payload.display_name or "").strip() or None
        normalized_username: str | None = None

        if payload.username:
            normalized_username = await self._validate_available_username(
                payload.username,
                current_user_id=str(user.id) if user is not None else None,
            )
        elif user is None or user.username is None:
            normalized_username = await self._build_google_oauth_username(
                email=email,
                payload=payload,
            )

        if user is None:
            user = await self.repository.create_user(
                email=email,
                username=normalized_username,
                display_name=incoming_display_name,
                password_hash=None,
                email_verified_at=now,
            )
        else:
            if user.email_verified_at is None:
                user.email_verified_at = now
            if user.username is None and normalized_username:
                user.username = normalized_username
            if user.display_name is None and incoming_display_name:
                user.display_name = incoming_display_name

        await self.repository.upsert_oauth_account(
            user_id=user.id,
            provider="google",
            provider_account_id=payload.provider_account_id,
            access_token=payload.access_token,
            refresh_token=payload.refresh_token,
            expires_at=payload.expires_at,
            scope=payload.scope,
        )
        synced_channel_count = await self._sync_youtube_channels_for_user(
            user=user,
            access_token=payload.access_token,
            scope=payload.scope,
        )
        await self.repository.commit()
        token = create_access_token(subject=str(user.id))
        logger.info(
            "google_oauth_exchange_complete",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "youtube_channels_synced": synced_channel_count,
            },
        )
        return user, token
