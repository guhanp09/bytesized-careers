from __future__ import annotations

import base64
import hashlib
import re
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.account_types import is_admin
from app.core.auth_assurance import has_fresh_strong_auth
from app.core.config import settings
from app.core.security import verify_password
from app.core.strong_auth_secrets import (
    StrongAuthSecretCipher,
    StrongAuthSecretContext,
)
from app.core.totp import (
    generate_totp_secret,
    matching_totp_step,
    totp_provisioning_uri,
)
from app.middleware.request_id import get_request_id
from app.models import (
    AuthRefreshCredential,
    AuthSession,
    OAuthAccount,
    StrongAuthRecoveryCode,
    StrongAuthTotpCredential,
    User,
)
from app.services.audit_service import record_admin_action
from app.services.google_identity import (
    GoogleIdentityVerificationError,
    GoogleIdentityVerifierProtocol,
    VerifiedGoogleIdentity,
)

StrongAuthMethod = Literal["totp", "recovery_code"]

ENROLLMENT_LIFETIME_MINUTES = 10
MAX_FAILED_ATTEMPTS = 5
FAILED_ATTEMPT_LOCK_MINUTES = 15
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_BYTES = 20
RECOVERY_CODE_PATTERN = re.compile(r"^[A-Z2-7]{32}$")


class StrongAuthError(Exception):
    pass


class StrongAuthPermissionError(StrongAuthError):
    pass


class StrongAuthPersistentSessionRequiredError(StrongAuthError):
    pass


class StrongAuthNotConfiguredError(StrongAuthError):
    pass


class StrongAuthAlreadyEnrolledError(StrongAuthError):
    pass


class StrongAuthNotEnrolledError(StrongAuthError):
    pass


class StrongAuthEnrollmentExpiredError(StrongAuthError):
    pass


class StrongAuthPrimaryReauthenticationError(StrongAuthError):
    pass


class StrongAuthInvalidCodeError(StrongAuthError):
    pass


class StrongAuthSessionError(StrongAuthError):
    pass


class StrongAuthLockedError(StrongAuthError):
    def __init__(self, retry_after_seconds: int):
        super().__init__("Strong authentication is temporarily locked")
        self.retry_after_seconds = max(1, retry_after_seconds)


class BaseAccessContext(Protocol):
    user: User
    session_id: UUID | None
    strong_auth_method: str | None
    strong_auth_verified_at: datetime | None
    strong_auth_expires_at: datetime | None
    is_qa_persona: bool


@dataclass(frozen=True)
class StrongAuthStatus:
    required: bool
    enrolled: bool
    enrollment_pending: bool
    enrollment_expires_at: datetime | None
    recovery_codes_remaining: int
    strong_auth_satisfied: bool
    strong_auth_method: str | None
    strong_auth_expires_at: datetime | None


@dataclass(frozen=True)
class StrongAuthEnrollment:
    secret: str = field(repr=False)
    provisioning_uri: str = field(repr=False)
    expires_at: datetime


@dataclass(frozen=True)
class StrongAuthVerification:
    method: StrongAuthMethod
    expires_at: datetime
    recovery_codes_remaining: int


@dataclass(frozen=True)
class StrongAuthRecoveryCodes:
    codes: tuple[str, ...] = field(repr=False)
    expires_at: datetime


def normalize_recovery_code(code: str) -> str | None:
    normalized = re.sub(r"[-\s]", "", code).upper()
    return normalized if RECOVERY_CODE_PATTERN.fullmatch(normalized) else None


def hash_recovery_code(code: str) -> str:
    normalized = normalize_recovery_code(code)
    if normalized is None:
        return ""
    return hashlib.sha256(f"cj.recovery.v1\0{normalized}".encode("ascii")).hexdigest()


def generate_recovery_codes() -> tuple[str, ...]:
    codes: list[str] = []
    while len(codes) < RECOVERY_CODE_COUNT:
        normalized = (
            base64.b32encode(secrets.token_bytes(RECOVERY_CODE_BYTES))
            .decode("ascii")
            .rstrip("=")
        )
        formatted = "-".join(
            normalized[index : index + 4]
            for index in range(0, len(normalized), 4)
        )
        if formatted not in codes:
            codes.append(formatted)
    return tuple(codes)


