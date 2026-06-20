import json
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="CreatorJobs Backend", alias="APP_NAME")
    app_env: Literal["development", "staging", "production", "test"] = Field(
        default="development", alias="APP_ENV"
    )
    email_mode: Literal["log", "smtp"] = Field(default="log", alias="EMAIL_MODE")
    smtp_host: str | None = Field(default=None, alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_username: str | None = Field(default=None, alias="SMTP_USERNAME")
    smtp_password: str | None = Field(default=None, alias="SMTP_PASSWORD")
    smtp_from_email: str | None = Field(default=None, alias="SMTP_FROM_EMAIL")
    smtp_use_tls: bool = Field(default=True, alias="SMTP_USE_TLS")
    # Master switch for delivering *notification* (non-auth) emails. Default off:
    # notification emails are queued to the outbox and mocked, never sent, until a
    # production domain + provider are ready. Auth emails keep using EMAIL_MODE.
    email_delivery_enabled: bool = Field(default=False, alias="EMAIL_DELIVERY_ENABLED")
    debug: bool = Field(default=False, alias="DEBUG")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    rate_limit_backend: Literal["memory", "redis"] = Field(default="memory", alias="RATE_LIMIT_BACKEND")
    redis_url: str | None = Field(default=None, alias="REDIS_URL")
    allow_memory_rate_limit_in_production: bool = Field(
        default=False, alias="ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION"
    )

    api_v1_prefix: str = Field(default="/api/v1", alias="API_V1_PREFIX")
    cors_origins: list[str] = Field(default_factory=list, alias="CORS_ORIGINS")
    frontend_base_url: str = Field(default="http://localhost:3000", alias="FRONTEND_BASE_URL")

    database_url: str = Field(
        default="postgresql+asyncpg://creatorjobs:creatorjobs@localhost:5432/creatorjobs",
        alias="DATABASE_URL",
    )

    jwt_secret: str = Field(default="change-me", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_access_token_expires_minutes: int = Field(
        default=60, alias="JWT_ACCESS_TOKEN_EXPIRES_MINUTES"
    )
    jwt_refresh_token_expires_minutes: int = Field(
        default=60 * 24 * 30, alias="JWT_REFRESH_TOKEN_EXPIRES_MINUTES"
    )
    youtube_api_key: str | None = Field(default=None, alias="YOUTUBE_API_KEY")
    youtube_data_api_key: str | None = Field(default=None, alias="YOUTUBE_DATA_API_KEY")
    media_root: str = Field(default=".local-data/media", alias="MEDIA_ROOT")
    media_base_path: str = Field(default="/media", alias="MEDIA_BASE_PATH")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str] | None) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        raw = value.strip()
        if raw.startswith("["):
            parsed = json.loads(raw)
            if not isinstance(parsed, list):
                raise ValueError("CORS_ORIGINS JSON value must be a list.")
            return [str(item).strip() for item in parsed if str(item).strip()]
        return [item.strip() for item in raw.split(",") if item.strip()]

    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug(cls, value: bool | str | None) -> bool | None:
        if value is None or isinstance(value, bool):
            return value
        raw = value.strip().lower()
        if raw in {"1", "true", "yes", "on", "debug"}:
            return True
        if raw in {"", "0", "false", "no", "off", "release", "prod", "production"}:
            return False
        raise ValueError("DEBUG must be a boolean-like value.")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


UNSAFE_SECRET_VALUES = {
    "",
    "change-me",
    "change-me-please",
    "changeme",
    "secret",
    "dev-secret",
    "insecure",
    "replace-me",
}


def validate_production_settings() -> None:
    if settings.app_env != "production":
        return

    failures: list[str] = []
    if settings.jwt_secret.strip().lower() in UNSAFE_SECRET_VALUES:
        failures.append("JWT_SECRET must be set to a strong non-placeholder value.")
    if settings.debug:
        failures.append("DEBUG must be false in production.")
    if not settings.frontend_base_url or any(
        local_host in settings.frontend_base_url for local_host in ("localhost", "127.0.0.1")
    ):
        failures.append("FRONTEND_BASE_URL must be set to the production frontend origin.")
    if not settings.cors_origins:
        failures.append("CORS_ORIGINS must include the production frontend origin.")
    if any(local_host in origin for origin in settings.cors_origins for local_host in ("localhost", "127.0.0.1")):
        failures.append("CORS_ORIGINS must not include localhost in production.")
    if settings.database_url.startswith("sqlite") or "localhost" in settings.database_url:
        failures.append("DATABASE_URL must point to a production database host.")
    if settings.email_mode != "smtp":
        failures.append("EMAIL_MODE must be 'smtp' in production.")
    if not settings.smtp_host:
        failures.append("SMTP_HOST is required in production.")
    if not settings.smtp_from_email:
        failures.append("SMTP_FROM_EMAIL is required in production.")
    if not settings.smtp_username:
        failures.append("SMTP_USERNAME is required in production.")
    if not settings.smtp_password:
        failures.append("SMTP_PASSWORD is required in production.")
    if settings.smtp_port <= 0:
        failures.append("SMTP_PORT must be a positive integer.")
    if settings.rate_limit_backend == "memory" and not settings.allow_memory_rate_limit_in_production:
        failures.append(
            "RATE_LIMIT_BACKEND must be 'redis' in production, or explicitly set "
            "ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION=true for a single-instance deployment."
        )
    if settings.rate_limit_backend == "redis" and not settings.redis_url:
        failures.append("REDIS_URL is required when RATE_LIMIT_BACKEND=redis.")

    if failures:
        joined = " ".join(failures)
        raise RuntimeError(f"Unsafe production backend configuration: {joined}")
