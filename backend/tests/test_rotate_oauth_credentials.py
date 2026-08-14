from __future__ import annotations

import base64
import json
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.oauth_credentials import OAuthCredentialCipher
from app.db.base import Base
from app.models import OAuthAccount, User
from app.services.oauth_credential_storage import OAuthCredentialStorage
from scripts.rotate_oauth_credentials import (
    OAuthCredentialRotationError,
    rotate_oauth_credentials,
)


def _cipher() -> OAuthCredentialCipher:
    key = base64.urlsafe_b64encode(bytes([91]) * 32).decode().rstrip("=")
    return OAuthCredentialCipher.from_json(
        keyring_json=json.dumps({"rotation_key": key}),
        active_key_id="rotation_key",
    )


async def _factory() -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _seed_legacy_account(factory: async_sessionmaker[AsyncSession]) -> uuid.UUID:
    account_id = uuid.uuid4()
    user_id = uuid.uuid4()
    async with factory() as session:
        session.add(
            User(
                id=user_id,
                email=f"rotation-{user_id}@example.com",
                username=f"rotation_{user_id.hex[:10]}",
            )
        )
        session.add(
            OAuthAccount(
                id=account_id,
                user_id=user_id,
                provider="google",
                provider_account_id=f"rotation-subject-{account_id}",
                access_token="legacy-access-secret",
                refresh_token="legacy-refresh-secret",
            )
        )
        await session.commit()
    return account_id


async def test_rotation_command_is_dry_run_by_default_and_idempotent() -> None:
    engine, factory = await _factory()
    try:
        account_id = await _seed_legacy_account(factory)
        dual = OAuthCredentialStorage(cipher=_cipher(), write_mode="dual")

        async with factory() as session:
            dry_run = await rotate_oauth_credentials(
                session,
                storage=dual,
                apply=False,
                batch_size=1,
            )
        assert dry_run.rows_scanned == 1
        assert dry_run.rows_needing_rewrap == 1
        assert dry_run.rows_rewrapped == 0

        async with factory() as session:
            unchanged = await session.get(OAuthAccount, account_id)
            assert unchanged is not None
            assert unchanged.access_token_ciphertext is None
            assert unchanged.access_token == "legacy-access-secret"

        async with factory() as session:
            applied = await rotate_oauth_credentials(
                session,
                storage=dual,
                apply=True,
                batch_size=1,
            )
        assert applied.rows_needing_rewrap == 1
        assert applied.rows_rewrapped == 1

        async with factory() as session:
            rerun = await rotate_oauth_credentials(
                session,
                storage=dual,
                apply=True,
                batch_size=1,
            )
        assert rerun.rows_needing_rewrap == 0
        assert rerun.rows_rewrapped == 0

        encrypted_only = OAuthCredentialStorage(
            cipher=_cipher(),
            write_mode="encrypted_only",
        )
        async with factory() as session:
            contracted = await rotate_oauth_credentials(
                session,
                storage=encrypted_only,
                apply=True,
                batch_size=1,
            )
        assert contracted.rows_rewrapped == 1

        async with factory() as session:
            row = (
                await session.execute(select(OAuthAccount).where(OAuthAccount.id == account_id))
            ).scalar_one()
            assert row.access_token is None
            assert row.refresh_token is None
            assert encrypted_only.read(row).access_token == "legacy-access-secret"
            assert encrypted_only.read(row).refresh_token == "legacy-refresh-secret"

            final_rerun = await rotate_oauth_credentials(
                session,
                storage=encrypted_only,
                apply=True,
                batch_size=1,
            )
            assert final_rerun.rows_needing_rewrap == 0
            assert final_rerun.rows_rewrapped == 0
    finally:
        await engine.dispose()


async def test_rotation_fails_closed_when_an_old_key_is_missing() -> None:
    engine, factory = await _factory()
    try:
        account_id = await _seed_legacy_account(factory)
        old_cipher = OAuthCredentialCipher.from_json(
            keyring_json=json.dumps(
                {"retired_key": base64.urlsafe_b64encode(bytes([7]) * 32).decode().rstrip("=")}
            ),
            active_key_id="retired_key",
        )
        old_storage = OAuthCredentialStorage(
            cipher=old_cipher,
            write_mode="encrypted_only",
        )
        async with factory() as session:
            row = await session.get(OAuthAccount, account_id)
            assert row is not None
            assert old_storage.rewrap(row) is True
            await session.commit()

        current_storage = OAuthCredentialStorage(
            cipher=_cipher(),
            write_mode="encrypted_only",
        )
        async with factory() as session:
            with pytest.raises(
                OAuthCredentialRotationError,
                match="unavailable encryption key",
            ) as exc_info:
                await rotate_oauth_credentials(
                    session,
                    storage=current_storage,
                    apply=True,
                )
        assert "legacy-access-secret" not in str(exc_info.value)
        assert "legacy-refresh-secret" not in str(exc_info.value)
    finally:
        await engine.dispose()
