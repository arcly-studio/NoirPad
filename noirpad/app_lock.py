"""Optional app lock: a password to open NoirPad (off by default).

Only a scrypt hash is stored, as `app_lock` in notes_data.json; deleting
that entry removes the lock (README). The lock keeps people out of the app
but does NOT encrypt notes — only locked notes are encrypted.

Unlocking issues a random token in an HttpOnly cookie; tokens live in
memory only, so every restart starts locked. While a lock is set, every
/api/ and /images/ request without a valid token gets 423 (server_auth).
"""

import base64
import hashlib
import hmac
import os
import secrets
from typing import Optional

from fastapi import Request, Response

from .runtime import RUNTIME

COOKIE_NAME = "noirpad_applock"
MIN_PASSWORD = 4
MAX_PASSWORD = 1024

# scrypt cost: ~50–100 ms and 32 MiB per check on a desktop CPU.
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 15, 8, 1


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p,
                          maxmem=128 * 1024 * 1024, dklen=32)


def make_record(password: str) -> dict:
    """The stored form of *password*: parameters, salt and hash, no secret."""
    salt = os.urandom(16)
    digest = _scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
    return {"kdf": "scrypt", "n": SCRYPT_N, "r": SCRYPT_R, "p": SCRYPT_P,
            "salt": base64.b64encode(salt).decode("ascii"),
            "hash": base64.b64encode(digest).decode("ascii")}


def verify(record: Optional[dict], password: str) -> bool:
    if not record or len(password) > MAX_PASSWORD:
        return False
    try:
        salt = base64.b64decode(record["salt"])
        expected = base64.b64decode(record["hash"])
        digest = _scrypt(password, salt, int(record["n"]), int(record["r"]), int(record["p"]))
    except (KeyError, TypeError, ValueError):
        return False
    return hmac.compare_digest(digest, expected)


def enabled() -> bool:
    return bool(RUNTIME.app_lock)


def is_unlocked(request: Request) -> bool:
    if not enabled():
        return True
    token = request.cookies.get(COOKIE_NAME)
    return bool(token) and token in RUNTIME.app_lock_tokens


def grant(response: Response, secure: bool) -> None:
    """Unlock the requesting client (session cookie, gone on restart)."""
    token = secrets.token_urlsafe(32)
    RUNTIME.app_lock_tokens.add(token)
    response.set_cookie(key=COOKIE_NAME, value=token, httponly=True,
                        samesite="strict", secure=secure, path="/")


def revoke(request: Request, response: Response, secure: bool) -> None:
    RUNTIME.app_lock_tokens.discard(request.cookies.get(COOKIE_NAME) or "")
    response.delete_cookie(key=COOKIE_NAME, path="/", samesite="strict", secure=secure)
