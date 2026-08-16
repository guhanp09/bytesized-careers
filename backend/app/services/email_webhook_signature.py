"""Deciding whether a delivery report really came from the provider.

This endpoint is unauthenticated by necessity — a mail provider cannot log in —
so the signature is the only thing standing between the suppression list and
anyone who can reach the URL. Without it, a stranger can post a fabricated hard
bounce for any address and silently stop that person receiving mail, including
password resets. That is a denial of service against one account at a time, and
it leaves no trace that looks like an attack.

The scheme here is deliberately provider-neutral: HMAC-SHA256 over
``timestamp.body`` with a shared secret, compared in constant time, with a
freshness window. No provider has been chosen yet (EMAIL-005 is blocked on the
sending domain), and inventing a specific vendor's header format now would mean
writing a verifier for a scheme this codebase has never seen. Mapping a real
provider onto this is a small adapter; getting the properties right is the part
worth doing carefully.

Three properties, each closing a specific hole:

* the body is signed, so the claim itself cannot be altered;
* the timestamp is inside the signature and checked against a window, so a
  captured-and-replayed report cannot suppress an address again months later;
* comparison is ``hmac.compare_digest``, because a byte-by-byte comparison
  leaks how much of a guess was right.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass

#: Anything older or further in the future than this is refused. Generous enough
#: for clock skew and a slow retry, short enough that a captured request is not
#: a lasting credential.
DEFAULT_TOLERANCE_SECONDS = 300


class WebhookSignatureError(Exception):
    """The request did not prove it came from the provider."""


@dataclass(frozen=True)
class SignatureCheck:
    valid: bool
    problem: str | None = None


def expected_signature(*, secret: str, timestamp: str, body: bytes) -> str:
    """HMAC-SHA256 over `timestamp.body`.

    The timestamp is inside the signed material rather than beside it. If it
    were only a header, an attacker could replay a captured body with a fresh
    timestamp and the signature would still verify.
    """

    message = timestamp.encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_signature(
    *,
    secret: str | None,
    signature: str | None,
    timestamp: str | None,
    body: bytes,
    now: float,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
) -> SignatureCheck:
    """Pure, so the rules can be read and tested without an HTTP request.

    An unset secret is a refusal rather than a bypass. The alternative — "no
    secret configured, so accept everything" — turns a missing environment
    variable into an open door, and that is precisely the deployment where
    nobody is watching.
    """

    if not secret:
        return SignatureCheck(False, "Webhook secret is not configured.")
    if not signature or not timestamp:
        return SignatureCheck(False, "Missing signature.")

    try:
        sent_at = float(timestamp)
    except ValueError:
        return SignatureCheck(False, "Malformed timestamp.")

    if abs(now - sent_at) > tolerance_seconds:
        return SignatureCheck(False, "Signature is outside the accepted time window.")

    if not hmac.compare_digest(
        expected_signature(secret=secret, timestamp=timestamp, body=body), signature
    ):
        return SignatureCheck(False, "Signature does not match.")

    return SignatureCheck(True)
