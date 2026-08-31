"""Admin audit trail writer (docs/ADMIN_PANEL_PLAN.md §15).

One helper, used by every admin mutation (and by privacy-sensitive *reads*
like reported-conversation views). Entries are added to the caller's session
so they commit atomically with the action they record. There is no update or
delete path for audit rows anywhere in the application.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AdminAuditLog, User


def record_admin_action(
    session: AsyncSession,
    *,
    actor: User,
    action: str,
    target_type: str,
    target_id: str | uuid.UUID,
    target_label: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    justification: str | None = None,
    report_id: uuid.UUID | None = None,
    request_id: str | None = None,
) -> AdminAuditLog:
    entry = AdminAuditLog(
        actor_user_id=actor.id,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        target_label=(target_label or "")[:255] or None,
        before_json=before,
        after_json=after,
        justification=justification,
        report_id=report_id,
        request_id=request_id,
    )
    session.add(entry)
    return entry
