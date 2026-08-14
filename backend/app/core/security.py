from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


class TokenError(Exception):
    """Raised when token encoding/decoding fails."""


ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"
SESSION_ID_CLAIM = "sid"
TOKEN_ID_CLAIM = "jti"
SESSION_TOKEN_VERSION_CLAIM = "stv"


def create_access_token(
    subject: str,
    expires_delta: timedelta | None = None,
    *,
    additional_claims: dict[str, Any] | None = None,
) -> str:
    expire = datetime.now(UTC) + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.jwt_access_token_expires_minutes)
    )
    payload: dict[str, Any] = dict(additional_claims or {})
    # Callers cannot override the security-critical standard claims.
    payload.update({"sub": subject, "exp": expire, "typ": ACCESS_TOKEN_TYPE})
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(
    subject: str,
    expires_delta: timedelta | None = None,
    *,
    expires_at: datetime | None = None,
    session_id: str | None = None,
    token_id: str | None = None,
) -> str:
    if (session_id is None) != (token_id is None):
        raise ValueError("session_id and token_id must be provided together")
    if expires_at is not None and expires_delta is not None:
        raise ValueError("expires_at and expires_delta are mutually exclusive")
    expire = expires_at or (
        datetime.now(UTC)
        + (
            expires_delta
            if expires_delta is not None
            else timedelta(minutes=settings.jwt_refresh_token_expires_minutes)
        )
    )
    payload: dict[str, Any] = {"sub": subject, "exp": expire, "typ": REFRESH_TOKEN_TYPE}
    if session_id is not None and token_id is not None:
        payload.update(
            {
                SESSION_ID_CLAIM: session_id,
                TOKEN_ID_CLAIM: token_id,
                SESSION_TOKEN_VERSION_CLAIM: 1,
            }
        )
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    payload = _decode_token(token)
    token_type = payload.get("typ")
    if token_type not in (None, ACCESS_TOKEN_TYPE):
        raise TokenError("Invalid token type")
    return payload


def decode_refresh_token(token: str) -> dict[str, Any]:
    payload = _decode_token(token)
    if payload.get("typ") != REFRESH_TOKEN_TYPE:
        raise TokenError("Invalid token type")
    return payload


def get_token_expires_at(token: str) -> int | None:
    payload = _decode_token(token)
    exp = payload.get("exp")
    return int(exp) if isinstance(exp, int | float) else None


def hash_refresh_token(token: str) -> str:
    """Return the fixed-size non-reversible identifier stored in the database."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise TokenError("Invalid or expired token") from exc


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False
