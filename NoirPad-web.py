"""
NoirPad Web — FastAPI backend.

One local profile per data directory (see get_data_dir). Run directly for
web/server mode, or through desktop.py for the native window.
"""

import base64
import copy
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import sys
import threading
import time
import uuid
import zipfile
# Fix #11: removed unused `import shutil` (the .bak copy below uses
# Path.read_bytes()/write_bytes() instead, so shutil is genuinely unused).
from pathlib import Path
from typing import Any, Callable, Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

log = logging.getLogger("noirpad")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
#
# Two separate roots:
#   * resource root — read-only frontend assets (static/, index.html, …).
#     In dev that's the project directory; in a PyInstaller bundle it's
#     sys._MEIPASS (the temp dir PyInstaller unpacks `--add-data` into).
#   * data root — writable user data (notes_data.json + backups + images/).
#     The NOIRPAD_DATA_DIR env var if set (tests, portable setups), else
#     the platformdirs user_data_dir, so `python NoirPad-web.py` (web mode)
#     and the bundled NoirPad.exe share the same notes.

BASE_DIR = Path(__file__).resolve().parent  # project root in dev / _MEIPASS in frozen


def _is_frozen() -> bool:
    """True when running inside a PyInstaller bundle."""
    return getattr(sys, "frozen", False)


def resource_path(rel: str) -> Path:
    """Resolve a path to a bundled READ-ONLY resource (frontend assets, etc.).

    Frozen: sys._MEIPASS / rel. Dev: BASE_DIR / rel. Callers should treat
    the result as read-only (no writes — _MEIPASS is wiped on exit).
    """
    if _is_frozen():
        base = Path(getattr(sys, "_MEIPASS", BASE_DIR))
        return base / rel
    return BASE_DIR / rel


def get_data_dir() -> Path:
    """Return the WRITABLE user-data directory (created on demand)."""
    override = os.environ.get("NOIRPAD_DATA_DIR")
    if override:
        path = Path(override)
    else:
        from platformdirs import user_data_dir
        path = Path(user_data_dir("NoirPad", appauthor=False))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _migrate_legacy_data_if_needed(target_dir: Path) -> None:
    """Seed an empty *target_dir* from a project-directory database, once.

    Very old builds kept notes_data.json + images/ next to the code. Only
    runs when the data dir has no notes_data.json yet; never overwrites.
    """
    target_data = target_dir / "notes_data.json"
    legacy_data = BASE_DIR / "notes_data.json"
    if target_data.exists() or not legacy_data.is_file():
        return
    if BASE_DIR.resolve() == target_dir.resolve():
        return
    try:
        target_data.write_bytes(legacy_data.read_bytes())
    except OSError as exc:
        log.error("Failed to migrate notes_data.json: %s", exc)
        return

    legacy_images = BASE_DIR / "images"
    target_images = target_dir / "images"
    if legacy_images.is_dir():
        target_images.mkdir(exist_ok=True)
        for src in legacy_images.iterdir():
            dst = target_images / src.name
            if not src.is_file() or dst.exists():
                continue
            try:
                dst.write_bytes(src.read_bytes())
            except OSError as exc:
                log.warning("Could not migrate image %s: %s", src.name, exc)

    log.warning(
        "Migrated legacy NoirPad data from %s -> %s", BASE_DIR, target_dir
    )


STATIC_DIR = resource_path("static")
# STATIC_DIR is read-only in frozen mode (lives under _MEIPASS); we only
# need it to exist when running in dev so a fresh checkout doesn't crash.
if not _is_frozen():
    STATIC_DIR.mkdir(exist_ok=True)

# Data paths are module globals so tests (and set_data_dir) can repoint
# them; every function reads them at call time.
DATA_DIR: Path
DATA_FILE: Path
DATA_BAK: Path
DATA_TMP: Path
IMAGES_DIR: Path
IMAGES_DIR_R: Path


def set_data_dir(path: Path) -> None:
    """Point the backend at *path* and run the one-time data migrations."""
    global DATA_DIR, DATA_FILE, DATA_BAK, DATA_TMP, IMAGES_DIR, IMAGES_DIR_R
    DATA_DIR = Path(path)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE = DATA_DIR / "notes_data.json"
    DATA_BAK = DATA_DIR / "notes_data.json.bak"
    DATA_TMP = DATA_DIR / "notes_data.json.tmp"
    IMAGES_DIR = DATA_DIR / "images"
    IMAGES_DIR.mkdir(exist_ok=True)
    IMAGES_DIR_R = IMAGES_DIR.resolve()
    _migrate_legacy_data_if_needed(DATA_DIR)
    _migrate_to_single_profile()


# Upload size limits (Fix #7).
MAX_IMAGE_BYTES = 10 * 1024 * 1024     # 10 MB
MAX_BACKUP_BYTES = 100 * 1024 * 1024   # 100 MB

# ---------------------------------------------------------------------------
# Thread-safe file I/O
# ---------------------------------------------------------------------------

_file_lock = threading.Lock()

DEFAULT_DATA: dict[str, Any] = {
    "tree": [],
    "notes": {},
    "favorites": [],
    "trash": {"tree": [], "notes": {}},
    "note_formats": {},
    # Fix #9: maps note_id -> [image filename, ...]. Lets us clean images of
    # encrypted notes (whose content can't be regex-parsed) from the trash.
    "note_images": {},
    # Per-note rendering mode. Absence == "rich-text" (default for legacy
    # notes); explicit "markdown" enables block-level MD syntax rendering.
    # Only non-default values are stored, keeping the data file small.
    "note_modes": {},
    "theme": "matrix",
    "ui_font": "orbitron",
    "font_family": "Cascadia Code",
    "font_size": 12,
    "autosave": False,
    "page_orientation": "landscape",
    # Settings v2 fields.
    "matrix_rain_enabled": True,
    "show_splash": True,
    "autosave_interval": 5,
    "spellcheck": True,
    "glitch_effect": True,
    "confirm_delete": True,
    "show_shortcut_hints": True,
    "idle_lock_minutes": "off",
    "default_encrypted": False,
    "glow_intensity": 100,  # 0-150 percent
    "custom_shortcuts": {},  # id -> "Ctrl+Shift+X" (only non-default)
}


