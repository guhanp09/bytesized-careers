from __future__ import annotations

import base64
import json

import pytest
from jose import jwt
from pydantic import ValidationError

from app.core import config
from app.core.security import create_access_token


def test_access_token_default_ttl_is_beta_friendly() -> None:
    # Beta sessions must not expire mid-action; keep at least a 7-day code default.
    # Assert the declared field default (env-independent: a local .env may override it).
    default_minutes = config.Settings.model_fields["jwt_access_token_expires_minutes"].default

    assert default_minutes >= 7 * 24 * 60


def test_create_access_token_honors_configured_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.settings, "jwt_access_token_expires_minutes", 14 * 24 * 60)

    token = create_access_token("user-123")
    payload = jwt.decode(token, config.settings.jwt_secret, algorithms=[config.settings.jwt_algorithm])
    lifetime_minutes = (payload["exp"] - payload["iat"]) / 60 if "iat" in payload else None

    if lifetime_minutes is None:
        # Tokens without iat: assert exp is at least ~13 days out from now.
        from datetime import UTC, datetime

        seconds_until_expiry = payload["exp"] - datetime.now(UTC).timestamp()
        assert seconds_until_expiry >= 13 * 24 * 60 * 60
    else:
        assert lifetime_minutes == pytest.approx(14 * 24 * 60, abs=2)


def test_cors_origins_accept_json_array() -> None:
    settings = config.Settings(CORS_ORIGINS='["https://creatorjobs.example","https://www.creatorjobs.example"]')

    assert settings.cors_origins == ["https://creatorjobs.example", "https://www.creatorjobs.example"]


def test_openai_configuration_is_server_owned_bounded_and_secret() -> None:
    settings = config.Settings(
        OPENAI_API_KEY="test-placeholder-not-a-real-key",
        OPENAI_MODEL="gpt-5.6-luna",
        OPENAI_REQUEST_TIMEOUT_SECONDS=60,
        OPENAI_MAX_RETRIES=2,
        JOB_IMPORT_PROMPT_VERSION="job-import-text-v1",
    )

    assert settings.openai_api_key is not None
    assert str(settings.openai_api_key) == "**********"
    assert (
        settings.openai_api_key.get_secret_value()
        == "test-placeholder-not-a-real-key"
    )
    assert settings.openai_model == "gpt-5.6-luna"
    assert settings.openai_request_timeout_seconds == 60
    assert (
        config.Settings.model_fields["openai_request_timeout_seconds"].default
        == 90
    )
    # Measured against a real job page: extraction takes ~33s, so a 30s timeout
    # kills a call that was about to succeed and the recruiter is then asked for
    # everything the page already stated. An existing deployment must keep
    # booting, so the floor is applied where the provider is built rather than
    # rejected here — but it must never be skipped.
    from app.api.deps import (
        MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS,
        _viable_timeout_seconds,
    )

    assert MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS >= 45
    assert _viable_timeout_seconds(30) == MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS
    assert _viable_timeout_seconds(120) == 120

    with pytest.raises(ValueError):
        config.Settings(OPENAI_MAX_RETRIES=4)
    with pytest.raises(ValueError):
        config.Settings(OPENAI_REQUEST_TIMEOUT_SECONDS=181)

    assert config.Settings.model_fields["job_import_prompt_version"].default == (
        "job-import-text-v6"
    )


def test_production_validation_rejects_localhost_and_debug(monkeypatch: pytest.MonkeyPatch) -> None:
    production_settings = config.Settings(
        APP_ENV="production",
        DEBUG=True,
        JWT_SECRET="change-me",
        JWT_ACCESS_TOKEN_EXPIRES_MINUTES=14 * 24 * 60,
        JWT_REFRESH_TOKEN_EXPIRES_MINUTES=30 * 24 * 60,
        FRONTEND_BASE_URL="http://localhost:3000",
        CORS_ORIGINS='["http://localhost:3000"]',
        DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/creatorjobs",
        EMAIL_MODE="log",
        RATE_LIMIT_BACKEND="memory",
    )
    monkeypatch.setattr(config, "settings", production_settings)

    with pytest.raises(RuntimeError) as exc_info:
        config.validate_production_settings()

    message = str(exc_info.value)
    assert "JWT_SECRET" in message
    assert "DEBUG" in message
    assert "FRONTEND_BASE_URL" in message
    assert "CORS_ORIGINS" in message
    assert "DATABASE_URL" in message
    assert "EMAIL_MODE" in message
    assert "GOOGLE_CLIENT_ID" in message
    assert "GOOGLE_CLIENT_SECRET" in message
    assert "GOOGLE_OAUTH_EXCHANGE_SECRET" in message
    assert "OAUTH_CREDENTIAL_KEYS" in message
    assert "OAUTH_CREDENTIAL_WRITE_MODE" in message
    assert "JWT_ACCESS_TOKEN_EXPIRES_MINUTES" in message
    assert "AUTH_SESSION_MODE" in message
    assert "ADMIN_STRONG_AUTH_REQUIRED" in message
    assert "STRONG_AUTH_SECRET_KEYS" in message
    assert "RATE_LIMIT_BACKEND" in message


