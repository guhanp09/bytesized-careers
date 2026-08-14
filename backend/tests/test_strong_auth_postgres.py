from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.deps import AuthenticatedAccessContext
from app.core.security import SESSION_ID_CLAIM, decode_access_token, hash_password
from app.core.strong_auth_secrets import StrongAuthSecretCipher, StrongAuthSecretContext
from app.core.totp import generate_totp_secret, totp_code_at
from app.models import AdminAuditLog, AuthSession, StrongAuthTotpCredential, User
from app.repositories.auth_repository import AuthRepository
from app.services import auth_service
from app.services.auth_service import AuthService
from app.services.google_identity import VerifiedGoogleIdentity
from app.services.strong_auth_service import (
    StrongAuthInvalidCodeError,
    StrongAuthService,
)

DATABASE_URL = os.getenv("POSTGRES_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="Set POSTGRES_TEST_DATABASE_URL via scripts/test_interaction_status_postgres.sh",
)


def _session_factory() -> async_sessionmaker[AsyncSession]:
    assert DATABASE_URL
    engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def _cipher() -> StrongAuthSecretCipher:
    return StrongAuthSecretCipher(
        keys={"postgres_test": bytes([83]) * 32},
        active_key_id="postgres_test",
    )


class _UnusedGoogleVerifier:
    async def verify(self, _raw_id_token: str) -> VerifiedGoogleIdentity:
        raise AssertionError("Google verification is not part of this test")


async def test_strong_auth_migration_installs_exact_constraints_and_indexes() -> None:
    factory = _session_factory()
    async with factory() as session:
        columns = (
            await session.execute(
                text(
                    """
                    SELECT table_name, column_name, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name IN (
                        'strong_auth_totp_credentials',
                        'strong_auth_recovery_codes'
                      )
                    ORDER BY table_name, ordinal_position
                    """
                )
            )
        ).all()
        constraints = set(
            (
                await session.execute(
                    text(
                        """
                        SELECT conname
                        FROM pg_constraint
                        WHERE conrelid IN (
                            'strong_auth_totp_credentials'::regclass,
                            'strong_auth_recovery_codes'::regclass
                        )
                        """
                    )
                )
            ).scalars()
        )
        foreign_keys = (
            await session.execute(
                text(
                    """
                    SELECT conrelid::regclass::text, confdeltype::text
                    FROM pg_constraint
                    WHERE conrelid IN (
                        'strong_auth_totp_credentials'::regclass,
                        'strong_auth_recovery_codes'::regclass
                    )
                      AND contype = 'f'
                    ORDER BY conrelid::regclass::text
                    """
                )
            )
        ).all()
        indexes = set(
            (
                await session.execute(
                    text(
                        """
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = current_schema()
                          AND tablename IN (
                            'strong_auth_totp_credentials',
                            'strong_auth_recovery_codes'
                          )
                        """
                    )
                )
            ).scalars()
        )

    assert columns == [
        ("strong_auth_recovery_codes", "id", "NO"),
        ("strong_auth_recovery_codes", "credential_id", "NO"),
        ("strong_auth_recovery_codes", "code_hash", "NO"),
        ("strong_auth_recovery_codes", "used_at", "YES"),
        ("strong_auth_recovery_codes", "created_at", "NO"),
        ("strong_auth_totp_credentials", "id", "NO"),
        ("strong_auth_totp_credentials", "user_id", "NO"),
        ("strong_auth_totp_credentials", "secret_ciphertext", "NO"),
        ("strong_auth_totp_credentials", "confirmed_at", "YES"),
        ("strong_auth_totp_credentials", "enrollment_expires_at", "YES"),
        ("strong_auth_totp_credentials", "last_used_step", "YES"),
        ("strong_auth_totp_credentials", "failed_attempt_count", "NO"),
        ("strong_auth_totp_credentials", "locked_until", "YES"),
        ("strong_auth_totp_credentials", "created_at", "NO"),
        ("strong_auth_totp_credentials", "updated_at", "NO"),
    ]
    assert {
        "ck_strong_auth_totp_failed_attempts",
        "ck_strong_auth_totp_lifecycle",
        "uq_strong_auth_recovery_code_hash",
        "uq_strong_auth_totp_user",
    } <= constraints
    assert foreign_keys == [
        ("strong_auth_recovery_codes", "c"),
        ("strong_auth_totp_credentials", "c"),
    ]
    assert {
        "ix_strong_auth_recovery_codes_credential_id",
        "ix_strong_auth_totp_credentials_user_id",
    } <= indexes