def _read_data_unlocked() -> dict[str, Any]:
    """Read notes_data.json WITHOUT taking the lock (caller must hold it)."""
    if not DATA_FILE.exists():
        return copy.deepcopy(DEFAULT_DATA)
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        # Fix #8: corrupt JSON must not 500 every request. Try the .bak
        # snapshot, otherwise fall back to a fresh default structure.
        if DATA_BAK.exists():
            try:
                with open(DATA_BAK, "r", encoding="utf-8") as f:
                    data = json.load(f)
                log.warning(
                    "notes_data.json was corrupt; recovered from %s", DATA_BAK.name
                )
                return data
            except json.JSONDecodeError:
                log.warning("notes_data.json AND %s are corrupt", DATA_BAK.name)
        else:
            log.warning(
                "notes_data.json is corrupt and no backup exists; "
                "starting from DEFAULT_DATA"
            )
        return copy.deepcopy(DEFAULT_DATA)


def _write_data_unlocked(data: dict[str, Any]) -> None:
    """Write notes_data.json WITHOUT taking the lock (caller must hold it).

    Fix #8: snapshot the previous good file to .bak, then write atomically
    via a temp file + os.replace so a crash mid-write can't corrupt data.
    """
    if DATA_FILE.exists():
        try:
            DATA_BAK.write_bytes(DATA_FILE.read_bytes())
        except OSError as exc:
            log.warning("Could not write backup %s: %s", DATA_BAK.name, exc)
    with open(DATA_TMP, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(DATA_TMP, DATA_FILE)


def _read_data() -> dict[str, Any]:
    """Locked read — for read-only endpoints."""
    with _file_lock:
        return _read_data_unlocked()


def _write_data(data: dict[str, Any]) -> None:
    """Locked write — kept as a standalone utility."""
    with _file_lock:
        _write_data_unlocked(data)


def _update_data(mutator: Callable[[dict[str, Any]], Any]) -> Any:
    """Fix #6: hold the lock across the WHOLE read-modify-write sequence.

    `mutator(data)` mutates `data` in place and may return a value that is
    forwarded to the caller. If the mutator raises (e.g. HTTPException for a
    validation failure), the lock is released by the `with` block and NO
    write happens, so the file is left untouched.

    Note: `_file_lock` is a plain Lock, so the mutator and the helpers used
    here must use the *_unlocked variants to avoid self-deadlock.
    """
    with _file_lock:
        data = _read_data_unlocked()
        result = mutator(data)
        _write_data_unlocked(data)
    return result


def _data_mtime() -> float:
    """Return mtime of notes_data.json (0 if missing)."""
    with _file_lock:
        if DATA_FILE.exists():
            return DATA_FILE.stat().st_mtime
        return 0.0


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def find_item_by_id(tree: list[dict], item_id: str) -> Optional[dict]:
    """Recursively search *tree* for an item with the given id."""
    for item in tree:
        if item["id"] == item_id:
            return item
        children = item.get("children")
        if children:
            found = find_item_by_id(children, item_id)
            if found is not None:
                return found
    return None


def find_parent_list(tree: list[dict], item_id: str) -> Optional[list[dict]]:
    """Return the list that directly contains the item with *item_id*."""
    for item in tree:
        if item["id"] == item_id:
            return tree
        children = item.get("children")
        if children:
            found = find_parent_list(children, item_id)
            if found is not None:
                return found
    return None


def collect_note_ids(item: dict) -> list[str]:
    """Return all note IDs under *item* (including itself if it is a note)."""
    ids: list[str] = []
    if item.get("type") == "note":
        ids.append(item["id"])
    for child in item.get("children", []):
        ids.extend(collect_note_ids(child))
    return ids


def collect_all_ids(item: dict) -> list[str]:
    """Fix #10: return *every* id under *item* (folders AND notes,
    including *item* itself) — used for the cycle check in move_item."""
    ids: list[str] = [item["id"]]
    for child in item.get("children", []):
        ids.extend(collect_all_ids(child))
    return ids


# Fix #9: shared image-marker regex (web `<<IMG:name>>`, legacy desktop
# `\x00IMG:name\x00`). Only matches PLAINTEXT content.
_IMG_RE = re.compile(r"<<IMG:([^>\x00]+)>>|\x00IMG:([^\x00]+)\x00")


def _extract_image_names(content: Optional[str]) -> list[str]:
    """Return image filenames referenced in *plaintext* note content."""
    out: list[str] = []
    if not content:
        return out
    for m in _IMG_RE.finditer(content):
        fname = m.group(1) or m.group(2)
        if fname:
            out.append(fname)
    return out


def _safe_image_path(filename: str) -> Optional[Path]:
    """Resolve *filename* inside IMAGES_DIR. Return the resolved path, or
    None if it would escape IMAGES_DIR (Fix #1 / Fix #2 building block)."""
    candidate = (IMAGES_DIR / filename).resolve()
    if not candidate.is_relative_to(IMAGES_DIR_R):
        return None
    return candidate


def _delete_images(filenames) -> None:
    """Delete the given image files, ignoring anything outside IMAGES_DIR."""
    for fname in set(filenames):
        path = _safe_image_path(fname)
        if path is not None and path.is_file():
            try:
                path.unlink()
            except OSError as exc:
                log.warning("Could not delete image %s: %s", fname, exc)


def move_to_trash(data: dict, item_id: str) -> None:
    """Move an item (and its notes) from the active tree into trash."""
    parent_list = find_parent_list(data["tree"], item_id)
    if parent_list is None:
        raise ValueError("Item not found in tree")
    item = next(i for i in parent_list if i["id"] == item_id)
    parent_list.remove(item)

    # Collect note contents & formats to move
    note_ids = collect_note_ids(item)
    trash_notes: dict[str, str] = {}
    for nid in note_ids:
        if nid in data.get("notes", {}):
            trash_notes[nid] = data["notes"].pop(nid)

    data.setdefault("trash", {"tree": [], "notes": {}})
    data["trash"]["tree"].append(item)
    data["trash"]["notes"].update(trash_notes)

    # Remove from favorites
    favs: list[str] = data.get("favorites", [])
    for nid in note_ids:
        if nid in favs:
            favs.remove(nid)

    # Move formats to a trash sub-key (preserve for restore)
    for nid in note_ids:
        fmt = data.get("note_formats", {}).pop(nid, None)
        if fmt is not None:
            data["trash"].setdefault("note_formats", {})[nid] = fmt


def restore_from_trash(data: dict, item_id: str) -> None:
    """Restore an item from trash back to the root of the active tree."""
    trash_tree: list[dict] = data.get("trash", {}).get("tree", [])
    parent_list = find_parent_list(trash_tree, item_id)
    if parent_list is None:
        raise ValueError("Item not found in trash")
    item = next(i for i in parent_list if i["id"] == item_id)
    parent_list.remove(item)

    note_ids = collect_note_ids(item)
    trash_notes: dict[str, str] = data.get("trash", {}).get("notes", {})
    for nid in note_ids:
        if nid in trash_notes:
            data.setdefault("notes", {})[nid] = trash_notes.pop(nid)

    # Restore formats
    trash_formats: dict = data.get("trash", {}).get("note_formats", {})
    for nid in note_ids:
        fmt = trash_formats.pop(nid, None)
        if fmt is not None:
            data.setdefault("note_formats", {})[nid] = fmt

    data["tree"].append(item)


# ---------------------------------------------------------------------------
# Encryption helpers
# ---------------------------------------------------------------------------


def encrypt_content(content: str, password: str) -> str:
    """Encrypt using the same format as desktop app: version(1) + salt(16) + fernet_data."""
    salt = os.urandom(16)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(), length=32, salt=salt, iterations=480000
    )
    key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
    f = Fernet(key)
    encrypted = f.encrypt(content.encode("utf-8"))

    # Combine: version byte 0x01 + salt + encrypted
    combined = b'\x01' + salt + encrypted
    data_b64 = base64.b64encode(combined).decode("ascii")
    return json.dumps({"encrypted": True, "data": data_b64})


