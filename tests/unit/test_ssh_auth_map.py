"""Unit tests for credential → SSH auth mapping."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from vman.db import models
from vman.db.base import Base
from vman.security.crypto import generate_master_key
from vman.services.vault import (
    SshAuthMaterial,
    Vault,
    VaultError,
    map_credential_to_ssh_auth,
)


def test_map_ssh_password() -> None:
    m = map_credential_to_ssh_auth(
        kind="ssh_password", plaintext="pw", auth_method="password"
    )
    assert m == SshAuthMaterial(password="pw")


def test_map_ssh_private_key() -> None:
    pem = (
        "-----BEGIN OPENSSH PRIVATE KEY-----\n"
        "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n"
        "-----END OPENSSH PRIVATE KEY-----\n"
    )
    m = map_credential_to_ssh_auth(
        kind="ssh_private_key",
        plaintext=pem,
        auth_method="key",
    )
    assert m.private_key and m.private_key.startswith("-----BEGIN")
    assert m.passphrase is None
    assert m.password is None


def test_map_ssh_private_key_rejects_non_pem() -> None:
    with pytest.raises(VaultError, match="not a PEM"):
        map_credential_to_ssh_auth(
            kind="ssh_private_key",
            plaintext="not-a-key",
            auth_method="key",
        )


def test_map_ssh_private_key_with_meta_passphrase() -> None:
    pem = (
        "-----BEGIN OPENSSH PRIVATE KEY-----\n"
        "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n"
        "-----END OPENSSH PRIVATE KEY-----\n"
    )
    m = map_credential_to_ssh_auth(
        kind="ssh_private_key",
        plaintext=pem,
        auth_method="key_with_passphrase",
        metadata={"passphrase": "secret-phrase"},
    )
    assert m.private_key == pem
    assert m.passphrase == "secret-phrase"


def test_map_passphrase_only() -> None:
    m = map_credential_to_ssh_auth(
        kind="ssh_private_key_passphrase",
        plaintext="phrase-only",
        auth_method="key_with_passphrase",
    )
    assert m.passphrase == "phrase-only"
    assert m.private_key is None


def test_map_passphrase_bundled_with_pem_in_metadata() -> None:
    pem = (
        "-----BEGIN OPENSSH PRIVATE KEY-----\n"
        "Y\n"
        "-----END OPENSSH PRIVATE KEY-----\n"
    )
    m = map_credential_to_ssh_auth(
        kind="ssh_private_key_passphrase",
        plaintext="phrase",
        auth_method="key_with_passphrase",
        metadata={"private_key": pem},
    )
    assert m.private_key == pem
    assert m.passphrase == "phrase"


def test_map_sudo_password_never_becomes_private_key() -> None:
    m = map_credential_to_ssh_auth(
        kind="sudo_password",
        plaintext="s3cretpw",
        auth_method="key",  # misconfigured host auth
    )
    assert m.password == "s3cretpw"
    assert m.private_key is None


def test_map_empty_plaintext_raises() -> None:
    with pytest.raises(VaultError):
        map_credential_to_ssh_auth(kind="ssh_password", plaintext="", auth_method="password")


@pytest.fixture()
def session_factory():
    eng = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, autoflush=False, expire_on_commit=False)


def test_reveal_ssh_for_host_password(session_factory) -> None:
    key = generate_master_key()
    with session_factory() as s:
        s.add(models.EncryptionKey(id="k-active", version=1, status="active"))
        s.commit()
    vault = Vault(master_key=key, session_factory=session_factory)
    cred_id = uuid.uuid4().hex
    with session_factory() as s:
        s.add(
            models.Credential(
                id=cred_id,
                name="pw",
                kind="ssh_password",
                encrypted_payload=b"placeholder",
                encryption_key_id="k-active",
            )
        )
        s.commit()
    vault.store(credential_id=cred_id, plaintext="hunter2", kind="ssh_password")
    host = models.Host(
        id="h1",
        name="h1",
        hostname_or_ip="1.2.3.4",
        ssh_port=22,
        username="root",
        auth_method="password",
        credential_id=cred_id,
    )
    material = vault.reveal_ssh_for_host(host)
    assert material.password == "hunter2"
    assert material.private_key is None


def test_reveal_ssh_for_host_key_plus_linked_passphrase(session_factory) -> None:
    key = generate_master_key()
    with session_factory() as s:
        s.add(models.EncryptionKey(id="k-active", version=1, status="active"))
        s.commit()
    vault = Vault(master_key=key, session_factory=session_factory)
    key_id = uuid.uuid4().hex
    phrase_id = uuid.uuid4().hex
    with session_factory() as s:
        s.add(
            models.Credential(
                id=key_id,
                name="key",
                kind="ssh_private_key",
                encrypted_payload=b"placeholder",
                encryption_key_id="k-active",
                metadata_json={"passphrase_credential_id": phrase_id},
            )
        )
        s.add(
            models.Credential(
                id=phrase_id,
                name="phrase",
                kind="ssh_private_key_passphrase",
                encrypted_payload=b"placeholder",
                encryption_key_id="k-active",
            )
        )
        s.commit()
    vault.store(
        credential_id=key_id,
        plaintext=(
            "-----BEGIN OPENSSH PRIVATE KEY-----\n"
            "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n"
            "-----END OPENSSH PRIVATE KEY-----\n"
        ),
        kind="ssh_private_key",
    )
    vault.store(
        credential_id=phrase_id, plaintext="the-phrase", kind="ssh_private_key_passphrase"
    )
    host = models.Host(
        id="h2",
        name="h2",
        hostname_or_ip="1.2.3.4",
        ssh_port=22,
        username="root",
        auth_method="key_with_passphrase",
        credential_id=key_id,
    )
    material = vault.reveal_ssh_for_host(host)
    assert material.private_key and material.private_key.startswith("-----BEGIN")
    assert material.passphrase == "the-phrase"


def test_reveal_passphrase_only_without_key_raises(session_factory) -> None:
    key = generate_master_key()
    with session_factory() as s:
        s.add(models.EncryptionKey(id="k-active", version=1, status="active"))
        s.commit()
    vault = Vault(master_key=key, session_factory=session_factory)
    cred_id = uuid.uuid4().hex
    with session_factory() as s:
        s.add(
            models.Credential(
                id=cred_id,
                name="phrase-only",
                kind="ssh_private_key_passphrase",
                encrypted_payload=b"placeholder",
                encryption_key_id="k-active",
            )
        )
        s.commit()
    vault.store(credential_id=cred_id, plaintext="x", kind="ssh_private_key_passphrase")
    host = models.Host(
        id="h3",
        name="h3",
        hostname_or_ip="1.2.3.4",
        ssh_port=22,
        username="root",
        auth_method="key_with_passphrase",
        credential_id=cred_id,
    )
    with pytest.raises(VaultError, match="does not yield"):
        vault.reveal_ssh_for_host(host)
