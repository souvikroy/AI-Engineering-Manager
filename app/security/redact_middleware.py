"""Redact secrets from request/response bodies before they hit logs."""

from __future__ import annotations

import logging

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from reviewer.core.redactor import redact

log = logging.getLogger("app.access")


class RequestLogger(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method
        # Redact path for safety even though it shouldn't contain secrets.
        log.info("[%s] %s", method, redact(path))
        response = await call_next(request)
        log.info("[%s] %s -> %s", method, redact(path), response.status_code)
        return response
