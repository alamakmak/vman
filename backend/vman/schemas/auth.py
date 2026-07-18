"""Pydantic schemas for the auth API."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class SetupRequest(BaseModel):
    """First-admin setup payload."""

    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=12, max_length=1024)
    email: str | None = Field(default=None, max_length=254)
    # Optional; required when VMAN_SETUP_TOKEN is configured.
    setup_token: str | None = Field(default=None, max_length=256)

    @field_validator("username")
    @classmethod
    def _validate_username(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("username must not be blank")
        # Allow letters, digits, dash, underscore, dot -- common safe chars.
        allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
        if not all(c in allowed for c in cleaned):
            raise ValueError("username may only contain letters, digits, '-', '_', '.'")
        return cleaned


class LoginRequest(BaseModel):
    """Login payload."""

    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=1024)


class AuthStatusOut(BaseModel):
    """Public bootstrap status (no secrets, no usernames)."""

    setup_required: bool
    setup_token_required: bool


class ChangePasswordRequest(BaseModel):
    """Authenticated password change."""

    current_password: str = Field(..., min_length=1, max_length=1024)
    new_password: str = Field(..., min_length=12, max_length=1024)


class UserOut(BaseModel):
    """Public-facing user representation (no secrets)."""

    id: str
    username: str
    email: str | None = None
    role: str
    totp_enabled: bool


class SessionOut(BaseModel):
    """Session list entry."""

    id: str
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: str
    expires_at: str
    revoked_at: str | None = None


__all__ = [
    "AuthStatusOut",
    "ChangePasswordRequest",
    "LoginRequest",
    "SessionOut",
    "SetupRequest",
    "UserOut",
]
