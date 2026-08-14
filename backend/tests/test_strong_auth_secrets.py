from __future__ import annotations

import base64
import json
from uuid import uuid4

import pytest

from app.core.strong_auth_secrets import (
    StrongAuthSecretCipher,
    StrongAuthSecretConfigurationError,
    StrongAuthSecretContext,
    StrongAuthSecretDecryptionError,
    StrongAuthSecretEncryptionError,
    build_strong_auth_secret_cipher,
)


def _key(byte: int) -> bytes:
    return bytes([byte]) * 32


def _encoded_key(byte: int) -> str:
    return base64.urlsafe_b64encode(_key(byte)).decode("ascii").rstrip("=")


def test_secret_cipher_round_trips_without_exposing_secret_or_key() -> None:
    cipher = StrongAuthSecretCipher(keys={"active": _key(7)}, active_key_id="active")
    context = StrongAuthSecretContext(user_id=uuid4(), credential_id=uuid4())
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    envelope = cipher.encrypt(secret, context=context)

    assert secret not in envelope
    assert envelope.startswith("cj.strong-auth.v1.active.")
    assert cipher.decrypt(envelope, context=context) == secret
    assert _encoded_key(7) not in repr(cipher)


def test_ciphertext_is_bound_to_user_and_credential() -> None:
    cipher = StrongAuthSecretCipher(keys={"active": _key(8)}, active_key_id="active")
    context = StrongAuthSecretContext(user_id=uuid4(), credential_id=uuid4())
    envelope = cipher.encrypt("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", context=context)

    with pytest.raises(StrongAuthSecretDecryptionError):
        cipher.decrypt(
            envelope,
            context=StrongAuthSecretContext(
                user_id=uuid4(),
                credential_id=context.credential_id,
            ),
        )
    with pytest.raises(StrongAuthSecretDecryptionError):
        cipher.decrypt(
            envelope,
            context=StrongAuthSecretContext(
                user_id=context.user_id,
                credential_id=uuid4(),
            ),
        )


def test_rotation_reads_old_keys_and_new_writes_use_active_key() -> None:
    context = StrongAuthSecretContext(user_id=uuid4(), credential_id=uuid4())
    old = StrongAuthSecretCipher(keys={"old": _key(9)}, active_key_id="old")
    old_envelope = old.encrypt("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", context=context)
    rotated = StrongAuthSecretCipher(
        keys={"old": _key(9), "new": _key(10)},
        active_key_id="new",
    )

    assert rotated.decrypt(old_envelope, context=context).startswith("JBSW")
    assert rotated.encrypt("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", context=context).startswith(
        "cj.strong-auth.v1.new."
    )


def test_cipher_rejects_tampering_unknown_keys_and_partial_configuration() -> None:
    context = StrongAuthSecretContext(user_id=uuid4(), credential_id=uuid4())
    cipher = StrongAuthSecretCipher(keys={"active": _key(11)}, active_key_id="active")
    envelope = cipher.encrypt("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", context=context)
    prefix, payload = envelope.rsplit(".", 1)
    tamper_index = len(payload) // 2
    replacement = "A" if payload[tamper_index] != "A" else "B"
    tampered = (
        f"{prefix}.{payload[:tamper_index]}{replacement}{payload[tamper_index + 1:]}"
    )

    with pytest.raises(StrongAuthSecretDecryptionError):
        cipher.decrypt(tampered, context=context)
    with pytest.raises(StrongAuthSecretDecryptionError, match="unavailable key"):
        StrongAuthSecretCipher(keys={"other": _key(12)}, active_key_id="other").decrypt(
            envelope,
            context=context,
        )
    with pytest.raises(StrongAuthSecretConfigurationError):
        build_strong_auth_secret_cipher(
            keyring_json=json.dumps({"key": _encoded_key(13)}),
            active_key_id=None,
        )
    with pytest.raises(StrongAuthSecretConfigurationError, match="duplicate"):
        StrongAuthSecretCipher.from_json(
            keyring_json=(
                f'{{"same":"{_encoded_key(13)}","same":"{_encoded_key(14)}"}}'
            ),
            active_key_id="same",
        )


def test_builder_accepts_a_secret_keyring_and_none_only_as_a_pair() -> None:
    cipher = build_strong_auth_secret_cipher(
        keyring_json=json.dumps({"key": _encoded_key(15)}),
        active_key_id="key",
    )

    assert cipher is not None
    assert build_strong_auth_secret_cipher(
        keyring_json=None,
        active_key_id=None,
    ) is None


def test_cipher_rejects_malformed_totp_plaintext() -> None:
    context = StrongAuthSecretContext(user_id=uuid4(), credential_id=uuid4())
    cipher = StrongAuthSecretCipher(keys={"active": _key(16)}, active_key_id="active")

    with pytest.raises(StrongAuthSecretConfigurationError):
        StrongAuthSecretCipher(keys={}, active_key_id="active")
    with pytest.raises(StrongAuthSecretEncryptionError, match="invalid format"):
        cipher.encrypt("not-a-totp-secret", context=context)
