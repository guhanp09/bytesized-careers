"""What a provider is allowed to tell the outbox.

The outbox needs one thing from an email provider that most client libraries do
not offer directly: a *classified* answer. "It failed" is not enough, because
the queue's next move depends entirely on which kind of failure it was — a
timeout deserves another attempt, a malformed recipient never will, and a
suppressed address should not be attempted at all.

So the seam is deliberately narrow. A provider takes a row and returns one of
four outcomes plus, on success, whatever identifier it uses for the message.
Everything else about a provider — auth, templates, batching, webhooks — stays
on the far side of this interface, so the queue can be tested against a fake
that never touches a network.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Protocol

from app.models import EmailOutbox
from app.services.email_service import EmailDeliveryError, send_auth_email


class ProviderOutcome(str, Enum):
    """The four answers the queue knows how to act on."""

    SENT = "sent"
    #: Worth trying again — timeout, connection refused, rate limited, 5xx.
    RETRYABLE = "retryable"
    #: Never worth trying again — malformed address, rejected on its merits.
    TERMINAL = "terminal"
    #: Do not send at all — unsubscribed, previously hard-bounced.
    SUPPRESSED = "suppressed"


@dataclass(frozen=True)
class ProviderResult:
    outcome: ProviderOutcome
    #: The provider's own identifier, kept so a later bounce can be traced back.
    message_id: str | None = None
    #: Human-readable reason, stored on the row for whoever reads the table.
    detail: str = ""

    @classmethod
    def sent(cls, message_id: str | None = None) -> ProviderResult:
        return cls(ProviderOutcome.SENT, message_id=message_id)

    @classmethod
    def retryable(cls, detail: str) -> ProviderResult:
        return cls(ProviderOutcome.RETRYABLE, detail=detail)

    @classmethod
    def terminal(cls, detail: str) -> ProviderResult:
        return cls(ProviderOutcome.TERMINAL, detail=detail)

    @classmethod
    def suppressed(cls, detail: str) -> ProviderResult:
        return cls(ProviderOutcome.SUPPRESSED, detail=detail)


class EmailProvider(Protocol):
    async def send(self, row: EmailOutbox) -> ProviderResult: ...


class MockEmailProvider:
    """Records intent without sending, which is the default everywhere today.

    Returns SENT rather than a separate "mocked" outcome so the queue exercises
    exactly one success path in development and in production. The distinction
    between a real send and a mocked one belongs in configuration and in the
    logs, not in the state machine — a second success state would mean every
    consumer had to know about both.
    """

    def __init__(self) -> None:
        self.sent: list[EmailOutbox] = []

    async def send(self, row: EmailOutbox) -> ProviderResult:
        self.sent.append(row)
        return ProviderResult.sent(message_id=f"mock-{row.id}")


class SmtpEmailProvider:
    """The existing SMTP path, with its failures classified.

    `email_service.send_auth_email` raises one exception type for everything, so
    the classification here is necessarily coarse: without a richer signal the
    safe default is to treat a failure as retryable and let the attempt ceiling
    stop it. That is bounded — five attempts and it is reported — whereas
    guessing "terminal" on a transient outage silently drops mail.
    """

    async def send(self, row: EmailOutbox) -> ProviderResult:
        try:
            send_auth_email(
                to_email=row.to_email,
                subject=row.subject,
                text_body=row.body or row.preview or "",
            )
        except EmailDeliveryError as exc:
            return ProviderResult.retryable(str(exc))
        return ProviderResult.sent()
