"""Grant (or revoke) the ADMIN account type for a user, by email.

This is the ONLY sanctioned way to mint a production admin
(docs/ADMIN_PANEL_PLAN.md §9): admin is never assignable through any API, and
public signup/onboarding cannot select it. Run manually, with database access,
from backend/:

    .venv/bin/python -m scripts.grant_admin admin@example.com
    .venv/bin/python -m scripts.grant_admin admin@example.com --revoke

Revoking resets the account to TALENT (the safe default; the user can change
their mode through normal onboarding afterwards).
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import User


async def _run(email: str, revoke: bool) -> int:
    async with SessionLocal() as session:
        user = (
            await session.execute(select(User).where(User.email == email.strip().lower()))
        ).scalar_one_or_none()
        if user is None:
            print(f"No user found with email {email!r}", file=sys.stderr)
            return 1
        before = user.account_type
        user.account_type = "TALENT" if revoke else "ADMIN"
        await session.commit()
        print(f"{user.email}: account_type {before} -> {user.account_type}")
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Grant or revoke ADMIN for a user by email.")
    parser.add_argument("email", help="The user's email address")
    parser.add_argument("--revoke", action="store_true", help="Reset the account to TALENT instead")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(args.email, args.revoke)))


if __name__ == "__main__":
    main()