def _safe_production_settings(**overrides: object) -> config.Settings:
    key = base64.urlsafe_b64encode(bytes([23]) * 32).decode().rstrip("=")
    values: dict[str, object] = {
        "APP_ENV": "production",
        "DEBUG": False,
        "JWT_SECRET": "a-production-secret-that-is-not-a-placeholder",
        "JWT_ACCESS_TOKEN_EXPIRES_MINUTES": 15,
        "JWT_REFRESH_TOKEN_EXPIRES_MINUTES": 30 * 24 * 60,
        "AUTH_SESSION_MODE": "persistent",
        "ADMIN_STRONG_AUTH_REQUIRED": True,
        "STRONG_AUTH_SECRET_KEYS": json.dumps({"strong_auth_key": key}),
        "STRONG_AUTH_SECRET_ACTIVE_KEY_ID": "strong_auth_key",
        "FRONTEND_BASE_URL": "https://creatorjobs.example",
        "MEDIA_PUBLIC_BASE_URL": "https://media.creatorjobs.example",
        # Capacity is a deployment fact with no safe default; production refuses
        # to boot without it. See test_db_pool_bounds.
        "DB_POOL_SIZE": 5,
        "DB_MAX_OVERFLOW": 5,
        "CORS_ORIGINS": '["https://creatorjobs.example"]',
        "DATABASE_URL": "postgresql+asyncpg://user:pass@database.example/creatorjobs",
        "EMAIL_MODE": "smtp",
        "SMTP_HOST": "smtp.example",
        "SMTP_USERNAME": "creatorjobs",
        "SMTP_PASSWORD": "smtp-test-placeholder",
        "SMTP_FROM_EMAIL": "support@creatorjobs.example",
        "GOOGLE_CLIENT_ID": "creatorjobs.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "production-google-client-secret",
        "GOOGLE_OAUTH_EXCHANGE_SECRET": "production-google-oauth-exchange-secret-2026",
        "RATE_LIMIT_BACKEND": "redis",
        "REDIS_URL": "redis://redis.example:6379/0",
        "TRUSTED_PROXY_IPS": "10.0.0.0/8",
        "OAUTH_CREDENTIAL_KEYS": json.dumps({"production_key": key}),
        "OAUTH_CREDENTIAL_ACTIVE_KEY_ID": "production_key",
        "OAUTH_CREDENTIAL_WRITE_MODE": "encrypted_only",
        # Only the process-local bus is implemented, so a booting production
        # configuration has to acknowledge it. Removing this line is the mutation
        # that proves the refusal — see test_config_contract.
        "ALLOW_PROCESS_LOCAL_REALTIME_IN_PRODUCTION": True,
    }
    values.update(overrides)
    return config.Settings(**values)


def test_production_validation_accepts_encrypted_only_oauth_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    production_settings = _safe_production_settings()
    monkeypatch.setattr(config, "settings", production_settings)

    config.validate_production_settings()

    assert production_settings.oauth_credential_keys is not None
    assert str(production_settings.oauth_credential_keys) == "**********"


def test_production_requires_nonblank_google_refresh_client_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    production_settings = _safe_production_settings(GOOGLE_CLIENT_SECRET="   ")
    monkeypatch.setattr(config, "settings", production_settings)

    with pytest.raises(RuntimeError, match="GOOGLE_CLIENT_SECRET"):
        config.validate_production_settings()


def test_production_rejects_example_google_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    production_settings = _safe_production_settings(
        GOOGLE_CLIENT_ID="your-google-client-id",
        GOOGLE_CLIENT_SECRET="your-google-client-secret",
        GOOGLE_OAUTH_EXCHANGE_SECRET="replace-with-a-random-server-only-secret",
    )
    monkeypatch.setattr(config, "settings", production_settings)

    with pytest.raises(RuntimeError) as exc_info:
        config.validate_production_settings()

    message = str(exc_info.value)
    assert "GOOGLE_CLIENT_ID" in message
    assert "GOOGLE_CLIENT_SECRET" in message
    assert "GOOGLE_OAUTH_EXCHANGE_SECRET" in message


def test_production_dual_write_requires_explicit_temporary_acknowledgement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    production_settings = _safe_production_settings(OAUTH_CREDENTIAL_WRITE_MODE="dual")
    monkeypatch.setattr(config, "settings", production_settings)

    with pytest.raises(RuntimeError, match="explicit temporary production compatibility"):
        config.validate_production_settings()

    acknowledged = _safe_production_settings(
        OAUTH_CREDENTIAL_WRITE_MODE="dual",
        ALLOW_OAUTH_PLAINTEXT_COMPATIBILITY_IN_PRODUCTION=True,
    )
    monkeypatch.setattr(config, "settings", acknowledged)
    config.validate_production_settings()


