from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import (
    SESSION_ID_CLAIM,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from app.models import AuthSession, PasswordResetToken, User
from app.repositories.auth_repository import AuthRepository
from app.services import auth_service
from app.services.auth_service import (
    AuthService,
    InvalidCredentialsError,
    InvalidPasswordResetTokenError,
)
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
    """Make both requests reach the family lock before either proceeds."""

    def __init__(self, session: AsyncSession, barrier: asyncio.Barrier):
        super().__init__(session)
        self._barrier = barrier

    async def get_auth_session_for_update(self, *, session_id: uuid.UUID):
        await asyncio.wait_for(self._barrier.wait(), timeout=5)
        return await super().get_auth_session_for_update(session_id=session_id)


class _CoordinatedPasswordResetRepository(AuthRepository):
    """Make login/reset competitors reach the shared user lock together."""

    def __init__(self, session: AsyncSession, barrier: asyncio.Barrier):
        super().__init__(session)
        self._barrier = barrier

    async def _wait_for_competitor(self) -> None:
        await asyncio.wait_for(self._barrier.wait(), timeout=5)

    async def get_user_by_email_for_update(self, email: str):
        await self._wait_for_competitor()
        return await super().get_user_by_email_for_update(email)

    async def get_user_by_id_for_update(self, user_id: uuid.UUID):
        await self._wait_for_competitor()
        return await super().get_user_by_id_for_update(user_id)


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


async def _coordinated_logout(
    factory: async_sessionmaker[AsyncSession],
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    barrier: asyncio.Barrier,
):
    async with factory() as session:
        service = AuthService(
            _CoordinatedRefreshRepository(session, barrier),
            _UnusedGoogleVerifier(),
        )
        return await service.revoke_current_session(
            user_id=user_id,
            session_id=session_id,
        )


async def _coordinated_password_reset(
    factory: async_sessionmaker[AsyncSession],
    *,
    reset_token: str,
    barrier: asyncio.Barrier,
):
    async with factory() as session:
        service = AuthService(
            _CoordinatedPasswordResetRepository(session, barrier),
            _UnusedGoogleVerifier(),
        )
        return await service.reset_password(
            token=reset_token,
            password="new-postgres-session-password",
        )


async def _coordinated_password_login(
    factory: async_sessionmaker[AsyncSession],
    *,
    email: str,
    barrier: asyncio.Barrier,
):
    async with factory() as session:
        service = AuthService(
            _CoordinatedPasswordResetRepository(session, barrier),
            _UnusedGoogleVerifier(),
        )
        return await service.login_with_password(
            email=email,
            password="postgres-session-password",
        )


async def _coordinated_password_reset_request(
    factory: async_sessionmaker[AsyncSession],
    *,
    email: str,
    barrier: asyncio.Barrier,
):
    async with factory() as session:
        service = AuthService(
            _CoordinatedPasswordResetRepository(session, barrier),
            _UnusedGoogleVerifier(),
        )
        return await service.request_password_reset_for_email(email=email)


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
        assurance_constraint = (
            await session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM pg_constraint
                    WHERE conrelid = 'auth_sessions'::regclass
                      AND conname = 'ck_auth_sessions_strong_auth_complete'
                      AND contype = 'c'
                    """
                )
            )
        ).scalar_one()

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
        ("auth_sessions", "strong_auth_method", "YES"),
        ("auth_sessions", "strong_auth_verified_at", "YES"),
        ("auth_sessions", "strong_auth_expires_at", "YES"),
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
    assert int(assurance_constraint) == 1


async def test_auth_session_assurance_constraint_rejects_partial_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    factory = _session_factory()
    user_id, _refresh_token = await _create_user_and_login(factory)

    async with factory() as session:
        auth_session = (
            await session.execute(
                select(AuthSession).where(AuthSession.user_id == user_id)
            )
        ).scalar_one()
        auth_session.strong_auth_method = "totp"
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


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


async def test_refresh_and_logout_share_lock_order_and_finish_revoked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    factory = _session_factory()
    user_id, original = await _create_user_and_login(factory)
    session_id = uuid.UUID(decode_refresh_token(original)[SESSION_ID_CLAIM])
    barrier = asyncio.Barrier(2)

    refresh_outcome, logout_outcome = await asyncio.wait_for(
        asyncio.gather(
            _coordinated_refresh(
                factory,
                refresh_token=original,
                barrier=barrier,
            ),
            _coordinated_logout(
                factory,
                user_id=user_id,
                session_id=session_id,
                barrier=barrier,
            ),
            return_exceptions=True,
        ),
        timeout=10,
    )

    assert logout_outcome == 1
    assert isinstance(refresh_outcome, tuple) or isinstance(
        refresh_outcome, InvalidCredentialsError
    )
    candidate_refresh = (
        refresh_outcome[1].refresh_token
        if isinstance(refresh_outcome, tuple)
        else original
    )

    async with factory() as session:
        auth_session = await session.get(AuthSession, session_id)
        assert auth_session is not None
        assert auth_session.revoked_at is not None
        assert auth_session.revocation_reason == "logout"
        service = AuthService(AuthRepository(session), _UnusedGoogleVerifier())
        with pytest.raises(InvalidCredentialsError):
            await service.refresh_backend_session(candidate_refresh)


async def test_concurrent_password_reset_has_one_winner_and_revokes_family(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    factory = _session_factory()
    user_id, original_refresh = await _create_user_and_login(factory)
    reset_token = f"postgres-reset-{uuid.uuid4().hex}"
    async with factory() as session:
        repository = AuthRepository(session)
        await repository.create_password_reset_token(
            user_id=user_id,
            token=reset_token,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        await repository.commit()

    barrier = asyncio.Barrier(2)
    outcomes = await asyncio.wait_for(
        asyncio.gather(
            _coordinated_password_reset(
                factory,
                reset_token=reset_token,
                barrier=barrier,
            ),
            _coordinated_password_reset(
                factory,
                reset_token=reset_token,
                barrier=barrier,
            ),
            return_exceptions=True,
        ),
        timeout=10,
    )

    successes = [outcome for outcome in outcomes if isinstance(outcome, User)]
    failures = [outcome for outcome in outcomes if isinstance(outcome, Exception)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], InvalidPasswordResetTokenError)

    async with factory() as session:
        user = await session.get(User, user_id)
        reset_row = (
            await session.execute(
                select(PasswordResetToken).where(
                    PasswordResetToken.token == reset_token
                )
            )
        ).scalar_one()
        auth_session = (
            await session.execute(
                select(AuthSession).where(AuthSession.user_id == user_id)
            )
        ).scalar_one()
        assert user is not None
        assert verify_password("new-postgres-session-password", user.password_hash or "")
        assert reset_row.used_at is not None
        assert auth_session.revoked_at is not None
        assert auth_session.revocation_reason == "password_reset"

        service = AuthService(AuthRepository(session), _UnusedGoogleVerifier())
        with pytest.raises(InvalidCredentialsError):
            await service.refresh_backend_session(original_refresh)


async def test_password_reset_and_old_password_login_cannot_leave_live_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_service.settings, "auth_session_mode", "persistent")
    factory = _session_factory()
    user_id, original_refresh = await _create_user_and_login(factory)
    reset_token = f"postgres-reset-login-race-{uuid.uuid4().hex}"
    async with factory() as session:
        user = await session.get(User, user_id)
        assert user is not None
        email = user.email
        repository = AuthRepository(session)
        await repository.create_password_reset_token(
            user_id=user_id,
            token=reset_token,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        await repository.commit()

    barrier = asyncio.Barrier(2)
    reset_outcome, login_outcome = await asyncio.wait_for(
        asyncio.gather(
            _coordinated_password_reset(
                factory,
                reset_token=reset_token,
                barrier=barrier,
            ),
            _coordinated_password_login(
                factory,
                email=email,
                barrier=barrier,
            ),
            return_exceptions=True,
        ),
        timeout=15,
    )

    assert isinstance(reset_outcome, User)
    assert isinstance(login_outcome, tuple) or isinstance(
        login_outcome,
        InvalidCredentialsError,
    )
    candidate_refresh = (
        login_outcome[1].refresh_token
        if isinstance(login_outcome, tuple)
        else original_refresh
    )

    async with factory() as session:
        auth_sessions = list(
            (
                await session.execute(
                    select(AuthSession).where(AuthSession.user_id == user_id)
                )
            ).scalars()
        )
        assert auth_sessions
        assert all(row.revoked_at is not None for row in auth_sessions)
        assert all(
            row.revocation_reason == "password_reset" for row in auth_sessions
        )

        service = AuthService(AuthRepository(session), _UnusedGoogleVerifier())
        with pytest.raises(InvalidCredentialsError):
            await service.refresh_backend_session(candidate_refresh)


async def test_concurrent_password_reset_requests_leave_only_one_usable_token() -> None:
    factory = _session_factory()
    user_id, _original_refresh = await _create_user_and_login(factory)
    async with factory() as session:
        user = await session.get(User, user_id)
        assert user is not None
        email = user.email

    barrier = asyncio.Barrier(2)
    outcomes = await asyncio.wait_for(
        asyncio.gather(
            _coordinated_password_reset_request(
                factory,
                email=email,
                barrier=barrier,
            ),
            _coordinated_password_reset_request(
                factory,
                email=email,
                barrier=barrier,
            ),
        ),
        timeout=10,
    )
    assert len(outcomes) == 2

    async with factory() as session:
        reset_rows = list(
            (
                await session.execute(
                    select(PasswordResetToken).where(
                        PasswordResetToken.user_id == user_id
                    )
                )
            ).scalars()
        )

    assert len(reset_rows) == 2
    assert sum(row.used_at is None for row in reset_rows) == 1
    assert sum(row.used_at is not None for row in reset_rows) == 1
