# VMAN Architecture

This is the human-readable companion to the implementation plan at
`.hermes/plans/2026-06-22_140720-vman-secure-vps-manager.md`. The plan is the
source of truth for scope and ordering; this document explains how the pieces
fit together once they exist.

## High-level model

VMAN is a **control plane that runs on one central VPS** and manages many
small target VPSes over SSH. The central VPS owns all the intelligence:

- inventory
- credentials
- recipes
- jobs and audit log
- the worker that actually opens SSH sessions

Targets stay boring: SSH server, shell, coreutils, a package manager. **No
agent, no Python, no Node, no DB on the target.**

```
                        +-----------------------+
                        |     Central VPS       |
   Dashboard (browser)  |                       |
   <------------------> |  FastAPI  +  Worker   |
                        |  SQLite  +  Vault     |
                        |  Recipe Engine        |
                        +----------+------------+
                                   |
                          SSH      |    (strict host key check,
                          only     |     encrypted creds in memory)
                                   v
                        +-----------------------+
                        |   Target VPS          |
                        |   OpenSSH + shell     |
                        +-----------------------+
```

## Components (current)

| Layer | Component | Status |
|---|---|---|
| API | FastAPI app with `/api/health` + routers | **shipped** |
| Config | Strict settings + production safety net | **shipped** |
| DB | SQLAlchemy 2 models + Alembic | **shipped** |
| Crypto | AES-256-GCM credential vault | **shipped** |
| Redaction | Secret-pattern scrubbing | **shipped** |
| Auth | Argon2id sessions, login/logout, CSRF | **shipped** |
| Audit | Append-only audit log + hash chain | **shipped** |
| Hosts | CRUD + fingerprint trust + connection test | **shipped** |
| SSH runner | Paramiko transport, strict host keys | **shipped** |
| Job queue | SQLite/local queue + in-process worker | **shipped** |
| Policy | Risk classification + approval | **shipped** |
| Recipes | YAML schema + engine + builtin pack | **shipped** |
| Dashboard | Vite React SPA (static build) | **shipped** |
| CLI | `vmanctl` (Typer) | **shipped** |
| MCP | `vman-mcp` constrained tools | **shipped** |
| Terminal | WebSocket SSH shell | **shipped** |
| Agent bridge | Setup wizard / auto-detection | **shipped** |
| Deployment | systemd units, Cloudflare Tunnel docs | **shipped** |

## Process and security boundaries

- **API process** serves HTTP. Session cookies signed with `VMAN_SESSION_SECRET`.
- **Worker process** (`vman-worker` / in-process `JobWorker`) decrypts vault
  credentials and opens SSH. Prefer this path for remote execution.
- **Connection test + terminal** also decrypt credentials in the API process
  today (MVP compromise for interactive UX). Treat those routes as trusted
  operator-only surfaces.
- **Database** lives on the central VPS only. SQLite for MVP; PostgreSQL-ready
  abstraction later.
- **Vault keys** never touch the database. `VMAN_MASTER_KEY` is loaded from
  the environment (env file, not committed).

## SSH credential mapping

Host has one primary `credential_id`. Mapping:

| Credential kind | Result |
|---|---|
| `ssh_password` | SSH password |
| `ssh_private_key` | Private key PEM; optional `metadata.passphrase` or linked `metadata.passphrase_credential_id` |
| `ssh_private_key_passphrase` | Passphrase only; optional bundled PEM in `metadata.private_key` |

For `auth_method=key_with_passphrase`: store the key as primary credential with
`metadata_json.passphrase_credential_id` pointing at a passphrase vault entry.

Hosts without `credential_id` fall back to local `SubprocessTransport` (dev/tests only).

## Threat model summary

The full threat model is in section 2 of the implementation plan. The
non-negotiables for every component:

1. No plaintext credentials in the DB, logs, API responses, or the dashboard.
2. No `print()` of secrets anywhere -- the redaction engine catches
   the obvious patterns in logs and tool outputs.
3. Every sensitive action creates an audit event.
4. Destructive actions are gated by the policy engine.
5. Host key fingerprints must be verified before any SSH command runs
   (after first trust).
6. Production deploys MUST refuse to boot with placeholder secrets (see
   `Settings.model_post_init`).

## Low-resource design constraints

The central VPS this runs on may be a 1 vCPU / 2 GB RAM machine that already
runs Hermes/Alice and other sidecars. The following defaults are mandatory
and documented in `.env.example`:

- `VMAN_DATABASE_URL` = SQLite (no PostgreSQL service required)
- `VMAN_QUEUE_BACKEND` = `sqlite` (no Redis required)
- `VMAN_UVICORN_WORKERS` = 1
- `VMAN_WORKER_CONCURRENCY` = 1
- `VMAN_MAX_PARALLEL_HOST_JOBS` = 1
- `VMAN_MAX_GLOBAL_JOBS` = 1
- `VMAN_FRONTEND_MODE` = `static` (no Node process in production)
- `VMAN_ENABLE_REDIS` = `false`
- `VMAN_ENABLE_PLAYWRIGHT_LOCAL` = `false`

Heavy validation that the small VPS cannot run reliably (full Playwright
matrix, full frontend production build, security scans across the whole
tree) happens in GitHub Actions instead.

## Where to look next

- `docs/operations.md` -- day-to-day running
- `docs/security.md` -- secrets, rotation, audit, policy
- `docs/recipes.md` -- recipe DSL and the recipe library
- `docs/deployment.md` -- systemd, Cloudflare Tunnel, backups
- `docs/mcp-integration.md` -- exposing VMAN to Alice/Hermes
