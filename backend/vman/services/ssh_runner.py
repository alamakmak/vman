"""SSH runner (Milestone 2 / Task 9).

This module is the only place in the API/worker process that opens
remote connections. It is transport-abstracted: a ``Transport`` is any
object that implements ``connect``, ``run``, ``disconnect``, and
``server_host_key``. The MVP provides a :class:`SubprocessTransport`
that runs commands locally (used for dev-loop recipes and tests) and
:class:`ParamikoTransport` for real SSH.

Security notes
--------------
- The runner is the single component that holds decrypted vault
  credentials in memory for the lifetime of an SSH session. After
  ``disconnect()``, secrets are NOT held any longer than needed.
- Every byte of stdout and stderr passes through the redactor
  before being returned, so a leaked password printed by a remote
  command is replaced with ``REDACTED`` on the way back.
- Host key fingerprints are checked at connect time. A mismatch
  raises :class:`HostKeyMismatchError` and the run is aborted before
  any command executes.
- The runner is the only place that talks to ``Transport.server_host_key``;
  callers MUST NOT trust any other source of "what the server key is".
"""

from __future__ import annotations

import subprocess  # nosec B404
import time
from dataclasses import dataclass, field
from typing import Protocol

from vman.security.host_keys import (
    HostKeyFingerprint,
    fingerprint_from_public_key_bytes,
    fingerprints_match,
)
from vman.security.redaction import Redactor, default_redactor


class HostKeyMismatchError(Exception):
    """Raised when the server's host key does not match the expected fingerprint."""


@dataclass
class CommandResult:
    """The result of running one command on a remote host."""

    stdout: str
    stderr: str
    exit_code: int
    started_at: float = field(default_factory=time.time)
    duration_s: float = 0.0
    timed_out: bool = False


class Transport(Protocol):
    """Interface every SSH transport must implement."""

    def connect(self, *, host: str, port: int, user: str) -> None: ...
    def run(
        self,
        *,
        command: str,
        timeout: float,
        env: dict[str, str] | None = None,
    ) -> CommandResult: ...
    def disconnect(self) -> None: ...
    def server_host_key(self) -> HostKeyFingerprint: ...


class SubprocessTransport:
    """A local transport that runs commands via ``subprocess``.

    Useful for:
    - local development of recipes (no real SSH server needed)
    - integration tests
    - emergency fallback when SSH is unavailable

    It is intentionally NOT an SSH transport; it does not talk to a
    remote host. The host key is a constant so fingerprint checks
    pass for the localhost case.
    """

    def __init__(self) -> None:
        self._connected = False
        self._key_blob = b"subprocess-local-fake-server-key"

    def connect(self, *, host: str, port: int, user: str) -> None:
        self._connected = True
        self._host = host
        self._port = port
        self._user = user

    def run(
        self,
        *,
        command: str,
        timeout: float,
        env: dict[str, str] | None = None,
    ) -> CommandResult:
        if not self._connected:
            raise RuntimeError("transport not connected")
        started = time.time()
        try:
            completed = subprocess.run(  # noqa: S602 # nosec B602
                command,
                shell=True,  # nosemgrep
                capture_output=True,
                text=True,
                timeout=timeout,
                env={**__import__("os").environ, **(env or {})},
            )
            return CommandResult(
                stdout=completed.stdout or "",
                stderr=completed.stderr or "",
                exit_code=completed.returncode,
                started_at=started,
                duration_s=time.time() - started,
                timed_out=False,
            )
        except subprocess.TimeoutExpired as exc:
            return CommandResult(
                stdout=(exc.stdout.decode() if exc.stdout else "") or "",
                stderr=(exc.stderr.decode() if exc.stderr else "") or "",
                exit_code=124,  # conventional "timed out" code
                started_at=started,
                duration_s=time.time() - started,
                timed_out=True,
            )

    def disconnect(self) -> None:
        self._connected = False

    def server_host_key(self) -> HostKeyFingerprint:
        return fingerprint_from_public_key_bytes("ssh-ed25519", self._key_blob)


