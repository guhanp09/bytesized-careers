from __future__ import annotations

import base64
import binascii
import json
import re
import secrets
from collections.abc import Mapping
from dataclasses import dataclass, field

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVELOPE_PREFIX = "cj.oauth.v1"
NONCE_BYTES = 12
KEY_BYTES = 32
MAX_KEYS = 16
MAX_CREDENTIAL_BYTES = 32 * 1024
MAX_ENVELOPE_BYTES = 48 * 1024
KEY_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


class OAuthCredentialConfigurationError(RuntimeError):
    """The server-owned OAuth credential keyring is unusable."""


class OAuthCredentialEncryptionError(RuntimeError):
    """An OAuth credential cannot be safely encrypted."""


class OAuthCredentialDecryptionError(RuntimeError):
    """A stored OAuth credential failed authenticated decryption."""


@dataclass(frozen=True)
class OAuthCredentialContext:
    provider: str
    provider_account_id: str
    field_name: str

    def additional_authenticated_data(self) -> bytes:
        # Canonical JSON avoids delimiter ambiguity in provider subjects while
        # binding ciphertext to its provider account and token field. A copied
        # access-token ciphertext therefore cannot be used as a refresh token or
        # moved to another provider account.
        return json.dumps(
            [ENVELOPE_PREFIX, self.provider, self.provider_account_id, self.field_name],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")


@dataclass(frozen=True)
class OAuthCredentialValues:
    """Decrypted values whose repr is always safe for logs and tracebacks."""

    access_token: str | None = field(default=None, repr=False)
    refresh_token: str | None = field(default=None, repr=False)

    def __repr__(self) -> str:
        return (
            "OAuthCredentialValues("
            f"has_access_token={self.access_token is not None}, "
            f"has_refresh_token={self.refresh_token is not None})"
        )


def _decode_key(raw_value: str) -> bytes:
    try:
        encoded = raw_value.strip().encode("ascii")
    except UnicodeEncodeError as exc:
        raise OAuthCredentialConfigurationError(
            "OAuth credential keys must use base64/base64url encoding."
        ) from exc

    try:
        key = base64.b64decode(
            encoded + b"=" * (-len(encoded) % 4),
            altchars=b"-_",
            validate=True,
        )
    except (binascii.Error, ValueError) as exc:
        raise OAuthCredentialConfigurationError(
            "OAuth credential keys must use valid base64/base64url encoding."
        ) from exc
    if len(key) != KEY_BYTES:
        raise OAuthCredentialConfigurationError(
            "Every OAuth credential key must decode to exactly 32 bytes."
        )
    return key


def _json_object_without_duplicate_keys(
    pairs: list[tuple[str, object]],
) -> dict[str, object]:
    parsed: dict[str, object] = {}
    for key, value in pairs:
        if key in parsed:
            raise OAuthCredentialConfigurationError(
                "OAUTH_CREDENTIAL_KEYS must not contain duplicate key IDs."
            )
        parsed[key] = value
    return parsed


class OAuthCredentialCipher:
    """Versioned AES-256-GCM envelope encryption with a rotation-ready keyring."""

    def __init__(self, *, keys: Mapping[str, bytes], active_key_id: str):
        if not keys:
            raise OAuthCredentialConfigurationError(
                "At least one OAuth credential key is required."
            )
        if len(keys) > MAX_KEYS:
            raise OAuthCredentialConfigurationError(
                f"At most {MAX_KEYS} OAuth credential keys may be configured."
            )
        normalized: dict[str, bytes] = {}
        for key_id, key in keys.items():
            if not KEY_ID_PATTERN.fullmatch(key_id):
                raise OAuthCredentialConfigurationError(
                    "OAuth credential key IDs must contain only letters, numbers, "
                    "underscores, or hyphens and be at most 64 characters."
                )
            key_bytes = bytes(key)
            if len(key_bytes) != KEY_BYTES:
                raise OAuthCredentialConfigurationError(
                    "Every OAuth credential key must contain exactly 32 bytes."
                )
            normalized[key_id] = key_bytes
        if active_key_id not in normalized:
            raise OAuthCredentialConfigurationError(
                "OAUTH_CREDENTIAL_ACTIVE_KEY_ID must name a configured key."
            )

        self._keys = normalized
        self.active_key_id = active_key_id

    def __repr__(self) -> str:
        return (
            "OAuthCredentialCipher("
            f"active_key_id={self.active_key_id!r}, key_count={len(self._keys)})"
        )

    @classmethod
    def from_json(cls, *, keyring_json: str, active_key_id: str) -> OAuthCredentialCipher:
        if len(keyring_json) > 32 * 1024:
            raise OAuthCredentialConfigurationError(
                "OAUTH_CREDENTIAL_KEYS exceeds the maximum configuration size."
            )
        try:
            parsed = json.loads(
                keyring_json,
                object_pairs_hook=_json_object_without_duplicate_keys,
            )
        except json.JSONDecodeError as exc:
            raise OAuthCredentialConfigurationError(
                "OAUTH_CREDENTIAL_KEYS must be a JSON object."
            ) from exc
        if not isinstance(parsed, dict) or not all(
            isinstance(key_id, str) and isinstance(raw_key, str)
            for key_id, raw_key in parsed.items()
        ):
            raise OAuthCredentialConfigurationError(
                "OAUTH_CREDENTIAL_KEYS must map key IDs to base64-encoded keys."
            )
        if not isinstance(active_key_id, str) or not active_key_id:
            raise OAuthCredentialConfigurationError(
                "OAUTH_CREDENTIAL_ACTIVE_KEY_ID is required when a keyring is configured."
            )
        return cls(
            keys={key_id: _decode_key(raw_key) for key_id, raw_key in parsed.items()},
            active_key_id=active_key_id,
        )

    @staticmethod
    def _encode(raw_value: bytes) -> str:
        return base64.urlsafe_b64encode(raw_value).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_envelope_payload(raw_value: str) -> bytes:
        if len(raw_value) > MAX_ENVELOPE_BYTES:
            raise OAuthCredentialDecryptionError("Stored OAuth credential could not be decrypted.")
        try:
            encoded = raw_value.encode("ascii")
            return base64.b64decode(
                encoded + b"=" * (-len(encoded) % 4),
                altchars=b"-_",
                validate=True,
            )
        except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
            raise OAuthCredentialDecryptionError(
                "Stored OAuth credential could not be decrypted."
            ) from exc

    @staticmethod
    def key_id_from_envelope(envelope: str) -> str:
        parts = envelope.split(".", 4)
        if len(parts) != 5 or ".".join(parts[:3]) != ENVELOPE_PREFIX:
            raise OAuthCredentialDecryptionError(
                "Stored OAuth credential has an unsupported encryption envelope."
            )
        key_id = parts[3]
        if not KEY_ID_PATTERN.fullmatch(key_id):
            raise OAuthCredentialDecryptionError(
                "Stored OAuth credential has an unsupported encryption envelope."
            )
        return key_id

    def encrypt(self, plaintext: str, *, context: OAuthCredentialContext) -> str:
        raw_plaintext = plaintext.encode("utf-8")
        if len(raw_plaintext) > MAX_CREDENTIAL_BYTES:
            raise OAuthCredentialEncryptionError(
                "OAuth credential exceeds the maximum encrypted size."
            )
        nonce = secrets.token_bytes(NONCE_BYTES)
        ciphertext = AESGCM(self._keys[self.active_key_id]).encrypt(
            nonce,
            raw_plaintext,
            context.additional_authenticated_data(),
        )
        payload = self._encode(nonce + ciphertext)
        return f"{ENVELOPE_PREFIX}.{self.active_key_id}.{payload}"

    def decrypt(self, envelope: str, *, context: OAuthCredentialContext) -> str:
        key_id = self.key_id_from_envelope(envelope)
        key = self._keys.get(key_id)
        if key is None:
            raise OAuthCredentialDecryptionError(
                "Stored OAuth credential references an unavailable encryption key."
            )

        payload = self._decode_envelope_payload(envelope.split(".", 4)[4])
        if len(payload) < NONCE_BYTES + 16:
            raise OAuthCredentialDecryptionError("Stored OAuth credential could not be decrypted.")
        nonce, ciphertext = payload[:NONCE_BYTES], payload[NONCE_BYTES:]
        try:
            plaintext = AESGCM(key).decrypt(
                nonce,
                ciphertext,
                context.additional_authenticated_data(),
            )
            if len(plaintext) > MAX_CREDENTIAL_BYTES:
                raise OAuthCredentialDecryptionError(
                    "Stored OAuth credential exceeds the maximum decrypted size."
                )
            return plaintext.decode("utf-8")
        except (InvalidTag, UnicodeDecodeError) as exc:
            raise OAuthCredentialDecryptionError(
                "Stored OAuth credential could not be decrypted."
            ) from exc


def build_oauth_credential_cipher(
    *,
    keyring_json: str | None,
    active_key_id: str | None,
) -> OAuthCredentialCipher | None:
    """Build a keyring while rejecting partial or ambiguous configuration."""

    if not keyring_json and not active_key_id:
        return None
    if not keyring_json:
        raise OAuthCredentialConfigurationError(
            "OAUTH_CREDENTIAL_KEYS is required when an active key ID is configured."
        )
    if not active_key_id:
        raise OAuthCredentialConfigurationError(
            "OAUTH_CREDENTIAL_ACTIVE_KEY_ID is required when a keyring is configured."
        )
    return OAuthCredentialCipher.from_json(
        keyring_json=keyring_json,
        active_key_id=active_key_id,
    )


__all__ = [
    "OAuthCredentialCipher",
    "OAuthCredentialConfigurationError",
    "OAuthCredentialContext",
    "OAuthCredentialDecryptionError",
    "OAuthCredentialEncryptionError",
    "OAuthCredentialValues",
    "build_oauth_credential_cipher",
]
