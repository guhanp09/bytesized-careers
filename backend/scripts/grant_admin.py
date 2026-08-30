"""Grant (or revoke) the ADMIN account type for a user, by email.

This is the ONLY sanctioned way to mint a production admin
(docs/ADMIN_PANEL_PLAN.md §9): admin is never assignable through any API, and
public signup/onboarding cannot select it. Run manually, with database access,
from backend/:

    .venv/bin/python -m scripts.grant_admin admin@example.com
    .venv/bin/python -m scripts.grant_admin admin@example.com --revoke

Revoking resets the account to TALENT (the safe default; the user can change
their mode through normal onboarding afterwards). It also revokes every durable
session family in the same transaction. Merely changing the role would stop
administrator authorization checks, but it would leave a compromised browser
authenticated as an ordinary user. A temporary claimless migration JWT cannot
be selectively revoked; demotion still removes its administrator permissions,
and an incident must follow with account suspension (or coordinated global
signing-secret rotation) to stop its remaining ordinary access before expiry.

Both directions append an actor-less operator event to the administrator audit
log. The event contains only the role transition and bounded revoked-session
count; the command's database/operator access control remains the identity of
the human who ran it.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import UTC, datetime

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import AdminAuditLog, User
from app.repositories.auth_repository import AuthRepository


async def _run(email: str, revoke: bool) -> int:
    async with SessionLocal() as session:
        user = (
            await session.execute(
                select(User)
                .where(User.email == email.strip().lower())
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if user is None:
            print("No user found for the supplied email.", file=sys.stderr)
            return 1
        before = user.account_type
        user.account_type = "TALENT" if revoke else "ADMIN"
        revoked_sessions = 0
        if revoke:
            revoked_sessions = await AuthRepository(
                session
            ).revoke_auth_sessions_for_user(
                user_id=user.id,
                revoked_at=datetime.now(UTC),
                reason="admin_role_revoked",
            )
        session.add(
            AdminAuditLog(
                actor_user_id=None,
                action="admin.role.revoke" if revoke else "admin.role.grant",
                target_type="user",
                target_id=str(user.id),
                target_label="Account role",
                before_json={"account_type": before},
                after_json={
                    "account_type": user.account_type,
                    "revoked_sessions": revoked_sessions,
                },
                justification="Operator CLI role change",
            )
        )
        await session.commit()
        suffix = f"; revoked_sessions={revoked_sessions}" if revoke else ""
        print(f"user_id={user.id}: account_type {before} -> {user.account_type}{suffix}")
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Grant or revoke ADMIN for a user by email.")
    parser.add_argument("email", help="The user's email address")
    parser.add_argument("--revoke", action="store_true", help="Reset the account to TALENT instead")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(args.email, args.revoke)))


if __name__ == "__main__":
    main()