class StrongAuthService:
    """Own encrypted TOTP enrollment, replay-safe elevation, and recovery."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        cipher: StrongAuthSecretCipher | None,
        google_identity_verifier: GoogleIdentityVerifierProtocol,
    ):
        self.session = session
        self.cipher = cipher
        self.google_identity_verifier = google_identity_verifier

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @staticmethod
    def _require_context(context: BaseAccessContext) -> UUID:
        if context.is_qa_persona or context.session_id is None:
            raise StrongAuthPersistentSessionRequiredError(
                "A durable authenticated session is required"
            )
        return context.session_id

    def _require_cipher(self) -> StrongAuthSecretCipher:
        if self.cipher is None:
            raise StrongAuthNotConfiguredError(
                "Strong authentication is not configured"
            )
        return self.cipher

    async def _locked_admin(self, context: BaseAccessContext) -> User:
        user = (
            await self.session.execute(
                select(User)
                .where(User.id == context.user.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if user is None or user.suspended_at is not None:
            raise StrongAuthSessionError("Authenticated account is unavailable")
        if not is_admin(user):
            raise StrongAuthPermissionError(
                "Administrator authentication is required"
            )
        return user

    async def _credential(
        self,
        *,
        user_id: UUID,
        for_update: bool,
    ) -> StrongAuthTotpCredential | None:
        statement = select(StrongAuthTotpCredential).where(
            StrongAuthTotpCredential.user_id == user_id
        )
        if for_update:
            statement = statement.with_for_update().execution_options(
                populate_existing=True
            )
        return (await self.session.execute(statement)).scalar_one_or_none()

    async def _locked_sessions(
        self,
        *,
        user_id: UUID,
    ) -> list[AuthSession]:
        return list(
            (
                await self.session.execute(
                    select(AuthSession)
                    .where(AuthSession.user_id == user_id)
                    .order_by(AuthSession.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )

    def _current_live_session(
        self,
        sessions: list[AuthSession],
        *,
        session_id: UUID,
        now: datetime,
    ) -> AuthSession:
        current = next((row for row in sessions if row.id == session_id), None)
        if (
            current is None
            or current.revoked_at is not None
            or self._as_utc(current.absolute_expires_at) <= now
        ):
            raise StrongAuthSessionError("Authenticated session is no longer active")
        return current

    async def _revoke_sessions(
        self,
        sessions: list[AuthSession],
        *,
        now: datetime,
        reason: str,
        preserve_session_id: UUID | None = None,
    ) -> int:
        targets = [
            row
            for row in sessions
            if preserve_session_id is None or row.id != preserve_session_id
        ]
        newly_revoked = 0
        for row in targets:
            if row.revoked_at is None:
                row.revoked_at = now
                row.revocation_reason = reason
                newly_revoked += 1
        if targets:
            await self.session.execute(
                update(AuthRefreshCredential)
                .where(
                    AuthRefreshCredential.session_id.in_([row.id for row in targets]),
                    AuthRefreshCredential.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
        return newly_revoked

    @staticmethod
    def _elevate_session(
        auth_session: AuthSession,
        *,
        method: StrongAuthMethod,
        now: datetime,
    ) -> datetime:
        expires_at = min(
            now + timedelta(minutes=settings.admin_strong_auth_max_age_minutes),
            StrongAuthService._as_utc(auth_session.absolute_expires_at),
        )
        if expires_at <= now:
            raise StrongAuthSessionError("Authenticated session is no longer active")
        auth_session.strong_auth_method = method
        auth_session.strong_auth_verified_at = now
        auth_session.strong_auth_expires_at = expires_at
        return expires_at

    @staticmethod
    def _secret_context(
        *,
        user_id: UUID,
        credential_id: UUID,
    ) -> StrongAuthSecretContext:
        return StrongAuthSecretContext(
            user_id=user_id,
            credential_id=credential_id,
        )

    def _decrypt_secret(
        self,
        credential: StrongAuthTotpCredential,
    ) -> str:
        cipher = self._require_cipher()
        return cipher.decrypt(
            credential.secret_ciphertext,
            context=self._secret_context(
                user_id=credential.user_id,
                credential_id=credential.id,
            ),
        )

    @staticmethod
    def _retry_after(locked_until: datetime, *, now: datetime) -> int:
        return max(1, int((StrongAuthService._as_utc(locked_until) - now).total_seconds()))

    def _ensure_not_locked(
        self,
        credential: StrongAuthTotpCredential,
        *,
        now: datetime,
    ) -> None:
        if credential.locked_until is None:
            return
        locked_until = self._as_utc(credential.locked_until)
        if locked_until > now:
            raise StrongAuthLockedError(self._retry_after(locked_until, now=now))
        credential.failed_attempt_count = 0
        credential.locked_until = None

    def _audit(
        self,
        *,
        actor: User,
        action: str,
        after: dict[str, object],
    ) -> None:
        record_admin_action(
            self.session,
            actor=actor,
            action=action,
            target_type="user_security",
            target_id=actor.id,
            after=after,
            request_id=get_request_id(),
        )

    async def _reject_code(
        self,
        *,
        actor: User,
        credential: StrongAuthTotpCredential,
        method: StrongAuthMethod,
        now: datetime,
    ) -> None:
        credential.failed_attempt_count = min(
            MAX_FAILED_ATTEMPTS,
            credential.failed_attempt_count + 1,
        )
        credential.updated_at = now
        newly_locked = credential.failed_attempt_count >= MAX_FAILED_ATTEMPTS
        if newly_locked:
            credential.locked_until = now + timedelta(
                minutes=FAILED_ATTEMPT_LOCK_MINUTES
            )
        self._audit(
            actor=actor,
            action="auth.strong_auth.challenge_failed",
            after={
                "method": method,
                "failed_attempt_count": credential.failed_attempt_count,
                "temporarily_locked": newly_locked,
            },
        )
        await self.session.commit()
        if newly_locked and credential.locked_until is not None:
            raise StrongAuthLockedError(
                self._retry_after(self._as_utc(credential.locked_until), now=now)
            )
        raise StrongAuthInvalidCodeError("Invalid strong-authentication code")

    async def _preverify_google(
        self,
        google_id_token: str | None,
    ) -> VerifiedGoogleIdentity | None:
        if google_id_token is None:
            return None
        try:
            return await self.google_identity_verifier.verify(google_id_token)
        except GoogleIdentityVerificationError as exc:
            raise StrongAuthPrimaryReauthenticationError(
                "Primary reauthentication failed"
            ) from exc

    async def _verify_primary_locked(
        self,
        *,
        user: User,
        password: str | None,
        google_identity: VerifiedGoogleIdentity | None,
    ) -> None:
        if (password is None) == (google_identity is None):
            raise StrongAuthPrimaryReauthenticationError(
                "Exactly one primary credential is required"
            )
        if password is not None:
            if user.password_hash is None or not verify_password(
                password,
                user.password_hash,
            ):
                raise StrongAuthPrimaryReauthenticationError(
                    "Primary reauthentication failed"
                )
            return

        assert google_identity is not None
        account = (
            await self.session.execute(
                select(OAuthAccount).where(
                    OAuthAccount.user_id == user.id,
                    OAuthAccount.provider == "google",
                )
            )
        ).scalar_one_or_none()
        if (
            account is None
            or account.provider_account_id != google_identity.subject
            or user.email.strip().lower() != google_identity.email.strip().lower()
        ):
            raise StrongAuthPrimaryReauthenticationError(
                "Primary reauthentication failed"
            )

    async def _remaining_recovery_codes(self, *, credential_id: UUID) -> int:
        return int(
            (
                await self.session.execute(
                    select(func.count(StrongAuthRecoveryCode.id)).where(
                        StrongAuthRecoveryCode.credential_id == credential_id,
                        StrongAuthRecoveryCode.used_at.is_(None),
                    )
                )
            ).scalar_one()
        )

    def _add_recovery_codes(
        self,
        *,
        credential_id: UUID,
        codes: tuple[str, ...],
    ) -> None:
        for code in codes:
            self.session.add(
                StrongAuthRecoveryCode(
                    id=uuid4(),
                    credential_id=credential_id,
                    code_hash=hash_recovery_code(code),
                )
            )

    async def status(self, context: BaseAccessContext) -> StrongAuthStatus:
        self._require_context(context)
        if not is_admin(context.user):
            raise StrongAuthPermissionError(
                "Administrator authentication is required"
            )
        credential = await self._credential(
            user_id=context.user.id,
            for_update=False,
        )
        now = datetime.now(UTC)
        enrolled = credential is not None and credential.confirmed_at is not None
        pending_expiry = (
            self._as_utc(credential.enrollment_expires_at)
            if credential is not None and credential.enrollment_expires_at is not None
            else None
        )
        pending = bool(
            credential is not None
            and credential.confirmed_at is None
            and pending_expiry is not None
            and pending_expiry > now
        )
        remaining = (
            await self._remaining_recovery_codes(credential_id=credential.id)
            if enrolled and credential is not None
            else 0
        )
        satisfied = has_fresh_strong_auth(
            method=context.strong_auth_method,
            verified_at=context.strong_auth_verified_at,
            expires_at=context.strong_auth_expires_at,
            max_age_minutes=settings.admin_strong_auth_max_age_minutes,
            now=now,
        )
        return StrongAuthStatus(
            required=settings.admin_strong_auth_required,
            enrolled=enrolled,
            enrollment_pending=pending,
            enrollment_expires_at=pending_expiry if pending else None,
            recovery_codes_remaining=remaining,
            strong_auth_satisfied=satisfied,
            strong_auth_method=context.strong_auth_method if satisfied else None,
            strong_auth_expires_at=context.strong_auth_expires_at if satisfied else None,
        )

    async def start_enrollment(
        self,
        context: BaseAccessContext,
        *,
        password: str | None,
        google_id_token: str | None,
    ) -> StrongAuthEnrollment:
        session_id = self._require_context(context)
        cipher = self._require_cipher()
        google_identity = await self._preverify_google(google_id_token)
        user = await self._locked_admin(context)
        await self._verify_primary_locked(
            user=user,
            password=password,
            google_identity=google_identity,
        )
        credential = await self._credential(user_id=user.id, for_update=True)
        if credential is not None and credential.confirmed_at is not None:
            raise StrongAuthAlreadyEnrolledError(
                "Strong authentication is already enrolled"
            )

        now = datetime.now(UTC)
        sessions = await self._locked_sessions(user_id=user.id)
        self._current_live_session(
            sessions,
            session_id=session_id,
            now=now,
        )
        expires_at = now + timedelta(minutes=ENROLLMENT_LIFETIME_MINUTES)
        secret = generate_totp_secret()
        if credential is None:
            credential = StrongAuthTotpCredential(
                id=uuid4(),
                user_id=user.id,
                secret_ciphertext="pending",
                enrollment_expires_at=expires_at,
                failed_attempt_count=0,
                created_at=now,
                updated_at=now,
            )
            self.session.add(credential)
        credential.secret_ciphertext = cipher.encrypt(
            secret,
            context=self._secret_context(
                user_id=user.id,
                credential_id=credential.id,
            ),
        )
        credential.enrollment_expires_at = expires_at
        credential.last_used_step = None
        credential.failed_attempt_count = 0
        credential.locked_until = None
        credential.updated_at = now
        self._audit(
            actor=user,
            action="auth.strong_auth.enrollment_started",
            after={"expires_at": expires_at.isoformat()},
        )
        await self.session.commit()
        return StrongAuthEnrollment(
            secret=secret,
            provisioning_uri=totp_provisioning_uri(
                secret=secret,
                account_name=user.email,
            ),
            expires_at=expires_at,
        )

    async def confirm_enrollment(
        self,
        context: BaseAccessContext,
        *,
        code: str,
    ) -> tuple[StrongAuthVerification, tuple[str, ...]]:
        session_id = self._require_context(context)
        user = await self._locked_admin(context)
        credential = await self._credential(user_id=user.id, for_update=True)
        if credential is None or credential.confirmed_at is not None:
            raise StrongAuthNotEnrolledError(
                "No pending strong-authentication enrollment exists"
            )
        now = datetime.now(UTC)
        if (
            credential.enrollment_expires_at is None
            or self._as_utc(credential.enrollment_expires_at) <= now
        ):
            raise StrongAuthEnrollmentExpiredError(
                "Strong-authentication enrollment has expired"
            )
        self._ensure_not_locked(credential, now=now)
        matched_step = matching_totp_step(
            secret=self._decrypt_secret(credential),
            code=code,
            at=now,
        )
        if (
            matched_step is None
            or (
                credential.last_used_step is not None
                and matched_step <= credential.last_used_step
            )
        ):
            await self._reject_code(
                actor=user,
                credential=credential,
                method="totp",
                now=now,
            )
            raise AssertionError("unreachable")

        sessions = await self._locked_sessions(user_id=user.id)
        current = self._current_live_session(
            sessions,
            session_id=session_id,
            now=now,
        )
        credential.confirmed_at = now
        credential.enrollment_expires_at = None
        credential.last_used_step = matched_step
        credential.failed_attempt_count = 0
        credential.locked_until = None
        credential.updated_at = now
        await self.session.execute(
            delete(StrongAuthRecoveryCode).where(
                StrongAuthRecoveryCode.credential_id == credential.id
            )
        )
        recovery_codes = generate_recovery_codes()
        self._add_recovery_codes(
            credential_id=credential.id,
            codes=recovery_codes,
        )
        revoked = await self._revoke_sessions(
            sessions,
            now=now,
            reason="strong_auth_enrolled",
            preserve_session_id=session_id,
        )
        expires_at = self._elevate_session(current, method="totp", now=now)
        self._audit(
            actor=user,
            action="auth.strong_auth.enrollment_confirmed",
            after={
                "recovery_code_count": len(recovery_codes),
                "revoked_other_sessions": revoked,
            },
        )
        await self.session.commit()
        return (
            StrongAuthVerification(
                method="totp",
                expires_at=expires_at,
                recovery_codes_remaining=len(recovery_codes),
            ),
            recovery_codes,
        )

    async def challenge(
        self,
        context: BaseAccessContext,
        *,
        method: StrongAuthMethod,
        code: str,
    ) -> StrongAuthVerification:
        if method not in {"totp", "recovery_code"}:
            raise ValueError("Unsupported strong-authentication method")
        session_id = self._require_context(context)
        user = await self._locked_admin(context)
        credential = await self._credential(user_id=user.id, for_update=True)
        if credential is None or credential.confirmed_at is None:
            raise StrongAuthNotEnrolledError(
                "Strong authentication is not enrolled"
            )
        now = datetime.now(UTC)
        self._ensure_not_locked(credential, now=now)

        recovery_row: StrongAuthRecoveryCode | None = None
        matched_step: int | None = None
        if method == "totp":
            matched_step = matching_totp_step(
                secret=self._decrypt_secret(credential),
                code=code,
                at=now,
            )
            valid = bool(
                matched_step is not None
                and (
                    credential.last_used_step is None
                    or matched_step > credential.last_used_step
                )
            )
        else:
            code_hash = hash_recovery_code(code)
            recovery_row = (
                await self.session.execute(
                    select(StrongAuthRecoveryCode)
                    .where(
                        StrongAuthRecoveryCode.credential_id == credential.id,
                        StrongAuthRecoveryCode.code_hash == code_hash,
                    )
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            valid = bool(recovery_row is not None and recovery_row.used_at is None)

        if not valid:
            await self._reject_code(
                actor=user,
                credential=credential,
                method=method,
                now=now,
            )
            raise AssertionError("unreachable")

        sessions = await self._locked_sessions(user_id=user.id)
        current = self._current_live_session(
            sessions,
            session_id=session_id,
            now=now,
        )
        revoked = 0
        if method == "totp":
            assert matched_step is not None
            credential.last_used_step = matched_step
        else:
            assert recovery_row is not None
            recovery_row.used_at = now
            revoked = await self._revoke_sessions(
                sessions,
                now=now,
                reason="strong_auth_recovery_used",
                preserve_session_id=session_id,
            )
        credential.failed_attempt_count = 0
        credential.locked_until = None
        credential.updated_at = now
        expires_at = self._elevate_session(current, method=method, now=now)
        await self.session.flush()
        remaining = await self._remaining_recovery_codes(
            credential_id=credential.id
        )
        self._audit(
            actor=user,
            action=(
                "auth.strong_auth.recovery_used"
                if method == "recovery_code"
                else "auth.strong_auth.challenge_succeeded"
            ),
            after={
                "method": method,
                "recovery_codes_remaining": remaining,
                "revoked_other_sessions": revoked,
            },
        )
        await self.session.commit()
        return StrongAuthVerification(
            method=method,
            expires_at=expires_at,
            recovery_codes_remaining=remaining,
        )

    async def regenerate_recovery_codes(
        self,
        context: BaseAccessContext,
        *,
        totp_code: str,
    ) -> StrongAuthRecoveryCodes:
        session_id = self._require_context(context)
        user = await self._locked_admin(context)
        credential = await self._credential(user_id=user.id, for_update=True)
        if credential is None or credential.confirmed_at is None:
            raise StrongAuthNotEnrolledError(
                "Strong authentication is not enrolled"
            )
        now = datetime.now(UTC)
        self._ensure_not_locked(credential, now=now)
        matched_step = matching_totp_step(
            secret=self._decrypt_secret(credential),
            code=totp_code,
            at=now,
        )
        if (
            matched_step is None
            or (
                credential.last_used_step is not None
                and matched_step <= credential.last_used_step
            )
        ):
            await self._reject_code(
                actor=user,
                credential=credential,
                method="totp",
                now=now,
            )
            raise AssertionError("unreachable")

        sessions = await self._locked_sessions(user_id=user.id)
        current = self._current_live_session(
            sessions,
            session_id=session_id,
            now=now,
        )
        credential.last_used_step = matched_step
        credential.failed_attempt_count = 0
        credential.locked_until = None
        credential.updated_at = now
        await self.session.execute(
            delete(StrongAuthRecoveryCode).where(
                StrongAuthRecoveryCode.credential_id == credential.id
            )
        )
        codes = generate_recovery_codes()
        self._add_recovery_codes(credential_id=credential.id, codes=codes)
        revoked = await self._revoke_sessions(
            sessions,
            now=now,
            reason="strong_auth_recovery_regenerated",
            preserve_session_id=session_id,
        )
        expires_at = self._elevate_session(current, method="totp", now=now)
        self._audit(
            actor=user,
            action="auth.strong_auth.recovery_regenerated",
            after={
                "recovery_code_count": len(codes),
                "revoked_other_sessions": revoked,
            },
        )
        await self.session.commit()
        return StrongAuthRecoveryCodes(codes=codes, expires_at=expires_at)

    async def disable(
        self,
        context: BaseAccessContext,
        *,
        method: StrongAuthMethod,
        code: str,
        password: str | None,
        google_id_token: str | None,
    ) -> int:
        if method not in {"totp", "recovery_code"}:
            raise ValueError("Unsupported strong-authentication method")
        session_id = self._require_context(context)
        google_identity = await self._preverify_google(google_id_token)
        user = await self._locked_admin(context)
        await self._verify_primary_locked(
            user=user,
            password=password,
            google_identity=google_identity,
        )
        credential = await self._credential(user_id=user.id, for_update=True)
        if credential is None or credential.confirmed_at is None:
            raise StrongAuthNotEnrolledError(
                "Strong authentication is not enrolled"
            )
        now = datetime.now(UTC)
        self._ensure_not_locked(credential, now=now)
        if method == "totp":
            matched_step = matching_totp_step(
                secret=self._decrypt_secret(credential),
                code=code,
                at=now,
            )
            valid = bool(
                matched_step is not None
                and (
                    credential.last_used_step is None
                    or matched_step > credential.last_used_step
                )
            )
        else:
            recovery = (
                await self.session.execute(
                    select(StrongAuthRecoveryCode)
                    .where(
                        StrongAuthRecoveryCode.credential_id == credential.id,
                        StrongAuthRecoveryCode.code_hash == hash_recovery_code(code),
                    )
                    .with_for_update()
                )
            ).scalar_one_or_none()
            valid = bool(recovery is not None and recovery.used_at is None)
        if not valid:
            await self._reject_code(
                actor=user,
                credential=credential,
                method=method,
                now=now,
            )
            raise AssertionError("unreachable")

        sessions = await self._locked_sessions(user_id=user.id)
        self._current_live_session(
            sessions,
            session_id=session_id,
            now=now,
        )
        revoked = await self._revoke_sessions(
            sessions,
            now=now,
            reason="strong_auth_disabled",
        )
        await self.session.delete(credential)
        self._audit(
            actor=user,
            action="auth.strong_auth.disabled",
            after={"verification_method": method, "revoked_sessions": revoked},
        )
        await self.session.commit()
        return revoked


__all__ = [
    "StrongAuthAlreadyEnrolledError",
    "StrongAuthEnrollment",
    "StrongAuthEnrollmentExpiredError",
    "StrongAuthError",
    "StrongAuthInvalidCodeError",
    "StrongAuthLockedError",
    "StrongAuthMethod",
    "StrongAuthNotConfiguredError",
    "StrongAuthNotEnrolledError",
    "StrongAuthPermissionError",
    "StrongAuthPersistentSessionRequiredError",
    "StrongAuthPrimaryReauthenticationError",
    "StrongAuthRecoveryCodes",
    "StrongAuthService",
    "StrongAuthSessionError",
    "StrongAuthStatus",
    "StrongAuthVerification",
    "generate_recovery_codes",
    "hash_recovery_code",
    "normalize_recovery_code",
]
