from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from conftest import TestSessionLocal
from sqlalchemy import delete, select

from app.models import AdminAuditLog, AuthRefreshCredential, AuthSession, User
from scripts import grant_admin


async def test_emergency_admin_revoke_demotes_and_revokes_sessions_atomically(
    monkeypatch,
    capsys,
) -> None:
    unique = uuid4().hex
    user_id = uuid4()
    active_session_id = uuid4()
    already_revoked_session_id = uuid4()
    now = datetime.now(UTC)

    async with TestSessionLocal() as session:
        session.add(
            User(
                id=user_id,
                email=f"incident-admin-{unique}@example.com",
                username=f"incident_{unique[:12]}",
                account_type="ADMIN",
            )
        )
        await session.flush()
        session.add_all(
            [
                AuthSession(
                    id=active_session_id,
                    user_id=user_id,
                    authentication_method="password",
                    absolute_expires_at=now + timedelta(days=1),
                ),
                AuthSession(
                    id=already_revoked_session_id,
                    user_id=user_id,
                    authentication_method="google",
                    absolute_expires_at=now + timedelta(days=1),
                    revoked_at=now - timedelta(minutes=1),
                    revocation_reason="logout",
                ),
            ]
        )
        await session.flush()
        session.add_all(
            [
                AuthRefreshCredential(
                    id=uuid4(),
                    session_id=active_session_id,
                    token_hash=uuid4().hex + uuid4().hex,
                    expires_at=now + timedelta(days=1),
                ),
                AuthRefreshCredential(
                    id=uuid4(),
                    session_id=already_revoked_session_id,
                    token_hash=uuid4().hex + uuid4().hex,
                    expires_at=now + timedelta(days=1),
                ),
            ]
        )
        await session.commit()

    monkeypatch.setattr(grant_admin, "SessionLocal", TestSessionLocal)
    try:
        result = await grant_admin._run(
            f"INCIDENT-ADMIN-{unique}@EXAMPLE.COM",
            revoke=True,
        )

        assert result == 0
        output = capsys.readouterr()
        assert unique not in output.out
        assert unique not in output.err
        assert "revoked_sessions=1" in output.out
        async with TestSessionLocal() as session:
            user = await session.get(User, user_id)
            assert user is not None
            assert user.account_type == "TALENT"

            sessions = list(
                (
                    await session.execute(
                        select(AuthSession)
                        .where(AuthSession.user_id == user_id)
                        .order_by(AuthSession.id)
                    )
                )
                .scalars()
                .all()
            )
            assert all(item.revoked_at is not None for item in sessions)
            assert next(
                item for item in sessions if item.id == active_session_id
            ).revocation_reason == "admin_role_revoked"
            assert next(
                item for item in sessions if item.id == already_revoked_session_id
            ).revocation_reason == "logout"

            credentials = list(
                (
                    await session.execute(
                        select(AuthRefreshCredential).where(
                            AuthRefreshCredential.session_id.in_(
                                [active_session_id, already_revoked_session_id]
                            )
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert all(item.revoked_at is not None for item in credentials)

            audit = (
                await session.execute(
                    select(AdminAuditLog).where(
                        AdminAuditLog.target_id == str(user_id),
                        AdminAuditLog.action == "admin.role.revoke",
                    )
                )
            ).scalar_one()
            assert audit.actor_user_id is None
            assert audit.target_label == "Account role"
            assert audit.before_json == {"account_type": "ADMIN"}
            assert audit.after_json == {
                "account_type": "TALENT",
                "revoked_sessions": 1,
            }
            assert audit.justification == "Operator CLI role change"
    finally:
        async with TestSessionLocal() as session:
            await session.execute(
                delete(AdminAuditLog).where(AdminAuditLog.target_id == str(user_id))
            )
            user = await session.get(User, user_id)
            if user is not None:
                await session.delete(user)
            await session.commit()


async def test_admin_grant_records_a_bounded_operator_audit_event(
    monkeypatch,
    capsys,
) -> None:
    unique = uuid4().hex
    user_id = uuid4()

    async with TestSessionLocal() as session:
        session.add(
            User(
                id=user_id,
                email=f"grant-admin-{unique}@example.com",
                username=f"grant_{unique[:12]}",
                account_type="TALENT",
            )
        )
        await session.commit()

    monkeypatch.setattr(grant_admin, "SessionLocal", TestSessionLocal)
    try:
        assert await grant_admin._run(
            f"grant-admin-{unique}@example.com",
            revoke=False,
        ) == 0
        output = capsys.readouterr()
        assert unique not in output.out
        assert unique not in output.err

        async with TestSessionLocal() as session:
            user = await session.get(User, user_id)
            assert user is not None
            assert user.account_type == "ADMIN"
            audit = (
                await session.execute(
                    select(AdminAuditLog).where(
                        AdminAuditLog.target_id == str(user_id),
                        AdminAuditLog.action == "admin.role.grant",
                    )
                )
            ).scalar_one()
            assert audit.before_json == {"account_type": "TALENT"}
            assert audit.after_json == {
                "account_type": "ADMIN",
                "revoked_sessions": 0,
            }
    finally:
        async with TestSessionLocal() as session:
            await session.execute(
                delete(AdminAuditLog).where(AdminAuditLog.target_id == str(user_id))
            )
            user = await session.get(User, user_id)
            if user is not None:
                await session.delete(user)
            await session.commit()
