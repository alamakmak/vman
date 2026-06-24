"""create agent bridge table
 
Revision ID: 20260107_0001
Revises: 20260106_0001
Create Date: 2026-01-07 00:00:00
"""

from __future__ import annotations

import json
import datetime as dt
import sqlalchemy as sa
from alembic import op

revision = "20260107_0001"
down_revision = "20260106_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create table
    op.create_table(
        "agents",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("dns_status", sa.String(length=16), nullable=False),
        sa.Column("domains", sa.JSON(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status IN ('active', 'setup_required', 'offline')",
            name="ck_agents_status"
        ),
        sa.CheckConstraint(
            "dns_status IN ('on', 'off')",
            name="ck_agents_dns_status"
        ),
    )

    # 2. Insert seed data
    meta = sa.MetaData()
    meta.reflect(bind=op.get_bind())
    agents_table = sa.Table("agents", meta)

    now = dt.datetime.now(dt.timezone.utc)
    seed_data = [
        {
            "id": "antigravity",
            "name": "Antigravity IDE",
            "status": "setup_required",
            "dns_status": "off",
            "domains": ["daily-cloudcode-pa.googleapis.com", "cloudcode-pa.googleapis.com"],
        },
        {
            "id": "hermes",
            "name": "Hermes Agent",
            "status": "setup_required",
            "dns_status": "off",
            "domains": ["api.openai.com"],
        },
        {
            "id": "openclaw",
            "name": "OpenClaw MCP",
            "status": "setup_required",
            "dns_status": "off",
            "domains": ["api.anthropic.com"],
        },
        {
            "id": "claudecode",
            "name": "Claude Code",
            "status": "setup_required",
            "dns_status": "off",
            "domains": ["api.anthropic.com"],
        },
        {
            "id": "opencode",
            "name": "OpenCode",
            "status": "setup_required",
            "dns_status": "off",
            "domains": ["opencode.ai"],
        },
        {
            "id": "cursor",
            "name": "Cursor IDE",
            "status": "setup_required",
            "dns_status": "off",
            "domains": ["api2.cursor.sh"],
        },
        {
            "id": "custom_mcp",
            "name": "Custom MCP Integration",
            "status": "setup_required",
            "dns_status": "off",
            "domains": ["localhost"],
        },
    ]

    # Convert domains list to JSON shape / string based on database engine compatibility
    for row in seed_data:
        op.bulk_insert(
            agents_table,
            [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "status": row["status"],
                    "dns_status": row["dns_status"],
                    "domains": row["domains"],
                    "last_seen_at": None,
                    "created_at": now,
                    "updated_at": now,
                }
            ]
        )


def downgrade() -> None:
    op.drop_table("agents")
