"""Proving that whoever clicked unsubscribe was sent the email.

The obvious version of this link carries a user id: `/unsubscribe?user=<uuid>`.
Anyone who sees one such URL learns the shape of all of them, and can switch off
another person's mail by guessing or by iterating — silently, with no login and
no trace that looks like an attack. The victim only finds out when something
they wanted stops arriving, and by then there is nothing to correlate.

So the link carries a signature over the address it is for. The server can check
that it issued the link; nobody else can produce one.

Two properties are unusual here and both are deliberate.

There is NO EXPIRY. An unsubscribe link lives in an email for as long as that
email exists, and someone clearing out their inbox two years later is exactly
the person who should be able to use it. A link that has quietly stopped working
sends them to a support queue to ask for something they were promised in
writing.

And the token is scoped to ONE CATEGORY. A single token that switched everything
off would mean a lifecycle email could unsubscribe someone from every optional
category at once, which is more than the link in that email offered to do.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from dataclasses import dataclass


class UnsubscribeTokenError(Exception):
    """A token that will not be acted on."""


@dataclass(frozen=True)
class UnsubscribeClaim:
    user_id: uuid.UUID
    category: str


def _secret() -> str:
    from app.core.config import settings

    secret = (settings.unsubscribe_token_secret or "").strip()
    if not secret:
        # A refusal rather than a fallback. "No secret, so accept anything"
        # turns a missing environment variable into an endpoint that
        # unsubscribes whoever it is asked to.
        raise UnsubscribeTokenError("Unsubscribe links are not configured.")
    return secret


def _signature(user_id: uuid.UUID, category: str, secret: str) -> str:
    message = f"{user_id.hex}:{category}".encode()
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()[:32]


def issue_unsubscribe_token(user_id: uuid.UUID, category: str) -> str:
    """The token that goes in one email, for one person, for one category."""

    return f"{user_id.hex}.{category}.{_signature(user_id, category, _secret())}"


def read_unsubscribe_token(token: str) -> UnsubscribeClaim:
    """Who and what this token is for, or a refusal.

    Every failure raises the same exception with the same message. Telling a
    caller whether the user existed, or whether only the signature was wrong,
    hands them the two halves of the problem separately.
    """

    secret = _secret()
    parts = (token or "").split(".")
    if len(parts) != 3:
        raise UnsubscribeTokenError("This unsubscribe link is not valid.")

    raw_user_id, category, provided = parts
    try:
        user_id = uuid.UUID(hex=raw_user_id)
    except ValueError as exc:
        raise UnsubscribeTokenError("This unsubscribe link is not valid.") from exc

    if not hmac.compare_digest(_signature(user_id, category, secret), provided):
        raise UnsubscribeTokenError("This unsubscribe link is not valid.")

    return UnsubscribeClaim(user_id=user_id, category=category)
