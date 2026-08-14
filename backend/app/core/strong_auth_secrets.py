from __future__ import annotations

import base64
import binascii
import json
import re
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVELOPE_PREFIX = "cj.strong-auth.v1"
KEY_BYTES = 32
NONCE_BYTES = 12
MAX_KEYS = 16
MAX_SECRET_BYTES = 256
MAX_ENVELOPE_BYTES = 1024
KEY_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
TOTP_SECRET_PATTERN = re.compile(r"^[A-Z2-7]{32}$")


class StrongAuthSecretConfigurationError(RuntimeError):
    """The server-owned strong-auth secret keyring is unusable."""


class StrongAuthSecretEncryptionError(RuntimeError):
    """A factor secret cannot be safely encrypted."""


class StrongAuthSecretDecryptionError(RuntimeError):
    """A stored factor secret failed authenticated decryption."""


@dataclass(frozen=True)
class StrongAuthSecretContext:
    user_id: UUID
    credential_id: UUID

    def additional_authenticated_data(self) -> bytes:
        return json.dumps(
            [ENVELOPE_PREFIX, str(self.user_id), str(self.credential_id), "totp_secret"],
            separators=(",", ":"),
        ).encode("ascii")


def _decode_key(raw_value: str) -> bytes:
    try:
        encoded = raw_value.strip().encode("ascii")
        key = base64.b64decode(
            encoded + b"=" * (-len(encoded) % 4),
            altchars=b"-_",
            validate=True,
        )
    except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
        raise StrongAuthSecretConfigurationError(
            "Strong-auth secret keys must use valid base64/base64url encoding."
        ) from exc
    if len(key) != KEY_BYTES:
        raise StrongAuthSecretConfigurationError(
            "Every strong-auth secret key must decode to exactly 32 bytes."
        )
    return key


def _object_without_duplicate_keys(
    pairs: list[tuple[str, object]],
) -> dict[str, object]:
    parsed: dict[str, object] = {}
    for key, value in pairs:
        if key in parsed:
            raise StrongAuthSecretConfigurationError(
                "STRONG_AUTH_SECRET_KEYS must not contain duplicate key IDs."
            )
        parsed[key] = value
    return parsed


