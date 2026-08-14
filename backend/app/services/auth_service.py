from __future__ import annotations

import logging
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote
from uuid import UUID, uuid4

from sqlalchemy.exc import IntegrityError

from app.core.account_types import PublicAccountType
from app.core.config import settings
from app.core.onboarding_intent import (
    OnboardingIntent,
    normalize_onboarding_intent,
    onboarding_intent_from_legacy_account_type,
)
from app.core.security import (
    SESSION_ID_CLAIM,
    SESSION_TOKEN_VERSION_CLAIM,
    TOKEN_ID_CLAIM,
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    get_token_expires_at,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.middleware.request_id import get_request_id
from app.models import AuthRefreshCredential, AuthSession, User
from app.repositories.auth_repository import (
    AuthRepository,
    OAuthAccountCollisionError,
)
from app.schemas.auth import OAuthGoogleExchangeRequest
from app.services.email_service import capture_dev_auth_email, send_auth_email
from app.services.google_identity import GoogleIdentityVerifierProtocol, VerifiedGoogleIdentity
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


class AccountSuspendedError(Exception):
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


@dataclass(frozen=True)
class AuthTokenPair:
    access_token: str
    refresh_token: str
    access_token_expires_at: int | None
    refresh_token_expires_at: int | None


class AuthService:
    def __init__(
        self,
        repository: AuthRepository,
        google_identity_verifier: GoogleIdentityVerifierProtocol,
    ):
        self.repository = repository
        self.google_identity_verifier = google_identity_verifier

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
        display_name: str | None,
    ) -> str:
        for raw_candidate in (
            display_name,
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
        display_name: str | None = None,
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
            display_name=(display_name or "").strip() or None,
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
        # Reset issuance and every session-producing login serialize on the
        # user row. Concurrent reset requests therefore leave only the token
        # from the transaction that committed last usable.
        user = await self.repository.get_user_by_email_for_update(
            normalized_email
        )
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
        candidate = await self.repository.get_password_reset_token(token)
        if candidate is None:
            raise InvalidPasswordResetTokenError("Invalid or expired password reset token")

        # Security events and login issuance share a user-first lock order.
        # Reading the token once supplies its owner; both records are then
        # re-read under locks before any security state changes.
        user = await self.repository.get_user_by_id_for_update(candidate.user_id)
        row = await self.repository.get_password_reset_token_for_update(token)
        now = datetime.now(UTC)
        if row is None or user is None or row.user_id != user.id:
            raise InvalidPasswordResetTokenError("Invalid or expired password reset token")
        expires_at = row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if row.used_at is not None or expires_at <= now:
            raise InvalidPasswordResetTokenError("Invalid or expired password reset token")

        user.password_hash = hash_password(password)
        row.used_at = now
        await self.repository.invalidate_unused_password_reset_tokens_for_user(
            user_id=user.id,
            used_at=now,
        )
        row.used_at = now
        await self.repository.revoke_auth_sessions_for_user(
            user_id=user.id,
            revoked_at=now,
            reason="password_reset",
        )
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

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    def create_token_pair(self, user: User) -> AuthTokenPair:
        """Create the rollback-compatible stateless token pair."""

        subject = str(user.id)
        access_token = create_access_token(subject=subject)
        refresh_token = create_refresh_token(subject=subject)
        return AuthTokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            access_token_expires_at=get_token_expires_at(access_token),
            refresh_token_expires_at=get_token_expires_at(refresh_token),
        )

    async def _create_persistent_token_pair(
        self,
        user: User,
        *,
        authentication_method: str,
        session: AuthSession | None = None,
        previous_credential: AuthRefreshCredential | None = None,
        now: datetime | None = None,
    ) -> AuthTokenPair:
        issued_at = now or datetime.now(UTC)
        if session is None:
            session_id = uuid4()
            absolute_expires_at = issued_at + timedelta(
                minutes=settings.jwt_refresh_token_expires_minutes
            )
            session = await self.repository.create_auth_session(
                session_id=session_id,
                user_id=user.id,
                authentication_method=authentication_method,
                absolute_expires_at=absolute_expires_at,
            )
        else:
            session_id = session.id
            absolute_expires_at = self._as_utc(session.absolute_expires_at)

        if absolute_expires_at <= issued_at:
            raise InvalidCredentialsError("Invalid or expired refresh token")

        credential_id = uuid4()
        refresh_token = create_refresh_token(
            subject=str(user.id),
            expires_at=absolute_expires_at,
            session_id=str(session_id),
            token_id=str(credential_id),
        )
        access_token = create_access_token(
            subject=str(user.id),
            additional_claims={SESSION_ID_CLAIM: str(session_id)},
        )
        replacement = await self.repository.create_auth_refresh_credential(
            credential_id=credential_id,
            session_id=session_id,
            token_hash=hash_refresh_token(refresh_token),
            expires_at=absolute_expires_at,
        )
        if previous_credential is not None:
            previous_credential.used_at = issued_at
            previous_credential.replaced_by_id = replacement.id
            session.last_refreshed_at = issued_at

        return AuthTokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            access_token_expires_at=get_token_expires_at(access_token),
            refresh_token_expires_at=get_token_expires_at(refresh_token),
        )

    async def _issue_login_token_pair(
        self,
        user: User,
        *,
        authentication_method: str,
    ) -> AuthTokenPair:
        if settings.auth_session_mode == "legacy":
            return self.create_token_pair(user)
        return await self._create_persistent_token_pair(
            user,
            authentication_method=authentication_method,
        )

    async def login_with_password(self, *, email: str, password: str) -> tuple[User, AuthTokenPair]:
        normalized_email = self.normalize_email(email)
        # Holding the user lock through credential verification and durable
        # issuance prevents an old-password login from committing a fresh
        # family after password reset or suspension has scanned the families.
        user = await self.repository.get_user_by_email_for_update(
            normalized_email
        )
        if user is None or not user.password_hash:
            raise InvalidCredentialsError("Invalid email or password")
        if not verify_password(password, user.password_hash):
            raise InvalidCredentialsError("Invalid email or password")
        if user.email_verified_at is None:
            raise EmailNotVerifiedError("Email is not verified")
        if user.suspended_at is not None:
            raise AccountSuspendedError("Account suspended")

        tokens = await self._issue_login_token_pair(
            user,
            authentication_method="password",
        )
        if settings.auth_session_mode != "legacy":
            await self.repository.commit()
        return user, tokens

    async def exchange_google_oauth(self, payload: OAuthGoogleExchangeRequest) -> tuple[User, AuthTokenPair]:
        identity = await self.google_identity_verifier.verify(payload.id_token)
        try:
            return await self._exchange_verified_google_oauth(payload=payload, identity=identity)
        except IntegrityError as exc:
            # The read-before-write checks keep ordinary collisions legible, but
            # only the database can arbitrate simultaneous links. Roll back the
            # failed transaction before inspecting the winner.
            await self.repository.rollback()
            email = self.normalize_email(identity.email)
            oauth_account = await self.repository.get_oauth_account_by_provider_subject(
                provider="google",
                provider_account_id=identity.subject,
            )
            email_user = await self.repository.get_user_by_email(email)
            if (
                oauth_account is not None
                and email_user is not None
                and oauth_account.user_id == email_user.id
            ):
                email_user = await self.repository.get_user_by_id_for_update(
                    email_user.id
                )
                if email_user is None:
                    raise OAuthAccountCollisionError(
                        "Google identity linkage is inconsistent"
                    ) from exc
                if email_user.suspended_at is not None:
                    raise AccountSuspendedError("Account suspended") from exc
                logger.info(
                    "google_oauth_concurrent_exchange_converged",
                    extra={"user_id": str(email_user.id)},
                )
                tokens = await self._issue_login_token_pair(
                    email_user,
                    authentication_method="google",
                )
                if settings.auth_session_mode != "legacy":
                    await self.repository.commit()
                return email_user, tokens
            raise OAuthAccountCollisionError(
                "Concurrent Google identity linkage conflict"
            ) from exc

    async def _exchange_verified_google_oauth(
        self,
        *,
        payload: OAuthGoogleExchangeRequest,
        identity: VerifiedGoogleIdentity,
    ) -> tuple[User, AuthTokenPair]:
        email = self.normalize_email(identity.email)
        oauth_account = await self.repository.get_oauth_account_by_provider_subject(
            provider="google",
            provider_account_id=identity.subject,
        )
        email_user = await self.repository.get_user_by_email(email)
        now = datetime.now(UTC)
        incoming_display_name = (identity.display_name or "").strip() or None

        if oauth_account is not None:
            user = await self.repository.get_user_by_id_for_update(
                oauth_account.user_id
            )
            if user is None:
                raise OAuthAccountCollisionError(
                    "Google identity linkage is inconsistent"
                )
            if email_user is not None and email_user.id != user.id:
                raise OAuthAccountCollisionError(
                    "Google identity and verified email resolve to different accounts"
                )
            if user.email != email:
                user.email = email
        else:
            user = email_user
            if user is not None:
                user = await self.repository.get_user_by_id_for_update(user.id)
                if user is None:
                    raise OAuthAccountCollisionError(
                        "Google identity linkage is inconsistent"
                    )
                existing_google_account = await self.repository.get_oauth_account_for_user(
                    user_id=user.id,
                    provider="google",
                )
                if (
                    existing_google_account is not None
                    and existing_google_account.provider_account_id != identity.subject
                ):
                    raise OAuthAccountCollisionError(
                        "A different Google identity is already linked to this account"
                    )

        if user is not None and user.suspended_at is not None:
            raise AccountSuspendedError("Account suspended")

        normalized_username: str | None = None
        if user is None or user.username is None:
            normalized_username = await self._build_google_oauth_username(
                email=email,
                display_name=incoming_display_name,
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
            provider_account_id=identity.subject,
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
        tokens = await self._issue_login_token_pair(
            user,
            authentication_method="google",
        )
        await self.repository.commit()
        logger.info(
            "google_oauth_exchange_complete",
            extra={
                "user_id": str(user.id),
                "email": user.email,
                "youtube_channels_synced": synced_channel_count,
            },
        )
        return user, tokens

    @staticmethod
    def _decode_refresh_identity(
        refresh_token: str,
    ) -> tuple[UUID, UUID | None, UUID | None]:
        """Verify a refresh JWT and return its user/session/credential identity."""

        try:
            payload = decode_refresh_token(refresh_token)
        except TokenError as exc:
            raise InvalidCredentialsError("Invalid or expired refresh token") from exc

        subject = payload.get("sub")
        if not isinstance(subject, str):
            raise InvalidCredentialsError("Invalid refresh token subject")
        try:
            user_id = UUID(subject)
        except ValueError as exc:
            raise InvalidCredentialsError("Invalid refresh token subject") from exc

        session_claim = payload.get(SESSION_ID_CLAIM)
        credential_claim = payload.get(TOKEN_ID_CLAIM)
        token_version = payload.get(SESSION_TOKEN_VERSION_CLAIM)
        has_persistent_claims = session_claim is not None or credential_claim is not None
        if not has_persistent_claims:
            return user_id, None, None
        if (
            not isinstance(session_claim, str)
            or not isinstance(credential_claim, str)
            or type(token_version) is not int
            or token_version != 1
        ):
            raise InvalidCredentialsError("Invalid or expired refresh token")
        try:
            return user_id, UUID(session_claim), UUID(credential_claim)
        except ValueError as exc:
            raise InvalidCredentialsError("Invalid or expired refresh token") from exc

    async def refresh_backend_session(self, refresh_token: str) -> tuple[User, AuthTokenPair]:
        user_id, session_id, credential_id = self._decode_refresh_identity(refresh_token)

        if session_id is None and settings.auth_session_mode == "legacy":
            user = await self.repository.get_user_by_id(user_id)
            if user is None:
                raise InvalidCredentialsError("Invalid refresh token subject")
            if user.suspended_at is not None:
                raise AccountSuspendedError("Account suspended")
            return user, self.create_token_pair(user)

        if session_id is None:
            if settings.auth_session_mode != "migration":
                raise InvalidCredentialsError("Invalid or expired refresh token")
            user = await self.repository.get_user_by_id(user_id)
            if user is None:
                raise InvalidCredentialsError("Invalid refresh token subject")
            if user.suspended_at is not None:
                raise AccountSuspendedError("Account suspended")
            tokens = await self._create_persistent_token_pair(
                user,
                authentication_method="legacy_refresh_migration",
            )
            await self.repository.commit()
            return user, tokens

        # Every session mutation locks the family before any credential row.
        # This is the shared ordering used by refresh and both logout paths.
        session = await self.repository.get_auth_session_for_update(session_id=session_id)
        credential = await self.repository.get_auth_refresh_credential_for_update(
            token_hash=hash_refresh_token(refresh_token),
        )
        if (
            session is None
            or credential is None
            or credential.id != credential_id
            or credential.session_id != session_id
            or session.user_id != user_id
        ):
            await self.repository.rollback()
            raise InvalidCredentialsError("Invalid or expired refresh token")

        now = datetime.now(UTC)
        if session.revoked_at is not None or credential.revoked_at is not None:
            await self.repository.rollback()
            raise InvalidCredentialsError("Invalid or expired refresh token")
        if (
            self._as_utc(session.absolute_expires_at) <= now
            or self._as_utc(credential.expires_at) <= now
        ):
            await self.repository.revoke_auth_session(
                session,
                revoked_at=now,
                reason="expired",
            )
            await self.repository.commit()
            raise InvalidCredentialsError("Invalid or expired refresh token")
        if credential.used_at is not None:
            used_at = self._as_utc(credential.used_at)
            if (now - used_at).total_seconds() > settings.refresh_reuse_grace_seconds:
                await self.repository.revoke_auth_session(
                    session,
                    revoked_at=now,
                    reason="refresh_reuse",
                    compromise_detected=True,
                )
                await self.repository.commit()
                logger.warning(
                    "auth_refresh_reuse_detected",
                    extra={"user_id": str(user_id), "session_id": str(session_id)},
                )
            else:
                await self.repository.rollback()
            raise InvalidCredentialsError("Invalid or expired refresh token")

        user = await self.repository.get_user_by_id(user_id)
        if user is None:
            await self.repository.revoke_auth_session(
                session,
                revoked_at=now,
                reason="user_missing",
            )
            await self.repository.commit()
            raise InvalidCredentialsError("Invalid refresh token subject")
        if user.suspended_at is not None:
            await self.repository.revoke_auth_session(
                session,
                revoked_at=now,
                reason="account_suspended",
            )
            await self.repository.commit()
            raise AccountSuspendedError("Account suspended")

        tokens = await self._create_persistent_token_pair(
            user,
            authentication_method=session.authentication_method,
            session=session,
            previous_credential=credential,
            now=now,
        )
        await self.repository.commit()
        return user, tokens

    async def revoke_session_from_refresh_token(self, refresh_token: str) -> int:
        """Revoke the family proven by a server-held refresh credential.

        Used by NextAuth's server-side sign-out event so logout remains
        effective even after the short-lived access token has expired. Legacy
        stateless refresh credentials have no durable family to revoke.
        """

        user_id, session_id, credential_id = self._decode_refresh_identity(refresh_token)
        if session_id is None:
            if settings.auth_session_mode == "persistent":
                raise InvalidCredentialsError("Invalid or expired refresh token")
            user = await self.repository.get_user_by_id(user_id)
            if user is None:
                raise InvalidCredentialsError("Invalid refresh token subject")
            return 0

        session = await self.repository.get_auth_session_for_update(session_id=session_id)
        credential = await self.repository.get_auth_refresh_credential_for_update(
            token_hash=hash_refresh_token(refresh_token),
        )
        if (
            session is None
            or credential is None
            or credential.id != credential_id
            or credential.session_id != session_id
            or session.user_id != user_id
        ):
            await self.repository.rollback()
            raise InvalidCredentialsError("Invalid or expired refresh token")

        was_active = session.revoked_at is None
        await self.repository.revoke_auth_session(
            session,
            revoked_at=datetime.now(UTC),
            reason="logout",
        )
        await self.repository.commit()
        return int(was_active)

    async def revoke_current_session(
        self,
        *,
        user_id: UUID,
        session_id: UUID | None,
    ) -> int:
        """Revoke the durable session bound to an authenticated access token."""

        if session_id is None:
            # A migration/legacy access JWT is still stateless and cannot be
            # selectively revoked. Its production lifetime is capped at one
            # hour while the rollout is in migration mode.
            return 0

        session = await self.repository.get_auth_session_for_update(session_id=session_id)
        if session is None or session.user_id != user_id:
            await self.repository.rollback()
            raise InvalidCredentialsError("Invalid authentication credentials")
        was_active = session.revoked_at is None
        await self.repository.revoke_auth_session(
            session,
            revoked_at=datetime.now(UTC),
            reason="logout",
        )
        await self.repository.commit()
        return int(was_active)

    async def revoke_all_sessions(self, *, user_id: UUID) -> int:
        """Revoke every durable login family owned by one authenticated user."""

        count = await self.repository.revoke_auth_sessions_for_user(
            user_id=user_id,
            revoked_at=datetime.now(UTC),
            reason="logout_all",
        )
        await self.repository.commit()
        return count
