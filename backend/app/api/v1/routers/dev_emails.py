from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import settings
from app.models import EmailOutbox
from app.services.email_service import clear_dev_auth_emails, list_dev_auth_emails

router = APIRouter(prefix="/dev/emails", tags=["dev"])


class DevAuthEmail(BaseModel):
    id: str | None = None
    to: str | None = None
    subject: str | None = None
    type: str | None = None
    createdAt: str | None = None
    actionUrl: str | None = None
    body: str | None = None
    preview: str | None = None


class DevAuthEmailListResponse(BaseModel):
    items: list[DevAuthEmail]


class DevAuthEmailClearResponse(BaseModel):
    ok: bool


def _ensure_dev_only() -> None:
    if settings.app_env not in {"development", "test"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


@router.get("", response_model=DevAuthEmailListResponse)
async def list_dev_emails() -> DevAuthEmailListResponse:
    _ensure_dev_only()
    return DevAuthEmailListResponse(items=[DevAuthEmail(**item) for item in list_dev_auth_emails()])


@router.delete("", response_model=DevAuthEmailClearResponse)
async def clear_dev_emails() -> DevAuthEmailClearResponse:
    _ensure_dev_only()
    clear_dev_auth_emails()
    return DevAuthEmailClearResponse(ok=True)


class DevOutboxEmail(BaseModel):
    id: str
    to_email: str
    event_key: str
    template_key: str
    subject: str
    preview: str | None = None
    cta_url: str | None = None
    status: str
    created_at: str | None = None


class DevOutboxListResponse(BaseModel):
    items: list[DevOutboxEmail]


@router.get("/outbox", response_model=DevOutboxListResponse)
async def list_notification_outbox(
    session: AsyncSession = Depends(get_db),
) -> DevOutboxListResponse:
    """Dev/test helper: inspect notification emails queued to the mock outbox.

    Notification emails are never sent while delivery is disabled — they land here
    with status ``mocked`` so they can be previewed locally and asserted in tests.
    """
    _ensure_dev_only()
    rows = (
        await session.execute(select(EmailOutbox).order_by(EmailOutbox.created_at.desc()).limit(100))
    ).scalars().all()
    return DevOutboxListResponse(
        items=[
            DevOutboxEmail(
                id=str(row.id),
                to_email=row.to_email,
                event_key=row.event_key,
                template_key=row.template_key,
                subject=row.subject,
                preview=row.preview,
                cta_url=row.cta_url,
                status=row.status,
                created_at=row.created_at.isoformat() if row.created_at else None,
            )
            for row in rows
        ]
    )
