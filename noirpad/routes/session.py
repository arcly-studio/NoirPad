"""Session: run mode, server-mode password login, desktop cookie bind."""

import secrets
import time

from fastapi import APIRouter, Request, Response

from .. import app_lock
from .. import server_auth as auth
from ..errors import ApiError
from ..models import LoginReq
from ..runtime import RUNTIME
from ..storage import read_data

router = APIRouter()


@router.get("/api/session")
async def session_info(request: Request):
    authenticated = auth.is_authenticated(request)
    return {
        "mode": RUNTIME.mode,
        "password_required": RUNTIME.mode == "server" and bool(RUNTIME.password),
        "authenticated": authenticated,
        "data_notice": RUNTIME.data_notice if authenticated else None,
        "app_lock": {"enabled": app_lock.enabled(),
                     "unlocked": app_lock.is_unlocked(request)},
        # Needed before login / app lock, so the gate is in the right language.
        "language": read_data().get("language", "auto"),
    }


@router.post("/api/session/dismiss-notice")
async def dismiss_notice():
    RUNTIME.data_notice = None
    return {"ok": True}


@router.post("/api/session/bind")
async def session_bind(response: Response):
    """Desktop: turn the header token into a cookie for <img> requests.

    Only reachable with a valid X-NoirPad-Token (see check_request).
    """
    if RUNTIME.mode == "desktop" and RUNTIME.desktop_token:
        response.set_cookie(
            key=auth.DESKTOP_COOKIE_NAME, value=RUNTIME.desktop_token,
            httponly=True, samesite="strict", path="/images/",
        )
    return {"ok": True}


@router.post("/api/login")
async def login(req: LoginReq, response: Response):
    if not (RUNTIME.mode == "server" and RUNTIME.password):
        return {"ok": True}
    now = time.time()
    RUNTIME.login_failures[:] = [t for t in RUNTIME.login_failures
                                 if t > now - auth.LOGIN_WINDOW]
    if len(RUNTIME.login_failures) >= auth.LOGIN_MAX_FAILURES:
        raise ApiError(429, "too_many_attempts")
    if len(req.password) > 1024 or not auth.password_matches(req.password):
        RUNTIME.login_failures.append(now)
        raise ApiError(401, "wrong_password")
    token = secrets.token_urlsafe(32)
    ttl = auth.SESSION_TTL_REMEMBER if req.remember else auth.SESSION_TTL_SHORT
    RUNTIME.sessions[token] = now + ttl
    auth.set_session_cookie(response, token, remember=req.remember)
    return {"ok": True}


@router.post("/api/logout")
async def logout(request: Request, response: Response):
    RUNTIME.sessions.pop(request.cookies.get(auth.SESSION_COOKIE_NAME) or "", None)
    response.delete_cookie(key=auth.SESSION_COOKIE_NAME, path="/", samesite="strict",
                           secure=auth.SESSION_COOKIE_SECURE)
    return {"ok": True}
