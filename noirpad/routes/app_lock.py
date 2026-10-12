"""App lock: unlock, lock now, enable/change, disable (see noirpad.app_lock)."""

import time

from fastapi import APIRouter, HTTPException, Request, Response

from .. import app_lock
from ..models import AppLockReq
from ..runtime import RUNTIME
from ..server_auth import LOGIN_MAX_FAILURES, LOGIN_WINDOW, SESSION_COOKIE_SECURE
from ..storage import update_data

router = APIRouter()


def _check_password(password: str) -> None:
    """Rate-limited check against the stored hash."""
    now = time.time()
    RUNTIME.app_lock_failures[:] = [t for t in RUNTIME.app_lock_failures
                                    if t > now - LOGIN_WINDOW]
    if len(RUNTIME.app_lock_failures) >= LOGIN_MAX_FAILURES:
        raise HTTPException(429, "Too many attempts, try again in a minute")
    if not app_lock.verify(RUNTIME.app_lock, password):
        RUNTIME.app_lock_failures.append(now)
        raise HTTPException(401, "Wrong password")


def _store(record) -> None:
    def _mut(data: dict) -> None:
        if record is None:
            data.pop("app_lock", None)
        else:
            data["app_lock"] = record

    update_data(_mut)
    RUNTIME.app_lock = record
    RUNTIME.app_lock_tokens.clear()


@router.post("/api/app-lock/unlock")
async def unlock(req: AppLockReq, response: Response):
    if not app_lock.enabled():
        return {"ok": True}
    _check_password(req.password)
    app_lock.grant(response, SESSION_COOKIE_SECURE)
    return {"ok": True}


@router.post("/api/app-lock/lock")
async def lock(request: Request, response: Response):
    """Lock this client; also forget every unlocked note's key."""
    app_lock.revoke(request, response, SESSION_COOKIE_SECURE)
    RUNTIME.unlocked.clear()
    return {"ok": True}


@router.post("/api/app-lock/enable")
async def enable(req: AppLockReq, response: Response):
    """Set the lock, or change its password (then current_password is required)."""
    if app_lock.enabled():
        _check_password(req.current_password or "")
    if len(req.password) < app_lock.MIN_PASSWORD:
        raise HTTPException(400, f"Password must be at least {app_lock.MIN_PASSWORD} characters")
    _store(app_lock.make_record(req.password))
    app_lock.grant(response, SESSION_COOKIE_SECURE)   # the client that set it stays in
    return {"ok": True}


@router.post("/api/app-lock/disable")
async def disable(req: AppLockReq, request: Request, response: Response):
    if app_lock.enabled():
        _check_password(req.password)
        _store(None)
    app_lock.revoke(request, response, SESSION_COOKIE_SECURE)
    return {"ok": True}
