"""FastAPI app: auth + repos + jobs + findings + SSE.

Run with: uvicorn app.web:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth.routes import router as auth_router
from .core.settings import get_app_settings
from .routes.events_sse import router as sse_router
from .routes.findings import router as findings_router
from .routes.jobs import review_router, router as jobs_router
from .routes.me import router as me_router
from .routes.repos import router as repos_router
from .routes.tickets import repo_tickets_router, router as tickets_router
from .security.redact_middleware import RequestLogger

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="OpenGraphXEM API", version="0.2.0", description="AI code review service backing the OpenGraphXEM PWA.")

s = get_app_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=s.cors_origins,
    allow_origin_regex=getattr(s, "cors_allow_origin_regex", None),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
    expose_headers=["X-Request-Id"],
    max_age=86400,
)
app.add_middleware(RequestLogger)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "service": "OpenGraphXEM", "version": "0.2.0"}


@app.get("/")
def root() -> dict:
    return {
        "service": "OpenGraphXEM",
        "endpoints": [
            "/api/auth/{signup,login,refresh,logout}",
            "/api/me",
            "/api/repos", "/api/repos/{id}", "/api/repos/{id}/reviews", "/api/repos/{id}/tickets",
            "/api/jobs", "/api/jobs/{id}", "/api/jobs/{id}/findings",
            "/api/jobs/{id}/event-token", "/api/jobs/{id}/events",
            "/api/findings/{id}",
            "/api/tickets", "/api/tickets/{id}",
        ],
    }


app.include_router(auth_router)
app.include_router(me_router)
app.include_router(repos_router)
app.include_router(review_router)
app.include_router(jobs_router)
app.include_router(findings_router)
app.include_router(sse_router)
app.include_router(tickets_router)
app.include_router(repo_tickets_router)


@app.exception_handler(Exception)
async def unhandled(_request, exc: Exception) -> JSONResponse:
    logging.getLogger("app.unhandled").exception("unhandled: %s", exc)
    return JSONResponse(status_code=500, content={"error": "internal error", "code": "internal"})