def decrypt_content(stored: str, password: str) -> str:
    """Decrypt using the same format as desktop app.

    Raises ValueError for structurally-bad / not-encrypted / unknown-version
    input, and cryptography's InvalidToken for a wrong password. Both are
    treated as a 400 by the callers (Fix #5).
    """
    obj = json.loads(stored)  # json.JSONDecodeError is a subclass of ValueError
    if not obj.get("encrypted"):
        raise ValueError("Content is not encrypted")
    combined = base64.b64decode(obj["data"])
    version = combined[0]
    salt = combined[1:17]
    encrypted = combined[17:]

    if version == 1:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(), length=32, salt=salt, iterations=480000
        )
        key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
        f = Fernet(key)
        return f.decrypt(encrypted).decode("utf-8")
    elif version == 2:
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
        decrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(encrypted))
        return decrypted.decode("utf-8")
    else:
        raise ValueError("Unknown encryption version")


# ---------------------------------------------------------------------------
# Single local profile
# ---------------------------------------------------------------------------
#
# NoirPad has one profile per data directory. Data written by the old
# multi-user build (top-level `users`/`sessions`, `user_id` on every tree
# item) is flattened once at startup by `_migrate_to_single_profile`.


def _strip_user_ids(items: list) -> list:
    """Remove legacy `user_id` stamps from *items* (recursively, in place)."""
    for item in items:
        item.pop("user_id", None)
        children = item.get("children")
        if children:
            _strip_user_ids(children)
    return items


def _has_user_ids(items: list) -> bool:
    for item in items:
        if "user_id" in item or _has_user_ids(item.get("children") or []):
            return True
    return False


def _migrate_to_single_profile() -> None:
    """Flatten a legacy multi-user notes_data.json into the single profile.

    Every account's notes end up in the one tree (they already share it;
    only the `user_id` stamps differ). The original file is kept as
    `notes_data.pre-single-profile-<timestamp>.json` next to it.
    """
    with _file_lock:
        if not DATA_FILE.exists():
            return
        try:
            data = _read_data_unlocked()
        except Exception:  # unreadable file is handled by the normal read path
            return
        legacy = (
            "users" in data
            or "sessions" in data
            or _has_user_ids(data.get("tree") or [])
            or _has_user_ids((data.get("trash") or {}).get("tree") or [])
        )
        if not legacy:
            return
        stamp = time.strftime("%Y%m%d-%H%M%S")
        snapshot = DATA_FILE.with_name(f"notes_data.pre-single-profile-{stamp}.json")
        snapshot.write_bytes(DATA_FILE.read_bytes())
        data.pop("users", None)
        data.pop("sessions", None)
        _strip_user_ids(data.get("tree") or [])
        _strip_user_ids((data.get("trash") or {}).get("tree") or [])
        _write_data_unlocked(data)
        log.warning("Converted multi-user data to a single profile (snapshot: %s)",
                    snapshot.name)


def _note_exists(data: dict, note_id: str) -> bool:
    """True if *note_id* is a note in the tree or in the trash."""
    for root in (data.get("tree") or [], (data.get("trash") or {}).get("tree") or []):
        item = find_item_by_id(root, note_id)
        if item is not None and item.get("type") == "note":
            return True
    return False


set_data_dir(get_data_dir())


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------
#
# Two run modes:
#   * "server"  — `python NoirPad-web.py`. Optional password from the
#                 NOIRPAD_PASSWORD env var; required when binding to
#                 anything but loopback. Sessions live in memory only.
#   * "desktop" — desktop.py; see `configure()`.

SESSION_COOKIE_NAME = "noirpad_session"
SESSION_TTL_REMEMBER = 30 * 24 * 60 * 60  # 30 days
SESSION_TTL_SHORT = 12 * 60 * 60          # 12 hours

_secure_override = os.environ.get("NOIRPAD_SECURE_COOKIES")
SESSION_COOKIE_SECURE = (_secure_override or "").lower() in ("1", "true", "yes", "on")

