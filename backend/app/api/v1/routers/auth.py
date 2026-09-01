from __future__ import annotations

import logging
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    BaseAuthenticatedAccessDependency,
    bearer_scheme,
    get_auth_service,
    get_db,
    get_strong_auth_service,
    resolve_access_token_context,
)
from app.core.config import settings
from app.core.oauth_scopes import has_google_youtube_read_scope
from app.core.rate_limit import (
    AUTH_EMAIL_LIMIT,
    AUTH_LOGIN_LIMIT,
    AUTH_REFRESH_LIMIT,
    AUTH_REGISTER_LIMIT,
    AUTH_VERIFY_LIMIT,
    STRONG_AUTH_CHALLENGE_LIMIT,
    STRONG_AUTH_ENROLL_LIMIT,
    STRONG_AUTH_FACTOR_CHANGE_LIMIT,
    rate_limit,
)
from app.core.strong_auth_secrets import (
    StrongAuthSecretDecryptionError,
    StrongAuthSecretEncryptionError,
)
from app.repositories.auth_repository import OAuthAccountCollisionError
from app.schemas import (
    AuthStatusResponse,
    AuthUserRead,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    OAuthGoogleExchangeRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    PasswordResetResponse,
    RefreshTokenRequest,
    RegisterRequest,
    ResendVerificationRequest,
    ResendVerificationResponse,
    SessionRevocationResponse,
    StrongAuthCodeRequest,
    StrongAuthDisableRequest,
    StrongAuthDisableResponse,
    StrongAuthEnrollmentConfirmationResponse,
    StrongAuthEnrollmentResponse,
    StrongAuthEnrollmentStartRequest,
    StrongAuthRecoveryCodesResponse,
    StrongAuthStatusResponse,
    StrongAuthTotpCodeRequest,
    StrongAuthVerificationResponse,
    VerifyEmailRequest,
)
from app.services.auth_service import (
    AccountSuspendedError,
    AuthService,
    EmailAlreadyExistsError,
    EmailNotVerifiedError,
    GoogleOAuthAuthorizationError,
    GoogleOAuthAuthorizationProviderUnavailableError,
    InvalidCredentialsError,
    InvalidPasswordResetTokenError,
    InvalidUsernameError,
    InvalidVerificationTokenError,
    UsernameAlreadyTakenError,
)
from app.services.beta_invitation_service import InvitationError
from app.services.google_identity import (
    GoogleIdentityConfigurationError,
    GoogleIdentityProviderUnavailableError,
    GoogleIdentityVerificationError,
)
from app.services.strong_auth_service import (
    StrongAuthAlreadyEnrolledError,
    StrongAuthEnrollmentExpiredError,
    StrongAuthError,
    StrongAuthInvalidCodeError,
    StrongAuthLockedError,
    StrongAuthNotConfiguredError,
    StrongAuthNotEnrolledError,
    StrongAuthPermissionError,
    StrongAuthPersistentSessionRequiredError,
    StrongAuthPrimaryReauthenticationError,
    StrongAuthService,
    StrongAuthSessionError,
)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def _prevent_sensitive_response_caching(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _login_response(user, tokens) -> LoginResponse:
    return LoginResponse(
        access_token=tokens.access_token,
        token_type="bearer",
        refresh_token=tokens.refresh_token,
        access_token_expires_at=tokens.access_token_expires_at,
        refresh_token_expires_at=tokens.refresh_token_expires_at,
        user=AuthUserRead.model_validate(user),
    )


def _strong_auth_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, StrongAuthLockedError):
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed strong-authentication attempts. Try again later.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )
    if isinstance(exc, StrongAuthEnrollmentExpiredError):
        return HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Strong-authentication enrollment expired. Start again.",
        )
    if isinstance(
        exc,
        StrongAuthAlreadyEnrolledError | StrongAuthNotEnrolledError,
    ):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, StrongAuthPersistentSessionRequiredError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A durable authenticated session is required",
        )
    if isinstance(exc, StrongAuthSessionError):
        return HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated session is no longer active",
        )
    if isinstance(
        exc,
        StrongAuthInvalidCodeError
        | StrongAuthPrimaryReauthenticationError
        | StrongAuthPermissionError,
    ):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Strong authentication failed"
                if not isinstance(exc, StrongAuthPermissionError)
                else str(exc)
            ),
            headers={
                "WWW-Authenticate": (
                    'Bearer error="insufficient_user_authentication"'
                )
            },
        )
    if isinstance(
        exc,
        StrongAuthNotConfiguredError
        | StrongAuthSecretEncryptionError
        | StrongAuthSecretDecryptionError
        | GoogleIdentityConfigurationError
        | GoogleIdentityProviderUnavailableError,
    ):
        logger.error(
            "strong_auth_unavailable",
            extra={"reason_type": type(exc).__name__},
        )
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Strong authentication is temporarily unavailable",
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Strong authentication failed",
    )


