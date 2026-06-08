from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_auth_service
from app.core.rate_limit import AUTH_EMAIL_LIMIT, AUTH_LOGIN_LIMIT, AUTH_REGISTER_LIMIT, rate_limit
from app.schemas import (
    AuthStatusResponse,
    AuthUserRead,
    LoginRequest,
    LoginResponse,
    OAuthGoogleExchangeRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    PasswordResetResponse,
    RegisterRequest,
    ResendVerificationRequest,
    ResendVerificationResponse,
    VerifyEmailRequest,
)
from app.services.auth_service import (
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

router = APIRouter(prefix="/auth", tags=["auth"])


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
        user, token = await service.login_with_password(email=payload.email, password=payload.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except EmailNotVerifiedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    return LoginResponse(
        access_token=token,
        token_type="bearer",
        user=AuthUserRead.model_validate(user),
    )


@router.post(
    "/oauth/google",
    response_model=LoginResponse,
    summary="Exchange Google OAuth identity for backend token",
    description="Upserts OAuth account details and returns backend JWT for authenticated frontend calls.",
)
async def oauth_google_exchange(
    payload: OAuthGoogleExchangeRequest,
    service: AuthService = Depends(get_auth_service),
) -> LoginResponse:
    try:
        user, token = await service.exchange_google_oauth(payload)
    except InvalidUsernameError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except UsernameAlreadyTakenError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return LoginResponse(
        access_token=token,
        token_type="bearer",
        user=AuthUserRead.model_validate(user),
    )
