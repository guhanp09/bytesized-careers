from __future__ import annotations

"""Admin permission scaffold (docs/ADMIN_PANEL_PLAN.md §14).

Today there is exactly one operator class: ``account_type == "ADMIN"`` holds
every permission. Routes are still written against *permission keys* (not a
bare admin check) so that when a second operator exists, adding real roles is
a resolution change here — not an information-architecture or router rewrite.

``ROLE_PRESETS`` documents the target matrix. It is deliberately not backed by
a database column yet: building role storage before a second human operator
exists would be speculative (see POST_BETA_ROADMAP.md's caution).
"""

from fastapi import Depends, HTTPException, status

from app.api.deps import get_current_user
from app.core.account_types import is_admin
from app.models import User

PERMISSION_KEYS: frozenset[str] = frozenset(
    {
        "view.overview",
        "view.queues",
        "reports.resolve",
        "verification.decide",
        "users.view",
        "users.suspend",
        "users.warn",
        "conversations.metadata",
        "conversations.view_reported",
        "listings.state",
        "messages.moderate",
        "platform.notices",
        "platform.entitlements",
        "compliance.deletion",
        "admin.manage_roles",
        "audit.view",
        # Internal support queue. Separate from users.view because reading a
        # support ticket and browsing accounts are different jobs, and a
        # moderator does not need the first to do the second.
        "support.tickets",
    }
)

# Target role → permission matrix (documentation until RBAC ships).
ROLE_PRESETS: dict[str, frozenset[str]] = {
    "owner": PERMISSION_KEYS,
    "admin": PERMISSION_KEYS - {"admin.manage_roles"},
    "moderator": frozenset(
        {
            "view.overview",
            "view.queues",
            "reports.resolve",
            "verification.decide",
            "users.view",
            "users.warn",
            "conversations.metadata",
            "conversations.view_reported",
            "listings.state",
            "messages.moderate",
            "audit.view",
        # Internal support queue. Separate from users.view because reading a
        # support ticket and browsing accounts are different jobs, and a
        # moderator does not need the first to do the second.
        "support.tickets",
        }
    ),
    "support": frozenset({"view.overview", "view.queues", "users.view", "conversations.metadata", "audit.view"}),
    "analyst": frozenset({"view.overview", "view.queues", "users.view", "audit.view"}),
}


def permissions_for(user: User) -> frozenset[str]:
    """Resolve a user's admin permissions. Single-role world: ADMIN → all."""
    return PERMISSION_KEYS if is_admin(user) else frozenset()


def require_permission(key: str):
    """Dependency factory: 403 unless the caller holds ``key``.

    ``key`` must be a registered permission — misspelled keys fail at import
    time (during route definition), not silently at request time.
    """
    if key not in PERMISSION_KEYS:
        raise ValueError(f"Unknown admin permission key: {key}")

    async def _check(current_user: User = Depends(get_current_user)) -> User:
        if key not in permissions_for(current_user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permission required")
        return current_user

    return _check