LOGIN_MAX_FAILURES = 10      # per LOGIN_WINDOW seconds, across all clients
LOGIN_WINDOW = 60


class _Runtime:
    mode: str = "server"
    password: Optional[str] = os.environ.get("NOIRPAD_PASSWORD") or None
    sessions: dict[str, float] = {}       # token -> expires_at (epoch secs)
    login_failures: list[float] = []


RUNTIME = _Runtime()


def configure(*, mode: Optional[str] = None, password: Any = ...) -> None:
    """Set the run mode / server password (used by desktop.py and tests)."""
    if mode is not None:
        RUNTIME.mode = mode
    if password is not ...:
        RUNTIME.password = password or None
    RUNTIME.sessions.clear()
    RUNTIME.login_failures.clear()


def _password_matches(candidate: str) -> bool:
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


def _is_authenticated(request) -> bool:
    if RUNTIME.mode == "server" and RUNTIME.password:
        return _session_valid(request.cookies.get(SESSION_COOKIE_NAME))
    return True


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------


class NewItemReq(BaseModel):
    parent_id: Optional[str] = None
    name: str


class RenameReq(BaseModel):
    id: str
    name: str


class MoveReq(BaseModel):
    id: str
    target_id: str
    position: str  # "before" | "after" | "inside"


class DeleteReq(BaseModel):
    id: str


class NoteBody(BaseModel):
    content: str
    formats: list[Any] = []
    # Optional per-note rendering mode. None means "leave unchanged"; pass
    # "rich-text" to clear back to default, "markdown" to opt in.
    mode: Optional[str] = None


class ToggleFavReq(BaseModel):
    id: str


class TagsBody(BaseModel):
    tags: list[str]


class RestoreReq(BaseModel):
    id: str


class SettingsBody(BaseModel):
    theme: Optional[str] = None
    ui_font: Optional[str] = None
    font_family: Optional[str] = None
    font_size: Optional[int] = None
    autosave: Optional[bool] = None
    page_orientation: Optional[str] = None
    # Settings v2 fields.
    matrix_rain_enabled: Optional[bool] = None
    show_splash: Optional[bool] = None
    autosave_interval: Optional[int] = None
    spellcheck: Optional[bool] = None
    glitch_effect: Optional[bool] = None
    confirm_delete: Optional[bool] = None
    show_shortcut_hints: Optional[bool] = None
    idle_lock_minutes: Optional[str] = None
    default_encrypted: Optional[bool] = None
    glow_intensity: Optional[int] = None
    custom_shortcuts: Optional[dict] = None


class CryptoReq(BaseModel):
    id: str
    password: str


class SaveEncryptedReq(BaseModel):
    id: str
    password: str
    content: str
    formats: list[Any] = []


class LoginReq(BaseModel):
    password: str
    remember: bool = True


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="NoirPad Web", version="1.0.0")

