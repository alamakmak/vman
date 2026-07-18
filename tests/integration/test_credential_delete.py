"""Credential delete must not be blocked by soft-deleted hosts."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select

from vman.config import get_settings
from vman.db import models
from vman.db.base import Base
from vman.db.session import get_sessionmaker, reset_engine
from vman.main import create_app
from vman.security.crypto import decode_master_key_from_env, generate_master_key, encode_master_key_for_env
from vman.services.vault import Vault


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "vman.db"
    master = encode_master_key_for_env(generate_master_key())
    monkeypatch.setenv("VMAN_ENV", "development")
    monkeypatch.setenv("VMAN_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("VMAN_DOTENV_PATH", "/dev/null")
    monkeypatch.setenv("VMAN_MASTER_KEY", master)
    monkeypatch.delenv("VMAN_SETUP_TOKEN", raising=False)
    monkeypatch.setenv("VMAN_SETUP_TOKEN", "")
    reset_engine()
    get_settings.cache_clear()  # type: ignore[attr-defined]
    eng = create_engine(f"sqlite:///{db_path}", future=True)
    Base.metadata.create_all(eng)
    eng.dispose()
    yield TestClient(create_app())
    reset_engine()
    get_settings.cache_clear()  # type: ignore[attr-defined]


def _login(client: TestClient) -> str:
    client.post(
        "/api/auth/setup",
        json={"username": "alice", "password": "S3cret-passphrase!!"},
    )
    return client.cookies.get("vman_csrf") or ""


def _seed_cred_and_host(*, disabled: bool) -> tuple[str, str]:
    from vman.security.crypto import decode_master_key_from_env
    import datetime as dt

    sf = get_sessionmaker()
    master = decode_master_key_from_env(get_settings().master_key)
    with sf() as s:
        s.add(models.EncryptionKey(id="k-active", version=1, status="active"))
        s.commit()
    cred_id = uuid.uuid4().hex
    with sf() as s:
        s.add(
            models.Credential(
                id=cred_id,
                name="cred-x",
                kind="ssh_password",
                encrypted_payload=b"placeholder",
                encryption_key_id="k-active",
            )
        )
        s.commit()
    Vault(master_key=master, session_factory=sf).store(
        credential_id=cred_id, plaintext="secret-password", kind="ssh_password"
    )
    host_id = uuid.uuid4().hex
    with sf() as s:
        s.add(
            models.Host(
                id=host_id,
                name="host-x",
                hostname_or_ip="10.0.0.9",
                ssh_port=22,
                username="root",
                auth_method="password",
                credential_id=cred_id,
                disabled_at=dt.datetime.now(dt.timezone.utc) if disabled else None,
            )
        )
        s.commit()
    return cred_id, host_id


def test_cannot_delete_credential_used_by_active_host(client: TestClient) -> None:
    csrf = _login(client)
    cred_id, _ = _seed_cred_and_host(disabled=False)
    resp = client.delete(f"/api/credentials/{cred_id}", headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 400
    assert "active host" in resp.json()["detail"].lower()


def test_can_delete_credential_after_host_soft_deleted(client: TestClient) -> None:
    csrf = _login(client)
    cred_id, host_id = _seed_cred_and_host(disabled=False)
    # soft-delete host via API (now clears credential_id)
    assert (
        client.delete(f"/api/hosts/{host_id}", headers={"X-CSRF-Token": csrf}).status_code
        == 200
    )
    resp = client.delete(f"/api/credentials/{cred_id}", headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 200, resp.text
    # gone
    sf = get_sessionmaker()
    with sf() as s:
        assert s.get(models.Credential, cred_id) is None
        host = s.get(models.Host, host_id)
        assert host is not None
        assert host.disabled_at is not None
        assert host.credential_id is None


def test_can_delete_credential_linked_only_to_already_disabled_host(
    client: TestClient,
) -> None:
    csrf = _login(client)
    cred_id, host_id = _seed_cred_and_host(disabled=True)
    resp = client.delete(f"/api/credentials/{cred_id}", headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 200, resp.text
    sf = get_sessionmaker()
    with sf() as s:
        assert s.get(models.Credential, cred_id) is None
        host = s.get(models.Host, host_id)
        assert host.credential_id is None