def test_production_auth_session_migration_requires_explicit_temporary_acknowledgement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration_settings = _safe_production_settings(AUTH_SESSION_MODE="migration")
    monkeypatch.setattr(config, "settings", migration_settings)

    with pytest.raises(RuntimeError, match="legacy-refresh compatibility acknowledgement"):
        config.validate_production_settings()

    acknowledged = _safe_production_settings(
        AUTH_SESSION_MODE="migration",
        ALLOW_LEGACY_REFRESH_COMPATIBILITY_IN_PRODUCTION=True,
    )
    monkeypatch.setattr(config, "settings", acknowledged)
    config.validate_production_settings()


def test_production_requires_administrator_strong_auth_enforcement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    unsafe = _safe_production_settings(ADMIN_STRONG_AUTH_REQUIRED=False)
    monkeypatch.setattr(config, "settings", unsafe)

    with pytest.raises(RuntimeError, match="ADMIN_STRONG_AUTH_REQUIRED"):
        config.validate_production_settings()

    with pytest.raises(ValueError):
        config.Settings(ADMIN_STRONG_AUTH_MAX_AGE_MINUTES=4)
    with pytest.raises(ValueError):
        config.Settings(ADMIN_STRONG_AUTH_MAX_AGE_MINUTES=61)


def test_production_requires_valid_dedicated_strong_auth_secret_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing = _safe_production_settings(
        STRONG_AUTH_SECRET_KEYS=None,
        STRONG_AUTH_SECRET_ACTIVE_KEY_ID=None,
    )
    monkeypatch.setattr(config, "settings", missing)
    with pytest.raises(RuntimeError, match="STRONG_AUTH_SECRET_KEYS"):
        config.validate_production_settings()

    malformed = _safe_production_settings(
        STRONG_AUTH_SECRET_KEYS='{"key":"not-base64!"}',
        STRONG_AUTH_SECRET_ACTIVE_KEY_ID="key",
    )
    monkeypatch.setattr(config, "settings", malformed)
    with pytest.raises(RuntimeError, match="Strong-auth secret encryption"):
        config.validate_production_settings()


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"AUTH_SESSION_MODE": "legacy"}, "AUTH_SESSION_MODE cannot be legacy"),
        (
            {"JWT_ACCESS_TOKEN_EXPIRES_MINUTES": 61},
            "JWT_ACCESS_TOKEN_EXPIRES_MINUTES must be 60 or less",
        ),
        (
            {
                "JWT_ACCESS_TOKEN_EXPIRES_MINUTES": 60,
                "JWT_REFRESH_TOKEN_EXPIRES_MINUTES": 60,
            },
            "JWT_REFRESH_TOKEN_EXPIRES_MINUTES must exceed",
        ),
    ],
)
def test_production_rejects_unsafe_backend_session_configuration(
    monkeypatch: pytest.MonkeyPatch,
    overrides: dict[str, object],
    message: str,
) -> None:
    production_settings = _safe_production_settings(**overrides)
    monkeypatch.setattr(config, "settings", production_settings)

    with pytest.raises(RuntimeError, match=message):
        config.validate_production_settings()


def test_production_requires_a_decision_about_what_sits_in_front(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Neither answer is safe to assume.

    With a proxy in front and nothing configured, every caller collapses into
    one bucket and the limits stop working for real users. With nothing in front
    and a header believed anyway, a caller mints their own bucket per request.
    So production has to say which it is.
    """

    unstated = _safe_production_settings(TRUSTED_PROXY_IPS=None)
    monkeypatch.setattr(config, "settings", unstated)

    with pytest.raises(RuntimeError, match="TRUSTED_PROXY_IPS"):
        config.validate_production_settings()

    acknowledged = _safe_production_settings(
        TRUSTED_PROXY_IPS=None,
        ALLOW_DIRECT_CLIENT_IPS_IN_PRODUCTION=True,
    )
    monkeypatch.setattr(config, "settings", acknowledged)
    config.validate_production_settings()


def test_jwt_signing_stays_on_the_hmac_family() -> None:
    """The asymmetric families are not merely unused; they are unreachable.

    Tokens are signed with `jwt_secret`, a shared secret, so `RS256`/`ES256`
    would be a misconfiguration. Refusing them also keeps `ecdsa` — a python-jose
    dependency carrying a Minerva timing attack on P-256 that upstream will not
    fix — off every code path this service can execute.
    """

    assert config.Settings().jwt_algorithm == "HS256"
    assert config.Settings(JWT_ALGORITHM="HS512").jwt_algorithm == "HS512"

    for rejected in ["ES256", "ES384", "ES512", "RS256", "EdDSA", "none", ""]:
        with pytest.raises(ValidationError):
            config.Settings(JWT_ALGORITHM=rejected)
