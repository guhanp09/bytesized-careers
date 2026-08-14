from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    AuthenticatedAccessDependency,
    bearer_scheme,
    get_auth_service,
    get_db,
    resolve_access_token_context,
)
from app.core.rate_limit import AUTH_EMAIL_LIMIT, AUTH_LOGIN_LIMIT, AUTH_REGISTER_LIMIT, rate_limit
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
    VerifyEmailRequest,
)
from app.services.auth_service import (
    AccountSuspendedError,
    AuthService,
    EmailAlreadyExistsError,
    EmailNotVerifiedError,
    InvalidCredentialsError,
    InvalidPasswordResetTokenError,
    InvalidUsernameError,
    InvalidVerificationTokenError,
    UsernameAlreadyTakenError,
)
from app.services.email_service import EmailDeliveryError
from app.services.google_identity import (
    GoogleIdentityConfigurationError,
    GoogleIdentityProviderUnavailableError,
    GoogleIdentityVerificationError,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _login_response(user, tokens) -> LoginResponse:
    return LoginResponse(
        access_token=tokens.access_token,
        token_type="bearer",
        refresh_token=tokens.refresh_token,
        access_token_expires_at=tokens.access_token_expires_at,
        refresh_token_expires_at=tokens.refresh_token_expires_at,
        user=AuthUserRead.model_validate(user),
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
        )
    except EmailAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except InvalidUsernameError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except UsernameAlreadyTakenError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except EmailDeliveryError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email delivery is temporarily unavailable. Please try again shortly.",
        ) from exc

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
    try:
        await service.resend_verification_for_email(email=payload.email)
    except EmailDeliveryError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email delivery is temporarily unavailable. Please try again shortly.",
        ) from exc
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
    try:
        reset_url = await service.request_password_reset_for_email(email=payload.email)
    except EmailDeliveryError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email delivery is temporarily unavailable. Please try again shortly.",
        ) from exc
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
    context: AuthenticatedAccessDependency,
    service: AuthService = Depends(get_auth_service),
) -> SessionRevocationResponse:
    if context.is_qa_persona:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="QA persona sessions cannot manage account sessions",
        )
    revoked = await service.revoke_all_sessions(user_id=context.user.id)
    return SessionRevocationResponse(revoked_sessions=revoked)


@router.post(
    "/oauth/google",
    response_model=LoginResponse,
    summary="Exchange Google OAuth identity for backend token",
    description="Upserts OAuth account details and returns backend JWT for authenticated frontend calls.",
)
async def oauth_google_exchange(
    payload: OAuthGoogleExchangeRequest,
    _limit: None = rate_limit(AUTH_LOGIN_LIMIT),
    service: AuthService = Depends(get_auth_service),
) -> LoginResponse:
    try:
        user, tokens = await service.exchange_google_oauth(payload)
    except GoogleIdentityVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google identity token",
        ) from exc
    except (
        GoogleIdentityConfigurationError,
        GoogleIdentityProviderUnavailableError,
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
