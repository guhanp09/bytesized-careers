from __future__ import annotations

import json
from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import AdminAuditLog

QA_ALLOWED_ENVIRONMENTS = {"staging", "test"}


def qa_controller_emails() -> frozenset[str]:
    raw = settings.qa_persona_controller_emails.strip()
    if not raw:
        return frozenset()
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return frozenset()
        if not isinstance(parsed, list):
            return frozenset()
        items = parsed
    else:
        items = raw.split(",")
    return frozenset(
        str(item).strip().lower() for item in items if str(item).strip()
    )


def qa_persona_feature_enabled() -> bool:
    """The backend is authoritative; production is never eligible."""

    return (
        settings.app_env in QA_ALLOWED_ENVIRONMENTS
        and settings.enable_qa_persona_switcher
        and bool(qa_controller_emails())
    )


def ensure_qa_persona_feature_enabled() -> None:
    if not qa_persona_feature_enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def is_qa_controller_email(email: str | None) -> bool:
    if not email:
        return False
    return email.strip().lower() in qa_controller_emails()


async def qa_session_is_revoked(session: AsyncSession, session_id: UUID) -> bool:
    """Use the append-only audit trail as the durable QA-session deny list."""

    revoked = await session.scalar(
        select(AdminAuditLog.id)
        .where(
            AdminAuditLog.action == "qa.persona.exit",
            AdminAuditLog.target_type == "qa_session",
            AdminAuditLog.target_id == str(session_id),
        )
        .limit(1)
    )
    return revoked is not None


@dataclass(frozen=True)
class QaTokenClaims:
    controller_user_id: UUID
    persona_user_id: UUID
    persona_key: str
    session_id: UUID


def parse_qa_token_claims(payload: dict[str, object]) -> QaTokenClaims | None:
    if payload.get("qa") is not True:
        return None
    try:
        controller = UUID(str(payload["act"]))
        persona = UUID(str(payload["sub"]))
        session_id = UUID(str(payload["qa_session_id"]))
        persona_key = str(payload["qa_persona_key"]).strip()
    except (KeyError, TypeError, ValueError):
        return None
    if not persona_key:
        return None
    return QaTokenClaims(
        controller_user_id=controller,
        persona_user_id=persona,
        persona_key=persona_key,
        session_id=session_id,
    )
