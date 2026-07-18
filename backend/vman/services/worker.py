"""In-process job worker (Milestone 3 / Task 11).

The MVP worker is a simple single-threaded loop that:
1. claims the oldest queued+approved job (FIFO)
2. builds an SshRunner for the host (Paramiko when credential present;
   SubprocessTransport for local/dev hosts without credentials)
3. runs the command, redacting each output line and persisting it
4. marks the job success / failed / cancelled
5. loops

The worker is started by the FastAPI app on startup and stopped on
shutdown. It honours the cancellation flag by checking between log
batches. It is intentionally cooperative; async cancellation is
out of scope for the MVP.
"""

from __future__ import annotations

import logging
import threading

from sqlalchemy.orm import sessionmaker

from vman.db import models
from vman.security.host_keys import parse_fingerprint
from vman.security.redaction import default_redactor
from vman.services.events import JobEventBroker
from vman.services.jobs import JobService
from vman.services.ssh_runner import (
    CommandResult,
    SshRunner,
    Transport,
    build_transport_for_host,
)

log = logging.getLogger("vman.worker")


def _build_runner(host: models.Host, transport: Transport) -> SshRunner:
    expected_fp = None
    if host.host_key_fingerprint and host.host_key_algorithm:
        try:
            expected_fp = parse_fingerprint(host.host_key_algorithm, host.host_key_fingerprint)
        except ValueError:
            expected_fp = None
    return SshRunner(
        transport=transport,
        host=host.hostname_or_ip,
        port=host.ssh_port,
        username=host.username,
        expected_fingerprint=expected_fp,
        redactor=default_redactor(),
    )


class JobWorker:
    """A single-threaded cooperative worker."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker,
        transport_factory=None,
        poll_interval_s: float = 0.5,
        broker: JobEventBroker | None = None,
    ) -> None:
        self._session_factory = session_factory
        # The worker shares a single JobService instance with the rest
        # of the application; the broker is wired through that service
        # so any state transition goes through the same code path.
        self._broker: JobEventBroker = broker if broker is not None else JobEventBroker()
        self._service = JobService(session_factory=session_factory, broker=self._broker)
        self._transport_factory = transport_factory
        self._poll_interval_s = poll_interval_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run_forever, name="vman-worker", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            self._thread = None

    def _build_transport(self, host: models.Host) -> Transport:
        if self._transport_factory is not None:
            return self._transport_factory(host)
        # Real hosts with vault credentials go over SSH. Hosts without
        # a credential (test seeds, local-only) stay on SubprocessTransport
        # so the existing job integration tests keep working.
        return build_transport_for_host(host, session_factory=self._session_factory)

    def _process_one(self) -> bool:
        """Claim and run at most one job. Return True if a job was processed."""
        job = self._service.claim_next_queued()
        if job is None:
            return False
        # Load the host.
        from sqlalchemy import select

        with self._session_factory() as session:
            host = session.execute(
                select(models.Host).where(models.Host.id == job.host_id)
            ).scalar_one_or_none()
            if host is None:
                # No host -> mark failed.
                self._service.complete(
                    job_id=job.id,
                    exit_code=1,
                    error_summary="host not found",
                )
                return True
            session.expunge(host)
        runner = _build_runner(host, self._build_transport(host))
        try:
            result: CommandResult = runner.run(
                job.command_summary,
                timeout=float(job.timeout_seconds),
            )
        except Exception as exc:
            self._service.append_log(
                job_id=job.id,
                stream="system",
                line=f"worker exception: {type(exc).__name__}",
            )
            self._service.complete(
                job_id=job.id,
                exit_code=1,
                error_summary=str(exc),
            )
            return True
        # Persist any captured output.
        for line in result.stdout.splitlines():
            self._service.append_log(job_id=job.id, stream="stdout", line=line)
        for line in result.stderr.splitlines():
            self._service.append_log(job_id=job.id, stream="stderr", line=line)
        # Check for cancellation before completing.
        current = self._service.get(job.id)
        if current is not None and current.status == "cancelled":
            return True
        self._service.complete(
            job_id=job.id,
            exit_code=result.exit_code,
            error_summary=("command timed out" if result.timed_out else None),
        )
        return True

    def _run_forever(self) -> None:
        log.info("vman worker started")
        while not self._stop.is_set():
            try:
                processed = self._process_one()
            except Exception:
                log.exception("worker iteration failed")
                processed = False
            if not processed:
                # Idle -- sleep until the next poll.
                self._stop.wait(self._poll_interval_s)
        log.info("vman worker stopped")

    def process_one_now(self) -> bool:
        """Process one job synchronously; used in tests."""
        return self._process_one()


__all__ = ["JobWorker"]
