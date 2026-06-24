"""VMAN FastAPI application entrypoint.

This module wires the FastAPI app and exposes a single `create_app()`
factory. The app intentionally stays minimal at Milestone 0: a health
endpoint and a couple of safety contracts (no secrets in responses, no
catch-all error handlers that swallow details). Real routes are added
in later tasks.
"""

from __future__ import annotations

import atexit
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from vman import __version__
from vman.config import Settings, get_settings
from vman.security.csrf import cors_headers_for, preflight_headers
from vman.services.events import JobEventBroker


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build a FastAPI app instance.

    Accepts an optional Settings override so tests can inject a fake.
    Production code should rely on the singleton via get_settings().
    """
    if settings is None:
        settings = get_settings()

    app = FastAPI(
        title="VMAN API",
        version=__version__,
        # The docs surface is fine to expose in development; in production
        # it should be hidden behind auth or disabled. For Milestone 0 we
        # only ship the health endpoint, so this is a no-op for now.
        docs_url="/api/docs" if settings.env == "development" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.env == "development" else None,
    )

    # Stash settings on app.state so routes can read them without an import.
    app.state.settings = settings

    # ------------------------------------------------------------------ #
    # Routes
    # ------------------------------------------------------------------ #

    @app.get("/api/health", tags=["health"])
    def health() -> dict[str, Any]:
        """Liveness probe.

        MUST NOT include any secret material, configuration values, host
        details, or PII. It is intentionally trivial so external uptime
        probes can call it without authentication.
        """
        return {
            "status": "ok",
            "service": "vman",
            "version": __version__,
        }

    # ------------------------------------------------------------------ #
    # Routers
    # ------------------------------------------------------------------ #
    from vman.api.routes_auth import router as auth_router

    app.include_router(auth_router)
    from vman.api.routes_audit import router as audit_router

    app.include_router(audit_router)
    from vman.api.routes_hosts import router as hosts_router

    app.include_router(hosts_router)
    from vman.api.routes_jobs import router as jobs_router

    app.include_router(jobs_router)
    from vman.api.routes_recipes import router as recipes_router

    app.include_router(recipes_router)

    from vman.api.routes_vault import router as vault_router

    app.include_router(vault_router)

    from vman.api.routes_logs import router as logs_router

    app.include_router(logs_router)

    from vman.api.routes_settings import router as settings_router

    app.include_router(settings_router)

    from vman.api.routes_terminal import router as terminal_router

    app.include_router(terminal_router)

    from vman.api.routes_agents import router as agents_router

    app.include_router(agents_router)

    # ------------------------------------------------------------------ #
    # Background worker (Milestone 3 / Task 11)
    # ------------------------------------------------------------------ #
    # The worker is started lazily by :func:`start_background_worker` and
    # stopped on process exit. Storing it on ``app.state.worker`` makes
    # the lifecycle testable.
    from vman.db.session import get_sessionmaker
    from vman.services.events import JobEventBroker
    from vman.services.worker import JobWorker

    app.state.events = JobEventBroker()
    app.state.worker = JobWorker(
        session_factory=get_sessionmaker(),
        broker=app.state.events,
    )

    # ------------------------------------------------------------------ #
    # CORS + preflight handling
    # ------------------------------------------------------------------ #
    from starlette.middleware.base import BaseHTTPMiddleware

    class _CORSMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            origin = request.headers.get("origin")
            # Preflight: short-circuit OPTIONS with the right headers.
            if request.method.upper() == "OPTIONS":
                headers = preflight_headers(origin, settings)
                if not headers:
                    return Response(status_code=403)
                return Response(status_code=204, headers=headers)
            response = await call_next(request)
            for key, value in cors_headers_for(origin, settings).items():
                response.headers[key] = value
            return response

    app.add_middleware(_CORSMiddleware)

    # ------------------------------------------------------------------ #
    # Error handlers: never leak secrets or stack traces.
    # ------------------------------------------------------------------ #

    @app.exception_handler(RequestValidationError)
    async def _on_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Drop the raw input + ctx from the error list. ``input`` may
        # contain a leaked secret the user pasted into a form field;
        # ``ctx`` may contain non-JSON-serialisable Exception objects
        # (the default handler crashes on them anyway). We replace each
        # with a safe placeholder.
        from fastapi.encoders import jsonable_encoder

        sanitized = []
        for err in exc.errors():
            err_copy = {k: v for k, v in err.items() if k not in {"input", "ctx"}}
            err_copy["input_type"] = type(err.get("input")).__name__
            ctx = err.get("ctx")
            if ctx:
                err_copy["ctx"] = jsonable_encoder(ctx)
            sanitized.append(err_copy)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": sanitized},
        )

    @app.exception_handler(HTTPException)
    async def _on_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        # Preserve the original status code; only standardize the body.
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def _on_unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
        # Never echo the message or stack trace -- it could contain
        # secret data from a config or a connection string. Log on the
        # server side and respond with a generic message.
        # (Structured logging is wired up in a later milestone.)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "internal server error"},
        )

    # ------------------------------------------------------------------ #
    # Frontend SPA static file serving (production)
    # ------------------------------------------------------------------ #
    # When the Vite build output exists, serve it so the dashboard is
    # accessible at the root domain. In development the Vite dev server
    # handles this via proxy, so this block is a no-op.
    from pathlib import Path

    # Resolve frontend/dist relative to the backend package root
    _backend_root = Path(__file__).resolve().parent.parent  # backend/
    _frontend_dist = _backend_root.parent / "frontend" / "dist"

    if _frontend_dist.is_dir():
        from starlette.staticfiles import StaticFiles
        from fastapi.responses import FileResponse

        _index_html = _frontend_dist / "index.html"
        _assets_dir = _frontend_dist / "assets"

        # Mount hashed asset bundles (JS/CSS) at /assets
        if _assets_dir.is_dir():
            app.mount(
                "/assets",
                StaticFiles(directory=str(_assets_dir)),
                name="frontend-assets",
            )

        # Serve other static files in dist root (favicon, manifest, etc.)
        @app.get("/vite.svg", include_in_schema=False)
        @app.get("/favicon.ico", include_in_schema=False)
        async def _static_root_files(request: Request) -> Response:
            file_name = request.url.path.lstrip("/")
            file_path = _frontend_dist / file_name
            if file_path.is_file():
                return FileResponse(str(file_path))
            return FileResponse(str(_index_html))

        # Catch-all: serve index.html for any non-API route so React
        # Router client-side routing works (e.g. /hosts, /agents, /login)
        @app.get("/{full_path:path}", include_in_schema=False)
        async def _spa_fallback(request: Request, full_path: str) -> Response:
            # Never intercept API routes
            if full_path.startswith("api/") or full_path.startswith("api"):
                raise HTTPException(status_code=404, detail="Not Found")
            # Try to serve the exact file if it exists (e.g. robots.txt)
            requested_file = _frontend_dist / full_path
            if full_path and requested_file.is_file():
                return FileResponse(str(requested_file))
            return FileResponse(str(_index_html))

    return app


# Module-level app for `uvicorn vman.main:app`. Tests should use
# create_app() directly to control configuration.
app = create_app()


_worker_singleton: object | None = None


def start_background_worker() -> object:
    """Start (or return) the global background worker.

    Tests can patch the module-level ``_worker_singleton`` directly
    to inject a custom worker; production code calls this from
    :func:`run` before uvicorn takes over.
    """
    global _worker_singleton
    if _worker_singleton is None:
        from vman.db.session import get_sessionmaker
        from vman.services.events import JobEventBroker
        from vman.services.worker import JobWorker

        broker = JobEventBroker()
        _worker_singleton = JobWorker(
            session_factory=get_sessionmaker(),
            broker=broker,
        )
        _worker_singleton.start()
        # Stash the broker on a module-level name too so callers that
        # only know about ``start_background_worker`` can still reach
        # the broker without going through the FastAPI app object.
        global _event_broker
        _event_broker = broker
        atexit.register(_stop_background_worker)
    return _worker_singleton


_event_broker: JobEventBroker | None = None


def get_event_broker() -> JobEventBroker | None:
    """Return the broker attached to the running worker, if any.

    Used by tests and the SSE route to share a single in-process
    broker.  Returns ``None`` if no worker has been started (yet).
    """
    return _event_broker


def _stop_background_worker() -> None:
    global _worker_singleton
    if _worker_singleton is not None:
        # The singleton is typed as object to keep the module surface
        # minimal; the runtime value is always a JobWorker (or test
        # double) that implements .stop().
        stop = getattr(_worker_singleton, "stop", None)
        if callable(stop):
            stop(timeout=5.0)
        _worker_singleton = None


def reset_background_worker() -> None:
    """Stop and clear the worker singleton. Test helper."""
    _stop_background_worker()


def run() -> None:
    """Console-script entrypoint: `vman-api`."""
    start_background_worker()
    settings = get_settings()
    uvicorn.run(
        "vman.main:app",
        host=settings.api_host,
        port=settings.api_port,
        log_level=settings.log_level.lower(),
        workers=settings.uvicorn_workers,
    )


if __name__ == "__main__":
    run()
