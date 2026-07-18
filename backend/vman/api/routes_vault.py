"""Credential vault HTTP routes."""

from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from vman.api.deps import CurrentUser
from vman.config import get_settings
from vman.db import models
from vman.db.session import get_sessionmaker
from vman.schemas.credentials import CredentialCreate, CredentialOut
from vman.security.crypto import decode_master_key_from_env
from vman.security.csrf import require_csrf
from vman.services.vault import Vault, VaultError

router = APIRouter(prefix="/api/credentials", tags=["credentials"])


def _get_active_key_id(session) -> str:
    row = session.execute(
        select(models.EncryptionKey)
        .where(models.EncryptionKey.status == "active")
        .order_by(models.EncryptionKey.version.desc())
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        # Fallback to create one in dev if missing
        active_key = models.EncryptionKey(
            id="k-active",
            version=1,
            status="active"
        )
        session.add(active_key)
        session.commit()
        session.refresh(active_key)
        return active_key.id
    return row.id


@router.get("", response_model=list[CredentialOut])
def list_credentials(user: CurrentUser) -> list[CredentialOut]:
    session_factory = get_sessionmaker()
    with session_factory() as session:
        rows = session.execute(
            select(models.Credential).order_by(models.Credential.name.asc())
        ).scalars().all()
        return [
            CredentialOut(
                id=row.id,
                name=row.name,
                kind=row.kind,
                fingerprint=row.fingerprint,
                metadata_json=row.metadata_json,
                last_used_at=row.last_used_at,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ]


@router.post("", response_model=CredentialOut, status_code=status.HTTP_201_CREATED)
def create_credential(
    payload: CredentialCreate,
    user: CurrentUser,
    _csrf: None = Depends(require_csrf),
) -> CredentialOut:
    settings = get_settings()
    session_factory = get_sessionmaker()

    # Resolve master key
    try:
        master_key_bytes = decode_master_key_from_env(settings.master_key)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="VMAN_MASTER_KEY configuration is invalid."
        ) from exc

    with session_factory() as session:
        # Check uniqueness of name
        existing_cred = session.execute(
            select(models.Credential).where(models.Credential.name == payload.name)
        ).scalar_one_or_none()
        if existing_cred is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A credential named '{payload.name}' already exists."
            )

        active_key_id = _get_active_key_id(session)
        cred_id = str(uuid.uuid4())

        cred = models.Credential(
            id=cred_id,
            name=payload.name,
            kind=payload.kind,
            encrypted_payload=b"placeholder",
            encryption_key_id=active_key_id,
            fingerprint="",
            metadata_json={},
        )
        session.add(cred)
        session.commit()

    # Store actual ciphertext in vault
    vault = Vault(master_key=master_key_bytes, session_factory=session_factory)
    try:
        stored_cred = vault.store(credential_id=cred_id, plaintext=payload.plaintext, kind=payload.kind)
    except VaultError as exc:
        # Cleanup
        with session_factory() as session:
            session.execute(
                select(models.Credential).where(models.Credential.id == cred_id)
            )
            db_cred = session.get(models.Credential, cred_id)
            if db_cred:
                session.delete(db_cred)
                session.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        ) from exc

    return CredentialOut(
        id=stored_cred.id,
        name=stored_cred.name,
        kind=stored_cred.kind,
        fingerprint=stored_cred.fingerprint,
        metadata_json=stored_cred.metadata_json,
        last_used_at=stored_cred.last_used_at,
        created_at=stored_cred.created_at,
        updated_at=stored_cred.updated_at,
    )


@router.delete("/{credential_id}")
def delete_credential(
    credential_id: str,
    user: CurrentUser,
    _csrf: None = Depends(require_csrf),
    force: bool = False,
) -> dict[str, str]:
    """Delete a vault credential.

    Blocked while any *active* (non-disabled) host still references it.
    Soft-deleted hosts no longer block deletion; their credential_id is
    cleared so the link cannot resurrect a deleted secret.
    Pass ``?force=true`` to also detach active hosts (sets their
    credential_id to null) then delete.
    """
    session_factory = get_sessionmaker()
    with session_factory() as session:
        active_hosts = (
            session.execute(
                select(models.Host).where(
                    models.Host.credential_id == credential_id,
                    models.Host.disabled_at.is_(None),
                )
            )
            .scalars()
            .all()
        )
        if active_hosts and not force:
            names = ", ".join(sorted(h.name for h in active_hosts)[:5])
            extra = f" (+{len(active_hosts) - 5} more)" if len(active_hosts) > 5 else ""
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Credential still used by active host(s): {names}{extra}. "
                    "Remove or reassign the host first, or delete with force=true."
                ),
            )

        # Clear credential_id on every host that pointed here (active or soft-deleted).
        linked = (
            session.execute(
                select(models.Host).where(models.Host.credential_id == credential_id)
            )
            .scalars()
            .all()
        )
        for host in linked:
            host.credential_id = None

        cred = session.get(models.Credential, credential_id)
        if cred is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Credential not found.",
            )
        session.delete(cred)
        session.commit()

    return {"status": "ok"}


__all__ = ["router"]