async def test_strong_auth_database_constraints_reject_partial_or_unbounded_state() -> None:
    factory = _session_factory()
    async with factory() as session:
        user = User(
            id=uuid.uuid4(),
            email=f"strong-auth-constraint-{uuid.uuid4().hex}@example.com",
            username=f"mfapg_{uuid.uuid4().hex[:12]}",
            password_hash=hash_password("postgres-strong-auth-password"),
            email_verified_at=datetime.now(UTC),
            account_type="ADMIN",
        )
        session.add(user)
        await session.commit()
        user_id = user.id
        session.add(
            StrongAuthTotpCredential(
                id=uuid.uuid4(),
                user_id=user_id,
                secret_ciphertext="ciphertext",
                enrollment_expires_at=None,
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

        session.add(
            StrongAuthTotpCredential(
                id=uuid.uuid4(),
                user_id=user_id,
                secret_ciphertext="ciphertext",
                enrollment_expires_at=datetime.now(UTC) + timedelta(minutes=10),
                failed_attempt_count=6,
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


async def _challenge(
    factory: async_sessionmaker[AsyncSession],
    *,
    context: AuthenticatedAccessContext,
    code: str,
    barrier: asyncio.Barrier,
):
    async with factory() as session:
        await asyncio.wait_for(barrier.wait(), timeout=5)
        service = StrongAuthService(
            session,
            cipher=_cipher(),
            google_identity_verifier=_UnusedGoogleVerifier(),
        )
        return await service.challenge(context, method="totp", code=code)


async def test_concurrent_totp_replay_has_exactly_one_winner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    monkeypatch.setattr(
        auth_service.settings,
        "admin_strong_auth_max_age_minutes",
        15,
    )
    factory = _session_factory()
    unique = uuid.uuid4().hex
    password = "postgres-strong-auth-password"
    async with factory() as session:
        user = User(
            id=uuid.uuid4(),
            email=f"strong-auth-race-{unique}@example.com",
            username=f"mfarace_{unique[:10]}",
            password_hash=hash_password(password),
            email_verified_at=datetime.now(UTC),
            account_type="ADMIN",
        )
        session.add(user)
        await session.commit()
        service = AuthService(AuthRepository(session), _UnusedGoogleVerifier())
        first_user, first = await service.login_with_password(
            email=user.email,
            password=password,
        )
        _second_user, second = await service.login_with_password(
            email=user.email,
            password=password,
        )
        secret = generate_totp_secret()
        credential_id = uuid.uuid4()
        session.add(
            StrongAuthTotpCredential(
                id=credential_id,
                user_id=user.id,
                secret_ciphertext=_cipher().encrypt(
                    secret,
                    context=StrongAuthSecretContext(
                        user_id=user.id,
                        credential_id=credential_id,
                    ),
                ),
                confirmed_at=datetime.now(UTC),
                enrollment_expires_at=None,
            )
        )
        await session.commit()

    contexts = [
        AuthenticatedAccessContext(
            user=first_user,
            session_id=uuid.UUID(decode_access_token(token)[SESSION_ID_CLAIM]),
        )
        for token in (first.access_token, second.access_token)
    ]
    code = totp_code_at(secret)
    barrier = asyncio.Barrier(2)
    outcomes = await asyncio.wait_for(
        asyncio.gather(
            *(
                _challenge(
                    factory,
                    context=context,
                    code=code,
                    barrier=barrier,
                )
                for context in contexts
            ),
            return_exceptions=True,
        ),
        timeout=10,
    )

    successes = [outcome for outcome in outcomes if not isinstance(outcome, Exception)]
    failures = [outcome for outcome in outcomes if isinstance(outcome, Exception)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], StrongAuthInvalidCodeError)

    async with factory() as session:
        elevated_sessions = (
            await session.execute(
                select(func.count(AuthSession.id)).where(
                    AuthSession.user_id == first_user.id,
                    AuthSession.strong_auth_method == "totp",
                )
            )
        ).scalar_one()
        credential = (
            await session.execute(
                select(StrongAuthTotpCredential).where(
                    StrongAuthTotpCredential.user_id == first_user.id
                )
            )
        ).scalar_one()
        succeeded_audits = (
            await session.execute(
                select(func.count(AdminAuditLog.id)).where(
                    AdminAuditLog.actor_user_id == first_user.id,
                    AdminAuditLog.action == "auth.strong_auth.challenge_succeeded",
                )
            )
        ).scalar_one()
        failed_audits = (
            await session.execute(
                select(func.count(AdminAuditLog.id)).where(
                    AdminAuditLog.actor_user_id == first_user.id,
                    AdminAuditLog.action == "auth.strong_auth.challenge_failed",
                )
            )
        ).scalar_one()
        assert int(elevated_sessions) == 1
        assert credential.failed_attempt_count == 1
        assert int(succeeded_audits) == 1
        assert int(failed_audits) == 1
