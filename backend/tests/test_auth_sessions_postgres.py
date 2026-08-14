from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.models import AuthSession, User
from app.repositories.auth_repository import AuthRepository
from app.services import auth_service
from app.services.auth_service import AuthService, InvalidCredentialsError
from app.services.google_identity import VerifiedGoogleIdentity

DATABASE_URL = os.getenv("POSTGRES_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="Set POSTGRES_TEST_DATABASE_URL via scripts/test_interaction_status_postgres.sh",
)


def _session_factory() -> async_sessionmaker[AsyncSession]:
    assert DATABASE_URL
    engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class _UnusedGoogleVerifier:
    async def verify(self, _raw_id_token: str) -> VerifiedGoogleIdentity:
        raise AssertionError("Google verification is not part of this test")


class _CoordinatedRefreshRepository(AuthRepository):
    """Make both requests reach the credential lock before either proceeds."""

    def __init__(self, session: AsyncSession, barrier: asyncio.Barrier):
        super().__init__(session)
        self._barrier = barrier

    async def get_auth_refresh_credential_for_update(self, *, token_hash: str):
        await asyncio.wait_for(self._barrier.wait(), timeout=5)
        return await super().get_auth_refresh_credential_for_update(token_hash=token_hash)


async def _create_user_and_login(
    factory: async_sessionmaker[AsyncSession],
) -> tuple[uuid.UUID, str]:
    unique = uuid.uuid4().hex
    async with factory() as session:
        user = User(
            id=uuid.uuid4(),
            email=f"pg-auth-session-{unique}@example.com",
            username=f"pgsess_{unique[:12]}",
            password_hash=hash_password("postgres-session-password"),
            email_verified_at=datetime.now(UTC),
        )
        session.add(user)
        await session.commit()

        service = AuthService(AuthRepository(session), _UnusedGoogleVerifier())
        logged_in_user, tokens = await service.login_with_password(
            email=user.email,
            password="postgres-session-password",
        )
        return logged_in_user.id, tokens.refresh_token


async def _coordinated_refresh(
    factory: async_sessionmaker[AsyncSession],
    *,
    refresh_token: str,
    barrier: asyncio.Barrier,
):
    async with factory() as session:
        service = AuthService(
            _CoordinatedRefreshRepository(session, barrier),
            _UnusedGoogleVerifier(),
        )
        return await service.refresh_backend_session(refresh_token)


async def test_auth_session_migration_installs_durable_constraints_and_indexes() -> None:
    factory = _session_factory()
    async with factory() as session:
        columns = (
            await session.execute(
                text(
                    """
                    SELECT table_name, column_name, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name IN ('auth_sessions', 'auth_refresh_credentials')
                    ORDER BY table_name, ordinal_position
                    """
                )
            )
        ).all()
        foreign_keys = (
            await session.execute(
                text(
                    """
                    SELECT conrelid::regclass::text, confdeltype::text
                    FROM pg_constraint
                    WHERE conrelid IN (
                        'auth_sessions'::regclass,
                        'auth_refresh_credentials'::regclass
                    )
                      AND contype = 'f'
                    ORDER BY conrelid::regclass::text, conname
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
                          AND tablename IN ('auth_sessions', 'auth_refresh_credentials')
                        """
                    )
                )
            ).scalars()
        )

    assert columns == [
        ("auth_refresh_credentials", "id", "NO"),
        ("auth_refresh_credentials", "session_id", "NO"),
        ("auth_refresh_credentials", "token_hash", "NO"),
        ("auth_refresh_credentials", "expires_at", "NO"),
        ("auth_refresh_credentials", "issued_at", "NO"),
        ("auth_refresh_credentials", "used_at", "YES"),
        ("auth_refresh_credentials", "revoked_at", "YES"),
        ("auth_refresh_credentials", "replaced_by_id", "YES"),
        ("auth_sessions", "id", "NO"),
        ("auth_sessions", "user_id", "NO"),
        ("auth_sessions", "authentication_method", "NO"),
        ("auth_sessions", "absolute_expires_at", "NO"),
        ("auth_sessions", "last_refreshed_at", "YES"),
        ("auth_sessions", "revoked_at", "YES"),
        ("auth_sessions", "revocation_reason", "YES"),
        ("auth_sessions", "compromise_detected_at", "YES"),
        ("auth_sessions", "created_at", "NO"),
    ]
    assert foreign_keys == [
        ("auth_refresh_credentials", "n"),
        ("auth_refresh_credentials", "c"),
        ("auth_sessions", "c"),
    ]
    assert {
        "ix_auth_refresh_credentials_token_hash",
        "ix_auth_refresh_session_issued",
        "ix_auth_sessions_user_id",
    } <= indexes


async def test_concurrent_refresh_has_one_winner_without_revoking_successor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    monkeypatch.setattr(auth_service.settings, "refresh_reuse_grace_seconds", 30)
    factory = _session_factory()
    user_id, original = await _create_user_and_login(factory)
    barrier = asyncio.Barrier(2)

    outcomes = await asyncio.gather(
        _coordinated_refresh(factory, refresh_token=original, barrier=barrier),
        _coordinated_refresh(factory, refresh_token=original, barrier=barrier),
        return_exceptions=True,
    )

    successes = [outcome for outcome in outcomes if isinstance(outcome, tuple)]
    failures = [outcome for outcome in outcomes if isinstance(outcome, Exception)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], InvalidCredentialsError)
    successful_user, successful_tokens = successes[0]
    assert successful_user.id == user_id

    async with factory() as session:
        auth_session = (
            await session.execute(select(AuthSession).where(AuthSession.user_id == user_id))
        ).scalar_one()
        assert auth_session.revoked_at is None
        service = AuthService(AuthRepository(session), _UnusedGoogleVerifier())
        refreshed_user, next_tokens = await service.refresh_backend_session(
            successful_tokens.refresh_token
        )

    assert refreshed_user.id == user_id
    assert next_tokens.refresh_token != successful_tokens.refresh_token