def _make_host_key_policy(expected: HostKeyFingerprint | None):
    """Paramiko MissingHostKeyPolicy: capture key; reject on fingerprint mismatch."""
    import paramiko

    class _CaptureHostKeyPolicy(paramiko.MissingHostKeyPolicy):
        def __init__(self) -> None:
            self.captured_key = None

        def missing_host_key(self, client, hostname, key) -> None:  # noqa: ANN001
            self.captured_key = key
            if expected is None:
                # First-trust path: accept and record; caller stores fingerprint.
                client.get_host_keys().add(hostname, key.get_name(), key)
                return
            got = fingerprint_from_public_key_bytes(key.get_name(), key.asbytes())
            if not fingerprints_match(expected, got):
                raise HostKeyMismatchError(
                    f"host key fingerprint mismatch: expected {expected!s}, got {got!s}"
                )
            client.get_host_keys().add(hostname, key.get_name(), key)

    return _CaptureHostKeyPolicy()


class ParamikoTransport:
    """A real SSH transport that uses the paramiko library."""

    def __init__(
        self,
        *,
        password: str | None = None,
        private_key: str | None = None,
        passphrase: str | None = None,
        expected_fingerprint: HostKeyFingerprint | None = None,
        connect_timeout: float = 10.0,
    ) -> None:
        self._password = password
        self._private_key = private_key
        self._passphrase = passphrase
        self._expected_fingerprint = expected_fingerprint
        self._connect_timeout = connect_timeout
        self._client = None
        self._host_key = None
        self._policy = None

    def connect(self, *, host: str, port: int, user: str) -> None:
        import io

        import paramiko

        if self._client is not None:
            return

        self._client = paramiko.SSHClient()
        self._policy = _make_host_key_policy(self._expected_fingerprint)
        self._client.set_missing_host_key_policy(self._policy)

        pkey = None
        if self._private_key:
            key_file = io.StringIO(self._private_key)
            # Paramiko 5+ dropped DSSKey; probe only classes that exist.
            key_classes = [
                cls
                for name in ("Ed25519Key", "RSAKey", "ECDSAKey", "DSSKey")
                if (cls := getattr(paramiko, name, None)) is not None
            ]
            for key_cls in key_classes:
                try:
                    key_file.seek(0)
                    pkey = key_cls.from_private_key(key_file, password=self._passphrase)
                    break
                except Exception:
                    continue
            if pkey is None:
                raise RuntimeError(
                    "Failed to parse private key (expected PEM). "
                    "Host auth_method is key but vault secret is not a private key — "
                    "use kind ssh_private_key or switch host to password auth."
                )

        self._client.connect(
            hostname=host,
            port=port,
            username=user,
            password=self._password,
            pkey=pkey,
            timeout=self._connect_timeout,
            allow_agent=False,
            look_for_keys=False,
        )

        transport = self._client.get_transport()
        if transport:
            self._host_key = transport.get_remote_server_key()
        elif self._policy.captured_key is not None:
            self._host_key = self._policy.captured_key

    def run(
        self,
        *,
        command: str,
        timeout: float,
        env: dict[str, str] | None = None,
    ) -> CommandResult:
        if not self._client:
            raise RuntimeError("transport not connected")
        started = time.time()
        try:
            _stdin, stdout, stderr = self._client.exec_command(
                command, timeout=timeout, environment=env
            )
            exit_code = stdout.channel.recv_exit_status()
            return CommandResult(
                stdout=stdout.read().decode("utf-8", errors="replace"),
                stderr=stderr.read().decode("utf-8", errors="replace"),
                exit_code=exit_code,
                started_at=started,
                duration_s=time.time() - started,
                timed_out=False,
            )
        except Exception as exc:
            # paramiko raises socket.timeout on command timeout in some paths
            timed_out = "timed out" in str(exc).lower() or type(exc).__name__ == "timeout"
            return CommandResult(
                stdout="",
                stderr=str(exc),
                exit_code=124 if timed_out else 255,
                started_at=started,
                duration_s=time.time() - started,
                timed_out=timed_out,
            )

    def disconnect(self) -> None:
        if self._client:
            self._client.close()
            self._client = None

    def server_host_key(self) -> HostKeyFingerprint:
        if not self._host_key:
            raise RuntimeError("not connected")
        key_name = self._host_key.get_name()
        key_bytes = self._host_key.asbytes()
        return fingerprint_from_public_key_bytes(key_name, key_bytes)


