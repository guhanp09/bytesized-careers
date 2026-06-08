from __future__ import annotations

import pytest

from app.core import config


def test_cors_origins_accept_json_array() -> None:
    settings = config.Settings(CORS_ORIGINS='["https://creatorjobs.example","https://www.creatorjobs.example"]')

    assert settings.cors_origins == ["https://creatorjobs.example", "https://www.creatorjobs.example"]


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
