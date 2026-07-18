"""Credential vault service for VMAN (Milestone 0 / Task 3).

The vault is the single component in VMAN that knows how to translate
between ``Credential.encrypted_payload`` (BLOB on disk) and the
plaintext value the SSH runner needs in worker memory.

For the MVP we use a single master key (no DEK wrapping). The schema
already supports key rotation through the ``encryption_keys`` table,
so introducing DEK wrapping later only requires swapping
:func:`_resolve_active_key_bytes` and the row-writing path. The
public API stays the same.

Security contracts enforced here:

- The plaintext NEVER leaves the worker process via logs or
  exceptions -- ``VaultError`` messages are deliberately generic.
- Each ciphertext is bound to ``(credential_id, kind)`` via AAD, so a
  stored ciphertext cannot be decrypted as a different credential.
- Wrong master key or tampered ciphertext raises :class:`VaultError`,
  not a low-level crypto exception, so callers handle one type.
- Reading a credential that has no stored ciphertext raises
  :class:`VaultError` (placeholder bytes are not a valid envelope).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from vman.db import models
from vman.security.crypto import (
    CryptoError,
    decrypt_bytes,
    encrypt_bytes,
)


class VaultError(Exception):
    """Raised for any vault-layer failure visible to callers."""


# Default kind used when storing a credential whose kind is unknown.
_DEFAULT_KIND: Final[str] = "ssh_password"


@dataclass(frozen=True)
class SshAuthMaterial:
    """Decrypted material needed to open an SSH session.

    Exactly one of password / private_key is typically set. passphrase
    is only used when private_key is encrypted.
    """

    password: str | None = None
    private_key: str | None = None
    passphrase: str | None = None


def map_credential_to_ssh_auth(
    *,
    kind: str,
    plaintext: str,
    auth_method: str,
    metadata: Mapping[str, object] | None = None,
) -> SshAuthMaterial:
    """Map one vault credential into SSH auth fields.

    Rules (single primary credential on the host):
    - ``ssh_password`` → password
    - ``ssh_private_key`` → private_key; optional passphrase from
      ``metadata["passphrase"]`` (legacy) or left for a second reveal
    - ``ssh_private_key_passphrase`` → passphrase only, unless
      ``metadata["private_key"]`` holds a PEM (bundled key+pass)
    - ``sudo_password`` / non-PEM secrets never treated as private keys
    - content sniffing: PEM-looking secrets become private_key even if
      kind/auth_method are mis-set; plain secrets become password

    Linked second credential (key_with_passphrase) is resolved by
    :meth:`Vault.reveal_ssh_for_host`, not here.
    """
    if not plaintext:
        raise VaultError("plaintext must be a non-empty string")
    meta = dict(metadata or {})
    looks_like_pem = "BEGIN" in plaintext and "PRIVATE KEY" in plaintext

    if kind == "ssh_password":
        return SshAuthMaterial(password=plaintext)

    if kind == "ssh_private_key":
        if not looks_like_pem:
            raise VaultError(
                "credential kind is ssh_private_key but secret is not a PEM private key"
            )
        extra = meta.get("passphrase")
        passphrase = extra if isinstance(extra, str) and extra else None
        return SshAuthMaterial(private_key=plaintext, passphrase=passphrase)

    if kind == "ssh_private_key_passphrase":
        # Passphrase-only credential. Optionally bundle PEM in metadata
        # when the operator stored both in one vault entry.
        pk = meta.get("private_key")
        if isinstance(pk, str) and "BEGIN" in pk:
            return SshAuthMaterial(private_key=pk, passphrase=plaintext)
        return SshAuthMaterial(passphrase=plaintext)

    if kind == "sudo_password":
        # Never treat sudo password as an SSH private key.
        return SshAuthMaterial(password=plaintext)

    # api_token / unknown: sniff content, then fall back to auth_method.
    if looks_like_pem:
        return SshAuthMaterial(private_key=plaintext)
    if auth_method == "password" or not looks_like_pem:
        return SshAuthMaterial(password=plaintext)
    return SshAuthMaterial(private_key=plaintext)


def _build_aad(credential_id: str, kind: str) -> bytes:
    """Construct AAD binding a ciphertext to its credential identity.

    Format is intentionally stable text -- changing it breaks every
    already-stored ciphertext, so it must be bumped together with a
    ciphertext version migration.
    """
    return f"credential_id={credential_id}|kind={kind}".encode()


class Vault:
    """High-level credential encrypt/decrypt service.

    Construct one per process (worker only). The instance holds the
    master key in memory for the life of the process -- which is
    exactly what we want inside the worker, and exactly what we do
    NOT want inside the API process. The API should never construct
    a ``Vault``; only the worker and the CLI should.

    Note: connection-test and terminal routes currently also construct
    a Vault (MVP compromise so the dashboard can verify SSH without a
    separate worker hop). Prefer worker/CLI for bulk decryption.
    """

    def __init__(self, master_key: bytes, session_factory: sessionmaker[Session]) -> None:
        if len(master_key) != 32:
            raise VaultError("vault master key must be exactly 32 bytes")
        self._master_key = master_key
        self._session_factory = session_factory

    # ------------------------------------------------------------------ #
    # Writes
    # ------------------------------------------------------------------ #

    def store(
        self,
        *,
        credential_id: str,
        plaintext: str,
        kind: str,
        public_fingerprint: str = "",
    ) -> models.Credential:
        """Encrypt ``plaintext`` and persist the ciphertext on the credential row.

        Returns the updated :class:`Credential` ORM instance.
        """
        if not plaintext:
            raise VaultError("plaintext must be a non-empty string")
        if not credential_id:
            raise VaultError("credential_id must be provided")
        if kind not in models.CREDENTIAL_KINDS:
            raise VaultError(f"unknown credential kind: {kind!r}")

        aad = _build_aad(credential_id, kind)
        ciphertext = encrypt_bytes(self._master_key, plaintext.encode("utf-8"), aad=aad)

        with self._session_factory() as session:
            cred = session.execute(
                select(models.Credential).where(models.Credential.id == credential_id)
            ).scalar_one_or_none()
            if cred is None:
                raise VaultError(f"credential not found: {credential_id}")
            cred.encrypted_payload = ciphertext
            cred.kind = kind
            cred.encryption_key_id = self._resolve_active_key_id(session)
            if public_fingerprint:
                cred.fingerprint = public_fingerprint
            session.commit()
            session.refresh(cred)
            # Detach so the caller doesn't accidentally keep a session-bound object.
            session.expunge(cred)
        return cred

    # ------------------------------------------------------------------ #
    # Reads
    # ------------------------------------------------------------------ #

    def reveal(self, *, credential_id: str) -> str:
        """Return the decrypted plaintext for ``credential_id``.

        Only the worker process should call this. The API layer MUST
        NOT expose plaintext through any endpoint.
        """
        if not credential_id:
            raise VaultError("credential_id must be provided")

        with self._session_factory() as session:
            cred = session.execute(
                select(models.Credential).where(models.Credential.id == credential_id)
            ).scalar_one_or_none()
            if cred is None:
                raise VaultError(f"credential not found: {credential_id}")
            ciphertext = bytes(cred.encrypted_payload)
            kind = cred.kind
            aad = _build_aad(cred.id, kind)

        try:
            plaintext_bytes = decrypt_bytes(self._master_key, ciphertext, aad=aad)
        except CryptoError as exc:
            # Wrap so callers handle one type; never echo the ciphertext.
            raise VaultError("vault decryption failed") from exc
        return plaintext_bytes.decode("utf-8")

    def reveal_ssh_for_host(self, host: models.Host) -> SshAuthMaterial:
        """Decrypt host credential(s) into SSH auth material.

        Primary credential is ``host.credential_id``. When auth_method is
        ``key_with_passphrase`` and the primary is a key, a second vault
        entry may be referenced via ``metadata_json[\"passphrase_credential_id\"]``
        on the key credential (or on the host via future schema).
        """
        if not host.credential_id:
            raise VaultError("host has no credential_id")

        with self._session_factory() as session:
            cred = session.execute(
                select(models.Credential).where(models.Credential.id == host.credential_id)
            ).scalar_one_or_none()
            if cred is None:
                raise VaultError(f"credential not found: {host.credential_id}")
            kind = cred.kind
            meta = dict(cred.metadata_json or {})
            ciphertext = bytes(cred.encrypted_payload)
            aad = _build_aad(cred.id, kind)
            passphrase_cred_id = meta.get("passphrase_credential_id")
            if not isinstance(passphrase_cred_id, str):
                passphrase_cred_id = None

        try:
            plaintext = decrypt_bytes(self._master_key, ciphertext, aad=aad).decode("utf-8")
        except CryptoError as exc:
            raise VaultError("vault decryption failed") from exc

        material = map_credential_to_ssh_auth(
            kind=kind,
            plaintext=plaintext,
            auth_method=host.auth_method,
            metadata=meta,
        )

        # Second hop: encrypted key needs a separate passphrase credential.
        if (
            material.private_key
            and not material.passphrase
            and host.auth_method == "key_with_passphrase"
            and passphrase_cred_id
        ):
            phrase = self.reveal(credential_id=passphrase_cred_id)
            material = SshAuthMaterial(
                password=material.password,
                private_key=material.private_key,
                passphrase=phrase,
            )

        if not material.password and not material.private_key:
            raise VaultError(
                "credential does not yield SSH password or private key "
                f"(kind={kind!r}, auth_method={host.auth_method!r})"
            )
        return material

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _resolve_active_key_id(self, session: Session) -> str:
        """Return the id of the currently-active encryption key.

        For MVP we have exactly one active row; later (DEK wrapping /
        real rotation) this becomes a richer lookup.
        """
        row = session.execute(
            select(models.EncryptionKey)
            .where(models.EncryptionKey.status == "active")
            .order_by(models.EncryptionKey.version.desc())
            .limit(1)
        ).scalar_one_or_none()
        if row is None:
            raise VaultError("no active encryption key registered")
        return row.id


__all__ = [
    "SshAuthMaterial",
    "Vault",
    "VaultError",
    "map_credential_to_ssh_auth",
]
