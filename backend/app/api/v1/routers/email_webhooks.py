"""Where delivery reports arrive.

The endpoint is unauthenticated because a mail provider cannot hold a session;
the signature does the whole job. See `email_webhook_signature` for why it is
built the way it is and what an unsigned version of this would let a stranger do.

The handler is deliberately dull: verify, map the category, record, commit. It
answers 200 to anything it has accepted responsibility for — including events it
does not act on — because a provider that receives an error retries, and
retrying will not turn an unrecognised category into a recognised one.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import settings
from app.services.email_suppression_service import (
    COMPLAINT,
    HARD_BOUNCE,
    record_suppression,
)
from app.services.email_webhook_signature import verify_signature

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/email-webhooks", tags=["email"])

#: Provider vocabulary mapped onto the two decisions the platform actually
#: makes. Anything not listed is recorded in the log and acted on by nobody,
#: which is the safe direction: an unknown category must not silently stop
#: someone's mail.
EVENT_CATEGORIES = {
    "bounce": HARD_BOUNCE,
    "hard_bounce": HARD_BOUNCE,
    "dropped": HARD_BOUNCE,
    "complaint": COMPLAINT,
    "spam_complaint": COMPLAINT,
    "spamreport": COMPLAINT,
}

#: Named so the log line reads as a decision rather than an omission.
TRANSIENT_CATEGORIES = {"soft_bounce", "deferred", "delayed", "throttled"}


class EmailWebhookResponse(BaseModel):
    ok: bool
    suppressed: bool


@router.post(
    "/delivery",
    response_model=EmailWebhookResponse,
    summary="Receive a delivery report from the email provider",
)
async def receive_delivery_report(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> EmailWebhookResponse:
    # The RAW body, before parsing: the signature covers the bytes that were
    # sent, and re-serializing a parsed model would change them.
    body = await request.body()

    check = verify_signature(
        secret=settings.email_webhook_secret,
        signature=request.headers.get("x-creatorjobs-signature"),
        timestamp=request.headers.get("x-creatorjobs-timestamp"),
        body=body,
        now=time.time(),
    )
    if not check.valid:
        # One message for every rejection. Telling a caller which part failed
        # tells them how to get closer, and there is no legitimate sender that
        # needs the hint.
        logger.warning("email_webhook_rejected", extra={"problem": check.problem})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Delivery report could not be verified.",
        )

    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001 - any unparseable body is one refusal
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Delivery report body must be JSON.",
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Delivery report body must be a JSON object.",
        )

    email = payload.get("email")
    event = str(payload.get("event") or "").strip().lower()
    if not isinstance(email, str) or not email.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Delivery report must name an address.",
        )

    reason = EVENT_CATEGORIES.get(event)
    if reason is None:
        # 200, not an error: a provider that gets an error retries, and no
        # number of retries will make an unknown category known.
        logger.info(
            "email_webhook_event_ignored",
            extra={"event": event, "transient": event in TRANSIENT_CATEGORIES},
        )
        return EmailWebhookResponse(ok=True, suppressed=False)

    await record_suppression(
        session,
        email=email,
        reason=reason,
        source=str(payload.get("provider") or "webhook")[:64],
        detail=str(payload.get("detail") or "")[:1000] or None,
        provider_message_id=str(payload.get("message_id") or "")[:255] or None,
    )
    await session.commit()

    logger.info("email_webhook_suppressed", extra={"reason": reason})
    return EmailWebhookResponse(ok=True, suppressed=True)
