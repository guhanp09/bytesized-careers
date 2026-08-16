"""Acting on an unsubscribe link.

Unauthenticated by necessity: the whole point is that it works from an email,
without remembering a password. The signature is what stands in for the session.

POST rather than GET, and that is not pedantry. Mail clients and security
scanners follow links in messages to prefetch and check them, so a GET that
changes state gets triggered by software the person never asked for — someone
would be unsubscribed by their own spam filter. The emailed link points at a
page; the page posts.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.notification_consent import OPTIONAL_CATEGORIES
from app.repositories.notification_preference_repository import record_opt_out
from app.services.unsubscribe_tokens import (
    UnsubscribeTokenError,
    read_unsubscribe_token,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/unsubscribe", tags=["notifications"])


class UnsubscribeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=8, max_length=256)


class UnsubscribeResponse(BaseModel):
    ok: bool
    category: str


@router.post(
    "",
    response_model=UnsubscribeResponse,
    summary="Stop sending one category of email, using a link from an email",
)
async def unsubscribe(
    payload: UnsubscribeRequest,
    session: AsyncSession = Depends(get_db),
) -> UnsubscribeResponse:
    try:
        claim = read_unsubscribe_token(payload.token)
    except UnsubscribeTokenError as exc:
        logger.warning("unsubscribe_token_rejected")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    if claim.category not in OPTIONAL_CATEGORIES:
        # A token naming an essential category should not exist, and acting on
        # one would let a link switch off a password reset.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This kind of email cannot be switched off.",
        )

    await record_opt_out(session, user_id=claim.user_id, category=claim.category)
    await session.commit()

    return UnsubscribeResponse(ok=True, category=claim.category)
