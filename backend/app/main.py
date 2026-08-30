from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.api import api_router
from app.core.config import settings, validate_production_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.db.dev_sqlite_schema import sync_dev_sqlite_schema
from app.db.seed import seed_roles_if_missing
from app.db.session import SessionLocal, engine
from app.middleware.operational_metrics import OperationalMetricsMiddleware
from app.middleware.qa_audit import QaPersonaAuditMiddleware
from app.middleware.request_body_limit import RequestBodyLimitMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.notifications.runner import run_worker_forever
from app.services.job_import_sweeper import run_import_sweeper_forever

validate_production_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    openapi_url=None if settings.app_env == "production" else f"{settings.api_v1_prefix}/openapi.json",
    docs_url=None if settings.app_env == "production" else f"{settings.api_v1_prefix}/docs",
    redoc_url=None if settings.app_env == "production" else f"{settings.api_v1_prefix}/redoc",
    openapi_tags=[
        {"name": "health", "description": "Service and dependency health checks"},
        {"name": "jobs", "description": "Jobs management endpoints"},
        {
            "name": "job-imports",
            "description": "Private recruiter-owned job-import readiness records",
        },
        {"name": "auth", "description": "Email/password and OAuth authentication endpoints"},
        {"name": "me", "description": "Authenticated user profile and YouTube channel endpoints"},
        {"name": "roles", "description": "Backend-driven role catalog and clarification questions"},
        {"name": "user", "description": "Authenticated user role/content-style preference endpoints"},
        {"name": "profile", "description": "Profile completion endpoints"},
        {"name": "portfolio", "description": "Portfolio ingestion and listing endpoints"},
        {"name": "content-style", "description": "Content style reference endpoints"},
        {"name": "users", "description": "Public profile endpoints"},
        {"name": "reviews", "description": "Verified engagement and two-sided review endpoints"},
        {
            "name": "telemetry",
            "description": "Privacy-bounded browser failure ingestion",
        },
        {"name": "qa", "description": "Allowlisted staging/test QA persona controls"},
        {"name": "dev", "description": "Development-only utility endpoints"},
    ],
)

# Added first, so it runs innermost. Nothing outside it reads the request body,
# so the memory guarantee is the same wherever it sits — but from here its 413
# still passes back out through the request-id and CORS layers, which a browser
# needs in order to read the response at all.
app.add_middleware(RequestBodyLimitMiddleware)
app.add_middleware(OperationalMetricsMiddleware)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(QaPersonaAuditMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(api_router, prefix=settings.api_v1_prefix)

media_root = Path(settings.media_root)
media_root.mkdir(parents=True, exist_ok=True)
app.mount(settings.media_base_path, StaticFiles(directory=media_root), name="media")


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": settings.app_name, "version": "v1"}


#: Set only when the API is hosting a background loop itself. Kept at module
#: level so shutdown can stop exactly what startup began.
_email_worker: dict[str, object] = {}
_import_sweeper: dict[str, object] = {}


@app.on_event("startup")
async def on_startup() -> None:
    await sync_dev_sqlite_schema(engine)
    async with SessionLocal() as session:
        await seed_roles_if_missing(session)

    if settings.email_worker_in_process:
        # Convenience for local development, where a second process to drain the
        # outbox is friction that ends with someone concluding email is broken.
        stop = asyncio.Event()
        _email_worker["stop"] = stop
        _email_worker["task"] = asyncio.create_task(
            run_worker_forever(
                SessionLocal,
                interval_seconds=settings.email_worker_interval_seconds,
                stop=stop,
            )
        )

    if settings.job_import_sweeper_in_process:
        # Same convenience, same caveat as the email worker above. Off by
        # default so deploying this code starts no loop nobody asked for.
        sweep_stop = asyncio.Event()
        _import_sweeper["stop"] = sweep_stop
        _import_sweeper["task"] = asyncio.create_task(
            run_import_sweeper_forever(
                SessionLocal,
                interval_seconds=settings.job_import_sweeper_interval_seconds,
                stop=sweep_stop,
            )
        )

    logger.info("backend_startup", extra={"env": settings.app_env})


@app.on_event("shutdown")
async def on_shutdown() -> None:
    """Ask the worker to stop and wait for the pass it is in the middle of.

    Cancelling outright would abandon a claimed row mid-attempt. That is
    survivable — the lease lapses and another worker picks it up — but waiting
    costs one interval and avoids a message being attempted twice for no reason.
    """

    for started in (_email_worker, _import_sweeper):
        stop = started.pop("stop", None)
        task = started.pop("task", None)
        if isinstance(stop, asyncio.Event):
            stop.set()
        if isinstance(task, asyncio.Task):
            with contextlib.suppress(asyncio.CancelledError):
                await task
