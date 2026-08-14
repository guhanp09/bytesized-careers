from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal, Protocol

from app.core.oauth_credentials import (
    OAuthCredentialCipher,
    OAuthCredentialConfigurationError,
    OAuthCredentialContext,
    OAuthCredentialDecryptionError,
    OAuthCredentialValues,
    build_oauth_credential_cipher,
)
from app.models import OAuthAccount

OAuthCredentialWriteMode = Literal["plaintext", "dual", "encrypted_only"]


class OAuthCredentialSettings(Protocol):
    oauth_credential_keys: object | None
    oauth_credential_active_key_id: str | None
    oauth_credential_write_mode: OAuthCredentialWriteMode


def _secret_value(value: object | None) -> str | None:
    if value is None:
        return None
    getter = getattr(value, "get_secret_value", None)
    if callable(getter):
        raw_value = getter()
        return raw_value if isinstance(raw_value, str) else str(raw_value)
    return value if isinstance(value, str) else str(value)


class OAuthCredentialStorage:
    """Own the expand/contract policy around encrypted OAuth token columns.

    `dual` is a temporary rollback-compatible deployment mode. `encrypted_only`
    is the steady state: plaintext is cleared on every write and never accepted
    as a read fallback. The legacy `plaintext` mode exists only for local/test
    compatibility and is rejected by production configuration validation.
    """

    def __init__(
        self,
        *,
        cipher: OAuthCredentialCipher | None,
        write_mode: OAuthCredentialWriteMode,
    ):
        if write_mode not in {"plaintext", "dual", "encrypted_only"}:
            raise OAuthCredentialConfigurationError(
                "OAUTH_CREDENTIAL_WRITE_MODE must be plaintext, dual, or encrypted_only."
            )
        if write_mode != "plaintext" and cipher is None:
            raise OAuthCredentialConfigurationError(
                "An OAuth credential keyring is required outside plaintext compatibility mode."
            )
        self.cipher = cipher
        self.write_mode = write_mode

    def __repr__(self) -> str:
        return (
            "OAuthCredentialStorage("
            f"write_mode={self.write_mode!r}, encryption_configured={self.cipher is not None})"
        )

    @classmethod
    def plaintext_compatibility(cls) -> OAuthCredentialStorage:
        return cls(cipher=None, write_mode="plaintext")

    @classmethod
    def from_settings(cls, settings: OAuthCredentialSettings) -> OAuthCredentialStorage:
        cipher = build_oauth_credential_cipher(
            keyring_json=_secret_value(settings.oauth_credential_keys),
            active_key_id=settings.oauth_credential_active_key_id,
        )
        return cls(cipher=cipher, write_mode=settings.oauth_credential_write_mode)

    @staticmethod
    def _context(account: OAuthAccount, field_name: str) -> OAuthCredentialContext:
        return OAuthCredentialContext(
            provider=account.provider,
            provider_account_id=account.provider_account_id,
            field_name=field_name,
        )

    def _decrypt(self, account: OAuthAccount, field_name: str, ciphertext: str) -> str:
        if self.cipher is None:
            raise OAuthCredentialConfigurationError(
                "Encrypted OAuth credentials exist but no keyring is configured."
            )
        return self.cipher.decrypt(
            ciphertext,
            context=self._context(account, field_name),
        )

    def read(self, account: OAuthAccount) -> OAuthCredentialValues:
        if self.write_mode in {"plaintext", "dual"}:
            # During the additive compatibility window plaintext remains the
            # rollback contract and is authoritative when present. Ciphertext
            # is used for rows already backfilled without plaintext.
            access_token = account.access_token
            if access_token is None and account.access_token_ciphertext is not None:
                access_token = self._decrypt(
                    account,
                    "access_token",
                    account.access_token_ciphertext,
                )
            refresh_token = account.refresh_token
            if refresh_token is None and account.refresh_token_ciphertext is not None:
                refresh_token = self._decrypt(
                    account,
                    "refresh_token",
                    account.refresh_token_ciphertext,
                )
            return OAuthCredentialValues(
                access_token=access_token,
                refresh_token=refresh_token,
            )

        if account.access_token is not None or account.refresh_token is not None:
            raise OAuthCredentialDecryptionError(
                "Plaintext OAuth credentials are not accepted in encrypted-only mode."
            )
        access_token = (
            self._decrypt(account, "access_token", account.access_token_ciphertext)
            if account.access_token_ciphertext is not None
            else None
        )
        refresh_token = (
            self._decrypt(account, "refresh_token", account.refresh_token_ciphertext)
            if account.refresh_token_ciphertext is not None
            else None
        )
        return OAuthCredentialValues(
            access_token=access_token,
            refresh_token=refresh_token,
        )

    def _encrypt(
        self,
        account: OAuthAccount,
        field_name: str,
        plaintext: str | None,
    ) -> str | None:
        if plaintext is None:
            return None
        if self.cipher is None:
            raise OAuthCredentialConfigurationError(
                "OAuth credential encryption is not configured."
            )
        return self.cipher.encrypt(
            plaintext,
            context=self._context(account, field_name),
        )

    def write(
        self,
        account: OAuthAccount,
        *,
        access_token: str | None,
        refresh_token: str | None,
        preserve_refresh_token: bool = True,
    ) -> None:
        if preserve_refresh_token and refresh_token is None:
            refresh_token = self.read(account).refresh_token

        if self.write_mode == "plaintext":
            if (
                account.access_token_ciphertext is not None
                or account.refresh_token_ciphertext is not None
            ):
                raise OAuthCredentialConfigurationError(
                    "Refusing to overwrite encrypted OAuth credentials in plaintext mode."
                )
            account.access_token = access_token
            account.refresh_token = refresh_token
            account.credentials_encrypted_at = None
            return

        account.access_token_ciphertext = self._encrypt(
            account,
            "access_token",
            access_token,
        )
        account.refresh_token_ciphertext = self._encrypt(
            account,
            "refresh_token",
            refresh_token,
        )
        account.credentials_encrypted_at = datetime.now(UTC)
        if self.write_mode == "dual":
            account.access_token = access_token
            account.refresh_token = refresh_token
        else:
            account.access_token = None
            account.refresh_token = None

    @staticmethod
    def clear(account: OAuthAccount) -> None:
        """Irrecoverably remove every local copy of provider credentials."""

        account.access_token = None
        account.refresh_token = None
        account.access_token_ciphertext = None
        account.refresh_token_ciphertext = None
        account.credentials_encrypted_at = None

    def _plaintext_source_for_rewrap(self, account: OAuthAccount) -> OAuthCredentialValues:
        """Resolve transitional rows for an explicit operator-owned rewrite.

        Legacy plaintext wins when present. This makes an interrupted expand
        rollout recoverable: rerunning the command repairs absent, old-key, or
        malformed compatibility ciphertext before plaintext is ever removed.
        Encrypted-only rows still require authenticated decryption.
        """

        access_token = account.access_token
        if access_token is None and account.access_token_ciphertext is not None:
            access_token = self._decrypt(
                account,
                "access_token",
                account.access_token_ciphertext,
            )
        refresh_token = account.refresh_token
        if refresh_token is None and account.refresh_token_ciphertext is not None:
            refresh_token = self._decrypt(
                account,
                "refresh_token",
                account.refresh_token_ciphertext,
            )
        return OAuthCredentialValues(
            access_token=access_token,
            refresh_token=refresh_token,
        )

    def needs_rewrap(self, account: OAuthAccount) -> bool:
        if self.write_mode == "plaintext":
            raise OAuthCredentialConfigurationError(
                "Credential rotation requires dual or encrypted_only write mode."
            )
        assert self.cipher is not None
        values = self._plaintext_source_for_rewrap(account)

        pairs = (
            ("access_token", values.access_token, account.access_token_ciphertext),
            ("refresh_token", values.refresh_token, account.refresh_token_ciphertext),
        )
        for field_name, plaintext, ciphertext in pairs:
            if plaintext is None:
                if ciphertext is not None:
                    return True
                continue
            if ciphertext is None:
                return True
            try:
                if self.cipher.key_id_from_envelope(ciphertext) != self.cipher.active_key_id:
                    return True
                if self._decrypt(account, field_name, ciphertext) != plaintext:
                    return True
            except OAuthCredentialDecryptionError:
                # A compatibility plaintext value lets the explicit backfill
                # repair incomplete/corrupt ciphertext. Without plaintext the
                # source resolver above already failed closed.
                return True

        if self.write_mode == "dual":
            return (
                account.access_token != values.access_token
                or account.refresh_token != values.refresh_token
            )
        return account.access_token is not None or account.refresh_token is not None

    def rewrap(self, account: OAuthAccount) -> bool:
        if not self.needs_rewrap(account):
            return False
        values = self._plaintext_source_for_rewrap(account)
        self.write(
            account,
            access_token=values.access_token,
            refresh_token=values.refresh_token,
            preserve_refresh_token=False,
        )
        return True


__all__ = [
    "OAuthCredentialSettings",
    "OAuthCredentialStorage",
    "OAuthCredentialWriteMode",
]
