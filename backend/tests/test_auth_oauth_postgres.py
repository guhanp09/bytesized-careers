from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import OAuthAccount, User
from app.repositories.auth_repository import AuthRepository, OAuthAccountCollisionError
from app.schemas.auth import OAuthGoogleExchangeRequest
from app.services.auth_service import AuthService
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


class _StaticGoogleVerifier:
    def __init__(self, identity: VerifiedGoogleIdentity):
        self.identity = identity

    async def verify(self, _raw_id_token: str) -> VerifiedGoogleIdentity:
        return self.identity


class _CoordinatedAuthRepository(AuthRepository):
    """Pause immediately before each competing OAuth write.

    Both services complete their read-side collision checks before either is
    allowed to insert. This makes the production race deterministic instead of
    relying on scheduler timing.
    """

    def __init__(self, session: AsyncSession, barrier: asyncio.Barrier):
        super().__init__(session)
        self._barrier = barrier

    async def upsert_oauth_account(
        self,
        *,
        user_id: uuid.UUID,
        provider: str,
        provider_account_id: str,
        access_token: str | None,
        refresh_token: str | None,
        expires_at: int | None,
        scope: str | None,
    ) -> OAuthAccount:
        await asyncio.wait_for(self._barrier.wait(), timeout=5)
        return await super().upsert_oauth_account(
            user_id=user_id,
            provider=provider,
            provider_account_id=provider_account_id,
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=expires_at,
            scope=scope,
        )


async def _create_user(
    factory: async_sessionmaker[AsyncSession],
    *,
    email: str,
) -> uuid.UUID:
    user_id = uuid.uuid4()
    async with factory() as session:
        session.add(
            User(
                id=user_id,
                email=email,
                username=f"pg_{user_id.hex[:12]}",
            )
        )
        await session.commit()
    return user_id


async def _exchange(
    factory: async_sessionmaker[AsyncSession],
    *,
    identity: VerifiedGoogleIdentity,
    barrier: asyncio.Barrier,
) -> uuid.UUID:
    async with factory() as session:
        service = AuthService(
            _CoordinatedAuthRepository(session, barrier),
            _StaticGoogleVerifier(identity),
        )
        user, _tokens = await service.exchange_google_oauth(
            OAuthGoogleExchangeRequest(id_token="x" * 64)
        )
        return user.id


async def _oauth_rows(
    factory: async_sessionmaker[AsyncSession],
    *,
    user_id: uuid.UUID | None = None,
    subject: str | None = None,
) -> list[OAuthAccount]:
    async with factory() as session:
        statement = select(OAuthAccount).where(OAuthAccount.provider == "google")
        if user_id is not None:
            statement = statement.where(OAuthAccount.user_id == user_id)
        if subject is not None:
            statement = statement.where(OAuthAccount.provider_account_id == subject)
        return list((await session.execute(statement)).scalars().all())


async def test_oauth_link_migration_installs_both_identity_invariants() -> None:
    factory = _session_factory()
    async with factory() as session:
        constraint_count = (
            await session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM pg_constraint
                    WHERE conrelid = 'oauth_accounts'::regclass
                      AND conname IN (
                        'uq_oauth_provider_account_id',
                        'uq_oauth_user_provider'
                      )
                    """
                )
            )
        ).scalar_one()
    assert int(constraint_count) == 2


async def test_concurrent_different_subjects_cannot_attach_to_one_user() -> None:
    factory = _session_factory()
    email = f"pg-one-user-{uuid.uuid4()}@example.com"
    user_id = await _create_user(factory, email=email)
    barrier = asyncio.Barrier(2)

    outcomes = await asyncio.gather(
        _exchange(
            factory,
            identity=VerifiedGoogleIdentity(
                subject="pg-subject-a-" + uuid.uuid4().hex,
                email=email,
                display_name="Concurrent A",
            ),
            barrier=barrier,
        ),
        _exchange(
            factory,
            identity=VerifiedGoogleIdentity(
                subject="pg-subject-b-" + uuid.uuid4().hex,
                email=email,
                display_name="Concurrent B",
            ),
            barrier=barrier,
        ),
        return_exceptions=True,
    )

    assert sum(outcome == user_id for outcome in outcomes) == 1
    assert sum(isinstance(outcome, OAuthAccountCollisionError) for outcome in outcomes) == 1
    rows = await _oauth_rows(factory, user_id=user_id)
    assert len(rows) == 1


async def test_concurrent_subject_cannot_be_claimed_by_different_users() -> None:
    factory = _session_factory()
    first_email = f"pg-subject-owner-a-{uuid.uuid4()}@example.com"
    second_email = f"pg-subject-owner-b-{uuid.uuid4()}@example.com"
    first_user_id = await _create_user(factory, email=first_email)
    second_user_id = await _create_user(factory, email=second_email)
    subject = "pg-shared-subject-" + uuid.uuid4().hex
    barrier = asyncio.Barrier(2)

    outcomes = await asyncio.gather(
        _exchange(
            factory,
            identity=VerifiedGoogleIdentity(
                subject=subject,
                email=first_email,
                display_name="Subject Owner A",
            ),
            barrier=barrier,
        ),
        _exchange(
            factory,
            identity=VerifiedGoogleIdentity(
                subject=subject,
                email=second_email,
                display_name="Subject Owner B",
            ),
            barrier=barrier,
        ),
        return_exceptions=True,
    )

    successful = [outcome for outcome in outcomes if isinstance(outcome, uuid.UUID)]
    assert len(successful) == 1
    assert successful[0] in {first_user_id, second_user_id}
    assert sum(isinstance(outcome, OAuthAccountCollisionError) for outcome in outcomes) == 1
    rows = await _oauth_rows(factory, subject=subject)
    assert len(rows) == 1
    assert rows[0].user_id == successful[0]


async def test_concurrent_same_identity_converges_on_one_link() -> None:
    factory = _session_factory()
    email = f"pg-same-identity-{uuid.uuid4()}@example.com"
    user_id = await _create_user(factory, email=email)
    identity = VerifiedGoogleIdentity(
        subject="pg-idempotent-subject-" + uuid.uuid4().hex,
        email=email,
        display_name="Idempotent Identity",
    )
    barrier = asyncio.Barrier(2)

    outcomes = await asyncio.gather(
        _exchange(factory, identity=identity, barrier=barrier),
        _exchange(factory, identity=identity, barrier=barrier),
    )

    assert outcomes == [user_id, user_id]
    assert len(await _oauth_rows(factory, user_id=user_id, subject=identity.subject)) == 1
    async with factory() as session:
        count = (
            await session.execute(
                select(func.count()).select_from(OAuthAccount).where(
                    OAuthAccount.user_id == user_id,
                    OAuthAccount.provider == "google",
                )
            )
        ).scalar_one()
    assert int(count) == 1
