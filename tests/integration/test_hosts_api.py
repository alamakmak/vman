"""Integration tests for the host CRUD API (Milestone 2 / Task 8).

Acceptance criteria from the implementation plan:
- create / list / get / update / delete host
- validates IP, port, name
- never returns decrypted credential material in the response
- the response shape never exposes vault ciphertexts
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from vman.config import get_settings
from vman.db.session import reset_engine
from vman.main import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "vman.db"
    monkeypatch.setenv("VMAN_ENV", "development")
    monkeypatch.setenv("VMAN_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("VMAN_DOTENV_PATH", "/dev/null")
    monkeypatch.delenv("VMAN_SETUP_TOKEN", raising=False)
    monkeypatch.setenv("VMAN_SETUP_TOKEN", "")
    reset_engine()
    get_settings.cache_clear()  # type: ignore[attr-defined]
    from sqlalchemy import create_engine

    import vman.db.models  # noqa: F401
    from vman.db.base import Base

    eng = create_engine(f"sqlite:///{db_path}", future=True)
    Base.metadata.create_all(eng)
    eng.dispose()
    yield TestClient(create_app())
    reset_engine()
    get_settings.cache_clear()  # type: ignore[attr-defined]


def _setup_and_login(client: TestClient) -> str:
    # Setup auto-logs in and sets cookies; no second login needed.
    client.post(
        "/api/auth/setup",
        json={"username": "alice", "password": "S3cret-passphrase!!"},
    )
    return client.cookies.get("vman_csrf") or ""


def _csrf_headers(csrf: str) -> dict[str, str]:
    return {"X-CSRF-Token": csrf}


def test_create_host_succeeds(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    resp = client.post(
        "/api/hosts",
        json={
            "name": "sg-1gb-01",
            "hostname_or_ip": "10.0.0.1",
            "ssh_port": 22144,
            "username": "root",
            "auth_method": "key",
            "tags": ["singapore", "experiment"],
        },
        headers=_csrf_headers(csrf),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "sg-1gb-01"
    assert body["hostname_or_ip"] == "10.0.0.1"
    assert body["ssh_port"] == 22144
    assert body["username"] == "root"
    assert body["auth_method"] == "key"
    assert body["tags"] == ["singapore", "experiment"]
    assert body["environment"] == "experiment"  # default


def test_list_hosts(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    for i in range(3):
        client.post(
            "/api/hosts",
            json={
                "name": "host-" + str(i),
                "hostname_or_ip": "10.0.0." + str(i + 1),
                "ssh_port": 22,
                "username": "root",
                "auth_method": "key",
            },
            headers=_csrf_headers(csrf),
        )
    resp = client.get("/api/hosts", headers=_csrf_headers(csrf))
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 3
    names = {h["name"] for h in body}
    assert names == {"host-0", "host-1", "host-2"}


def test_get_host_by_id(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    create_resp = client.post(
        "/api/hosts",
        json={
            "name": "host-a",
            "hostname_or_ip": "10.0.0.1",
            "ssh_port": 22,
            "username": "root",
            "auth_method": "password",
        },
        headers=_csrf_headers(csrf),
    )
    host_id = create_resp.json()["id"]
    resp = client.get("/api/hosts/" + host_id, headers=_csrf_headers(csrf))
    assert resp.status_code == 200
    assert resp.json()["name"] == "host-a"


def test_get_unknown_host_returns_404(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    resp = client.get("/api/hosts/does-not-exist", headers=_csrf_headers(csrf))
    assert resp.status_code == 404


def test_update_host(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    create_resp = client.post(
        "/api/hosts",
        json={
            "name": "host-b",
            "hostname_or_ip": "10.0.0.2",
            "ssh_port": 22,
            "username": "root",
            "auth_method": "key",
            "tags": ["old"],
        },
        headers=_csrf_headers(csrf),
    )
    host_id = create_resp.json()["id"]
    resp = client.patch(
        "/api/hosts/" + host_id,
        json={"tags": ["new", "tier1"], "environment": "production"},
        headers=_csrf_headers(csrf),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["tags"] == ["new", "tier1"]
    assert body["environment"] == "production"


def test_delete_host_is_soft(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    create_resp = client.post(
        "/api/hosts",
        json={
            "name": "host-c",
            "hostname_or_ip": "10.0.0.3",
            "ssh_port": 22,
            "username": "root",
            "auth_method": "key",
        },
        headers=_csrf_headers(csrf),
    )
    host_id = create_resp.json()["id"]
    resp = client.delete("/api/hosts/" + host_id, headers=_csrf_headers(csrf))
    assert resp.status_code == 200
    resp = client.get("/api/hosts", headers=_csrf_headers(csrf))
    assert all(h["id"] != host_id for h in resp.json())


def test_can_recreate_host_with_same_name_after_soft_delete(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    payload = {
        "name": "2c4gb",
        "hostname_or_ip": "10.0.0.50",
        "ssh_port": 22,
        "username": "root",
        "auth_method": "key",
    }
    first = client.post("/api/hosts", json=payload, headers=_csrf_headers(csrf))
    assert first.status_code == 201, first.text
    host_id = first.json()["id"]
    assert client.delete(f"/api/hosts/{host_id}", headers=_csrf_headers(csrf)).status_code == 200

    again = client.post(
        "/api/hosts",
        json={
            **payload,
            "hostname_or_ip": "10.0.0.51",
            "ssh_port": 2222,
        },
        headers=_csrf_headers(csrf),
    )
    assert again.status_code == 201, again.text
    assert again.json()["name"] == "2c4gb"
    assert again.json()["id"] != host_id
    # list shows only the new active host with that name
    listed = client.get("/api/hosts", headers=_csrf_headers(csrf)).json()
    names = [h["name"] for h in listed]
    assert names.count("2c4gb") == 1


def test_name_must_be_unique(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    payload = {
        "name": "dup",
        "hostname_or_ip": "10.0.0.10",
        "ssh_port": 22,
        "username": "root",
        "auth_method": "key",
    }
    client.post("/api/hosts", json=payload, headers=_csrf_headers(csrf))
    resp = client.post("/api/hosts", json=payload, headers=_csrf_headers(csrf))
    assert resp.status_code in (400, 409)


def test_name_must_be_valid_identifier(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    for bad in ["host with spaces", "host!bang", ""]:
        resp = client.post(
            "/api/hosts",
            json={
                "name": bad,
                "hostname_or_ip": "10.0.0.1",
                "ssh_port": 22,
                "username": "root",
                "auth_method": "key",
            },
            headers=_csrf_headers(csrf),
        )
        assert resp.status_code in (400, 422), f"bad name {bad!r}: {resp.status_code}"


def test_invalid_ip_or_hostname_rejected(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    # Empty string / whitespace are not valid; obvious garbage is rejected
    # by length / charset checks. Valid DNS names (e.g. "not-an-ip")
    # ARE accepted by design.
    for bad in ["", "   ", "x" * 256]:
        resp = client.post(
            "/api/hosts",
            json={
                "name": "host-bad-host-" + str(len(bad)),
                "hostname_or_ip": bad,
                "ssh_port": 22,
                "username": "root",
                "auth_method": "key",
            },
            headers=_csrf_headers(csrf),
        )
        assert resp.status_code in (400, 422), f"bad host {bad!r}: {resp.status_code}"


def test_invalid_port_rejected(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    for bad in [0, -1, 70000, 100000]:
        resp = client.post(
            "/api/hosts",
            json={
                "name": "host-p" + str(bad),
                "hostname_or_ip": "10.0.0.1",
                "ssh_port": bad,
                "username": "root",
                "auth_method": "key",
            },
            headers=_csrf_headers(csrf),
        )
        assert resp.status_code in (400, 422), f"bad port {bad}: {resp.status_code}"


def test_username_must_be_nonempty(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    resp = client.post(
        "/api/hosts",
        json={
            "name": "host-u",
            "hostname_or_ip": "10.0.0.1",
            "ssh_port": 22,
            "username": "",
            "auth_method": "key",
        },
        headers=_csrf_headers(csrf),
    )
    assert resp.status_code in (400, 422)


def test_auth_method_must_be_known(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    resp = client.post(
        "/api/hosts",
        json={
            "name": "host-am",
            "hostname_or_ip": "10.0.0.1",
            "ssh_port": 22,
            "username": "root",
            "auth_method": "telepathy",
        },
        headers=_csrf_headers(csrf),
    )
    assert resp.status_code in (400, 422)


def test_create_host_requires_authentication(client: TestClient) -> None:
    resp = client.post(
        "/api/hosts",
        json={
            "name": "host",
            "hostname_or_ip": "10.0.0.1",
            "ssh_port": 22,
            "username": "root",
            "auth_method": "key",
        },
    )
    assert resp.status_code == 401


def test_create_host_requires_csrf(client: TestClient) -> None:
    _setup_and_login(client)
    resp = client.post(
        "/api/hosts",
        json={
            "name": "host-csrf",
            "hostname_or_ip": "10.0.0.1",
            "ssh_port": 22,
            "username": "root",
            "auth_method": "key",
        },
    )
    assert resp.status_code == 403


def test_have_host_key_fingerprint_field(client: TestClient) -> None:
    csrf = _setup_and_login(client)
    create_resp = client.post(
        "/api/hosts",
        json={
            "name": "host-fp",
            "hostname_or_ip": "10.0.0.1",
            "ssh_port": 22,
            "username": "root",
            "auth_method": "key",
        },
        headers=_csrf_headers(csrf),
    )
    body = create_resp.json()
    # fingerprint is nullable; the field MUST exist in the response.
    assert "host_key_fingerprint" in body
    assert body["host_key_fingerprint"] in (None, "")
