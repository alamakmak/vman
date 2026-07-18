"""Terminal WebSocket API route (Milestone 4 / Task 14)."""

from __future__ import annotations

import asyncio
import datetime as dt
import io
import json
import logging
from http.cookies import SimpleCookie

import paramiko
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from vman.api.deps import SESSION_COOKIE_NAME
from vman.config import get_settings
from vman.db import models
from vman.db.session import get_sessionmaker
from vman.security.auth import hash_session_token
from vman.security.crypto import decode_master_key_from_env
from vman.services.vault import Vault

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/terminal", tags=["terminal"])


async def get_websocket_user(websocket: WebSocket) -> models.User | None:
    """Authenticate the user from the session cookie in WebSocket handshake headers/cookies."""
    token = websocket.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        cookie_header = websocket.headers.get("cookie")
        if cookie_header:
            cookie = SimpleCookie(cookie_header)
            if SESSION_COOKIE_NAME in cookie:
                token = cookie[SESSION_COOKIE_NAME].value

    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Not authenticated")
        return None

    token_hash = hash_session_token(token)
    now = dt.datetime.now(dt.timezone.utc)

    db_session_factory = get_sessionmaker()
    with db_session_factory() as db:
        row = db.execute(
            select(models.UserSession)
            .where(models.UserSession.session_token_hash == token_hash)
            .where(models.UserSession.revoked_at.is_(None))
            .where(models.UserSession.expires_at > now)
        ).scalar_one_or_none()
        if row is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Session invalid or expired")
            return None
        user = db.execute(
            select(models.User).where(models.User.id == row.user_id)
        ).scalar_one_or_none()
        if user is None or user.disabled_at is not None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="User disabled")
            return None
        return user


@router.websocket("/ws/{host_id}")
async def terminal_ws(websocket: WebSocket, host_id: str) -> None:
    """WS /api/terminal/ws/{host_id} endpoint."""
    user = await get_websocket_user(websocket)
    if not user:
        return

    await websocket.accept()

    db_session_factory = get_sessionmaker()
    with db_session_factory() as db:
        host = db.get(models.Host, host_id)
        if not host:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Host not found")
            return

        # Reveal credentials via shared vault helper
        password = None
        private_key = None
        passphrase = None

        if host.credential_id:
            settings = get_settings()
            try:
                master_key_bytes = decode_master_key_from_env(settings.master_key)
                vault = Vault(master_key=master_key_bytes, session_factory=db_session_factory)
                material = vault.reveal_ssh_for_host(host)
                password = material.password
                private_key = material.private_key
                passphrase = material.passphrase
            except Exception as e:
                logger.error("Failed to decrypt vault credential: %s", type(e).__name__)
                await websocket.close(
                    code=status.WS_1011_INTERNAL_ERROR, reason="Failed to decrypt credential"
                )
                return

    # Use paramiko to connect to the SSH host with strict host-key check.
    from vman.security.host_keys import parse_fingerprint
    from vman.services.ssh_runner import HostKeyMismatchError, _make_host_key_policy

    expected_fp = None
    if host.host_key_fingerprint and host.host_key_algorithm:
        try:
            expected_fp = parse_fingerprint(host.host_key_algorithm, host.host_key_fingerprint)
        except ValueError:
            expected_fp = None

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(_make_host_key_policy(expected_fp))

    pkey = None
    if private_key:
        key_file = io.StringIO(private_key)
        key_classes = [
            cls
            for name in ("Ed25519Key", "RSAKey", "ECDSAKey", "DSSKey")
            if (cls := getattr(paramiko, name, None)) is not None
        ]
        for key_cls in key_classes:
            try:
                key_file.seek(0)
                pkey = key_cls.from_private_key(key_file, password=passphrase)
                break
            except Exception:
                continue
        if pkey is None:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Failed to parse private key")
            return

    try:
        # Run blocking connection in thread
        await asyncio.to_thread(
            client.connect,
            hostname=host.hostname_or_ip,
            port=host.ssh_port,
            username=host.username,
            password=password,
            pkey=pkey,
            timeout=10.0,
            allow_agent=False,
            look_for_keys=False,
        )
    except HostKeyMismatchError as exc:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=str(exc)[:120])
        return
    except Exception as exc:
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason=f"SSH connection failed: {exc}")
        return

    # Invoke interactive shell
    try:
        channel = client.invoke_shell(term="xterm", width=80, height=24)
    except Exception as exc:
        client.close()
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason=f"Failed to invoke shell: {exc}")
        return

    # Bridging tasks
    async def read_from_ssh() -> None:
        try:
            while True:
                # recv is blocking, run in a thread
                data = await asyncio.to_thread(channel.recv, 1024)
                if not data:
                    break
                await websocket.send_text(data.decode("utf-8", errors="ignore"))
        except Exception:
            pass
        finally:
            try:
                await websocket.close()
            except Exception:
                pass

    async def write_to_ssh() -> None:
        try:
            while True:
                # Receive message from WebSocket
                data = await websocket.receive()
                
                # Check for disconnect
                if data.get("type") == "websocket.disconnect":
                    break

                msg = None
                if "text" in data:
                    msg = data["text"]
                elif "bytes" in data:
                    msg = data["bytes"]

                if msg is not None:
                    # Check if it's a resize message
                    if isinstance(msg, str) and msg.startswith('{"type": "resize"'):
                        try:
                            parsed = json.loads(msg)
                            cols = parsed.get("cols", 80)
                            rows = parsed.get("rows", 24)
                            channel.resize_pty(width=cols, height=rows)
                            continue
                        except Exception:
                            pass

                    # Standard payload write
                    if isinstance(msg, str):
                        payload = msg.encode("utf-8")
                    else:
                        payload = msg
                    await asyncio.to_thread(channel.send, payload)
        except Exception:
            pass

    # Run tasks concurrently
    try:
        await asyncio.gather(read_from_ssh(), write_to_ssh())
    finally:
        # Cleanup
        try:
            channel.close()
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass
