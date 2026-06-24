"""Health and basic app wiring tests (Milestone 0 / Task 1).

These are the very first tests we run. They intentionally cover only
what Task 1 promises: a health endpoint that returns OK, plus sane
configuration loading with strict safety defaults.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from vman.config import Settings, get_settings
from vman.main import create_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())


def test_health_endpoint_returns_ok(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "vman"
    assert isinstance(payload["version"], str) and payload["version"]
    # The health endpoint must NEVER leak secrets or master key material.
    body_text = response.text.lower()
    for forbidden in ("master_key", "session_secret", "password", "token"):
        assert forbidden not in body_text, (
            f"health response leaked forbidden token: {response.text}"
        )


def test_root_path_returns_frontend_or_404(client: TestClient) -> None:
    # When frontend/dist exists (post-build), root serves the SPA index.html (200).
    # When it does not exist (CI / unit test env), FastAPI returns 404.
    response = client.get("/")
    assert response.status_code in (200, 404)


def test_settings_default_database_is_sqlite() -> None:
    settings = get_settings()
    assert settings.database_url.startswith("sqlite"), settings.database_url


def test_settings_default_queue_is_sqlite_local() -> None:
    settings = get_settings()
    # MVP must be runnable without Redis.
    assert settings.queue_backend == "sqlite"
    assert settings.enable_redis is False


def test_settings_low_resource_defaults_are_one() -> None:
    """Small-VPS defaults: one uvicorn worker, one job at a time."""
    settings = get_settings()
    assert settings.uvicorn_workers == 1
    assert settings.worker_concurrency == 1
    assert settings.max_parallel_host_jobs == 1
    assert settings.max_global_jobs == 1


# Sentinel values whose first 32 chars match the placeholder prefixes baked
# into Settings, so the production check correctly rejects them.
PH_MASTER_SENTINEL = "CHANGEME-32B-URLSAFE-BASE64-_PH_MASTER_VALUE-SENTINEL"
PH_SESSION_SENTINEL = "changeme-please-set-a-long-random-value-_PH_SESSION_VALUE-SENTINEL"


def test_settings_reject_placeholder_master_key_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A production deploy must not boot with the placeholder master key."""
    monkeypatch.setenv("VMAN_ENV", "production")
    monkeypatch.setenv("VMAN_MASTER_KEY", PH_MASTER_SENTINEL)
    monkeypatch.setenv("VMAN_SESSION_SECRET", PH_SESSION_SENTINEL)
    get_settings.cache_clear()  # type: ignore[attr-defined]
    try:
        with pytest.raises(ValueError):
            Settings()
    finally:
        get_settings.cache_clear()  # type: ignore[attr-defined]


def test_settings_accept_strong_master_key_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A real key + non-placeholder session secret MUST boot in production."""
    monkeypatch.setenv("VMAN_ENV", "production")
    # 44 chars, does not start with the placeholder prefix.
    monkeypatch.setenv("VMAN_MASTER_KEY", "Z" * 44)
    # 64 chars, does not start with the placeholder prefix.
    monkeypatch.setenv("VMAN_SESSION_SECRET", "Y" * 64)
    monkeypatch.setenv("VMAN_ALLOWED_ORIGINS", "https://vman.example.test")
    get_settings.cache_clear()  # type: ignore[attr-defined]
    try:
        s = Settings()
        assert s.is_production is True
    finally:
        get_settings.cache_clear()  # type: ignore[attr-defined]


def test_settings_allowed_origins_parsed() -> None:
    settings = get_settings()
    origins = settings.allowed_origins_list
    assert isinstance(origins, list)
    for origin in origins:
        assert origin.startswith("http://") or origin.startswith("https://")