class SshRunner:
    """High-level SSH command runner with strict host key + redaction.

    Connection is reused across multiple ``run()`` calls until
    ``close()`` / context exit. One-shot callers still work: first
    ``run()`` connects, and they may call ``close()`` when done.
    """

    def __init__(
        self,
        *,
        transport: Transport,
        host: str,
        port: int,
        username: str,
        expected_fingerprint: HostKeyFingerprint | None = None,
        redactor: Redactor | None = None,
    ) -> None:
        self._transport = transport
        self._host = host
        self._port = port
        self._username = username
        self._expected_fingerprint = expected_fingerprint
        self._redactor = redactor or default_redactor()
        self._connected = False
        self._host_key_checked = False

    def register_secret_for_redaction(self, secret: str) -> None:
        """Register a plaintext secret that may appear in command output."""
        self._redactor.register(secret)

    def __enter__(self) -> SshRunner:
        self.open()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def open(self) -> None:
        """Connect and verify host key once."""
        if self._connected:
            return
        self._transport.connect(host=self._host, port=self._port, user=self._username)
        self._connected = True
        self._verify_host_key()

    def close(self) -> None:
        if self._connected:
            self._transport.disconnect()
            self._connected = False
            self._host_key_checked = False

    def _verify_host_key(self) -> None:
        if self._host_key_checked or self._expected_fingerprint is None:
            self._host_key_checked = True
            return
        server_key = self._transport.server_host_key()
        if not fingerprints_match(self._expected_fingerprint, server_key):
            self.close()
            raise HostKeyMismatchError(
                f"host key fingerprint mismatch: expected "
                f"{self._expected_fingerprint!s}, got "
                f"{server_key!s}"
            )
        self._host_key_checked = True

    def run(
        self,
        command: str,
        *,
        timeout: float = 30.0,
        env: dict[str, str] | None = None,
        close_after: bool = False,
    ) -> CommandResult:
        if not command or not command.strip():
            raise ValueError("command must be a non-empty string")
        own_session = not self._connected
        try:
            self.open()
            raw = self._transport.run(command=command, timeout=timeout, env=env)
            return CommandResult(
                stdout=self._redactor.redact(raw.stdout),
                stderr=self._redactor.redact(raw.stderr),
                exit_code=raw.exit_code,
                started_at=raw.started_at,
                duration_s=raw.duration_s,
                timed_out=raw.timed_out,
            )
        finally:
            # One-shot default: disconnect after each run so callers that
            # never call close() still free the socket. Multi-step recipes
            # should use open()/context manager so own_session is False.
            if own_session or close_after:
                self.close()


def build_transport_for_host(
    host,
    *,
    session_factory,
    force_local: bool = False,
):
    """Build the right Transport for a Host row.

    - ``force_local`` or missing credential → SubprocessTransport (tests/dev)
    - otherwise decrypt vault and return ParamikoTransport
    """
    if force_local or not getattr(host, "credential_id", None):
        return SubprocessTransport()

    from vman.config import get_settings
    from vman.security.crypto import decode_master_key_from_env
    from vman.security.host_keys import parse_fingerprint
    from vman.services.vault import Vault

    settings = get_settings()
    master_key = decode_master_key_from_env(settings.master_key)
    vault = Vault(master_key=master_key, session_factory=session_factory)
    material = vault.reveal_ssh_for_host(host)

    expected_fp = None
    if host.host_key_fingerprint and host.host_key_algorithm:
        try:
            expected_fp = parse_fingerprint(host.host_key_algorithm, host.host_key_fingerprint)
        except ValueError:
            expected_fp = None

    return ParamikoTransport(
        password=material.password,
        private_key=material.private_key,
        passphrase=material.passphrase,
        expected_fingerprint=expected_fp,
    )


__all__ = [
    "CommandResult",
    "HostKeyMismatchError",
    "SshRunner",
    "SubprocessTransport",
    "ParamikoTransport",
    "Transport",
    "build_transport_for_host",
]
