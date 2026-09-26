"""Application settings.

All configuration comes from environment variables (or a local `.env` file in development).
`get_settings()` is cached, so settings are parsed once per process.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEFAULT_SECRET = "dev-insecure-change-me-0123456789abcdef"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    app_name: str = "POS API"
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"
    log_json: bool = False

    # --- Database -------------------------------------------------------------------------
    # asyncpg for the API (async), psycopg for Celery workers and scripts (sync).
    database_url: PostgresDsn = PostgresDsn("postgresql+asyncpg://pos:pos@localhost:5432/pos")
    database_url_sync: PostgresDsn | None = None
    db_pool_size: int = 10
    db_max_overflow: int = 10
    db_echo: bool = False

    # --- Redis ----------------------------------------------------------------------------
    # "fakeredis://" runs an in-process fake. Development-only convenience for machines
    # without Redis; it is not shared between processes.
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None
    # Development without a Celery worker (e.g. REDIS_URL=fakeredis://): run background jobs
    # in-process after the response instead of queueing them.
    background_jobs_inline: bool = False

    # --- Security -------------------------------------------------------------------------
    jwt_secret: str = Field(default=_INSECURE_DEFAULT_SECRET, min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_ttl_seconds: int = 15 * 60
    device_token_ttl_seconds: int = 60 * 60
    refresh_token_ttl_admin_seconds: int = 14 * 24 * 3600
    refresh_token_ttl_pos_seconds: int = 12 * 3600
    cookie_secure: bool = True
    pin_offline_iterations: int = 210_000
    device_challenge_ttl_seconds: int = 60

    allow_signup: bool = True
    cors_origins: list[str] = ["http://localhost:3000"]
    rate_limit_enabled: bool = True

    @model_validator(mode="after")
    def _check_production_safety(self) -> "Settings":
        if self.environment == "production":
            if self.jwt_secret == _INSECURE_DEFAULT_SECRET:
                raise ValueError("JWT_SECRET must be set in production")
            if self.redis_url.startswith("fakeredis"):
                raise ValueError("fakeredis cannot be used in production")
            if self.background_jobs_inline:
                raise ValueError("BACKGROUND_JOBS_INLINE must be false in production")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true in production")
        return self

    @property
    def sync_database_url(self) -> str:
        """Database URL for synchronous engines (Celery, scripts)."""
        if self.database_url_sync:
            return str(self.database_url_sync)
        return str(self.database_url).replace("+asyncpg", "+psycopg")

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