@router.post(
    "/register",
    response_model=AuthStatusResponse,
    summary="Register with email and password",
)
async def register(
    payload: RegisterRequest,
    _limit: None = rate_limit(AUTH_REGISTER_LIMIT),
    service: AuthService = Depends(get_auth_service),
) -> AuthStatusResponse:
    try:
        result = await service.register_user(
            email=payload.email,
            password=payload.password,
            username=payload.username,
            display_name=payload.display_name,
            onboarding_intent=payload.onboarding_intent,
            account_type=payload.account_type,
            invitation_token=payload.invitation_token,
        )
    except InvitationError as exc:
        # 403 rather than 400: the request is well-formed, the caller is simply
        # not admitted to the closed beta yet.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except EmailAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except InvalidUsernameError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except UsernameAlreadyTakenError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    if result.created_new_user:
        return AuthStatusResponse(
            status="ok",
            message="Account created. Verify your email before logging in.",
            verification_url=result.verification_url,
        )

    return AuthStatusResponse(
        status="ok",
        message="Account exists but isn't verified. We resent a verification link.",
        verification_url=result.verification_url,
    )


@router.post(
    "/verify-email",
    response_model=AuthStatusResponse,
    summary="Verify email with token",
)
async def verify_email(
    payload: VerifyEmailRequest,
    _limit: None = rate_limit(AUTH_VERIFY_LIMIT),
    service: AuthService = Depends(get_auth_service),
) -> AuthStatusResponse:
    try:
        await service.verify_email_token(token=payload.token)
    except InvalidVerificationTokenError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AuthStatusResponse(status="ok")


@router.post(
    "/resend-verification",
    response_model=ResendVerificationResponse,
    summary="Resend verification email",
    description="Always returns a generic success response to avoid account enumeration.",
)
async def resend_verification(
    payload: ResendVerificationRequest,
    _limit: None = rate_limit(AUTH_EMAIL_LIMIT),
    service: AuthService = Depends(get_auth_service),
) -> ResendVerificationResponse:
    await service.resend_verification_for_email(email=payload.email)
    return ResendVerificationResponse(
        ok=True,
        message="If an account exists for this email, we sent a verification link.",
    )


@router.post(
    "/password-reset/request",
    response_model=PasswordResetResponse,
    summary="Request a password reset email",
    description="Always returns a generic success response to avoid account enumeration.",
)
async def request_password_reset(
    payload: PasswordResetRequest,
    _limit: None = rate_limit(AUTH_EMAIL_LIMIT),
    service: AuthService = Depends(get_auth_service),
) -> PasswordResetResponse:
    reset_url = await service.request_password_reset_for_email(email=payload.email)
    return PasswordResetResponse(
        ok=True,
        message="If an account exists for this email, we sent a password reset link.",
        reset_url=reset_url,
    )


@router.post(
    "/password-reset/confirm",
    response_model=PasswordResetResponse,
    summary="Confirm a password reset token",
)
async def confirm_password_reset(
    payload: PasswordResetConfirmRequest,
    _limit: None = rate_limit(AUTH_EMAIL_LIMIT),
    service: AuthService = Depends(get_auth_service),
) -> PasswordResetResponse:
    try:
        await service.reset_password(token=payload.token, password=payload.password)
    except InvalidPasswordResetTokenError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PasswordResetResponse(ok=True, message="Password updated. You can log in now.")


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Login with email and password",
)
async def login(
    payload: LoginRequest,
    _limit: None = rate_limit(AUTH_LOGIN_LIMIT),
    service: AuthService = Depends(get_auth_service),
) -> LoginResponse:
    try:
        user, tokens = await service.login_with_password(email=payload.email, password=payload.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except EmailNotVerifiedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except AccountSuspendedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    return _login_response(user, tokens)


@router.post(
    "/refresh",
    response_model=LoginResponse,
    summary="Refresh backend session token",
)
async def refresh_backend_session(
    payload: RefreshTokenRequest,
    _limit: None = rate_limit(AUTH_REFRESH_LIMIT),
    service: AuthService = Depends(get_auth_service),
) -> LoginResponse:
    try:
        user, tokens = await service.refresh_backend_session(payload.refresh_token)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except AccountSuspendedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    return _login_response(user, tokens)


@router.post(
    "/logout",
    response_model=SessionRevocationResponse,
    summary="Revoke the current backend session",
)
async def logout(
    payload: LogoutRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db),
    service: AuthService = Depends(get_auth_service),
) -> SessionRevocationResponse:
    """Revoke current durable state without trusting a caller-selected session ID."""

    try:
        if payload.refresh_token is not None:
            revoked = await service.revoke_session_from_refresh_token(
                payload.refresh_token
            )
        else:
            if credentials is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Missing session credential",
                )
            context = await resolve_access_token_context(
                session=session,
                token=credentials.credentials,
                enforce_admin_strong_auth=False,
            )
            if context is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication credentials",
                )
            if context.is_qa_persona:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="QA persona sessions cannot manage account sessions",
                )
            revoked = await service.revoke_current_session(
                user_id=context.user.id,
                session_id=context.session_id,
            )
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return SessionRevocationResponse(revoked_sessions=revoked)


