"""Pydantic schemas for the host CRUD API."""

from __future__ import annotations

import ipaddress
import re

from pydantic import BaseModel, Field, field_validator

_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$")


def _validate_ip_or_host(value: str) -> str:
    """Accept either a literal IPv4/IPv6 address OR a DNS hostname.

    DNS hostnames are not strictly validated (DNS allows many
    characters); we just reject empty / overly long values and
    obvious garbage.
    """
    if not value or len(value) > 255:
        raise ValueError("hostname_or_ip must be 1-255 chars")
    # First try parsing as an IP address.
    try:
        ipaddress.ip_address(value)
        return value
    except ValueError:
        pass
    # Otherwise treat as a DNS hostname. Very loose validation.
    if any(c.isspace() for c in value):
        raise ValueError("hostname_or_ip must not contain whitespace")
    return value


class HostCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    hostname_or_ip: str = Field(..., min_length=1, max_length=255)
    ssh_port: int = Field(22, ge=1, le=65535)
    username: str = Field(..., min_length=1, max_length=64)
    auth_method: str = Field(..., min_length=1, max_length=32)
    credential_id: str | None = Field(default=None, max_length=64)
    sudo_mode: str = Field("root", max_length=32)
    environment: str = Field("experiment", max_length=16)
    provider: str | None = Field(default=None, max_length=64)
    region: str | None = Field(default=None, max_length=64)
    tags: list[str] = Field(default_factory=list, max_length=64)
    notes: str = Field("", max_length=2048)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError("name must start with alnum, then [a-zA-Z0-9_.-], max 64 chars")
        return v

    @field_validator("hostname_or_ip")
    @classmethod
    def _validate_host(cls, v: str) -> str:
        return _validate_ip_or_host(v)

    @field_validator("auth_method")
    @classmethod
    def _validate_auth_method(cls, v: str) -> str:
        if v not in {"password", "key", "key_with_passphrase"}:
            raise ValueError("auth_method must be 'password', 'key', or 'key_with_passphrase'")
        return v

    @field_validator("sudo_mode")
    @classmethod
    def _validate_sudo_mode(cls, v: str) -> str:
        if v not in {"root", "passwordless_sudo", "sudo_password"}:
            raise ValueError("sudo_mode must be 'root', 'passwordless_sudo', or 'sudo_password'")
        return v

    @field_validator("environment")
    @classmethod
    def _validate_environment(cls, v: str) -> str:
        if v not in {"experiment", "staging", "production"}:
            raise ValueError("environment must be 'experiment', 'staging', or 'production'")
        return v


class HostUpdate(BaseModel):
    """Partial update payload; every field is optional."""

    hostname_or_ip: str | None = Field(default=None, max_length=255)
    ssh_port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = Field(default=None, min_length=1, max_length=64)
    auth_method: str | None = Field(default=None, min_length=1, max_length=32)
    credential_id: str | None = Field(default=None, max_length=64)
    sudo_mode: str | None = Field(default=None, max_length=32)
    environment: str | None = Field(default=None, max_length=16)
    provider: str | None = Field(default=None, max_length=64)
    region: str | None = Field(default=None, max_length=64)
    tags: list[str] | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=2048)
    host_key_fingerprint: str | None = Field(default=None, max_length=128)
    host_key_algorithm: str | None = Field(default=None, max_length=16)
    os_family: str | None = Field(default=None, max_length=32)
    os_name: str | None = Field(default=None, max_length=64)
    os_version: str | None = Field(default=None, max_length=64)
    package_manager: str | None = Field(default=None, max_length=32)
    arch: str | None = Field(default=None, max_length=16)
    cpu_cores: int | None = Field(default=None, ge=0)
    ram_mb: int | None = Field(default=None, ge=0)
    disk_total_mb: int | None = Field(default=None, ge=0)
    risk_level: str | None = Field(default=None, max_length=16)

    @field_validator("hostname_or_ip")
    @classmethod
    def _validate_host(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _validate_ip_or_host(v)

    @field_validator("auth_method")
    @classmethod
    def _validate_auth_method(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in {"password", "key", "key_with_passphrase"}:
            raise ValueError("auth_method must be 'password', 'key', or 'key_with_passphrase'")
        return v

    @field_validator("sudo_mode")
    @classmethod
    def _validate_sudo_mode(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in {"root", "passwordless_sudo", "sudo_password"}:
            raise ValueError("sudo_mode must be 'root', 'passwordless_sudo', or 'sudo_password'")
        return v

    @field_validator("environment")
    @classmethod
    def _validate_environment(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in {"experiment", "staging", "production"}:
            raise ValueError("environment must be 'experiment', 'staging', or 'production'")
        return v


class HostOut(BaseModel):
    id: str
    name: str
    hostname_or_ip: str
    ssh_port: int
    username: str
    auth_method: str
    credential_id: str | None = None
    sudo_mode: str
    host_key_fingerprint: str | None = None
    host_key_algorithm: str | None = None
    os_family: str | None = None
    os_name: str | None = None
    os_version: str | None = None
    package_manager: str | None = None
    arch: str | None = None
    cpu_cores: int | None = None
    ram_mb: int | None = None
    disk_total_mb: int | None = None
    provider: str | None = None
    region: str | None = None
    environment: str
    risk_level: str | None = None
    tags: list[str]
    notes: str
    last_seen_at: str | None = None
    disabled_at: str | None = None
    created_at: str
    updated_at: str


class ConnectionTestResult(BaseModel):
    ok: bool
    reached: bool
    authenticated: bool
    host_key_fingerprint: str | None = None
    host_key_algorithm: str | None = None
    latency_ms: float | None = None
    message: str
    tested_at: str
    # Detected fields so the dashboard can refresh without a second GET.
    os_family: str | None = None
    os_name: str | None = None
    os_version: str | None = None
    package_manager: str | None = None
    arch: str | None = None
    cpu_cores: int | None = None
    ram_mb: int | None = None
    disk_total_mb: int | None = None
    last_seen_at: str | None = None


__all__ = ["HostCreate", "HostOut", "HostUpdate", "ConnectionTestResult"]

