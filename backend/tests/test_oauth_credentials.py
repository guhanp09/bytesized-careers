from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime

import pytest
from conftest import TestSessionLocal, google_id_token_for_test
from pydantic import SecretStr
from sqlalchemy import select

from app.core.config import settings
from app.core.oauth_credentials import (
    OAuthCredentialCipher,
    OAuthCredentialConfigurationError,
    OAuthCredentialContext,
    OAuthCredentialDecryptionError,
    OAuthCredentialValues,
    build_oauth_credential_cipher,
)
from app.models import OAuthAccount
from app.services.oauth_credential_storage import OAuthCredentialStorage
from app.services.youtube_service import YouTubeChannelResult


def _encoded_key(byte: int) -> str:
    return base64.urlsafe_b64encode(bytes([byte]) * 32).decode().rstrip("=")


def _cipher(*, active: str = "key_2026_08") -> OAuthCredentialCipher:
    return OAuthCredentialCipher.from_json(
        keyring_json=json.dumps(
            {
                "key_2026_07": _encoded_key(7),
                "key_2026_08": _encoded_key(8),
            }
        ),
        active_key_id=active,
    )


def _account(**overrides: object) -> OAuthAccount:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "provider": "google",
        "provider_account_id": f"google-subject-{uuid.uuid4()}",
    }
    values.update(overrides)
    return OAuthAccount(**values)


def test_cipher_round_trip_is_randomized_bound_and_redacted() -> None:
    cipher = _cipher()
    context = OAuthCredentialContext(
        provider="google",
        provider_account_id="subject-123",
        field_name="access_token",
    )

    first = cipher.encrypt("provider-access-secret", context=context)
    second = cipher.encrypt("provider-access-secret", context=context)

    assert first != second
    assert "provider-access-secret" not in first
    assert first.startswith("cj.oauth.v1.key_2026_08.")
    assert cipher.decrypt(first, context=context) == "provider-access-secret"
    assert "provider-access-secret" not in repr(cipher)
    assert "provider-refresh-secret" not in repr(
        OAuthCredentialValues(
            access_token="provider-access-secret",
            refresh_token="provider-refresh-secret",
        )
    )


@pytest.mark.parametrize(
    "wrong_context",
    [
        OAuthCredentialContext("google", "different-subject", "access_token"),
        OAuthCredentialContext("google", "subject-123", "refresh_token"),
        OAuthCredentialContext("different-provider", "subject-123", "access_token"),
    ],
)
def test_cipher_rejects_context_swaps(wrong_context: OAuthCredentialContext) -> None:
    cipher = _cipher()
    context = OAuthCredentialContext("google", "subject-123", "access_token")
    envelope = cipher.encrypt("provider-secret", context=context)

    with pytest.raises(OAuthCredentialDecryptionError):
        cipher.decrypt(envelope, context=wrong_context)


def test_cipher_rejects_tampering_and_missing_rotation_key() -> None:
    cipher = _cipher()
    context = OAuthCredentialContext("google", "subject-123", "access_token")
    envelope = cipher.encrypt("provider-secret", context=context)
    prefix, payload = envelope.rsplit(".", 1)
    replacement = "A" if payload[0] != "A" else "B"
    tampered = f"{prefix}.{replacement}{payload[1:]}"

    with pytest.raises(OAuthCredentialDecryptionError):
        cipher.decrypt(tampered, context=context)

    new_key_only = OAuthCredentialCipher.from_json(
        keyring_json=json.dumps({"key_2026_08": _encoded_key(8)}),
        active_key_id="key_2026_08",
    )
    old_envelope = _cipher(active="key_2026_07").encrypt(
        "old-provider-secret",
        context=context,
    )
    with pytest.raises(OAuthCredentialDecryptionError, match="unavailable encryption key"):
        new_key_only.decrypt(old_envelope, context=context)


@pytest.mark.parametrize(
    ("keyring", "active_key_id", "message"),
    [
        (None, "key_2026_08", "OAUTH_CREDENTIAL_KEYS is required"),
        ("not-json", "key_2026_08", "must be a JSON object"),
        (
            '{"duplicate":"' + _encoded_key(7) + '","duplicate":"' + _encoded_key(8) + '"}',
            "duplicate",
            "duplicate key IDs",
        ),
        (json.dumps({"bad.key": _encoded_key(8)}), "bad.key", "key IDs"),
        (json.dumps({"short": _encoded_key(8)[:-4]}), "short", "exactly 32 bytes"),
        (json.dumps({"known": _encoded_key(8)}), "unknown", "must name a configured key"),
    ],
)
def test_keyring_configuration_fails_without_echoing_key_material(
    keyring: str | None,
    active_key_id: str,
    message: str,
) -> None:
    with pytest.raises(OAuthCredentialConfigurationError, match=message) as exc_info:
        build_oauth_credential_cipher(
            keyring_json=keyring,
            active_key_id=active_key_id,
        )

    assert _encoded_key(8) not in str(exc_info.value)


def test_dual_storage_is_rollback_compatible_and_rotation_ready() -> None:
    account = _account()
    storage = OAuthCredentialStorage(cipher=_cipher(), write_mode="dual")

    storage.write(
        account,
        access_token="access-secret",
        refresh_token="refresh-secret",
        preserve_refresh_token=False,
    )

    assert account.access_token == "access-secret"
    assert account.refresh_token == "refresh-secret"
    assert "access-secret" not in (account.access_token_ciphertext or "")
    assert "refresh-secret" not in (account.refresh_token_ciphertext or "")
    assert account.credentials_encrypted_at is not None
    assert storage.read(account).access_token == "access-secret"
    assert storage.needs_rewrap(account) is False


def test_encrypted_only_storage_clears_plaintext_and_preserves_refresh_on_update() -> None:
    account = _account()
    storage = OAuthCredentialStorage(cipher=_cipher(), write_mode="encrypted_only")
    storage.write(
        account,
        access_token="access-v1",
        refresh_token="refresh-stable",
        preserve_refresh_token=False,
    )

    assert account.access_token is None
    assert account.refresh_token is None
    storage.write(
        account,
        access_token="access-v2",
        refresh_token=None,
    )

    values = storage.read(account)
    assert values.access_token == "access-v2"
    assert values.refresh_token == "refresh-stable"
    assert account.access_token is None
    assert account.refresh_token is None


def test_encrypted_only_storage_fails_closed_without_plaintext_fallback() -> None:
    account = _account(access_token="legacy-access", refresh_token="legacy-refresh")
    storage = OAuthCredentialStorage(cipher=_cipher(), write_mode="encrypted_only")

    with pytest.raises(OAuthCredentialDecryptionError, match="Plaintext OAuth credentials"):
        storage.read(account)

    storage.write(
        account,
        access_token="trusted-access",
        refresh_token="trusted-refresh",
        preserve_refresh_token=False,
    )
    assert account.access_token_ciphertext is not None
    prefix, payload = account.access_token_ciphertext.rsplit(".", 1)
    replacement = "A" if payload[0] != "A" else "B"
    account.access_token_ciphertext = f"{prefix}.{replacement}{payload[1:]}"
    with pytest.raises(OAuthCredentialDecryptionError):
        storage.read(account)


def test_rotation_reads_old_key_and_rewraps_idempotently_with_active_key() -> None:
    account = _account()
    old_storage = OAuthCredentialStorage(
        cipher=_cipher(active="key_2026_07"),
        write_mode="encrypted_only",
    )
    old_storage.write(
        account,
        access_token="access-secret",
        refresh_token="refresh-secret",
        preserve_refresh_token=False,
    )
    assert account.access_token_ciphertext is not None
    assert ".key_2026_07." in account.access_token_ciphertext

    current_storage = OAuthCredentialStorage(cipher=_cipher(), write_mode="encrypted_only")
    assert current_storage.rewrap(account) is True
    assert account.access_token_ciphertext is not None
    assert ".key_2026_08." in account.access_token_ciphertext
    assert current_storage.read(account).refresh_token == "refresh-secret"
    assert current_storage.rewrap(account) is False


def test_encrypted_only_rewrap_backfills_and_clears_legacy_plaintext() -> None:
    account = _account(access_token="legacy-access", refresh_token="legacy-refresh")
    storage = OAuthCredentialStorage(cipher=_cipher(), write_mode="encrypted_only")

    assert storage.rewrap(account) is True
    assert account.access_token is None
    assert account.refresh_token is None
    assert storage.read(account).access_token == "legacy-access"
    assert storage.read(account).refresh_token == "legacy-refresh"
    assert storage.rewrap(account) is False


async def test_google_exchange_and_youtube_refresh_use_encrypted_credentials(
    client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    keyring = json.dumps({"test_active": _encoded_key(42)})
    monkeypatch.setattr(settings, "oauth_credential_keys", SecretStr(keyring))
    monkeypatch.setattr(settings, "oauth_credential_active_key_id", "test_active")
    monkeypatch.setattr(settings, "oauth_credential_write_mode", "encrypted_only")

    observed_access_tokens: list[str] = []

    async def fake_fetch(access_token: str) -> list[YouTubeChannelResult]:
        observed_access_tokens.append(access_token)
        return []

    monkeypatch.setattr(
        "app.services.me_service.fetch_user_youtube_channels",
        fake_fetch,
    )

    subject = f"encrypted-google-{uuid.uuid4()}"
    exchange = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "id_token": google_id_token_for_test(
                email=f"{subject}@example.com",
                subject=subject,
            ),
            "access_token": "provider-access-secret",
            "refresh_token": "provider-refresh-secret",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert exchange.status_code == 200, exchange.text

    async with TestSessionLocal() as session:
        row = (
            await session.execute(
                select(OAuthAccount).where(
                    OAuthAccount.provider == "google",
                    OAuthAccount.provider_account_id == subject,
                )
            )
        ).scalar_one()
        assert row.access_token is None
        assert row.refresh_token is None
        assert row.access_token_ciphertext is not None
        assert row.refresh_token_ciphertext is not None
        assert "provider-access-secret" not in row.access_token_ciphertext
        assert "provider-refresh-secret" not in row.refresh_token_ciphertext

    refresh = await client.post(
        "/api/v1/me/youtube/refresh",
        headers={"Authorization": f"Bearer {exchange.json()['access_token']}"},
    )
    assert refresh.status_code == 200, refresh.text
    assert observed_access_tokens == ["provider-access-secret"]
    assert "provider-access-secret" not in refresh.text
    assert "provider-refresh-secret" not in refresh.text
