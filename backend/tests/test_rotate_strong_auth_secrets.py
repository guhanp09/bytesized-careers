from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.strong_auth_secrets import (
    StrongAuthSecretCipher,
    StrongAuthSecretContext,
)
from app.db.base import Base
from app.models import StrongAuthTotpCredential, User
from scripts.rotate_strong_auth_secrets import (
    StrongAuthSecretRotationError,
    rotate_strong_auth_secrets,
)

TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"


def _key(byte: int) -> bytes:
    return bytes([byte]) * 32


def _cipher(*, active: str, include_old: bool = True) -> StrongAuthSecretCipher:
    keys = {"new_key": _key(61)}
    if include_old:
        keys["old_key"] = _key(17)
    return StrongAuthSecretCipher(keys=keys, active_key_id=active)


async def _factory() -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _seed_credential(
    factory: async_sessionmaker[AsyncSession],
    *,
    cipher: StrongAuthSecretCipher,
    confirmed: bool,
) -> uuid.UUID:
    user_id = uuid.uuid4()
    credential_id = uuid.uuid4()
    context = StrongAuthSecretContext(user_id=user_id, credential_id=credential_id)
    async with factory() as session:
        session.add(
            User(
                id=user_id,
                email=f"factor-{user_id}@example.com",
                username=f"factor_{user_id.hex[:10]}",
            )
        )
        session.add(
            StrongAuthTotpCredential(
                id=credential_id,
                user_id=user_id,
                secret_ciphertext=cipher.encrypt(TOTP_SECRET, context=context),
                enrollment_expires_at=(
                    None if confirmed else datetime.now(UTC) + timedelta(hours=1)
                ),
                confirmed_at=datetime.now(UTC) if confirmed else None,
            )
        )
        await session.commit()
    return credential_id


async def test_rotation_is_dry_run_first_bounded_and_idempotent() -> None:
    engine, factory = await _factory()
    try:
        old_id = await _seed_credential(
            factory,
            cipher=_cipher(active="old_key"),
            confirmed=True,
        )
        new_id = await _seed_credential(
            factory,
            cipher=_cipher(active="new_key"),
            confirmed=False,
        )
        current = _cipher(active="new_key")

        async with factory() as session:
            dry_run = await rotate_strong_auth_secrets(
                session,
                cipher=current,
                apply=False,
                batch_size=1,
            )
        assert dry_run.rows_scanned == 2
        assert dry_run.rows_needing_rewrap == 1
        assert dry_run.rows_rewrapped == 0

        async with factory() as session:
            unchanged = await session.get(StrongAuthTotpCredential, old_id)
            assert unchanged is not None
            assert current.key_id_from_envelope(unchanged.secret_ciphertext) == "old_key"

        async with factory() as session:
            applied = await rotate_strong_auth_secrets(
                session,
                cipher=current,
                apply=True,
                batch_size=1,
            )
        assert applied.rows_needing_rewrap == 1
        assert applied.rows_rewrapped == 1

        async with factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(StrongAuthTotpCredential).where(
                            StrongAuthTotpCredential.id.in_([old_id, new_id])
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(rows) == 2
            for row in rows:
                context = StrongAuthSecretContext(
                    user_id=row.user_id,
                    credential_id=row.id,
                )
                assert current.key_id_from_envelope(row.secret_ciphertext) == "new_key"
                assert current.decrypt(row.secret_ciphertext, context=context) == TOTP_SECRET

            rerun = await rotate_strong_auth_secrets(
                session,
                cipher=current,
                apply=True,
                batch_size=1,
            )
            assert rerun.rows_needing_rewrap == 0
            assert rerun.rows_rewrapped == 0
    finally:
        await engine.dispose()


async def test_rotation_fails_closed_when_the_old_key_is_missing() -> None:
    engine, factory = await _factory()
    try:
        await _seed_credential(
            factory,
            cipher=_cipher(active="old_key"),
            confirmed=True,
        )
        without_old = _cipher(active="new_key", include_old=False)

        async with factory() as session:
            with pytest.raises(
                StrongAuthSecretRotationError,
                match="unavailable key",
            ) as exc_info:
                await rotate_strong_auth_secrets(
                    session,
                    cipher=without_old,
                    apply=True,
                )
        assert TOTP_SECRET not in str(exc_info.value)
    finally:
        await engine.dispose()


@pytest.mark.parametrize("batch_size", [0, 1001])
async def test_rotation_refuses_unbounded_batch_sizes(batch_size: int) -> None:
    engine, factory = await _factory()
    try:
        async with factory() as session:
            with pytest.raises(StrongAuthSecretRotationError, match="between 1 and 1000"):
                await rotate_strong_auth_secrets(
                    session,
                    cipher=_cipher(active="new_key"),
                    apply=False,
                    batch_size=batch_size,
                )
    finally:
        await engine.dispose()
