import json
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
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
    # Beta posture: there is no app-level refresh for credentials users yet, so a
    # short access-token TTL forced people to re-login (~hourly) mid-action on
    # apply/save. Default to a 14-day window so beta sessions stay usable. Override
    # via env and add refresh-token rotation before tightening this for scale.
    jwt_access_token_expires_minutes: int = Field(
        default=60 * 24 * 14, alias="JWT_ACCESS_TOKEN_EXPIRES_MINUTES"
    )
    jwt_refresh_token_expires_minutes: int = Field(
        default=60 * 24 * 30, alias="JWT_REFRESH_TOKEN_EXPIRES_MINUTES"
    )
    google_client_id: str | None = Field(default=None, alias="GOOGLE_CLIENT_ID")
    # JSON keyring mapping stable key IDs to base64/base64url-encoded 32-byte
    # AES keys. SecretStr keeps the entire keyring out of settings repr/logs.
    # Keep previous keys configured until every row has been explicitly rotated.
    oauth_credential_keys: SecretStr | None = Field(
        default=None,
        max_length=32 * 1024,
        alias="OAUTH_CREDENTIAL_KEYS",
    )
    oauth_credential_active_key_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$",
        alias="OAUTH_CREDENTIAL_ACTIVE_KEY_ID",
    )
    oauth_credential_write_mode: Literal["plaintext", "dual", "encrypted_only"] = Field(
        default="plaintext",
        alias="OAUTH_CREDENTIAL_WRITE_MODE",
    )
    # A temporary expand/rollback escape hatch. Production steady state must be
    # encrypted_only; dual mode is accepted only when an operator explicitly
    # acknowledges that plaintext remains during a controlled migration window.
    allow_oauth_plaintext_compatibility_in_production: bool = Field(
        default=False,
        alias="ALLOW_OAUTH_PLAINTEXT_COMPATIBILITY_IN_PRODUCTION",
    )
    youtube_api_key: str | None = Field(default=None, alias="YOUTUBE_API_KEY")
    youtube_data_api_key: str | None = Field(default=None, alias="YOUTUBE_DATA_API_KEY")
    openai_api_key: SecretStr | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: str = Field(
        default="gpt-5.6-luna",
        min_length=1,
        max_length=120,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        alias="OPENAI_MODEL",
    )
    #: How long one extraction call may take before it is abandoned.
    #:
    #: Measured, not guessed. A real 16k-character job page takes this provider
    #: about 33 seconds to extract ~27 fields from. The deployment was running
    #: at 30 seconds, so every real page timed out roughly three seconds before
    #: its answer arrived: the extraction succeeded and was thrown away, and the
    #: recruiter met an assistant asking about everything the page already said.
    #:
    #: A configured value below MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS is raised
    #: to that floor at the point the provider is built, with a warning — an
    #: existing deployment must not stop booting, but nor should it keep
    #: quietly destroying every import.
    openai_request_timeout_seconds: float = Field(
        default=90.0,
        ge=5.0,
        le=180.0,
        alias="OPENAI_REQUEST_TIMEOUT_SECONDS",
    )
    #: Retries for genuinely transient provider failures only.
    #:
    #: One, deliberately. A retry exists to survive a blip, and the adapter only
    #: retries timeouts, rate limits and temporary outages — never a schema,
    #: auth or refusal failure, which would return the same answer more slowly.
    #:
    #: Two retries at the 90-second ceiling is a four-and-a-half minute worst
    #: case spent in front of a recruiter watching a progress bar, which is a
    #: worse outcome than telling them promptly that it did not work.
    openai_max_retries: int = Field(
        default=1,
        ge=0,
        le=3,
        alias="OPENAI_MAX_RETRIES",
    )
    job_import_prompt_version: str = Field(
        default="job-import-text-v6",
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        alias="JOB_IMPORT_PROMPT_VERSION",
    )
    media_root: str = Field(default=".local-data/media", alias="MEDIA_ROOT")
    media_base_path: str = Field(default="/media", alias="MEDIA_BASE_PATH")

    # Controlled staging/test impersonation for deterministic QA personas. This
    # is intentionally server-only: the frontend flag merely decides whether to
    # mount the drawer, while these settings are the authorization boundary.
    enable_qa_persona_switcher: bool = Field(
        default=False, alias="ENABLE_QA_PERSONA_SWITCHER"
    )
    qa_persona_controller_emails: str = Field(
        default="", alias="QA_PERSONA_CONTROLLER_EMAILS"
    )
    qa_persona_access_token_minutes: int = Field(
        default=30, ge=5, le=120, alias="QA_PERSONA_ACCESS_TOKEN_MINUTES"
    )

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
    if not settings.google_client_id or not settings.google_client_id.strip():
        failures.append("GOOGLE_CLIENT_ID is required for verified Google sign-in.")
    from app.core.oauth_credentials import (
        OAuthCredentialConfigurationError,
        build_oauth_credential_cipher,
    )

    keyring_json = (
        settings.oauth_credential_keys.get_secret_value()
        if settings.oauth_credential_keys is not None
        else None
    )
    try:
        credential_cipher = build_oauth_credential_cipher(
            keyring_json=keyring_json,
            active_key_id=settings.oauth_credential_active_key_id,
        )
    except OAuthCredentialConfigurationError as exc:
        failures.append(f"OAuth credential encryption configuration is invalid: {exc}")
        credential_cipher = None
    if credential_cipher is None:
        failures.append(
            "OAUTH_CREDENTIAL_KEYS and OAUTH_CREDENTIAL_ACTIVE_KEY_ID are required in production."
        )
    if settings.oauth_credential_write_mode == "plaintext":
        failures.append("OAUTH_CREDENTIAL_WRITE_MODE cannot be plaintext in production.")
    if (
        settings.oauth_credential_write_mode == "dual"
        and not settings.allow_oauth_plaintext_compatibility_in_production
    ):
        failures.append(
            "Dual OAuth credential writes require explicit temporary production compatibility "
            "acknowledgement."
        )
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