class StrongAuthSecretCipher:
    """Domain-separated AES-256-GCM encryption with rotation-ready key IDs."""

    def __init__(self, *, keys: Mapping[str, bytes], active_key_id: str):
        if not keys:
            raise StrongAuthSecretConfigurationError(
                "At least one strong-auth secret key is required."
            )
        if len(keys) > MAX_KEYS:
            raise StrongAuthSecretConfigurationError(
                f"At most {MAX_KEYS} strong-auth secret keys may be configured."
            )
        normalized: dict[str, bytes] = {}
        for key_id, key in keys.items():
            if not KEY_ID_PATTERN.fullmatch(key_id):
                raise StrongAuthSecretConfigurationError(
                    "Strong-auth key IDs must contain only letters, numbers, underscores, "
                    "or hyphens and be at most 64 characters."
                )
            key_bytes = bytes(key)
            if len(key_bytes) != KEY_BYTES:
                raise StrongAuthSecretConfigurationError(
                    "Every strong-auth secret key must contain exactly 32 bytes."
                )
            normalized[key_id] = key_bytes
        if active_key_id not in normalized:
            raise StrongAuthSecretConfigurationError(
                "STRONG_AUTH_SECRET_ACTIVE_KEY_ID must name a configured key."
            )
        self._keys = normalized
        self.active_key_id = active_key_id

    def __repr__(self) -> str:
        return (
            "StrongAuthSecretCipher("
            f"active_key_id={self.active_key_id!r}, key_count={len(self._keys)})"
        )

    @classmethod
    def from_json(
        cls,
        *,
        keyring_json: str,
        active_key_id: str,
    ) -> StrongAuthSecretCipher:
        if len(keyring_json) > 32 * 1024:
            raise StrongAuthSecretConfigurationError(
                "STRONG_AUTH_SECRET_KEYS exceeds the maximum configuration size."
            )
        try:
            parsed = json.loads(
                keyring_json,
                object_pairs_hook=_object_without_duplicate_keys,
            )
        except json.JSONDecodeError as exc:
            raise StrongAuthSecretConfigurationError(
                "STRONG_AUTH_SECRET_KEYS must be a JSON object."
            ) from exc
        if not isinstance(parsed, dict) or not all(
            isinstance(key_id, str) and isinstance(raw_key, str)
            for key_id, raw_key in parsed.items()
        ):
            raise StrongAuthSecretConfigurationError(
                "STRONG_AUTH_SECRET_KEYS must map key IDs to base64-encoded keys."
            )
        if not active_key_id:
            raise StrongAuthSecretConfigurationError(
                "STRONG_AUTH_SECRET_ACTIVE_KEY_ID is required with a keyring."
            )
        return cls(
            keys={key_id: _decode_key(raw_key) for key_id, raw_key in parsed.items()},
            active_key_id=active_key_id,
        )

    @staticmethod
    def _encode(raw_value: bytes) -> str:
        return base64.urlsafe_b64encode(raw_value).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_payload(raw_value: str) -> bytes:
        if len(raw_value) > MAX_ENVELOPE_BYTES:
            raise StrongAuthSecretDecryptionError(
                "Stored strong-auth secret could not be decrypted."
            )
        try:
            encoded = raw_value.encode("ascii")
            return base64.b64decode(
                encoded + b"=" * (-len(encoded) % 4),
                altchars=b"-_",
                validate=True,
            )
        except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
            raise StrongAuthSecretDecryptionError(
                "Stored strong-auth secret could not be decrypted."
            ) from exc

    @staticmethod
    def key_id_from_envelope(envelope: str) -> str:
        parts = envelope.split(".", 4)
        if len(parts) != 5 or ".".join(parts[:3]) != ENVELOPE_PREFIX:
            raise StrongAuthSecretDecryptionError(
                "Stored strong-auth secret has an unsupported encryption envelope."
            )
        key_id = parts[3]
        if not KEY_ID_PATTERN.fullmatch(key_id):
            raise StrongAuthSecretDecryptionError(
                "Stored strong-auth secret has an unsupported encryption envelope."
            )
        return key_id

    def encrypt(self, secret: str, *, context: StrongAuthSecretContext) -> str:
        try:
            plaintext = secret.encode("ascii")
        except UnicodeEncodeError as exc:
            raise StrongAuthSecretEncryptionError(
                "Strong-auth secret has an invalid format."
            ) from exc
        if (
            len(plaintext) > MAX_SECRET_BYTES
            or TOTP_SECRET_PATTERN.fullmatch(secret) is None
        ):
            raise StrongAuthSecretEncryptionError(
                "Strong-auth secret has an invalid format."
            )
        nonce = secrets.token_bytes(NONCE_BYTES)
        ciphertext = AESGCM(self._keys[self.active_key_id]).encrypt(
            nonce,
            plaintext,
            context.additional_authenticated_data(),
        )
        return f"{ENVELOPE_PREFIX}.{self.active_key_id}.{self._encode(nonce + ciphertext)}"

    def decrypt(self, envelope: str, *, context: StrongAuthSecretContext) -> str:
        key_id = self.key_id_from_envelope(envelope)
        key = self._keys.get(key_id)
        if key is None:
            raise StrongAuthSecretDecryptionError(
                "Stored strong-auth secret references an unavailable key."
            )
        payload = self._decode_payload(envelope.split(".", 4)[4])
        if len(payload) < NONCE_BYTES + 16:
            raise StrongAuthSecretDecryptionError(
                "Stored strong-auth secret could not be decrypted."
            )
        nonce, ciphertext = payload[:NONCE_BYTES], payload[NONCE_BYTES:]
        try:
            plaintext = AESGCM(key).decrypt(
                nonce,
                ciphertext,
                context.additional_authenticated_data(),
            )
            decoded = plaintext.decode("ascii")
            if (
                len(plaintext) > MAX_SECRET_BYTES
                or TOTP_SECRET_PATTERN.fullmatch(decoded) is None
            ):
                raise StrongAuthSecretDecryptionError(
                    "Stored strong-auth secret has an invalid format."
                )
            return decoded
        except (InvalidTag, UnicodeDecodeError) as exc:
            raise StrongAuthSecretDecryptionError(
                "Stored strong-auth secret could not be decrypted."
            ) from exc


def build_strong_auth_secret_cipher(
    *,
    keyring_json: str | None,
    active_key_id: str | None,
) -> StrongAuthSecretCipher | None:
    if not keyring_json and not active_key_id:
        return None
    if not keyring_json:
        raise StrongAuthSecretConfigurationError(
            "STRONG_AUTH_SECRET_KEYS is required when an active key is configured."
        )
    if not active_key_id:
        raise StrongAuthSecretConfigurationError(
            "STRONG_AUTH_SECRET_ACTIVE_KEY_ID is required when a keyring is configured."
        )
    return StrongAuthSecretCipher.from_json(
        keyring_json=keyring_json,
        active_key_id=active_key_id,
    )


__all__ = [
    "StrongAuthSecretCipher",
    "StrongAuthSecretConfigurationError",
    "StrongAuthSecretContext",
    "StrongAuthSecretDecryptionError",
    "StrongAuthSecretEncryptionError",
    "build_strong_auth_secret_cipher",
]