@router.post(
    "/logout-all",
    response_model=SessionRevocationResponse,
    summary="Revoke every backend session for the current account",
)
async def logout_all(
    context: BaseAuthenticatedAccessDependency,
    service: AuthService = Depends(get_auth_service),
) -> SessionRevocationResponse:
    if context.is_qa_persona:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="QA persona sessions cannot manage account sessions",
        )
    revoked = await service.revoke_all_sessions(user_id=context.user.id)
    return SessionRevocationResponse(revoked_sessions=revoked)


@router.get(
    "/strong-auth/status",
    response_model=StrongAuthStatusResponse,
    summary="Read administrator strong-authentication state",
)
async def strong_auth_status(
    response: Response,
    context: BaseAuthenticatedAccessDependency,
    service: StrongAuthService = Depends(get_strong_auth_service),
) -> StrongAuthStatusResponse:
    _prevent_sensitive_response_caching(response)
    try:
        result = await service.status(context)
    except StrongAuthError as exc:
        raise _strong_auth_http_error(exc) from exc
    available_methods = []
    if result.enrolled:
        available_methods.append("totp")
        if result.recovery_codes_remaining > 0:
            available_methods.append("recovery_code")
    return StrongAuthStatusResponse(
        required=result.required,
        enrolled=result.enrolled,
        enrollment_pending=result.enrollment_pending,
        enrollment_expires_at=result.enrollment_expires_at,
        recovery_codes_remaining=result.recovery_codes_remaining,
        strong_auth_satisfied=result.strong_auth_satisfied,
        strong_auth_method=result.strong_auth_method,
        strong_auth_expires_at=result.strong_auth_expires_at,
        available_methods=available_methods,
    )


@router.post(
    "/strong-auth/totp/enroll",
    response_model=StrongAuthEnrollmentResponse,
    summary="Start a primary-credential-bound TOTP enrollment",
)
async def strong_auth_totp_enroll(
    payload: StrongAuthEnrollmentStartRequest,
    response: Response,
    context: BaseAuthenticatedAccessDependency,
    _limit: None = rate_limit(STRONG_AUTH_ENROLL_LIMIT),
    service: StrongAuthService = Depends(get_strong_auth_service),
) -> StrongAuthEnrollmentResponse:
    _prevent_sensitive_response_caching(response)
    try:
        result = await service.start_enrollment(
            context,
            password=payload.primary.password,
            google_id_token=payload.primary.google_id_token,
        )
    except (
        StrongAuthError,
        StrongAuthSecretEncryptionError,
        GoogleIdentityConfigurationError,
        GoogleIdentityProviderUnavailableError,
    ) as exc:
        raise _strong_auth_http_error(exc) from exc
    return StrongAuthEnrollmentResponse(
        secret=result.secret,
        provisioning_uri=result.provisioning_uri,
        expires_at=result.expires_at,
    )


@router.post(
    "/strong-auth/totp/confirm",
    response_model=StrongAuthEnrollmentConfirmationResponse,
    summary="Confirm TOTP enrollment and return one-time recovery codes",
)
async def strong_auth_totp_confirm(
    payload: StrongAuthTotpCodeRequest,
    response: Response,
    context: BaseAuthenticatedAccessDependency,
    _limit: None = rate_limit(STRONG_AUTH_CHALLENGE_LIMIT),
    service: StrongAuthService = Depends(get_strong_auth_service),
) -> StrongAuthEnrollmentConfirmationResponse:
    _prevent_sensitive_response_caching(response)
    try:
        result, recovery_codes = await service.confirm_enrollment(
            context,
            code=payload.code,
        )
    except (
        StrongAuthError,
        StrongAuthSecretDecryptionError,
    ) as exc:
        raise _strong_auth_http_error(exc) from exc
    return StrongAuthEnrollmentConfirmationResponse(
        method=result.method,
        expires_at=result.expires_at,
        recovery_codes_remaining=result.recovery_codes_remaining,
        recovery_codes=list(recovery_codes),
    )


