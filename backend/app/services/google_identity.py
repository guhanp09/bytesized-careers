from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Protocol

from email_validator import EmailNotValidError, validate_email
from google.auth import exceptions as google_auth_exceptions
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token

GOOGLE_IDENTITY_ISSUERS = frozenset(
    {
        "accounts.google.com",
        "https://accounts.google.com",
    }
)


class GoogleIdentityVerificationError(Exception):
    """The supplied credential is not a valid Google identity token."""


class GoogleIdentityProviderUnavailableError(Exception):
    """Google's verification material could not be reached temporarily."""


class GoogleIdentityConfigurationError(Exception):
    """The server cannot safely verify Google identities."""


@dataclass(frozen=True)
class VerifiedGoogleIdentity:
    subject: str
    email: str
    display_name: str | None


class GoogleIdentityVerifierProtocol(Protocol):
    async def verify(self, raw_id_token: str) -> VerifiedGoogleIdentity:
        """Verify a Google ID token and return only trusted identity claims."""


class GoogleIdentityVerifier:
    """Verify Google identity tokens off the async request loop.

    ``google.oauth2.id_token.verify_oauth2_token`` verifies the signed JWT with
    Google's public keys and validates its audience and expiry. The explicit
    checks below keep CreatorJobs' account-linking contract fail closed even if
    library defaults change, and make the trusted claims obvious at the service
    boundary.
    """

    def __init__(self, client_id: str | None):
        self._client_id = (client_id or "").strip()

    async def verify(self, raw_id_token: str) -> VerifiedGoogleIdentity:
        if not self._client_id:
            raise GoogleIdentityConfigurationError("Google identity verification is not configured")
        return await asyncio.to_thread(self._verify_sync, raw_id_token)

    def _verify_sync(self, raw_id_token: str) -> VerifiedGoogleIdentity:
        try:
            claims = google_id_token.verify_oauth2_token(
                raw_id_token,
                GoogleAuthRequest(),
                self._client_id,
            )
        except google_auth_exceptions.TransportError as exc:
            raise GoogleIdentityProviderUnavailableError(
                "Google identity verification is temporarily unavailable"
            ) from exc
        except (ValueError, google_auth_exceptions.GoogleAuthError) as exc:
            raise GoogleIdentityVerificationError("Invalid Google identity token") from exc

        return self._identity_from_verified_claims(claims)

    def _identity_from_verified_claims(self, claims: dict[str, Any]) -> VerifiedGoogleIdentity:
        issuer = claims.get("iss")
        if issuer not in GOOGLE_IDENTITY_ISSUERS:
            raise GoogleIdentityVerificationError("Invalid Google identity token")

        if claims.get("aud") != self._client_id:
            raise GoogleIdentityVerificationError("Invalid Google identity token")

        expires_at = claims.get("exp")
        if (
            isinstance(expires_at, bool)
            or not isinstance(expires_at, (int, float))
            or expires_at <= time.time()
        ):
            raise GoogleIdentityVerificationError("Invalid Google identity token")

        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject.strip() or len(subject) > 255:
            raise GoogleIdentityVerificationError("Invalid Google identity token")

        if claims.get("email_verified") is not True:
            raise GoogleIdentityVerificationError("Google email is not verified")

        raw_email = claims.get("email")
        if not isinstance(raw_email, str):
            raise GoogleIdentityVerificationError("Invalid Google identity token")
        try:
            email = validate_email(raw_email, check_deliverability=False).normalized.lower()
        except EmailNotValidError as exc:
            raise GoogleIdentityVerificationError("Invalid Google identity token") from exc

        raw_name = claims.get("name")
        display_name = None
        if isinstance(raw_name, str):
            display_name = raw_name.strip()[:255] or None

        return VerifiedGoogleIdentity(
            subject=subject.strip(),
            email=email,
            display_name=display_name,
        )
