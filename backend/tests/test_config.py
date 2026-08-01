from __future__ import annotations

import pytest
from jose import jwt

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
        OPENAI_REQUEST_TIMEOUT_SECONDS=30,
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

    with pytest.raises(ValueError):
        config.Settings(OPENAI_MAX_RETRIES=4)
    with pytest.raises(ValueError):
        config.Settings(OPENAI_REQUEST_TIMEOUT_SECONDS=121)

    assert config.Settings.model_fields["job_import_prompt_version"].default == (
        "job-import-text-v3"
    )


def test_production_validation_rejects_localhost_and_debug(monkeypatch: pytest.MonkeyPatch) -> None:
    production_settings = config.Settings(
        APP_ENV="production",
        DEBUG=True,
        JWT_SECRET="change-me",
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
    assert "RATE_LIMIT_BACKEND" in message