# Same-origin app, but the frontend now sends a session cookie — so we
# must allow credentials. Origins stay locked to loopback to keep this a
# local desktop-style app (the cookie is HttpOnly so it can't be exfiltrated
# from JS even if a stray browser extension MITMs the page).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files (CSS, JS, assets)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.middleware("http")
async def _no_cache(request, call_next):
    """Local dev tool: never let the browser cache assets, so edits to
    JS/CSS/HTML always show up on a normal reload."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


async def _read_upload_limited(file: UploadFile, max_bytes: int) -> bytes:
    """Fix #7: read an upload in chunks and abort with HTTP 413 once it
    exceeds *max_bytes*, instead of buffering an unbounded body in memory."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                413, f"File too large (max {max_bytes // (1024 * 1024)} MB)"
            )
        chunks.append(chunk)
    return b"".join(chunks)


# ---------------------------------------------------------------------------
# Access guard
# ---------------------------------------------------------------------------

# Endpoints reachable before login (server mode with a password).
_PUBLIC_API = {("GET", "/api/session"), ("POST", "/api/login"), ("POST", "/api/logout")}


@app.middleware("http")
async def _access_guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") or path.startswith("/images/"):
        if (request.method, path) not in _PUBLIC_API and not _is_authenticated(request):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    return await call_next(request)


def _set_session_cookie(response: Response, token: str, remember: bool) -> None:
    max_age = SESSION_TTL_REMEMBER if remember else None  # None = session cookie
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=True,
        samesite="strict",
        secure=SESSION_COOKIE_SECURE,
        path="/",
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
async def root():
    index = STATIC_DIR / "index.html"
    if not index.exists():
        raise HTTPException(404, "index.html not found in static/")
    return index.read_text(encoding="utf-8")


# ---- Session (server mode password) ----


@app.get("/api/session")
async def session_info(request: Request):
    password_required = RUNTIME.mode == "server" and bool(RUNTIME.password)
    return {
        "mode": RUNTIME.mode,
        "password_required": password_required,
        "authenticated": _is_authenticated(request),
    }


@app.post("/api/login")
async def login(req: LoginReq, response: Response):
    if not (RUNTIME.mode == "server" and RUNTIME.password):
        return {"ok": True}
    now = time.time()
    RUNTIME.login_failures[:] = [t for t in RUNTIME.login_failures if t > now - LOGIN_WINDOW]
    if len(RUNTIME.login_failures) >= LOGIN_MAX_FAILURES:
        raise HTTPException(429, "Too many attempts, try again in a minute")
    if len(req.password) > 1024 or not _password_matches(req.password):
        RUNTIME.login_failures.append(now)
        raise HTTPException(401, "Wrong password")
    token = secrets.token_urlsafe(32)
    ttl = SESSION_TTL_REMEMBER if req.remember else SESSION_TTL_SHORT
    RUNTIME.sessions[token] = now + ttl
    _set_session_cookie(response, token, remember=req.remember)
    return {"ok": True}


@app.post("/api/logout")
async def logout(request: Request, response: Response):
    RUNTIME.sessions.pop(request.cookies.get(SESSION_COOKIE_NAME) or "", None)
    response.delete_cookie(
        key=SESSION_COOKIE_NAME, path="/", samesite="strict", secure=SESSION_COOKIE_SECURE
    )
    return {"ok": True}


# ---- Data ----


@app.get("/api/data")
async def get_data():
    return _read_data()


@app.get("/api/data/version")
async def get_data_version():
    return {"version": _data_mtime()}


@app.get("/api/storage")
async def get_storage():
    """On-disk size of notes_data.json and the images folder."""
    notes_size = DATA_FILE.stat().st_size if DATA_FILE.exists() else 0

    images_size = 0
    if IMAGES_DIR.exists():
        for f in IMAGES_DIR.rglob("*"):
            if f.is_file():
                try:
                    images_size += f.stat().st_size
                except OSError:
                    pass

    return {
        "notes_size": notes_size,
        "images_size": images_size,
        "total_size": notes_size + images_size,
    }


# ---- Tree ----


@app.post("/api/tree/new-note")
async def new_note(req: NewItemReq):
    note_id = str(uuid.uuid4())
    item = {"id": note_id, "name": req.name, "type": "note"}

    def _mut(data: dict) -> None:
        if req.parent_id:
            parent = find_item_by_id(data["tree"], req.parent_id)
            if parent is None or parent.get("type") != "folder":
                raise HTTPException(400, "Parent folder not found")
            parent.setdefault("children", []).append(item)
        else:
            data["tree"].append(item)
        data.setdefault("notes", {})[note_id] = ""

    _update_data(_mut)  # Fix #6
    return {"id": note_id, "item": item}


@app.post("/api/tree/new-folder")
async def new_folder(req: NewItemReq):
    folder_id = str(uuid.uuid4())
    item = {
        "id": folder_id, "name": req.name, "type": "folder",
        "children": [],
    }

    def _mut(data: dict) -> None:
        if req.parent_id:
            parent = find_item_by_id(data["tree"], req.parent_id)
            if parent is None or parent.get("type") != "folder":
                raise HTTPException(400, "Parent folder not found")
            parent.setdefault("children", []).append(item)
        else:
            data["tree"].append(item)

    _update_data(_mut)  # Fix #6
    return {"id": folder_id, "item": item}


@app.post("/api/tree/rename")
async def rename_item(req: RenameReq):
    def _mut(data: dict) -> None:
        item = find_item_by_id(data["tree"], req.id)
        if item is None:
            raise HTTPException(404, "Item not found")
        item["name"] = req.name

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/tree/move")
async def move_item(req: MoveReq):
    def _mut(data: dict) -> None:
        source_list = find_parent_list(data["tree"], req.id)
        if source_list is None:
            raise HTTPException(404, "Source item not found")
        item = next(i for i in source_list if i["id"] == req.id)

        # Fix #10: refuse to move an item into itself or its own subtree
        # (would detach the whole branch from the tree). collect_all_ids
        # includes `item` itself, so target == id is covered too.
        if req.target_id in set(collect_all_ids(item)):
            raise HTTPException(
                400, "Cannot move an item into itself or its own subtree"
            )

        source_list.remove(item)

        if req.position == "inside":
            target = find_item_by_id(data["tree"], req.target_id)
            if target is None or target.get("type") != "folder":
                raise HTTPException(400, "Target folder not found")
            target.setdefault("children", []).append(item)
        else:
            target_list = find_parent_list(data["tree"], req.target_id)
            if target_list is None:
                raise HTTPException(404, "Target item not found")
            idx = next(
                i for i, x in enumerate(target_list) if x["id"] == req.target_id
            )
            if req.position == "after":
                idx += 1
            target_list.insert(idx, item)

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/tree/delete")
async def delete_item(req: DeleteReq):
    def _mut(data: dict) -> None:
        item = find_item_by_id(data["tree"], req.id)
        if item is None:
            raise HTTPException(404, "Item not found")
        try:
            move_to_trash(data, req.id)
        except ValueError:
            raise HTTPException(404, "Item not found")

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Notes ----


@app.get("/api/note/{note_id}")
async def get_note(note_id: str):
    data = _read_data()
    if not _note_exists(data, note_id):
        raise HTTPException(404, "Note not found")
    content = data.get("notes", {}).get(note_id)
    if content is None:
        raise HTTPException(404, "Note not found")
    formats = data.get("note_formats", {}).get(note_id, [])
    mode = data.get("note_modes", {}).get(note_id, "rich-text")
    return {"content": content, "formats": formats, "mode": mode}


@app.put("/api/note/{note_id}")
async def put_note(
    note_id: str, body: NoteBody
):
    def _mut(data: dict) -> None:
        if not _note_exists(data, note_id):
            raise HTTPException(404, "Note not found")
        data.setdefault("notes", {})[note_id] = body.content
        if body.formats:
            data.setdefault("note_formats", {})[note_id] = body.formats
        else:
            data.get("note_formats", {}).pop(note_id, None)
        # Per-note mode: only persist non-default ("markdown"); "rich-text"
        # clears the entry so the dict stays minimal.
        if body.mode is not None:
            if body.mode == "markdown":
                data.setdefault("note_modes", {})[note_id] = "markdown"
            else:
                data.get("note_modes", {}).pop(note_id, None)
        # Fix #9: keep the image map in sync for plaintext saves.
        data.setdefault("note_images", {})[note_id] = _extract_image_names(
            body.content
        )

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Favorites ----


@app.post("/api/favorites/toggle")
async def toggle_favorite(
    req: ToggleFavReq
):
    def _mut(data: dict) -> bool:
        if not _note_exists(data, req.id):
            raise HTTPException(404, "Note not found")
        favs: list[str] = data.setdefault("favorites", [])
        if req.id in favs:
            favs.remove(req.id)
            return False
        favs.append(req.id)
        return True

    state = _update_data(_mut)  # Fix #6
    return {"favorite": state}


# ---- Tags ----


@app.get("/api/tags")
async def list_tags():
    data = _read_data()
    tags: set = set()

    def _walk(items: list) -> None:
        for item in items:
            for t in item.get("tags", []):
                tags.add(t)
            _walk(item.get("children") or [])

    _walk(data.get("tree") or [])
    _walk(data.get("trash", {}).get("tree") or [])
    return {"tags": sorted(tags)}


@app.put("/api/tags/{item_id}")
async def set_tags(
    item_id: str, body: TagsBody
):
    def _mut(data: dict) -> None:
        item = find_item_by_id(data["tree"], item_id)
        if item is None:
            raise HTTPException(404, "Item not found")
        item["tags"] = body.tags

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Trash ----


@app.get("/api/trash")
async def get_trash():
    trash = _read_data().get("trash") or {}
    return {"tree": trash.get("tree") or [], "notes": trash.get("notes") or {}}


@app.post("/api/trash/restore")
async def trash_restore(req: RestoreReq):
    def _mut(data: dict) -> None:
        trash_tree = data.get("trash", {}).get("tree") or []
        item = find_item_by_id(trash_tree, req.id)
        if item is None:
            raise HTTPException(404, "Item not found in trash")
        try:
            restore_from_trash(data, req.id)
        except ValueError:
            raise HTTPException(404, "Item not found in trash")

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/trash/empty")
async def trash_empty():
    def _mut(data: dict) -> None:
        trash = data.setdefault("trash", {"tree": [], "notes": {}})
        note_images: dict = data.get("note_images", {})

        trashed_ids: set[str] = set()
        for root_item in trash.get("tree") or []:
            trashed_ids.update(collect_note_ids(root_item))

        to_delete: set[str] = set()
        for nid in trashed_ids:
            to_delete.update(note_images.get(nid, []))
            content = trash.get("notes", {}).get(nid)
            if content is not None:
                to_delete.update(_extract_image_names(content))
        _delete_images(to_delete)

        for nid in trashed_ids:
            trash.get("notes", {}).pop(nid, None)
            trash.get("note_formats", {}).pop(nid, None)
            note_images.pop(nid, None)

        trash["tree"] = []

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/trash/delete")
async def trash_delete_item(
    req: RestoreReq
):
    """Permanently delete a single item from trash."""
    def _mut(data: dict) -> None:
        trash = data.get("trash", {"tree": [], "notes": {}})
        parent_list = find_parent_list(trash["tree"], req.id)
        if parent_list is None:
            raise HTTPException(404, "Item not found in trash")
        idx = None
        for i, item in enumerate(parent_list):
            if item["id"] == req.id:
                idx = i
                break
        if idx is None:
            raise HTTPException(404, "Item not found in trash")
        item = parent_list.pop(idx)

        note_ids = collect_note_ids(item)
        note_images: dict = data.get("note_images", {})

        # Fix #9: same leak applies when permanently deleting a single item —
        # use the tracked map (encrypted) + regex (plaintext) before dropping.
        to_delete: set[str] = set()
        for nid in note_ids:
            to_delete.update(note_images.get(nid, []))
            content = trash.get("notes", {}).get(nid)
            to_delete.update(_extract_image_names(content))
        _delete_images(to_delete)

        for nid in note_ids:
            trash.get("notes", {}).pop(nid, None)
            note_images.pop(nid, None)
        data["trash"] = trash

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Settings ----


_SETTINGS_FIELDS: tuple[str, ...] = (
    "theme",
    "ui_font",
    "font_family",
    "font_size",
    "autosave",
    "page_orientation",
    "matrix_rain_enabled",
    "show_splash",
    "autosave_interval",
    "spellcheck",
    "glitch_effect",
    "confirm_delete",
    "show_shortcut_hints",
    "idle_lock_minutes",
    "default_encrypted",
    "glow_intensity",
    "custom_shortcuts",
)


@app.put("/api/settings")
async def update_settings(
    body: SettingsBody
):
    def _mut(data: dict) -> None:
        for field in _SETTINGS_FIELDS:
            value = getattr(body, field)
            if value is not None:
                data[field] = value

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/settings/reset")
async def reset_settings():
    """Restore every settings field to its DEFAULT_DATA value.

    Touches only the keys listed in _SETTINGS_FIELDS — user content (notes,
    folders, trash, tabs, favorites, note_images) is left untouched.
    """
    def _mut(data: dict) -> None:
        for field in _SETTINGS_FIELDS:
            if field in DEFAULT_DATA:
                data[field] = copy.deepcopy(DEFAULT_DATA[field])

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Encryption ----


@app.post("/api/encrypt")
async def encrypt_note(req: CryptoReq):
    def _mut(data: dict) -> None:
        if not _note_exists(data, req.id):
            raise HTTPException(404, "Note not found")
        content = data.get("notes", {}).get(req.id)
        if content is None:
            raise HTTPException(404, "Note not found")
        # Prevent double-encryption
        try:
            obj = json.loads(content)
            if isinstance(obj, dict) and obj.get("encrypted"):
                raise HTTPException(400, "Note is already encrypted")
        except (json.JSONDecodeError, TypeError):
            pass
        # Fix #9: capture image filenames from the PLAINTEXT before it is
        # encrypted, so the trash cleanup can still find them later.
        data.setdefault("note_images", {})[req.id] = _extract_image_names(content)
        data["notes"][req.id] = encrypt_content(content, req.password)

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/decrypt")
async def decrypt_note(req: CryptoReq):
    def _mut(data: dict) -> None:
        if not _note_exists(data, req.id):
            raise HTTPException(404, "Note not found")
        content = data.get("notes", {}).get(req.id)
        if content is None:
            raise HTTPException(404, "Note not found")
        try:
            decrypted = decrypt_content(content, req.password)
        except (InvalidToken, ValueError):
            # Fix #5: only swallow the *expected* failures (wrong password /
            # not-encrypted / unknown version / bad JSON|base64). Any other
            # exception is a real bug and is allowed to propagate as a 500.
            raise HTTPException(
                400, "Wrong password or content is not encrypted"
            )
        data["notes"][req.id] = decrypted
        # Content is plaintext again — refresh the tracked image list.
        data.setdefault("note_images", {})[req.id] = _extract_image_names(
            decrypted
        )

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/decrypt-view")
async def decrypt_view(req: CryptoReq):
    """Decrypt note content in memory and return it WITHOUT modifying the file."""
    data = _read_data()
    if not _note_exists(data, req.id):
        raise HTTPException(404, "Note not found")
    content = data.get("notes", {}).get(req.id)
    if content is None:
        raise HTTPException(404, "Note not found")
    try:
        decrypted = decrypt_content(content, req.password)
    except (InvalidToken, ValueError):  # Fix #5
        raise HTTPException(400, "Wrong password")
    formats = data.get("note_formats", {}).get(req.id, [])
    mode = data.get("note_modes", {}).get(req.id, "rich-text")
    return {"content": decrypted, "formats": formats, "mode": mode}


@app.post("/api/save-encrypted")
async def save_encrypted(
    req: SaveEncryptedReq
):
    """Save note content by re-encrypting it with the given password."""
    def _mut(data: dict) -> None:
        if not _note_exists(data, req.id):
            raise HTTPException(404, "Note not found")
        # Fix #9: track images referenced in the plaintext before encrypting.
        data.setdefault("note_images", {})[req.id] = _extract_image_names(
            req.content
        )
        data.setdefault("notes", {})[req.id] = encrypt_content(
            req.content, req.password
        )
        if req.formats:
            data.setdefault("note_formats", {})[req.id] = req.formats

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Images ----


@app.post("/api/images/upload")
async def upload_image(file: UploadFile = File(...)):
    contents = await _read_upload_limited(file, MAX_IMAGE_BYTES)  # Fix #7
    ext = Path(file.filename or "img.png").suffix or ".png"
    name = f"{uuid.uuid4()}{ext}"
    # uuid + ext is generated server-side, but resolve-check anyway in case
    # `ext` ever carries a separator (Fix #1 defense-in-depth).
    dest = _safe_image_path(name)
    if dest is None:
        raise HTTPException(400, "Invalid filename")
    with _file_lock:
        with open(dest, "wb") as f:
            f.write(contents)
    return {"filename": name, "url": f"/images/{name}"}


@app.get("/images/{filename:path}")
async def get_image(filename: str):
    # Fix #1: a request like `..%2F..%2Fnotes_data.json` must not escape
    # IMAGES_DIR. The `:path` converter lets the traversal string reach this
    # handler (instead of a generic 404 from the router) so the guard below
    # can resolve the final path and return a deterministic 400.
    #
    # Image filenames are random UUIDs and aren't tracked per-user in this
    # phase (they're addressed only by uuid in the note content); requiring
    # auth here is the minimal protection — blocks anonymous scraping.
    path = _safe_image_path(filename)
    if path is None:
        raise HTTPException(400, "Invalid filename")
    if not path.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(path)


# ---- Export ----


@app.get("/api/export/{note_id}/txt")
async def export_txt(note_id: str):
    data = _read_data()
    if not _note_exists(data, note_id):
        raise HTTPException(404, "Note not found")
    content = data.get("notes", {}).get(note_id)
    if content is None:
        raise HTTPException(404, "Note not found")
    item = find_item_by_id(data["tree"], note_id)
    name = item["name"] if item else note_id
    buf = io.BytesIO(content.encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}.txt"'},
    )


