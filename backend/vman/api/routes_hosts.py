"""Host inventory HTTP routes (Milestone 2 / Task 8)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from vman.api.deps import CurrentUser
from vman.db import models
from vman.db.session import get_sessionmaker
from vman.schemas.hosts import HostCreate, HostOut, HostUpdate, ConnectionTestResult
from vman.security.audit import AuditService
from vman.security.csrf import require_csrf
from vman.security.redaction import default_redactor
from vman.services.hosts import HostService, HostServiceError
from vman.services.ssh_runner import SshRunner, build_transport_for_host
from vman.security.host_keys import parse_fingerprint

router = APIRouter(prefix="/api/hosts", tags=["hosts"])



def _service() -> HostService:
    return HostService(
        session_factory=get_sessionmaker(),
        audit=AuditService(
            session_factory=get_sessionmaker(),
            redactor=default_redactor(),
        ),
    )


def _to_out(host: models.Host) -> HostOut:
    return HostOut(
        id=host.id,
        name=host.name,
        hostname_or_ip=host.hostname_or_ip,
        ssh_port=host.ssh_port,
        username=host.username,
        auth_method=host.auth_method,
        credential_id=host.credential_id,
        sudo_mode=host.sudo_mode,
        host_key_fingerprint=host.host_key_fingerprint,
        host_key_algorithm=host.host_key_algorithm,
        os_family=host.os_family,
        os_name=host.os_name,
        os_version=host.os_version,
        package_manager=host.package_manager,
        arch=host.arch,
        cpu_cores=host.cpu_cores,
        ram_mb=host.ram_mb,
        disk_total_mb=host.disk_total_mb,
        provider=host.provider,
        region=host.region,
        environment=host.environment,
        risk_level=host.risk_level,
        tags=list(host.tags or []),
        notes=host.notes,
        last_seen_at=host.last_seen_at.isoformat() if host.last_seen_at else None,
        disabled_at=host.disabled_at.isoformat() if host.disabled_at else None,
        created_at=host.created_at.isoformat() if host.created_at else "",
        updated_at=host.updated_at.isoformat() if host.updated_at else "",
    )


# --------------------------------------------------------------------------- #
# List
# --------------------------------------------------------------------------- #


@router.get("", response_model=list[HostOut])
def list_hosts(
    user: CurrentUser,
    include_disabled: bool = False,
) -> list[HostOut]:
    rows = _service().list_hosts(include_disabled=include_disabled)
    return [_to_out(r) for r in rows]


# --------------------------------------------------------------------------- #
# Get
# --------------------------------------------------------------------------- #


@router.get("/{host_id}", response_model=HostOut)
def get_host(host_id: str, user: CurrentUser) -> HostOut:
    row = _service().get(host_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="host not found")
    return _to_out(row)


# --------------------------------------------------------------------------- #
# Create
# --------------------------------------------------------------------------- #


@router.post("", response_model=HostOut, status_code=status.HTTP_201_CREATED)
def create_host(
    payload: HostCreate,
    user: CurrentUser,
    _csrf: None = Depends(require_csrf),
) -> HostOut:
    try:
        host = _service().create(
            name=payload.name,
            hostname_or_ip=payload.hostname_or_ip,
            ssh_port=payload.ssh_port,
            username=payload.username,
            auth_method=payload.auth_method,
            actor_user_id=user.id,
            credential_id=payload.credential_id,
            sudo_mode=payload.sudo_mode,
            environment=payload.environment,
            provider=payload.provider,
            region=payload.region,
            tags=payload.tags,
            notes=payload.notes,
        )
    except HostServiceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _to_out(host)


# --------------------------------------------------------------------------- #
# Update (partial)
# --------------------------------------------------------------------------- #


@router.patch("/{host_id}", response_model=HostOut)
def update_host(
    host_id: str,
    payload: HostUpdate,
    user: CurrentUser,
    _csrf: None = Depends(require_csrf),
) -> HostOut:
    update_data = payload.model_dump(exclude_unset=True)
    try:
        host = _service().update(host_id=host_id, actor_user_id=user.id, **update_data)
    except HostServiceError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _to_out(host)


# --------------------------------------------------------------------------- #
# Delete (soft)
# --------------------------------------------------------------------------- #


@router.delete("/{host_id}")
def delete_host(
    host_id: str,
    user: CurrentUser,
    _csrf: None = Depends(require_csrf),
) -> dict[str, str]:
    try:
        _service().delete(host_id=host_id, actor_user_id=user.id)
    except HostServiceError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Connection Test
# --------------------------------------------------------------------------- #


@router.post("/{host_id}/test", response_model=ConnectionTestResult)
def test_connection(
    host_id: str,
    user: CurrentUser,
    _csrf: None = Depends(require_csrf),
) -> ConnectionTestResult:
    import datetime as dt
    import time

    from vman.services.os_detection import detect_from_outputs

    service = _service()
    host = service.get(host_id)
    if not host:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Host not found")

    tested_at = dt.datetime.now(dt.timezone.utc).isoformat()

    try:
        transport = build_transport_for_host(host, session_factory=get_sessionmaker())
    except Exception as exc:
        return ConnectionTestResult(
            ok=False,
            reached=False,
            authenticated=False,
            message=f"Failed to retrieve or decrypt credential: {exc}",
            tested_at=tested_at,
        )

    expected_fp = None
    if host.host_key_fingerprint and host.host_key_algorithm:
        try:
            expected_fp = parse_fingerprint(host.host_key_algorithm, host.host_key_fingerprint)
        except Exception:
            pass

    runner = SshRunner(
        transport=transport,
        host=host.hostname_or_ip,
        port=host.ssh_port,
        username=host.username,
        expected_fingerprint=expected_fp,
    )

    start_time = time.time()
    try:
        runner.open()
        result = runner.run("echo 'ping'", timeout=10.0)
        latency = (time.time() - start_time) * 1000.0
        server_key = transport.server_host_key()

        if result.exit_code != 0:
            return ConnectionTestResult(
                ok=False,
                reached=True,
                authenticated=True,
                host_key_fingerprint=server_key.fingerprint,
                host_key_algorithm=server_key.algorithm,
                latency_ms=latency,
                message=f"Connected but command failed with code {result.exit_code}: {result.stderr}",
                tested_at=tested_at,
            )

        # OS / resource probes (best-effort). Keep one SSH session open.
        outputs: dict[str, str] = {}
        for label, cmd in (
            ("os_release", "cat /etc/os-release 2>/dev/null || cat /usr/lib/os-release 2>/dev/null || true"),
            ("uname", "uname -m"),
            ("free_m", "free -m"),
            ("df_m", "df -m /"),
            ("dpkg_q", "dpkg -l 2>/dev/null | head -n 5 || true"),
            ("rpm_qa", "rpm -qa 2>/dev/null | head -n 5 || true"),
            ("pacman_q", "pacman -Q 2>/dev/null | head -n 5 || true"),
            ("nproc", "nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || true"),
        ):
            try:
                r = runner.run(cmd, timeout=10.0)
                outputs[label] = r.stdout if r.exit_code == 0 else ""
            except Exception:
                outputs[label] = ""

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

        # Prefer pretty name for UI when available.
        pretty = ""
        for line in (outputs.get("os_release") or "").splitlines():
            if line.startswith("PRETTY_NAME="):
                pretty = line.split("=", 1)[1].strip().strip('"')
                break
        os_name = pretty or info.os_name or None
        os_family = info.os_family if info.os_family != "unknown" else None
        os_version = info.os_version or None
        package_manager = info.package_manager
        arch = info.arch if info.arch != "unknown" else None
        ram_mb = info.ram_total_mb
        disk_total_mb = info.disk_total_mb
        last_seen = dt.datetime.now(dt.timezone.utc)

        service.update(
            host_id=host.id,
            actor_user_id=user.id,
            host_key_fingerprint=server_key.fingerprint,
            host_key_algorithm=server_key.algorithm,
            os_family=os_family,
            os_name=os_name,
            os_version=os_version,
            package_manager=package_manager,
            arch=arch,
            cpu_cores=cpu_cores,
            ram_mb=ram_mb,
            disk_total_mb=disk_total_mb,
            last_seen_at=last_seen,
        )

        return ConnectionTestResult(
            ok=True,
            reached=True,
            authenticated=True,
            host_key_fingerprint=server_key.fingerprint,
            host_key_algorithm=server_key.algorithm,
            latency_ms=latency,
            message=(
                "Successfully connected and authenticated.\n"
                f"OS: {os_name or 'unknown'} {os_version or ''} "
                f"({os_family or '?'}) arch={arch} "
                f"cpu={cpu_cores} ram_mb={ram_mb} disk_mb={disk_total_mb}"
            ).strip(),
            tested_at=tested_at,
            os_family=os_family,
            os_name=os_name,
            os_version=os_version,
            package_manager=package_manager,
            arch=arch,
            cpu_cores=cpu_cores,
            ram_mb=ram_mb,
            disk_total_mb=disk_total_mb,
            last_seen_at=last_seen.isoformat(),
        )
    except Exception as exc:
        latency = (time.time() - start_time) * 1000.0
        message = str(exc)
        reached = (
            "authentication failed" not in message.lower()
            and "permission denied" not in message.lower()
        )
        authenticated = not reached
        fk_fp = None
        fk_alg = None
        try:
            server_key = transport.server_host_key()
            fk_fp = server_key.fingerprint
            fk_alg = server_key.algorithm
        except Exception:
            pass
        return ConnectionTestResult(
            ok=False,
            reached=reached,
            authenticated=authenticated,
            host_key_fingerprint=fk_fp,
            host_key_algorithm=fk_alg,
            latency_ms=latency if reached else None,
            message=f"Connection failed: {message}",
            tested_at=tested_at,
        )
    finally:
        try:
            runner.close()
        except Exception:
            pass


__all__ = ["router"]

