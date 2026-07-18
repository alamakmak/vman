"""Host inventory service (Milestone 2 / Task 8).

The service is the only place that mutates the hosts table; the HTTP
layer is a thin translation between the wire format and these methods.
Audit events are emitted here so every state change has a record.

Security notes
--------------
- The service never decrypts vault credentials. The Host row holds
  only a reference (credential_id) and metadata; the plaintext lives
  only in the worker process.
- ``notes`` and ``provider`` are user-controlled free-form fields; we
  run them through the audit redactor when they are recorded as
  audit metadata so secrets pasted into notes do not leak into the
  audit table.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from vman.db import models
from vman.security.audit import AuditService
from vman.security.redaction import default_redactor


class HostServiceError(Exception):
    """Domain-level host service failure."""


def _redact(value: str) -> str:
    """Redact a single string via the default redactor."""
    return default_redactor().redact(value)


class HostService:
    """CRUD for the hosts table."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker,
        audit: AuditService | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._audit = audit or AuditService(
            session_factory=session_factory,
            redactor=default_redactor(),
        )

    # ------------------------------------------------------------------ #
    # Reads
    # ------------------------------------------------------------------ #

    def list_hosts(
        self,
        *,
        include_disabled: bool = False,
    ) -> list[models.Host]:
        with self._session_factory() as session:
            stmt = select(models.Host).order_by(models.Host.name.asc())
            if not include_disabled:
                stmt = stmt.where(models.Host.disabled_at.is_(None))
            rows = session.execute(stmt).scalars().all()
            for r in rows:
                session.expunge(r)
        return list(rows)

    def get(self, host_id: str) -> models.Host | None:
        with self._session_factory() as session:
            row = session.execute(
                select(models.Host).where(models.Host.id == host_id)
            ).scalar_one_or_none()
            if row is not None:
                session.expunge(row)
        return row

    # ------------------------------------------------------------------ #
    # Writes
    # ------------------------------------------------------------------ #

    def create(
        self,
        *,
        name: str,
        hostname_or_ip: str,
        ssh_port: int,
        username: str,
        auth_method: str,
        actor_user_id: str | None = None,
        credential_id: str | None = None,
        sudo_mode: str = "root",
        environment: str = "experiment",
        provider: str | None = None,
        region: str | None = None,
        tags: list[str] | None = None,
        notes: str = "",
    ) -> models.Host:
        now = dt.datetime.now(dt.timezone.utc)
        # Free the name if only a soft-deleted host still holds it.
        with self._session_factory() as session:
            active = session.execute(
                select(models.Host).where(
                    models.Host.name == name,
                    models.Host.disabled_at.is_(None),
                )
            ).scalar_one_or_none()
            if active is not None:
                raise HostServiceError(f"host with name {name!r} already exists")
            stale = (
                session.execute(
                    select(models.Host).where(
                        models.Host.name == name,
                        models.Host.disabled_at.is_not(None),
                    )
                )
                .scalars()
                .all()
            )
            for row in stale:
                row.name = f"{name}__deleted_{row.id[:8]}"
                row.credential_id = None
            if stale:
                session.commit()

        host = models.Host(
            id=uuid.uuid4().hex,
            name=name,
            hostname_or_ip=hostname_or_ip,
            ssh_port=ssh_port,
            username=username,
            auth_method=auth_method,
            credential_id=credential_id,
            sudo_mode=sudo_mode,
            environment=environment,
            provider=provider,
            region=region,
            tags=list(tags or []),
            notes=notes,
            created_at=now,
            updated_at=now,
        )
        try:
            with self._session_factory() as session:
                session.add(host)
                session.commit()
                session.refresh(host)
                session.expunge(host)
        except IntegrityError as exc:
            raise HostServiceError(f"host with name {name!r} already exists") from exc

        self._audit.record(
            actor_user_id=actor_user_id,
            actor_type="user",
            action="host.create",
            resource_type="host",
            resource_id=host.id,
            metadata={
                "name": host.name,
                "ssh_port": host.ssh_port,
                "auth_method": host.auth_method,
                "environment": host.environment,
                "tags": list(host.tags),
                "provider": _redact(host.provider or "") or None,
                "region": host.region,
                "notes": _redact(host.notes) if host.notes else "",
            },
        )
        return host

    def update(
        self,
        *,
        host_id: str,
        actor_user_id: str | None = None,
        **fields: object,
    ) -> models.Host:
        # Whitelist of mutable fields. Anything else is silently dropped
        # so a typo in the route does not silently write to the DB.
        mutable = {
            "hostname_or_ip",
            "ssh_port",
            "username",
            "auth_method",
            "credential_id",
            "sudo_mode",
            "environment",
            "provider",
            "region",
            "tags",
            "notes",
            "host_key_fingerprint",
            "host_key_algorithm",
            "os_family",
            "os_name",
            "os_version",
            "package_manager",
            "arch",
            "cpu_cores",
            "ram_mb",
            "disk_total_mb",
            "risk_level",
            "last_seen_at",
        }
        with self._session_factory() as session:
            row = session.execute(
                select(models.Host).where(models.Host.id == host_id)
            ).scalar_one_or_none()
            if row is None:
                raise HostServiceError(f"host not found: {host_id}")
            changes: dict[str, object] = {}
            for key, value in fields.items():
                if key in mutable and value is not None:
                    setattr(row, key, value)
                    changes[key] = value
            row.updated_at = dt.datetime.now(dt.timezone.utc)
            session.commit()
            session.refresh(row)
            session.expunge(row)
            host = row

        if changes:
            # Redact free-form fields so audit does not store secrets.
            safe_changes: dict[str, object] = {}
            for k, v in changes.items():
                if isinstance(v, dt.datetime):
                    safe_changes[k] = v.isoformat()
                elif isinstance(v, str) and k in {"notes", "provider"}:
                    safe_changes[k] = _redact(v)
                else:
                    safe_changes[k] = v
            self._audit.record(
                actor_user_id=actor_user_id,
                actor_type="user",
                action="host.update",
                resource_type="host",
                resource_id=host.id,
                metadata={"name": host.name, "changes": safe_changes},
            )
        return host

    def delete(
        self,
        *,
        host_id: str,
        actor_user_id: str | None = None,
    ) -> models.Host:
        with self._session_factory() as session:
            row = session.execute(
                select(models.Host).where(models.Host.id == host_id)
            ).scalar_one_or_none()
            if row is None:
                raise HostServiceError(f"host not found: {host_id}")
            now = dt.datetime.now(dt.timezone.utc)
            original_name = row.name
            row.disabled_at = now
            row.updated_at = now
            # Free unique name + vault link so recreate / credential delete work.
            row.credential_id = None
            if not row.name.endswith(f"__deleted_{row.id[:8]}"):
                row.name = f"{row.name}__deleted_{row.id[:8]}"
            session.commit()
            session.refresh(row)
            session.expunge(row)
            host = row

        self._audit.record(
            actor_user_id=actor_user_id,
            actor_type="user",
            action="host.delete",
            resource_type="host",
            resource_id=host.id,
            metadata={"name": original_name, "tombstone_name": host.name},
        )
        return host

    # ------------------------------------------------------------------ #
    # OS / resource detection
    # ------------------------------------------------------------------ #

    def detect(
        self,
        *,
        host_id: str,
        actor_user_id: str | None = None,
        ssh_runner_factory: Callable[[models.Host], object] | None = None,
    ) -> models.Host:
        """Run standard probes against the host and update its row.

        ``ssh_runner_factory`` is an injection seam for tests: it
        receives the Host row and must return an object with a
        ``run(command, timeout)`` method that returns a
        :class:`CommandResult`. Production code uses the real
        SshRunner; tests pass a fake.
        """
        from vman.services.os_detection import detect_from_outputs
        from vman.services.ssh_runner import SshRunner

        with self._session_factory() as session:
            host = session.execute(
                select(models.Host).where(models.Host.id == host_id)
            ).scalar_one_or_none()
            if host is None:
                raise HostServiceError(f"host not found: {host_id}")
            # Detach a snapshot of the fields the factory needs.
            session.expunge(host)

        if ssh_runner_factory is None:
            from vman.services.ssh_runner import build_transport_for_host

            expected_fp = None
            if host.host_key_fingerprint and host.host_key_algorithm:
                try:
                    from vman.security.host_keys import parse_fingerprint

                    expected_fp = parse_fingerprint(
                        host.host_key_algorithm, host.host_key_fingerprint
                    )
                except ValueError:
                    expected_fp = None
            transport = build_transport_for_host(host, session_factory=self._session_factory)
            runner = SshRunner(
                transport=transport,
                host=host.hostname_or_ip,
                port=host.ssh_port,
                username=host.username,
                expected_fingerprint=expected_fp,
            )
        else:
            runner = ssh_runner_factory(host)  # type: ignore[assignment]

        # Run each probe and collect the outputs. A failed probe
        # results in an empty string for that field; the parser
        # returns Unknown for the affected fields.
        open_fn = getattr(runner, "open", None)
        close_fn = getattr(runner, "close", None)
        if callable(open_fn):
            try:
                open_fn()
            except Exception:
                pass
        outputs: dict[str, str] = {}
        try:
            for label, cmd in [
                ("os_release", "cat /etc/os-release 2>/dev/null || cat /usr/lib/os-release 2>/dev/null || true"),
                ("uname", "uname -m"),
                ("free_m", "free -m"),
                ("df_m", "df -m /"),
                ("dpkg_q", "dpkg -l 2>/dev/null | head -n 5 || true"),
                ("rpm_qa", "rpm -qa 2>/dev/null | head -n 5 || true"),
                ("pacman_q", "pacman -Q 2>/dev/null | head -n 5 || true"),
                ("nproc", "nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || true"),
            ]:
                try:
                    result = runner.run(cmd, timeout=15.0)
                    if result.exit_code == 0:
                        outputs[label] = result.stdout
                except Exception:
                    outputs[label] = ""
        finally:
            if callable(close_fn):
                try:
                    close_fn()
                except Exception:
                    pass

        info = detect_from_outputs(
            os_release=outputs.get("os_release", ""),
            uname=outputs.get("uname", ""),
            free_m=outputs.get("free_m", ""),
            df_m=outputs.get("df_m", ""),
            dpkg_q=outputs.get("dpkg_q", ""),
            rpm_qa=outputs.get("rpm_qa", ""),
            pacman_q=outputs.get("pacman_q", ""),
        )
        nproc = (outputs.get("nproc") or "").strip()
        cpu_cores = int(nproc) if nproc.isdigit() else None

        pretty = ""
        for line in (outputs.get("os_release") or "").splitlines():
            if line.startswith("PRETTY_NAME="):
                pretty = line.split("=", 1)[1].strip().strip('"')
                break

        # Persist the detected fields.
        with self._session_factory() as session:
            host = session.execute(
                select(models.Host).where(models.Host.id == host_id)
            ).scalar_one_or_none()
            if host is None:
                raise HostServiceError(f"host not found: {host_id}")
            host.os_family = info.os_family if info.os_family != "unknown" else None
            host.os_name = pretty or info.os_name or None
            host.os_version = info.os_version or None
            host.package_manager = info.package_manager
            host.arch = info.arch if info.arch != "unknown" else None
            host.cpu_cores = cpu_cores
            host.ram_mb = info.ram_total_mb
            host.disk_total_mb = info.disk_total_mb
            host.last_seen_at = dt.datetime.now(dt.timezone.utc)
            host.updated_at = host.last_seen_at
            session.commit()
            session.refresh(host)
            session.expunge(host)
            updated = host

        self._audit.record(
            actor_user_id=actor_user_id,
            actor_type="user",
            action="host.detect",
            resource_type="host",
            resource_id=updated.id,
            metadata={
                "name": updated.name,
                "os_name": updated.os_name,
                "os_version": updated.os_version,
                "os_family": updated.os_family,
            },
        )
        return updated


__all__ = ["HostService", "HostServiceError"]
