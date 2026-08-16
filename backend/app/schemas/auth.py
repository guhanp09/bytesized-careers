from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.account_types import AccountType, PublicAccountType
from app.core.onboarding_intent import OnboardingIntent


class AuthStatusResponse(BaseModel):
    status: str = "ok"
    message: str | None = None
    verification_url: str | None = None


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=20)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=255)
    onboarding_intent: OnboardingIntent = "DECIDE_LATER"
    # Deprecated compatibility input. Public users are not permanently talent/employer classified.
    account_type: PublicAccountType | None = None
    #: Required only while the closed beta is on; the server decides, not the client.
    invitation_token: str | None = Field(default=None, max_length=512)


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=16, max_length=255)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ResendVerificationResponse(BaseModel):
    ok: bool = True
    message: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(min_length=16, max_length=255)
    password: str = Field(min_length=8, max_length=128)


class PasswordResetResponse(BaseModel):
    ok: bool = True
    message: str
    reset_url: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(min_length=16)


class LogoutRequest(BaseModel):
    """Server-to-server logout proof; browser sessions never serialize this value."""

    refresh_token: str | None = Field(default=None, min_length=16, max_length=8192)


class SessionRevocationResponse(BaseModel):
    status: str = "ok"
    revoked_sessions: int = Field(ge=0)


class OAuthGoogleExchangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_token: str = Field(min_length=64, max_length=8192)
    access_token: str | None = Field(default=None, max_length=16384)
    refresh_token: str | None = Field(default=None, max_length=16384)
    expires_at: int | None = None
    scope: str | None = Field(default=None, max_length=4096)
    #: Only consulted while the closed beta is on, and only for an account that
    #: does not exist yet. An established user signing in never needs one.
    invitation_token: str | None = Field(default=None, max_length=512)


class AuthUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    username: str | None = None
    display_name: str | None = None
    account_type: AccountType = "TALENT"
    account_type_selected_at: datetime | None = None
    onboarding_intent: OnboardingIntent = "DECIDE_LATER"
    onboarding_intent_selected_at: datetime | None = None
    email_verified_at: datetime | None = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str
    access_token_expires_at: int | None = None
    refresh_token_expires_at: int | None = None
    user: AuthUserRead
