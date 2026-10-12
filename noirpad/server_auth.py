"""Access control: run modes, Host check, CSRF, desktop token, password.

Two run modes:
  * "server"  — `python NoirPad-web.py`. Optional password from the
                NOIRPAD_PASSWORD env var; required when binding to anything
                but loopback. Sessions live in memory only.
  * "desktop" — desktop.py. A random token per launch must accompany every
                /api/ request (X-NoirPad-Token) and authorises /images/
                through a cookie set by /api/session/bind.

In both modes the Host header must be loopback (or listed in
NOIRPAD_ALLOWED_HOSTS for a self-hosted server — DNS rebinding), and
state-changing requests must carry a custom header and a same-origin Origin
(CSRF).
"""

import hashlib
import hmac
import os
import time
from typing import Any, Optional

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from . import app_lock
from .runtime import LOOPBACK_HOSTS, RUNTIME, env_allowed_hosts

SESSION_COOKIE_NAME = "noirpad_session"
DESKTOP_COOKIE_NAME = "noirpad_desktop"
TOKEN_HEADER = "x-noirpad-token"
CSRF_HEADER = "x-noirpad-request"
SESSION_TTL_REMEMBER = 30 * 24 * 60 * 60  # 30 days
SESSION_TTL_SHORT = 12 * 60 * 60          # 12 hours

SESSION_COOKIE_SECURE = (os.environ.get("NOIRPAD_SECURE_COOKIES") or "").lower() in (
    "1", "true", "yes", "on")

LOGIN_MAX_FAILURES = 10      # per LOGIN_WINDOW seconds, across all clients
LOGIN_WINDOW = 60

# Endpoints reachable before login (server mode with a password).
PUBLIC_API = {("GET", "/api/session"), ("POST", "/api/login"), ("POST", "/api/logout")}
# … and while the app lock is set and this client has not unlocked it.
APP_LOCK_OPEN = PUBLIC_API | {("POST", "/api/session/bind"), ("POST", "/api/app-lock/unlock"),
                              ("POST", "/api/app-lock/lock")}
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
])
# Uploaded files are only ever images; even if one were misinterpreted it
# gets no script, no origin and no same-origin access.
IMAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"


def configure(*, mode: Optional[str] = None, password: Any = ...,
              desktop_token: Any = ...) -> None:
    """Set the run mode, server password and desktop token.

    Used by desktop.py and the tests. Re-reads NOIRPAD_ALLOWED_HOSTS
    (server mode only; the desktop app only ever talks to loopback).
    """
    if mode is not None:
        RUNTIME.mode = mode
    if password is not ...:
        RUNTIME.password = password or None
    if desktop_token is not ...:
        RUNTIME.desktop_token = desktop_token or None
    RUNTIME.allowed_hosts = set(LOOPBACK_HOSTS)
    if RUNTIME.mode == "server":
        RUNTIME.allowed_hosts |= env_allowed_hosts()
    RUNTIME.sessions.clear()
    RUNTIME.login_failures.clear()
    RUNTIME.unlocked.clear()
    RUNTIME.app_lock_tokens.clear()
    RUNTIME.app_lock_failures.clear()


def password_matches(candidate: str) -> bool:
    expected = RUNTIME.password or ""
    return hmac.compare_digest(
        hashlib.sha256(candidate.encode("utf-8")).digest(),
        hashlib.sha256(expected.encode("utf-8")).digest(),
    )


def _session_valid(token: Optional[str]) -> bool:
    if not token:
        return False
    expires_at = RUNTIME.sessions.get(token)
    if expires_at is None:
        return False
    if expires_at <= time.time():
        RUNTIME.sessions.pop(token, None)
        return False
    return True


def is_authenticated(request: Request) -> bool:
    if RUNTIME.mode == "server" and RUNTIME.password:
        return _session_valid(request.cookies.get(SESSION_COOKIE_NAME))
    return True


def _token_ok(candidate: Optional[str]) -> bool:
    expected = RUNTIME.desktop_token
    return bool(expected and candidate) and hmac.compare_digest(
        candidate.encode("utf-8"), expected.encode("utf-8"))


def _host_of(value: str) -> str:
    """'Host' header / URL authority → lower-case host without port."""
    value = (value or "").strip().lower()
    if value.startswith("["):                      # [::1]:8000
        return value[1:value.find("]")] if "]" in value else value
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


def _deny(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def check_request(request: Request) -> Optional[JSONResponse]:
    """Host, CSRF, desktop token and password checks. None = allowed."""
    if _host_of(request.headers.get("host", "")) not in RUNTIME.allowed_hosts:
        return _deny(400, "Invalid host header")

    path = request.url.path
    is_api = path.startswith("/api/")
    if not (is_api or path.startswith("/images/")):
        return None

    if request.method in _UNSAFE_METHODS:
        origin = request.headers.get("origin")
        if origin is not None:
            authority = origin.split("://", 1)[-1]
            if authority.lower() != request.headers.get("host", "").lower():
                return _deny(403, "Cross-origin request refused")
        if RUNTIME.mode == "server" and request.headers.get(CSRF_HEADER) != "1":
            return _deny(403, "Missing X-NoirPad-Request header")

    if RUNTIME.mode == "desktop":
        token = request.headers.get(TOKEN_HEADER)
        if not is_api:  # <img> can't send headers → cookie from /api/session/bind
            token = token or request.cookies.get(DESKTOP_COOKIE_NAME)
        if not _token_ok(token):
            return _deny(403, "Missing or wrong NoirPad token")

    if (request.method, path) not in PUBLIC_API and not is_authenticated(request):
        return _deny(401, "Not authenticated")
    if (request.method, path) not in APP_LOCK_OPEN and not app_lock.is_unlocked(request):
        return _deny(423, "App is locked")
    return None


def apply_security_headers(request: Request, response: Response) -> None:
    headers = response.headers
    headers["X-Content-Type-Options"] = "nosniff"
    headers["Referrer-Policy"] = "no-referrer"
    headers["X-Frame-Options"] = "DENY"
    headers["Content-Security-Policy"] = (
        IMAGE_CSP if request.url.path.startswith("/images/") else CONTENT_SECURITY_POLICY)
    # Local app: never cache, so JS/CSS edits always show up on reload.
    headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    headers["Pragma"] = "no-cache"
    headers["Expires"] = "0"


def set_session_cookie(response: Response, token: str, remember: bool) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_TTL_REMEMBER if remember else None,  # None = session cookie
        httponly=True,
        samesite="strict",
        secure=SESSION_COOKIE_SECURE,
        path="/",
    )
