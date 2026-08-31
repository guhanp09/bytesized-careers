"""Audit and rewrap encrypted TOTP factors without exposing their secrets.

The command is dry-run by default. For a planned key rotation, configure both
the old and new keys, name the new key active, then run:

    .venv/bin/python -m scripts.rotate_strong_auth_secrets
    .venv/bin/python -m scripts.rotate_strong_auth_secrets --apply --confirm staging

Each pass verifies authenticated decryption for every row. Apply mode locks and
commits bounded batches, so interruption is safe to resume. Remove an old key
only after a final dry run reports zero rows needing rewrap.

This is cryptographic maintenance, not compromise recovery. If an attacker may
have obtained a decrypted TOTP seed, re-encryption cannot make them forget it;
the affected factor must be disabled/re-enrolled and its sessions contained.
Output contains counts and the active key ID only, never factor secrets.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import NoReturn
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import settings  # noqa: E402
from app.core.strong_auth_secrets import (  # noqa: E402
    StrongAuthSecretCipher,
    StrongAuthSecretConfigurationError,
    StrongAuthSecretContext,
    StrongAuthSecretDecryptionError,
    StrongAuthSecretEncryptionError,
    build_strong_auth_secret_cipher,
)
from app.db.session import SessionLocal, engine  # noqa: E402
from app.models import StrongAuthTotpCredential  # noqa: E402


@dataclass
class StrongAuthSecretRotationResult:
    dry_run: bool
    active_key_id: str
    rows_scanned: int = 0
    rows_needing_rewrap: int = 0
    rows_rewrapped: int = 0


class StrongAuthSecretRotationError(RuntimeError):
    pass


def _context(credential: StrongAuthTotpCredential) -> StrongAuthSecretContext:
    return StrongAuthSecretContext(
        user_id=credential.user_id,
        credential_id=credential.id,
    )


async def rotate_strong_auth_secrets(
    session: AsyncSession,
    *,
    cipher: StrongAuthSecretCipher,
    apply: bool,
    batch_size: int = 100,
) -> StrongAuthSecretRotationResult:
    if batch_size < 1 or batch_size > 1000:
        raise StrongAuthSecretRotationError("Batch size must be between 1 and 1000.")

    result = StrongAuthSecretRotationResult(
        dry_run=not apply,
        active_key_id=cipher.active_key_id,
    )
    last_id: UUID | None = None

    while True:
        statement = (
            select(StrongAuthTotpCredential)
            .order_by(StrongAuthTotpCredential.id)
            .limit(batch_size)
        )
        if last_id is not None:
            statement = statement.where(StrongAuthTotpCredential.id > last_id)
        if apply:
            # Enrollment/challenge paths lock the credential before changing it.
            # The same lock prevents a stale rewrap from replacing a newer seed.
            statement = statement.with_for_update()
        rows = list((await session.execute(statement)).scalars().all())
        if not rows:
            break

        for credential in rows:
            credential_id = credential.id
            context = _context(credential)
            result.rows_scanned += 1
            try:
                key_id = cipher.key_id_from_envelope(credential.secret_ciphertext)
                secret = cipher.decrypt(
                    credential.secret_ciphertext,
                    context=context,
                )
                if key_id != cipher.active_key_id:
                    result.rows_needing_rewrap += 1
                    if apply:
                        credential.secret_ciphertext = cipher.encrypt(
                            secret,
                            context=context,
                        )
                        result.rows_rewrapped += 1
            except (
                StrongAuthSecretDecryptionError,
                StrongAuthSecretEncryptionError,
            ) as exc:
                await session.rollback()
                raise StrongAuthSecretRotationError(
                    f"Strong-auth credential {credential_id} could not be safely rewrapped: {exc}"
                ) from exc
            last_id = credential_id

        if apply:
            await session.commit()
        else:
            # Inspection is currently read-only; rollback keeps it that way if
            # later auditing code accidentally mutates a mapped object.
            await session.rollback()

    return result


def _fail(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit or rotate encrypted strong-authentication secrets."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist bounded, idempotent rewrap batches. Default is dry-run.",
    )
    parser.add_argument(
        "--confirm",
        help="Required with --apply and must exactly match APP_ENV.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Rows per commit (1-1000; default 100).",
    )
    return parser.parse_args()


async def _run(args: argparse.Namespace) -> StrongAuthSecretRotationResult:
    if args.apply and (args.confirm or "").strip().lower() != settings.app_env:
        raise StrongAuthSecretRotationError(
            f"Confirmation mismatch: pass --confirm {settings.app_env} for "
            f"APP_ENV={settings.app_env}."
        )

    keyring_json = (
        settings.strong_auth_secret_keys.get_secret_value()
        if settings.strong_auth_secret_keys is not None
        else None
    )
    try:
        cipher = build_strong_auth_secret_cipher(
            keyring_json=keyring_json,
            active_key_id=settings.strong_auth_secret_active_key_id,
        )
    except StrongAuthSecretConfigurationError as exc:
        raise StrongAuthSecretRotationError(str(exc)) from exc
    if cipher is None:
        raise StrongAuthSecretRotationError(
            "Strong-auth rotation requires a configured keyring and active key."
        )

    async with SessionLocal() as session:
        return await rotate_strong_auth_secrets(
            session,
            cipher=cipher,
            apply=args.apply,
            batch_size=args.batch_size,
        )


async def _main() -> None:
    args = _parse_args()
    try:
        result = await _run(args)
    except StrongAuthSecretRotationError as exc:
        _fail(str(exc))
    finally:
        await engine.dispose()
    print(json.dumps(asdict(result), indent=2, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(_main())
