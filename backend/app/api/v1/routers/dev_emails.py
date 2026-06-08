from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.config import settings
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
