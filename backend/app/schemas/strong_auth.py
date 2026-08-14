from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

StrongAuthMethod = Literal["totp", "recovery_code"]
StrongAuthAssuranceMethod = Literal["totp", "recovery_code", "webauthn"]


class StrongAuthPrimaryCredential(BaseModel):
    password: str | None = Field(default=None, min_length=8, max_length=128)
    google_id_token: str | None = Field(default=None, min_length=64, max_length=8192)

    @model_validator(mode="after")
    def exactly_one_primary_credential(self) -> StrongAuthPrimaryCredential:
        if (self.password is None) == (self.google_id_token is None):
            raise ValueError("Provide exactly one primary reauthentication credential")
        return self


class StrongAuthEnrollmentStartRequest(BaseModel):
    primary: StrongAuthPrimaryCredential


class StrongAuthCodeRequest(BaseModel):
    method: StrongAuthMethod
    code: str = Field(min_length=6, max_length=128)

    @field_validator("code")
    @classmethod
    def normalize_code_whitespace(cls, value: str) -> str:
        return value.strip()


class StrongAuthTotpCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")


class StrongAuthDisableRequest(StrongAuthCodeRequest):
    primary: StrongAuthPrimaryCredential


class StrongAuthStatusResponse(BaseModel):
    enrolled: bool
    enrollment_pending: bool
    enrollment_expires_at: datetime | None = None
    recovery_codes_remaining: int = Field(ge=0)
    strong_auth_satisfied: bool
    strong_auth_method: StrongAuthAssuranceMethod | None = None
    strong_auth_expires_at: datetime | None = None
    available_methods: list[StrongAuthMethod] = Field(default_factory=list)


class StrongAuthEnrollmentResponse(BaseModel):
    secret: str
    provisioning_uri: str
    expires_at: datetime


class StrongAuthVerificationResponse(BaseModel):
    status: str = "ok"
    method: StrongAuthMethod
    expires_at: datetime
    recovery_codes_remaining: int = Field(ge=0)


class StrongAuthEnrollmentConfirmationResponse(StrongAuthVerificationResponse):
    recovery_codes: list[str]


class StrongAuthRecoveryCodesResponse(BaseModel):
    status: str = "ok"
    recovery_codes: list[str]
    expires_at: datetime


class StrongAuthDisableResponse(BaseModel):
    status: str = "ok"
    revoked_sessions: int = Field(ge=0)


__all__ = [
    "StrongAuthCodeRequest",
    "StrongAuthDisableRequest",
    "StrongAuthDisableResponse",
    "StrongAuthEnrollmentConfirmationResponse",
    "StrongAuthEnrollmentResponse",
    "StrongAuthEnrollmentStartRequest",
    "StrongAuthMethod",
    "StrongAuthPrimaryCredential",
    "StrongAuthRecoveryCodesResponse",
    "StrongAuthStatusResponse",
    "StrongAuthTotpCodeRequest",
    "StrongAuthVerificationResponse",
]