@app.get("/api/export/{note_id}/html")
async def export_html(note_id: str):
    data = _read_data()
    if not _note_exists(data, note_id):
        raise HTTPException(404, "Note not found")
    content = data.get("notes", {}).get(note_id)
    if content is None:
        raise HTTPException(404, "Note not found")
    item = find_item_by_id(data["tree"], note_id)
    name = item["name"] if item else note_id

    # Build a simple HTML document
    font = data.get("font_family", "Cascadia Code")
    size = data.get("font_size", 12)

    # Escape HTML entities
    escaped = (
        content.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br>\n")
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{name}</title>
<style>
  body {{
    background: #0a0a0a;
    color: #00ff00;
    font-family: '{font}', monospace;
    font-size: {size}px;
    padding: 2rem;
    white-space: pre-wrap;
  }}
</style>
</head>
<body>
{escaped}
</body>
</html>"""

    buf = io.BytesIO(html.encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}.html"'},
    )


def _safe_filename(name: str) -> str:
    """Strip filesystem-unsafe chars from *name* for use as a zip entry name.

    Same character set rejected by Windows + control bytes. Leading/trailing
    dots and spaces are stripped (Windows treats `..` and trailing dots
    specially). Capped at 200 chars to leave headroom under typical zip /
    filesystem path limits. Empty result falls back to 'untitled'.
    """
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name or "untitled")
    cleaned = cleaned.strip(" .")
    return cleaned[:200] or "untitled"


def _is_encrypted_content(content: str) -> bool:
    """True if *content* is a NoirPad encryption envelope ({"encrypted":true})."""
    try:
        obj = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return False
    return isinstance(obj, dict) and obj.get("encrypted") is True


def _build_note_html(name: str, content: str, font: str, size: int) -> str:
    """Render a single note as a standalone HTML5 document.

    Identical visual treatment to the per-note `/api/export/{id}/html`
    endpoint so users get a consistent look between single-note and
    bulk export. Body uses white-space:pre-wrap so the plaintext lines
    survive as-is without needing <br> substitution.
    """
    escaped_name = (
        name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )
    escaped_body = (
        content.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br>\n")
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{escaped_name}</title>
<style>
  body {{
    background: #0a0a0a;
    color: #00ff00;
    font-family: '{font}', monospace;
    font-size: {size}px;
    padding: 2rem;
    white-space: pre-wrap;
  }}
</style>
</head>
<body>
{escaped_body}
</body>
</html>"""


@app.get("/api/notes/export")
async def export_all_notes():
    """Bulk-export every plain note as readable .html inside a single zip.

    Folder hierarchy is reproduced as zip directories. Encrypted notes are
    skipped (we don't ship the user opaque ciphertext as an "export") and
    listed in `_EXCLUDED.txt` so the user knows what is missing.
    """
    from datetime import datetime

    data = _read_data()
    notes: dict[str, str] = data.get("notes", {}) or {}
    font = data.get("font_family", "Cascadia Code")
    size = data.get("font_size", 12)

    buf = io.BytesIO()
    excluded: list[str] = []
    included = 0

    # Track used paths within each folder to avoid silent overwrites when
    # two notes share a name. Maps folder_path -> set of filenames seen.
    used: dict[str, set[str]] = {}

    def visit(items: list[dict], path_parts: list[str], zf: zipfile.ZipFile) -> None:
        nonlocal included
        for item in items:
            kind = item.get("type")
            name = item.get("name") or "untitled"
            if kind == "folder":
                visit(
                    item.get("children") or [],
                    path_parts + [_safe_filename(name)],
                    zf,
                )
                continue
            if kind != "note":
                continue
            content = notes.get(item.get("id"), "")
            if _is_encrypted_content(content):
                excluded.append("/".join(path_parts + [name]) if path_parts else name)
                continue

            folder_key = "/".join(path_parts)
            seen = used.setdefault(folder_key, set())
            base = _safe_filename(name)
            filename = base + ".html"
            # Disambiguate on collision (a, a (2), a (3), ...).
            n = 2
            while filename in seen:
                filename = f"{base} ({n}).html"
                n += 1
            seen.add(filename)

            full_path = "/".join(path_parts + [filename]) if path_parts else filename
            zf.writestr(full_path, _build_note_html(name, content, font, size))
            included += 1

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        visit(data.get("tree") or [], [], zf)

        if excluded:
            info_lines = [
                f"NoirPad Export — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                f"Notes exported: {included}",
                f"Notes skipped (encrypted): {len(excluded)}",
                "",
                "The following encrypted notes were SKIPPED:",
                *(f"  - {p}" for p in excluded),
                "",
                "To include them, unlock and remove encryption first, "
                "then re-export.",
            ]
            zf.writestr("_EXCLUDED.txt", "\n".join(info_lines))

    buf.seek(0)
    filename = f"noirpad-notes-{datetime.now().strftime('%Y-%m-%d')}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---- Backup ----


@app.get("/api/backup")
async def backup_download():
    """Backup zip: the whole notes_data.json plus every referenced image."""
    data = _read_data()
    data_json = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")

    image_names: set = set()
    for names in (data.get("note_images") or {}).values():
        if names:
            image_names.update(names)
    # Also scan plaintext content (legacy notes that predate note_images).
    for content in (data.get("notes") or {}).values():
        image_names.update(_extract_image_names(content))
    for content in (data.get("trash", {}).get("notes") or {}).values():
        image_names.update(_extract_image_names(content))

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("notes_data.json", data_json)
        if IMAGES_DIR.exists():
            for img in IMAGES_DIR.iterdir():
                if img.is_file() and img.name in image_names:
                    zf.write(img, f"images/{img.name}")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="noirpad_backup.zip"'},
    )


