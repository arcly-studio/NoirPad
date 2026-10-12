"""Per-note encryption endpoints.

The password is sent once: to lock (/api/encrypt) or unlock (/api/unlock).
The server derives the key, keeps it in memory and hands back a short-lived
unlock token for that one note. Autosave sends the token, never the
password. /api/lock, /api/lock-all, idle expiry and process exit forget the
key. PBKDF2 runs outside the data-file lock.
"""

import os
import secrets
import time
from typing import Optional

from fastapi import APIRouter

from ..crypto import (MAX_NOTE_PASSWORD, MIN_NOTE_PASSWORD, InvalidToken, decrypt_content,
                      decrypt_with_key, derive_key, encrypt_with_key, is_encrypted_content,
                      unlock_content)
from ..errors import ApiError
from ..images import extract_image_names
from ..models import DecryptReq, LockReq, PasswordReq, SaveEncryptedReq
from ..runtime import RUNTIME
from ..storage import read_data, update_data
from ..tree import note_exists

router = APIRouter()

UNLOCK_IDLE_TTL = 30 * 60        # forget a key after 30 min without use
UNLOCK_MAX_TTL = 12 * 60 * 60    # … and after 12 h no matter what


def _check_new_password(password: str) -> None:
    if len(password) < MIN_NOTE_PASSWORD:
        raise ApiError(400, "password_too_short", min=MIN_NOTE_PASSWORD)
    if len(password) > MAX_NOTE_PASSWORD:
        raise ApiError(400, "password_too_long")


def _expired(entry: dict, now: float) -> bool:
    return now - entry["used"] > UNLOCK_IDLE_TTL or now - entry["created"] > UNLOCK_MAX_TTL


def _remember_key(note_id: str, key: bytes, salt: bytes) -> str:
    now = time.time()
    for tok, entry in list(RUNTIME.unlocked.items()):
        if _expired(entry, now):
            RUNTIME.unlocked.pop(tok, None)
    token = secrets.token_urlsafe(32)
    RUNTIME.unlocked[token] = {"note_id": note_id, "key": key, "salt": salt,
                               "created": now, "used": now}
    return token


def _key_for(token: Optional[str], note_id: str) -> dict:
    entry = RUNTIME.unlocked.get(token or "")
    now = time.time()
    if entry is None or entry["note_id"] != note_id or _expired(entry, now):
        RUNTIME.unlocked.pop(token or "", None)
        raise ApiError(401, "note_locked")
    entry["used"] = now
    return entry


def _forget_note_keys(note_id: str) -> None:
    for tok, entry in list(RUNTIME.unlocked.items()):
        if entry["note_id"] == note_id:
            RUNTIME.unlocked.pop(tok, None)


def _stored_note(data: dict, note_id: str) -> str:
    content = data.get("notes", {}).get(note_id)
    if content is None or not note_exists(data, note_id):
        raise ApiError(404, "note_not_found")
    return content


@router.post("/api/encrypt")
async def encrypt_note(req: PasswordReq):
    """Lock a plain note. Returns an unlock token so it stays open."""
    _check_new_password(req.password)
    salt = os.urandom(16)
    key = derive_key(req.password, salt)

    def _mut(data: dict) -> None:
        content = _stored_note(data, req.id)
        if is_encrypted_content(content):
            raise ApiError(400, "note_already_encrypted")
        # Image names from the PLAINTEXT, so the trash cleanup still finds them.
        data.setdefault("note_images", {})[req.id] = extract_image_names(content)
        data["notes"][req.id] = encrypt_with_key(content, key, salt)

    update_data(_mut)
    return {"ok": True, "unlock_token": _remember_key(req.id, key, salt)}


@router.post("/api/unlock")
async def unlock_note(req: PasswordReq):
    """Check the password and return the plaintext + an unlock token.

    The file stays encrypted.
    """
    data = read_data()
    stored = _stored_note(data, req.id)
    try:
        text, key, salt = unlock_content(stored, req.password)
    except (InvalidToken, ValueError):
        raise ApiError(400, "wrong_password")
    return {
        "content": text,
        "formats": data.get("note_formats", {}).get(req.id, []),
        "mode": data.get("note_modes", {}).get(req.id, "rich-text"),
        "unlock_token": _remember_key(req.id, key, salt),
    }


@router.post("/api/save-encrypted")
async def save_encrypted(req: SaveEncryptedReq):
    """Autosave of an unlocked note: re-encrypt with the remembered key."""
    entry = _key_for(req.unlock_token, req.id)

    def _mut(data: dict) -> None:
        _stored_note(data, req.id)
        data.setdefault("note_images", {})[req.id] = extract_image_names(req.content)
        data["notes"][req.id] = encrypt_with_key(req.content, entry["key"], entry["salt"])
        if req.formats:
            data.setdefault("note_formats", {})[req.id] = req.formats

    update_data(_mut)
    if req.lock_after:
        RUNTIME.unlocked.pop(req.unlock_token, None)
    return {"ok": True}


@router.post("/api/decrypt")
async def decrypt_note(req: DecryptReq):
    """Remove encryption for good (unlock token, or the password)."""
    entry = _key_for(req.unlock_token, req.id) if req.unlock_token else None
    if entry is None and not req.password:
        raise ApiError(400, "password_required")
    stored_before = read_data().get("notes", {}).get(req.id)
    key = entry["key"] if entry else None
    if key is None and stored_before is not None:
        try:
            unlock_content(stored_before, req.password)   # KDF outside the lock
        except (InvalidToken, ValueError):
            raise ApiError(400, "wrong_password")

    def _mut(data: dict) -> None:
        stored = _stored_note(data, req.id)
        try:
            text = (decrypt_with_key(stored, key) if key is not None
                    else decrypt_content(stored, req.password))
        except (InvalidToken, ValueError):
            raise ApiError(400, "wrong_password")
        data["notes"][req.id] = text
        data.setdefault("note_images", {})[req.id] = extract_image_names(text)

    update_data(_mut)
    _forget_note_keys(req.id)
    return {"ok": True}


@router.post("/api/lock")
async def lock_note(req: LockReq):
    """Forget the key behind one unlock token (lock button, closing a tab)."""
    RUNTIME.unlocked.pop(req.unlock_token, None)
    return {"ok": True}


@router.post("/api/lock-all")
async def lock_all():
    """Forget every remembered key (auto-lock, leaving the page)."""
    RUNTIME.unlocked.clear()
    return {"ok": True}