@router.post(
    "/strong-auth/challenge",
    response_model=StrongAuthVerificationResponse,
    summary="Elevate the current durable session with TOTP or a recovery code",
)
async def strong_auth_challenge(
    payload: StrongAuthCodeRequest,
    response: Response,
    context: BaseAuthenticatedAccessDependency,
    _limit: None = rate_limit(STRONG_AUTH_CHALLENGE_LIMIT),
    service: StrongAuthService = Depends(get_strong_auth_service),
) -> StrongAuthVerificationResponse:
    _prevent_sensitive_response_caching(response)
    try:
        result = await service.challenge(
            context,
            method=payload.method,
            code=payload.code,
        )
    except (
        StrongAuthError,
        StrongAuthSecretDecryptionError,
    ) as exc:
        raise _strong_auth_http_error(exc) from exc
    return StrongAuthVerificationResponse(
        method=result.method,
        expires_at=result.expires_at,
        recovery_codes_remaining=result.recovery_codes_remaining,
    )


@router.post(
    "/strong-auth/recovery-codes/regenerate",
    response_model=StrongAuthRecoveryCodesResponse,
    summary="Replace every recovery code after a fresh TOTP proof",
)
async def strong_auth_recovery_codes_regenerate(
    payload: StrongAuthTotpCodeRequest,
    response: Response,
    context: BaseAuthenticatedAccessDependency,
    _limit: None = rate_limit(STRONG_AUTH_FACTOR_CHANGE_LIMIT),
    service: StrongAuthService = Depends(get_strong_auth_service),
) -> StrongAuthRecoveryCodesResponse:
    _prevent_sensitive_response_caching(response)
    try:
        result = await service.regenerate_recovery_codes(
            context,
            totp_code=payload.code,
        )
    except (
        StrongAuthError,
        StrongAuthSecretDecryptionError,
    ) as exc:
        raise _strong_auth_http_error(exc) from exc
    return StrongAuthRecoveryCodesResponse(
        recovery_codes=list(result.codes),
        expires_at=result.expires_at,
    )


@router.post(
    "/strong-auth/disable",
    response_model=StrongAuthDisableResponse,
    summary="Disable the factor after primary and strong reauthentication",
)
async def strong_auth_disable(
    payload: StrongAuthDisableRequest,
    response: Response,
    context: BaseAuthenticatedAccessDependency,
    _limit: None = rate_limit(STRONG_AUTH_FACTOR_CHANGE_LIMIT),
    service: StrongAuthService = Depends(get_strong_auth_service),
) -> StrongAuthDisableResponse:
    _prevent_sensitive_response_caching(response)
    try:
        revoked = await service.disable(
            context,
            method=payload.method,
            code=payload.code,
            password=payload.primary.password,
            google_id_token=payload.primary.google_id_token,
        )
    except (
        StrongAuthError,
        StrongAuthSecretDecryptionError,
        GoogleIdentityConfigurationError,
        GoogleIdentityProviderUnavailableError,
    ) as exc:
        raise _strong_auth_http_error(exc) from exc
    return StrongAuthDisableResponse(revoked_sessions=revoked)


@router.post(
    "/oauth/google",
    response_model=LoginResponse,
    summary="Exchange Google OAuth identity for backend token",
    description="Upserts OAuth account details and returns backend JWT for authenticated frontend calls.",
)
async def oauth_google_exchange(
    payload: OAuthGoogleExchangeRequest,
    internal_exchange_secret: Annotated[
        str | None,
        Header(alias="X-CreatorJobs-OAuth-Exchange"),
    ] = None,
    _limit: None = rate_limit(AUTH_LOGIN_LIMIT),
    service: AuthService = Depends(get_auth_service),
) -> LoginResponse:
    if has_google_youtube_read_scope(payload.scope):
        configured = (
            settings.google_oauth_exchange_secret.get_secret_value()
            if settings.google_oauth_exchange_secret is not None
            else None
        )
        previous = (
            settings.google_oauth_exchange_previous_secret.get_secret_value()
            if settings.google_oauth_exchange_previous_secret is not None
            else None
        )
        if not configured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google authorization is temporarily unavailable",
            )
        valid_internal_secret = False
        if internal_exchange_secret is not None and len(internal_exchange_secret) <= 512:
            primary_match = secrets.compare_digest(internal_exchange_secret, configured)
            previous_match = bool(
                previous
                and secrets.compare_digest(internal_exchange_secret, previous)
            )
            valid_internal_secret = primary_match or previous_match
        if not valid_internal_secret:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Google authorization could not be verified",
            )
    try:
        user, tokens = await service.exchange_google_oauth(payload)
    except GoogleIdentityVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google identity token",
        ) from exc
    except GoogleOAuthAuthorizationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google authorization could not be verified",
        ) from exc
    except (
        GoogleIdentityConfigurationError,
        GoogleIdentityProviderUnavailableError,
        GoogleOAuthAuthorizationProviderUnavailableError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is temporarily unavailable",
        ) from exc
    except OAuthAccountCollisionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Google identity cannot be linked to this account",
        ) from exc
    except AccountSuspendedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except InvalidUsernameError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except UsernameAlreadyTakenError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _login_response(user, tokens)