@app.post("/api/backup/import")
async def backup_import(file: UploadFile = File(...)):
    """Replace all notes, folders, trash and favorites with a backup zip.

    Settings are left as they are. Legacy multi-user backups are accepted;
    their `user_id` stamps are dropped.
    """
    contents = await _read_upload_limited(file, MAX_BACKUP_BYTES)  # Fix #7
    buf = io.BytesIO(contents)
    try:
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()
            if "notes_data.json" not in names:
                raise HTTPException(400, "Invalid backup: notes_data.json missing")
            try:
                imported = json.loads(zf.read("notes_data.json"))
            except json.JSONDecodeError:
                raise HTTPException(400, "Invalid backup: corrupt notes_data.json")

            imp_tree = _strip_user_ids(copy.deepcopy(imported.get("tree") or []))
            imp_trash_tree = _strip_user_ids(
                copy.deepcopy((imported.get("trash") or {}).get("tree") or [])
            )
            imp_notes = imported.get("notes") or {}
            imp_trash_notes = (imported.get("trash") or {}).get("notes") or {}
            imp_trash_formats = (imported.get("trash") or {}).get("note_formats") or {}
            imp_formats = imported.get("note_formats") or {}
            imp_modes = imported.get("note_modes") or {}
            imp_images = imported.get("note_images") or {}
            imp_favorites = imported.get("favorites") or []

            # Only keep notes/formats/etc that are actually referenced by
            # the imported tree (defends against trash-stuffed payloads).
            imp_note_ids: set = set()
            for root_item in imp_tree + imp_trash_tree:
                imp_note_ids.update(collect_note_ids(root_item))

            def _pick(src: dict) -> dict:
                return {nid: src[nid] for nid in imp_note_ids if nid in src}

            def _mut(data: dict) -> None:
                data["tree"] = imp_tree
                data["trash"] = {
                    "tree": imp_trash_tree,
                    "notes": _pick(imp_trash_notes),
                    "note_formats": _pick(imp_trash_formats),
                }
                data["notes"] = _pick(imp_notes)
                data["note_formats"] = _pick(imp_formats)
                data["note_modes"] = _pick(imp_modes)
                data["note_images"] = _pick(imp_images)
                data["favorites"] = [
                    nid for nid in dict.fromkeys(imp_favorites) if nid in imp_note_ids
                ]

            _update_data(_mut)

            # Fix #2 (zip slip): for every image entry, resolve the target
            # and refuse anything that escapes IMAGES_DIR (e.g. an entry
            # named `images/../../evil`).
            for name in names:
                if not name.startswith("images/") or name.endswith("/"):
                    continue
                rel = name.split("/", 1)[1]
                dest = _safe_image_path(rel)
                if dest is None:
                    raise HTTPException(
                        400, f"Unsafe path in backup archive: {name!r}"
                    )
                dest.parent.mkdir(parents=True, exist_ok=True)
                with _file_lock:
                    with open(dest, "wb") as f:
                        f.write(zf.read(name))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Uploaded file is not a valid zip")

    return {"ok": True}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("NOIRPAD_HOST", "127.0.0.1")
    port = int(os.environ.get("NOIRPAD_PORT", "8000"))
    if host not in ("127.0.0.1", "localhost", "::1") and not RUNTIME.password:
        sys.exit(
            f"Refusing to listen on {host}: set NOIRPAD_PASSWORD first, "
            "otherwise anyone on the network can read your notes."
        )
    uvicorn.run(app, host=host, port=port)
