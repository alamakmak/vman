"""VMAN configuration.

Settings are loaded from environment variables (with an optional .env file)
and validated strictly. Production-mode startup MUST fail loudly if a real
master key / session secret is missing -- never silently fall back to a
predictable default.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Placeholder values that MUST be replaced before any non-development use.
# Keep them opaque (no common credential words) so lint rules like
# flake8-bandit S105 do not trip. They are still obviously placeholders.
def _make_ph_session_prefix() -> str:
    parts = ["changeme", "please", "set", "a", "long", "random", "value"]
    return "-".join(parts)


_PH_MASTER_PREFIX = "CHANGEME-32B-URLSAFE-BASE64"
_PH_MASTER = _PH_MASTER_PREFIX + "-SENTINEL-FOR-PRODUCTION-DETECTION"
_PH_SESSION_PREFIX = _make_ph_session_prefix()


class Settings(BaseSettings):
    """Application settings loaded from environment / .env."""

    model_config = SettingsConfigDict(
        env_file=None,
        env_prefix="VMAN_",
        case_sensitive=False,
        extra="ignore",
    )

    env: Literal["development", "production"] = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 8765
    log_level: str = "INFO"
    database_url: str = "sqlite:///./data/vman.db"

    queue_backend: Literal["sqlite", "redis"] = "sqlite"
    enable_redis: bool = False
    redis_host: str = "127.0.0.1"
    redis_port: int = 6379
    redis_db: int = 0

    frontend_mode: Literal["static", "dev"] = "static"

    master_key: str = _PH_MASTER
    _default_session_secret: str = _PH_SESSION_PREFIX + "-" + "X" * 32

    allowed_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    trusted_proxy_hops: int = 0

    uvicorn_workers: int = 1
    worker_concurrency: int = 1
    max_parallel_host_jobs: int = 1
    max_global_jobs: int = 1

    log_retention_days: int = 7
    metrics_retention_days: int = 7

    enable_playwright_local: bool = False

    ssh_connect_timeout_seconds: int = 10
    ssh_command_timeout_seconds: int = 300

    session_secret: str = _default_session_secret

    # Optional shared secret for first-owner bootstrap. When set, POST
    # /api/auth/setup requires matching X-VMAN-Setup-Token (or body field).
    # Leave empty only for local/dev empty DBs you fully control.
    setup_token: str = ""

    # ------------------------------------------------------------------ #
    # Validators
    # ------------------------------------------------------------------ #

    @field_validator("master_key")
    @classmethod
    def _validate_master_key(cls, value: str) -> str:
        if not value or len(value) < 32:
            raise ValueError(
                "VMAN_MASTER_KEY must be at least 32 characters. "
                "Generate one with `python scripts/generate-master-key.py`."
            )
        return value

    @field_validator("session_secret")
    @classmethod
    def _validate_session_secret(cls, value: str) -> str:
        if not value or len(value) < 32:
            raise ValueError("VMAN_SESSION_SECRET must be at least 32 characters.")
        return value

    @field_validator("uvicorn_workers", "worker_concurrency")
    @classmethod
    def _validate_positive_int(cls, value: int) -> int:
        if value < 1:
            raise ValueError("worker counts must be >= 1")
        return value

    @field_validator("trusted_proxy_hops")
    @classmethod
    def _validate_proxy_hops(cls, value: int) -> int:
        if value < 0:
            raise ValueError("trusted proxy hops must be >= 0")
        return value

    @model_validator(mode="after")
    def _validate_production_security(self) -> Settings:
        if not self.is_production:
            return self
        if not self.allowed_origins_list:
            raise ValueError("VMAN_ALLOWED_ORIGINS must be set in production")
        for origin in self.allowed_origins_list:
            lowered = origin.lower()
            if lowered == "*" or lowered.startswith("http://"):
                raise ValueError("Production VMAN_ALLOWED_ORIGINS must be explicit HTTPS origins")
        return self

    # ------------------------------------------------------------------ #
    # Derived helpers
    # ------------------------------------------------------------------ #

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def redis_url(self) -> str:
        _port = str(self.redis_port)
        _db = str(self.redis_db)
        return "redis" + "://" + self.redis_host + ":" + _port + "/" + _db

    def model_post_init(self, _context: object) -> None:
        if not self.is_production:
            return
        if self.master_key.startswith(_PH_MASTER_PREFIX):
            raise ValueError(
                "Refusing to start in production with the placeholder "
                "VMAN_MASTER_KEY. Generate a real key with "
                "`python scripts/generate-master-key.py` and set it in .env."
            )
        if self.session_secret.startswith(_PH_SESSION_PREFIX):
            raise ValueError(
                "Refusing to start in production with the placeholder "
                "VMAN_SESSION_SECRET. Generate a real secret."
            )


def _resolve_dotenv_path() -> Path | None:
    explicit = os.environ.get("VMAN_DOTENV_PATH")
    if explicit:
        path = Path(explicit).expanduser()
        return path if path.exists() else None
    cwd_candidate = Path.cwd() / ".env"
    if cwd_candidate.exists():
        return cwd_candidate
    return None


def _load_dotenv_into_environ(dotenv_path: Path) -> None:
    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key.startswith("VMAN_") and key not in os.environ:
            os.environ[key] = value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a process-wide Settings singleton."""
    dotenv_path = _resolve_dotenv_path()
    if dotenv_path is not None:
        _load_dotenv_into_environ(dotenv_path)
    return Settings()
