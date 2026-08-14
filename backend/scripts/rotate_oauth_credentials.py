"""Audit, backfill, and rotate stored OAuth credentials without exposing them.

The command is dry-run by default. It reads the server-owned keyring and write
mode from the ordinary backend environment:

    .venv/bin/python -m scripts.rotate_oauth_credentials
    .venv/bin/python -m scripts.rotate_oauth_credentials --apply --confirm staging

Run once in `dual` mode to create rollback-compatible ciphertext, then again in
`encrypted_only` mode to rewrap with the active key and clear plaintext. Each
pass is idempotent and commits bounded batches; an interrupted run is safe to
resume. The JSON result contains counts and key IDs only, never credentials.
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
from app.core.oauth_credentials import (  # noqa: E402
    OAuthCredentialConfigurationError,
    OAuthCredentialDecryptionError,
    OAuthCredentialEncryptionError,
)
from app.db.session import SessionLocal, engine  # noqa: E402
from app.models import OAuthAccount  # noqa: E402
from app.services.oauth_credential_storage import OAuthCredentialStorage  # noqa: E402


@dataclass
class OAuthCredentialRotationResult:
    dry_run: bool
    write_mode: str
    active_key_id: str
    rows_scanned: int = 0
    rows_needing_rewrap: int = 0
    rows_rewrapped: int = 0


class OAuthCredentialRotationError(RuntimeError):
    pass


async def rotate_oauth_credentials(
    session: AsyncSession,
    *,
    storage: OAuthCredentialStorage,
    apply: bool,
    batch_size: int = 100,
) -> OAuthCredentialRotationResult:
    if storage.write_mode == "plaintext" or storage.cipher is None:
        raise OAuthCredentialRotationError(
            "Credential rotation requires dual or encrypted_only mode with a valid keyring."
        )
    if batch_size < 1 or batch_size > 1000:
        raise OAuthCredentialRotationError("Batch size must be between 1 and 1000.")

    result = OAuthCredentialRotationResult(
        dry_run=not apply,
        write_mode=storage.write_mode,
        active_key_id=storage.cipher.active_key_id,
    )
    last_id: UUID | None = None

    while True:
        statement = select(OAuthAccount).order_by(OAuthAccount.id).limit(batch_size)
        if last_id is not None:
            statement = statement.where(OAuthAccount.id > last_id)
        if apply:
            # Serialize each rewrite against normal OAuth token updates so a
            # stale backfill read cannot overwrite a newly issued credential.
            statement = statement.with_for_update()
        rows = list((await session.execute(statement)).scalars().all())
        if not rows:
            break

        for account in rows:
            account_id = account.id
            result.rows_scanned += 1
            try:
                if storage.needs_rewrap(account):
                    result.rows_needing_rewrap += 1
                    if apply and storage.rewrap(account):
                        result.rows_rewrapped += 1
            except (
                OAuthCredentialConfigurationError,
                OAuthCredentialDecryptionError,
                OAuthCredentialEncryptionError,
            ) as exc:
                await session.rollback()
                raise OAuthCredentialRotationError(
                    f"OAuth account {account_id} could not be safely rewrapped: {exc}"
                ) from exc
            last_id = account_id

        if apply:
            await session.commit()
        else:
            # No mutation occurs in dry-run, but rollback guarantees future
            # changes to inspection code cannot accidentally persist state.
            await session.rollback()

    return result


def _fail(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit or rotate application-encrypted OAuth credentials."
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


async def _run(args: argparse.Namespace) -> OAuthCredentialRotationResult:
    if args.apply and (args.confirm or "").strip().lower() != settings.app_env:
        raise OAuthCredentialRotationError(
            f"Confirmation mismatch: pass --confirm {settings.app_env} for APP_ENV={settings.app_env}."
        )
    try:
        storage = OAuthCredentialStorage.from_settings(settings)
    except OAuthCredentialConfigurationError as exc:
        raise OAuthCredentialRotationError(str(exc)) from exc

    async with SessionLocal() as session:
        return await rotate_oauth_credentials(
            session,
            storage=storage,
            apply=args.apply,
            batch_size=args.batch_size,
        )


async def _main() -> None:
    args = _parse_args()
    try:
        result = await _run(args)
    except OAuthCredentialRotationError as exc:
        _fail(str(exc))
    finally:
        await engine.dispose()
    print(json.dumps(asdict(result), indent=2, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(_main())
