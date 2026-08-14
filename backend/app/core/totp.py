from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import secrets
from datetime import UTC, datetime
from urllib.parse import quote, urlencode

TOTP_DIGITS = 6
TOTP_PERIOD_SECONDS = 30
TOTP_SECRET_BYTES = 20
TOTP_ALLOWED_DRIFT_STEPS = 1


class TotpSecretError(ValueError):
    """The supplied base32 TOTP secret is malformed or unsafe."""


def generate_totp_secret() -> str:
    """Generate a 160-bit RFC 4226/6238 secret without base32 padding."""

    return base64.b32encode(secrets.token_bytes(TOTP_SECRET_BYTES)).decode("ascii").rstrip("=")


def _decode_secret(secret: str) -> bytes:
    normalized = secret.strip().upper()
    if not normalized or len(normalized) > 256:
        raise TotpSecretError("Invalid TOTP secret")
    try:
        raw = base64.b32decode(
            normalized + "=" * (-len(normalized) % 8),
            casefold=False,
        )
    except (binascii.Error, ValueError) as exc:
        raise TotpSecretError("Invalid TOTP secret") from exc
    if not 10 <= len(raw) <= 128:
        raise TotpSecretError("Invalid TOTP secret")
    return raw


def hotp_code(secret: str, counter: int, *, digits: int = TOTP_DIGITS) -> str:
    """Calculate an RFC 4226 code for a non-negative moving counter."""

    if counter < 0:
        raise ValueError("HOTP counter must be non-negative")
    if not 6 <= digits <= 8:
        raise ValueError("HOTP digits must be between 6 and 8")
    digest = hmac.new(
        _decode_secret(secret),
        counter.to_bytes(8, "big"),
        hashlib.sha1,
    ).digest()
    offset = digest[-1] & 0x0F
    binary = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return str(binary % (10**digits)).zfill(digits)


def totp_time_step(
    at: datetime | None = None,
    *,
    period_seconds: int = TOTP_PERIOD_SECONDS,
) -> int:
    if period_seconds <= 0:
        raise ValueError("TOTP period must be positive")
    current = at or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    return int(current.timestamp()) // period_seconds


def totp_code_at(
    secret: str,
    at: datetime | None = None,
    *,
    digits: int = TOTP_DIGITS,
    period_seconds: int = TOTP_PERIOD_SECONDS,
) -> str:
    return hotp_code(
        secret,
        totp_time_step(at, period_seconds=period_seconds),
        digits=digits,
    )


def matching_totp_step(
    *,
    secret: str,
    code: str,
    at: datetime | None = None,
    allowed_drift_steps: int = TOTP_ALLOWED_DRIFT_STEPS,
) -> int | None:
    """Return the matched step while checking every bounded drift candidate."""

    if len(code) != TOTP_DIGITS or not code.isascii() or not code.isdigit():
        return None
    if not 0 <= allowed_drift_steps <= 2:
        raise ValueError("TOTP drift must be between zero and two steps")

    current_step = totp_time_step(at)
    matches: list[int] = []
    for step in range(
        current_step - allowed_drift_steps,
        current_step + allowed_drift_steps + 1,
    ):
        if step < 0:
            continue
        candidate = hotp_code(secret, step)
        if hmac.compare_digest(candidate, code):
            matches.append(step)
    return max(matches) if matches else None


def totp_provisioning_uri(*, secret: str, account_name: str) -> str:
    """Build the standard authenticator URI without logging or persisting it."""

    # Validate before reflecting the secret into a response URI.
    _decode_secret(secret)
    issuer = "CreatorJobs"
    label = quote(f"{issuer}:{account_name}", safe="")
    query = urlencode(
        {
            "secret": secret,
            "issuer": issuer,
            "algorithm": "SHA1",
            "digits": str(TOTP_DIGITS),
            "period": str(TOTP_PERIOD_SECONDS),
        }
    )
    return f"otpauth://totp/{label}?{query}"


__all__ = [
    "TOTP_ALLOWED_DRIFT_STEPS",
    "TOTP_DIGITS",
    "TOTP_PERIOD_SECONDS",
    "TotpSecretError",
    "generate_totp_secret",
    "hotp_code",
    "matching_totp_step",
    "totp_code_at",
    "totp_provisioning_uri",
    "totp_time_step",
]
