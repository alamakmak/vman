"""Integration tests for the auth API (Milestone 1 / Task 5).

Covers:

- First-admin setup (single-shot, blocked once a user exists).
- Login with username + password -> HttpOnly cookie session.
- Session lookup via cookie -> /api/auth/me.
- Wrong password -> 401, no cookie set.
- Rate limiting: 5 failed logins in a row from the same IP get a 429.
- Logout revokes the session; subsequent /me returns 401.
- /api/auth/me never echoes the password hash or session token.
- Session token in DB is a hash, never the plaintext cookie value.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from vman.config import get_settings
from vman.db import models
from vman.db.session import get_sessionmaker, reset_engine
from vman.main import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Point the app at an isolated SQLite file so tests don't pollute prod.
    db_path = tmp_path / "vman.db"
    monkeypatch.setenv("VMAN_ENV", "development")
    monkeypatch.setenv("VMAN_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("VMAN_DOTENV_PATH", "/dev/null")
    # Never inherit a production setup token into the test process.
    monkeypatch.delenv("VMAN_SETUP_TOKEN", raising=False)
    monkeypatch.setenv("VMAN_SETUP_TOKEN", "")
    reset_engine()
    get_settings.cache_clear()  # type: ignore[attr-defined]
    # Reset the in-process login rate limiter between tests so one test's
    # failures don't lock the next test out of the same IP (TestClient).
    from vman.security.auth import get_rate_limiter

    get_rate_limiter().reset_all()
    # Initialise the schema in the test DB.
    from sqlalchemy import create_engine

    import vman.db.models  # noqa: F401
    from vman.db.base import Base

    eng = create_engine(f"sqlite:///{db_path}", future=True)
    Base.metadata.create_all(eng)
    eng.dispose()
    yield TestClient(create_app())
    reset_engine()
    get_settings.cache_clear()  # type: ignore[attr-defined]


def _setup_admin(
    client: TestClient,
    *,
    username: str = "alice",
    password: str = "S3cret-passphrase!!",  # noqa: S107 (test fixture)
) -> None:
    resp = client.post(
        "/api/auth/setup",
        json={"username": username, "password": password},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["username"] == username
    assert resp.json()["role"] == "owner"


def test_setup_creates_first_owner(client: TestClient) -> None:
    _setup_admin(client)
    # Second call must be rejected -- only one setup is allowed.
    resp = client.post(
        "/api/auth/setup",
        json={"username": "bob", "password": "another-strong-passphrase!!"},
    )
    assert resp.status_code in (400, 409)


def test_auth_status_before_and_after_setup(client: TestClient) -> None:
    before = client.get("/api/auth/status")
    assert before.status_code == 200
    body = before.json()
    assert body["setup_required"] is True
    assert body["setup_token_required"] is False

    _setup_admin(client)

    after = client.get("/api/auth/status")
    assert after.status_code == 200
    assert after.json()["setup_required"] is False


def test_setup_requires_token_when_configured(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("VMAN_SETUP_TOKEN", "deploy-secret-token-xyz")
    get_settings.cache_clear()  # type: ignore[attr-defined]

    # Fresh app so settings re-read env
    from vman.main import create_app

    c = TestClient(create_app())
    denied = c.post(
        "/api/auth/setup",
        json={"username": "alice", "password": "S3cret-passphrase!!"},
    )
    assert denied.status_code == 403

    ok = c.post(
        "/api/auth/setup",
        json={
            "username": "alice",
            "password": "S3cret-passphrase!!",
            "setup_token": "deploy-secret-token-xyz",
        },
    )
    assert ok.status_code == 200, ok.text
    assert ok.cookies.get("vman_session"), "setup should auto-login"
    assert c.get("/api/auth/me").status_code == 200

    get_settings.cache_clear()  # type: ignore[attr-defined]


def test_setup_rejects_short_password(client: TestClient) -> None:
    resp = client.post(
        "/api/auth/setup",
        json={"username": "x", "password": "short"},
    )
    # The validator runs before insert; bad password -> 422.
    assert resp.status_code in (422, 400)


def test_login_with_correct_password_sets_cookie(client: TestClient) -> None:
    _setup_admin(client, password="correct-horse-battery-staple")
    resp = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "correct-horse-battery-staple"},
    )
    assert resp.status_code == 200, resp.text
    # Cookie must be HttpOnly + SameSite=Lax (CSRF safety comes in T6).
    set_cookie = resp.headers.get("set-cookie", "")
    assert "vman_session" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=Lax" in set_cookie or "samesite=lax" in set_cookie.lower()


def test_login_with_wrong_password_returns_401_no_cookie(client: TestClient) -> None:
    _setup_admin(client, password="correct-horse-battery-staple")
    resp = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "wrong-password"},
    )
    assert resp.status_code == 401
    assert "vman_session" not in resp.headers.get("set-cookie", "")


def test_login_unknown_user_returns_401(client: TestClient) -> None:
    _setup_admin(client)
    resp = client.post(
        "/api/auth/login",
        json={"username": "nobody", "password": "whatever"},
    )
    assert resp.status_code == 401


def test_me_returns_current_user_when_authenticated(client: TestClient) -> None:
    _setup_admin(client)
    client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "S3cret-passphrase!!"},
    )
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "alice"
    assert body["role"] == "owner"
    # No password hash, no session token in the response.
    for forbidden in ("password_hash", "session_token", "token_hash"):
        assert forbidden not in resp.text.lower()


def test_me_returns_401_when_no_cookie(client: TestClient) -> None:
    _setup_admin(client)
    # Setup now auto-logs in; clear cookies to assert unauthenticated /me.
    client.cookies.clear()
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_logout_revokes_session(client: TestClient) -> None:
    _setup_admin(client)
    client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "S3cret-passphrase!!"},
    )
    # /me works while logged in
    assert client.get("/api/auth/me").status_code == 200
    # Logout (with CSRF token -- the login response set vman_csrf)
    csrf = client.cookies.get("vman_csrf") or ""
    resp = client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 200
    # Cookie cleared
    assert resp.headers.get("set-cookie", "").find("vman_session") != -1
    # /me now fails
    assert client.get("/api/auth/me").status_code == 401


def test_login_rate_limits_repeated_failures(client: TestClient) -> None:
    _setup_admin(client, password="correct-password-12345")
    # Five failed attempts (the limit) should succeed with 401, the sixth
    # MUST be rate-limited (429).
    statuses = []
    for _ in range(6):
        r = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong-password"},
        )
        statuses.append(r.status_code)
    assert 429 in statuses, f"expected 429 in attempts, got {statuses}"


def test_session_token_in_db_is_a_hash_not_plaintext(client: TestClient) -> None:
    _setup_admin(client)
    resp = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "S3cret-passphrase!!"},
    )
    cookie = resp.cookies.get("vman_session")
    assert cookie, "no session cookie returned"
    # Read the session row directly.
    from sqlalchemy import create_engine, select

    import vman.db.models  # noqa: F401
    from vman.db.base import Base

    eng = create_engine(get_settings().database_url, future=True)
    Base.metadata.create_all(eng)
    with get_sessionmaker()() as s:
        rows = s.execute(select(models.UserSession)).scalars().all()
    eng.dispose()
    assert rows, "no session row"
    # The DB hash MUST NOT equal the cookie value.
    for r in rows:
        assert r.session_token_hash != cookie
        # And it should look like a hex sha256 (64 hex chars).
        assert len(r.session_token_hash) == 64


def test_disabled_user_cannot_login(client: TestClient) -> None:
    import datetime as dt

    _setup_admin(client)
    # Disable the user directly via DB.
    from sqlalchemy import create_engine, update

    import vman.db.models  # noqa: F401
    from vman.db.base import Base

    eng = create_engine(get_settings().database_url, future=True)
    Base.metadata.create_all(eng)
    with eng.begin() as conn:
        conn.execute(
            update(models.User)
            .where(models.User.username == "alice")
            .values(disabled_at=dt.datetime.now(dt.timezone.utc))
        )
    eng.dispose()
    resp = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "S3cret-passphrase!!"},
    )
    assert resp.status_code == 401


def test_login_rate_limit_tracks_username_across_forwarded_for_spoofing(client: TestClient) -> None:
    client.post(
        "/api/auth/setup",
        json={"username": "alice", "password": "S3cret-passphrase!!"},
    )

    for index in range(5):
        resp = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong-passphrase!!"},
            headers={"X-Forwarded-For": f"203.0.113.{index}"},
        )
        assert resp.status_code == 401

    blocked = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "wrong-passphrase!!"},
        headers={"X-Forwarded-For": "203.0.113.250"},
    )
    assert blocked.status_code == 429
    assert blocked.headers.get("retry-after") == "300"


def test_change_password_requires_current_and_updates(client: TestClient) -> None:
    _setup_admin(client, password="old-password-12345")
    # setup auto-login; get csrf
    csrf = client.cookies.get("vman_csrf") or ""
    bad = client.post(
        "/api/auth/password",
        json={"current_password": "wrong", "new_password": "new-password-12345"},
        headers={"X-CSRF-Token": csrf},
    )
    assert bad.status_code == 401

    ok = client.post(
        "/api/auth/password",
        json={
            "current_password": "old-password-12345",
            "new_password": "new-password-12345",
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert ok.status_code == 200, ok.text

    # old password fails
    client.cookies.clear()
    assert (
        client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "old-password-12345"},
        ).status_code
        == 401
    )
    # new password works
    assert (
        client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "new-password-12345"},
        ).status_code
        == 200
    )
