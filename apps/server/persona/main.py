from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from persona import __version__
from persona.core.config import get_settings
from persona.services import storage

log = logging.getLogger("persona")


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path.startswith("/media/"):
            resp.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return resp


def _api_router() -> APIRouter:
    from persona.api import admin, auth, characters, users

    api = APIRouter(prefix="/api/v1")
    api.include_router(auth.router)
    api.include_router(users.router)
    api.include_router(characters.router)
    api.include_router(admin.router)
    api.include_router(admin.reports_router)

    for mod in ("chats", "personas", "rooms", "cards", "images", "voices", "calls", "ws"):
        try:
            m = __import__(f"persona.api.{mod}", fromlist=["router"])
        except ModuleNotFoundError as e:
            if e.name == f"persona.api.{mod}":
                continue
            raise
        api.include_router(m.router)

    @api.get("/health", tags=["meta"])
    async def health() -> dict:
        return {"status": "ok", "version": __version__}

    return api


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    if s.secret_key == "change-me-dev-only" and s.environment == "production":
        log.warning("SECRET_KEY is the development default. Set SECRET_KEY in .env!")
    storage.media_root()
    if s.database_url == "" or s.is_test:
        # SQLite: make sure the schema exists even if `persona migrate` was skipped.
        from persona.db import create_all

        if not s.is_test:
            from persona.cli import run_migrations

            try:
                run_migrations()
            except Exception:  # noqa: BLE001
                log.exception("Alembic migration failed, falling back to create_all")
                await create_all()
        else:
            await create_all()
    worker_task = None
    if s.embedded_worker and not s.is_test:
        import asyncio

        from persona.worker import embedded_loop

        worker_task = asyncio.create_task(embedded_loop())
    yield
    if worker_task:
        worker_task.cancel()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="Persona.AI",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    origins = list(s.cors_origins)
    if s.public_url and s.public_url not in origins:
        origins.append(s.public_url.rstrip("/"))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.add_middleware(SecurityHeaders)
    app.include_router(_api_router())
    app.mount("/media", StaticFiles(directory=storage.media_root(), check_dir=False), name="media")

    @app.exception_handler(404)
    async def not_found(request: Request, exc):  # noqa: ANN001
        if request.url.path.startswith(("/api/", "/media/")):
            detail = getattr(exc, "detail", "Not found")
            return JSONResponse({"detail": detail}, status_code=404)
        return await _spa(request)

    web_dist = s.web_dist or _default_web_dist()
    if web_dist and (web_dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=web_dist / "assets", check_dir=False))

        async def _spa_impl(request: Request):
            rel = request.url.path.lstrip("/")
            candidate = (web_dist / rel).resolve()
            if rel and web_dist.resolve() in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(web_dist / "index.html", headers={"Cache-Control": "no-cache"})

        app.state.spa = _spa_impl

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(request: Request, path: str):
            return await _spa_impl(request)

    return app


async def _spa(request: Request):
    spa = getattr(request.app.state, "spa", None)
    if spa:
        return await spa(request)
    return JSONResponse({"detail": "Not found"}, status_code=404)


def _default_web_dist() -> Path | None:
    here = Path(__file__).resolve()
    for cand in (here.parents[2] / "web" / "dist", here.parent / "web_dist"):
        if cand.exists():
            return cand
    return None


app = create_app()
