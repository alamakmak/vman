"""Pydantic schemas for the Agent Bridge API."""

from __future__ import annotations

import datetime
from pydantic import BaseModel


class AgentOut(BaseModel):
    id: str
    name: str
    status: str
    dns_status: str
    domains: list[str]
    is_detected: bool = False
    last_seen_at: datetime.datetime | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime


__all__ = ["AgentOut"]
