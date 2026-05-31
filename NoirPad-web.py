"""
NoirPad Web — FastAPI backend.
Standalone project: notes_data.json and images/ live next to this file.
"""

import base64
import copy
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

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
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
#   * data root — writable user data (notes_data.json + .bak/.tmp + images/).
#     ALWAYS the platformdirs user_data_dir, both in dev and frozen, so
#     `python NoirPad-web.py` (web mode) and the bundled NoirPad.exe share
#     accounts and notes. A one-shot migration below seeds the AppData
#     store from a pre-existing project-directory database the first time
#     this code runs against an empty AppData dir.

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
    """Return the WRITABLE user-data directory.

    Always platformdirs.user_data_dir on every OS / run mode, so web and
    desktop builds share one source of truth (no more dev vs frozen split).
    The directory is created on demand.
    """
    try:
        from platformdirs import user_data_dir
    except ImportError as exc:  # pragma: no cover — dependency missing
        raise RuntimeError(
            "platformdirs is required to resolve the NoirPad data directory"
        ) from exc
    path = Path(user_data_dir("NoirPad", appauthor=False))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _migrate_legacy_data_if_needed(target_dir: Path) -> None:
    """Seed *target_dir* from a legacy project-directory database, once.

    Triggers ONLY when target_dir holds no real users yet AND the project
    directory has a notes_data.json that does. Existing AppData content is
    snapshotted to *.pre-migration.bak before being touched. Re-running
    after migration is a no-op (the second check finds users present).
    """
    target_data = target_dir / "notes_data.json"

    # Bail out if AppData already has real data — never overwrite the user.
    if target_data.exists():
        try:
            with open(target_data, "r", encoding="utf-8") as f:
                existing = json.load(f)
            if existing.get("users"):
                return
        except (json.JSONDecodeError, OSError):
            # If AppData has an unreadable file we can't safely overwrite.
            return

    legacy_data = BASE_DIR / "notes_data.json"
    # Same dir → nothing to migrate, also avoids self-copy loops.
    if BASE_DIR.resolve() == target_dir.resolve():
        return
    if not legacy_data.is_file():
        return
    try:
        with open(legacy_data, "r", encoding="utf-8") as f:
            legacy = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        log.warning(
            "Skipping legacy migration: cannot read %s (%s)", legacy_data, exc
        )
        return
    if not legacy.get("users"):
        # Pre-multi-user database or empty — nothing meaningful to migrate.
        return

    # Snapshot whatever is currently at the destination so a botched copy
    # never silently destroys a previously working file.
    if target_data.exists():
        try:
            (target_dir / "notes_data.json.pre-migration.bak").write_bytes(
                target_data.read_bytes()
            )
        except OSError as exc:
            log.warning("Pre-migration backup failed: %s", exc)

    try:
        target_data.write_bytes(legacy_data.read_bytes())
    except OSError as exc:
        log.error("Failed to migrate notes_data.json: %s", exc)
        return

    legacy_bak = BASE_DIR / "notes_data.json.bak"
    if legacy_bak.is_file():
        try:
            (target_dir / "notes_data.json.bak").write_bytes(legacy_bak.read_bytes())
        except OSError as exc:
            log.warning("Could not migrate %s: %s", legacy_bak.name, exc)

    legacy_images = BASE_DIR / "images"
    target_images = target_dir / "images"
    if legacy_images.is_dir():
        target_images.mkdir(exist_ok=True)
        for src in legacy_images.iterdir():
            if not src.is_file():
                continue
            dst = target_images / src.name
            if dst.exists():
                # Refuse to clobber an AppData image of the same name (rare).
                continue
            try:
                dst.write_bytes(src.read_bytes())
            except OSError as exc:
                log.warning("Could not migrate image %s: %s", src.name, exc)

    log.warning(
        "Migrated legacy NoirPad data from %s -> %s", BASE_DIR, target_dir
    )


DATA_DIR = get_data_dir()
_migrate_legacy_data_if_needed(DATA_DIR)
STATIC_DIR = resource_path("static")

DATA_FILE = DATA_DIR / "notes_data.json"
IMAGES_DIR = DATA_DIR / "images"

# Resolved roots used for path-traversal / zip-slip checks.
BASE_DIR_R = BASE_DIR.resolve()
IMAGES_DIR_R = IMAGES_DIR.resolve()

# .bak / .tmp companions of the data file.
DATA_BAK = DATA_FILE.parent / (DATA_FILE.name + ".bak")
DATA_TMP = DATA_FILE.parent / (DATA_FILE.name + ".tmp")

IMAGES_DIR.mkdir(exist_ok=True)
# STATIC_DIR is read-only in frozen mode (lives under _MEIPASS); we only
# need it to exist when running in dev so a fresh checkout doesn't crash.
if not _is_frozen():
    STATIC_DIR.mkdir(exist_ok=True)

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
    # Multi-user auth — added in v2.1. Existing single-user installs have no
    # `users` block until the first registration; that first registration
    # adopts all legacy notes/folders that still carry no user_id. See
    # `adopt_orphan_items` below.
    # users: { user_id: {id, username, username_lower, password_hash,
    #                    created_at} }
    "users": {},
    # sessions: { token: {token, user_id, created_at, expires_at} }
    "sessions": {},
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


def get_all_tags(data: dict) -> list[str]:
    """Collect every unique tag from all tree items (active + trash)."""
    tags: set[str] = set()

    def _walk(items: list[dict]) -> None:
        for item in items:
            for t in item.get("tags", []):
                tags.add(t)
            _walk(item.get("children", []))

    _walk(data.get("tree", []))
    _walk(data.get("trash", {}).get("tree", []))
    return sorted(tags)


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
        import hashlib
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
        decrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(encrypted))
        return decrypted.decode("utf-8")
    else:
        raise ValueError("Unknown encryption version")


# ---------------------------------------------------------------------------
# Auth / sessions
# ---------------------------------------------------------------------------
#
# Persistence is the same JSON file used for notes — `users` and `sessions`
# live as top-level dicts inside notes_data.json (see DEFAULT_DATA). This
# keeps the storage model identical to everything else; the shared file
# lock already serialises read-modify-write cycles.
#
# Adoption: the very first registration claims all pre-existing tree /
# trash items that still have no `user_id`. After that, new users start
# with an empty workspace.

# Cookie / session knobs. Secure flag is controlled by env so dev over
# http:// works (Secure cookies are dropped by the browser there).
SESSION_COOKIE_NAME = "noirpad_session"
SESSION_TTL_REMEMBER = 30 * 24 * 60 * 60  # 30 days
SESSION_TTL_SHORT = 12 * 60 * 60          # 12 hours — used for non-remember

_env = (os.environ.get("NOIRPAD_ENV") or "dev").lower()
_secure_override = os.environ.get("NOIRPAD_SECURE_COOKIES")
if _secure_override is not None:
    SESSION_COOKIE_SECURE = _secure_override.lower() in ("1", "true", "yes", "on")
else:
    SESSION_COOKIE_SECURE = _env in ("prod", "production")

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        _password_hasher.verify(password_hash, password)
        return True
    except (VerifyMismatchError, InvalidHashError, Exception):
        return False


def _now() -> int:
    return int(time.time())


def _new_session_token() -> str:
    return secrets.token_urlsafe(32)


def _find_user_by_username(data: dict, username: str) -> Optional[dict]:
    """Case-insensitive username lookup."""
    target = (username or "").strip().lower()
    if not target:
        return None
    for user in data.get("users", {}).values():
        if user.get("username_lower") == target:
            return user
    return None


def _prune_expired_sessions(data: dict) -> None:
    sessions: dict = data.setdefault("sessions", {})
    now = _now()
    expired = [t for t, s in sessions.items() if (s.get("expires_at") or 0) <= now]
    for t in expired:
        sessions.pop(t, None)


def _get_session(data: dict, token: Optional[str]) -> Optional[dict]:
    """Return a non-expired session dict, or None."""
    if not token:
        return None
    sess = data.get("sessions", {}).get(token)
    if not sess:
        return None
    if (sess.get("expires_at") or 0) <= _now():
        return None
    return sess


def adopt_orphan_items(data: dict, user_id: str) -> None:
    """Stamp every tree / trash item lacking `user_id` with *user_id*.

    Runs exactly once: only when registering the very first user (caller's
    job to check `len(users) == 0` BEFORE inserting the new row). Used so
    a single-user install upgrading to the multi-user build keeps its
    existing notes/folders visible after login.
    """
    def _walk(items: list) -> None:
        for item in items:
            if "user_id" not in item:
                item["user_id"] = user_id
            children = item.get("children")
            if children:
                _walk(children)
    _walk(data.get("tree") or [])
    _walk(data.get("trash", {}).get("tree") or [])


def _user_owns_note(data: dict, user_id: str, note_id: str) -> bool:
    """True if *note_id* lives anywhere in the user's tree or trash."""
    def _walk(items: list) -> bool:
        for item in items:
            if item.get("type") == "note" and item.get("id") == note_id:
                return item.get("user_id") == user_id
            children = item.get("children")
            if children and _walk(children):
                return True
        return False
    if _walk(data.get("tree") or []):
        return True
    return _walk(data.get("trash", {}).get("tree") or [])


def _user_owns_item(data: dict, user_id: str, item_id: str) -> bool:
    """True if *item_id* (note OR folder) is owned by user_id (tree+trash)."""
    def _walk(items: list) -> bool:
        for item in items:
            if item.get("id") == item_id:
                return item.get("user_id") == user_id
            children = item.get("children")
            if children and _walk(children):
                return True
        return False
    if _walk(data.get("tree") or []):
        return True
    return _walk(data.get("trash", {}).get("tree") or [])


def _collect_user_note_ids(data: dict, user_id: str) -> set:
    """Every note_id owned by *user_id* (active tree + trash)."""
    ids: set = set()

    def _walk(items: list) -> None:
        for item in items:
            if item.get("user_id") == user_id and item.get("type") == "note":
                ids.add(item.get("id"))
            children = item.get("children")
            if children:
                _walk(children)

    _walk(data.get("tree") or [])
    _walk(data.get("trash", {}).get("tree") or [])
    return ids


def _scope_view_for_user(data: dict, user_id: str) -> dict:
    """Return a copy of *data* containing only items the user can see.

    Strips: other users' tree/trash items, their notes/formats/modes/images,
    their favorites; the global `users`/`sessions` blocks are never exposed.
    Settings stay shared for now (see "scope" note at top of file).
    """
    def _filter_tree(items: list) -> list:
        out = []
        for item in items:
            if item.get("user_id") != user_id:
                continue
            copied = copy.deepcopy(item)
            if copied.get("type") == "folder":
                copied["children"] = _filter_tree(item.get("children") or [])
            out.append(copied)
        return out

    visible_tree = _filter_tree(data.get("tree") or [])
    visible_trash_tree = _filter_tree(data.get("trash", {}).get("tree") or [])
    visible_notes_ids = _collect_user_note_ids(data, user_id)

    view = copy.deepcopy(data)
    view.pop("users", None)
    view.pop("sessions", None)
    view["tree"] = visible_tree
    view["trash"] = {
        "tree": visible_trash_tree,
        "notes": {
            nid: data.get("trash", {}).get("notes", {}).get(nid)
            for nid in visible_notes_ids
            if nid in data.get("trash", {}).get("notes", {})
        },
        "note_formats": {
            nid: data.get("trash", {}).get("note_formats", {}).get(nid)
            for nid in visible_notes_ids
            if nid in data.get("trash", {}).get("note_formats", {})
        },
    }
    view["notes"] = {
        nid: data.get("notes", {}).get(nid)
        for nid in visible_notes_ids
        if nid in data.get("notes", {})
    }
    view["favorites"] = [
        nid for nid in (data.get("favorites") or []) if nid in visible_notes_ids
    ]
    view["note_formats"] = {
        nid: data.get("note_formats", {}).get(nid)
        for nid in visible_notes_ids
        if nid in data.get("note_formats", {})
    }
    view["note_modes"] = {
        nid: data.get("note_modes", {}).get(nid)
        for nid in visible_notes_ids
        if nid in data.get("note_modes", {})
    }
    view["note_images"] = {
        nid: data.get("note_images", {}).get(nid)
        for nid in visible_notes_ids
        if nid in data.get("note_images", {})
    }
    return view


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


class RegisterReq(BaseModel):
    username: str
    password: str


class LoginReq(BaseModel):
    username: str
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
# Auth dependency
# ---------------------------------------------------------------------------


def get_current_user(
    noirpad_session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> dict:
    """Resolve the request's session cookie to a user, else 401.

    Reads the JSON store (no lock upgrade needed for a pure read) and
    refuses expired sessions. Returns the user dict (id, username, ...).
    """
    data = _read_data()
    sess = _get_session(data, noirpad_session)
    if sess is None:
        raise HTTPException(401, "Not authenticated")
    user = data.get("users", {}).get(sess.get("user_id"))
    if user is None:
        # Session points at a user that was wiped — treat as unauthenticated.
        raise HTTPException(401, "Not authenticated")
    return user


def _set_session_cookie(response: Response, token: str, remember: bool) -> None:
    max_age = SESSION_TTL_REMEMBER if remember else None  # None = session cookie
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=SESSION_COOKIE_SECURE,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        samesite="lax",
        secure=SESSION_COOKIE_SECURE,
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


# ---- Auth ----


@app.post("/api/auth/register")
async def auth_register(req: RegisterReq, response: Response):
    username = (req.username or "").strip()
    password = req.password or ""
    if not username:
        raise HTTPException(400, "Username is required")
    if len(username) > 64:
        raise HTTPException(400, "Username is too long (max 64 chars)")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    pw_hash = hash_password(password)
    token = _new_session_token()
    expires_at = _now() + SESSION_TTL_REMEMBER

    state: dict = {}

    def _mut(data: dict) -> None:
        _prune_expired_sessions(data)
        if _find_user_by_username(data, username) is not None:
            raise HTTPException(409, "Username already exists")
        users: dict = data.setdefault("users", {})
        is_first_user = len(users) == 0
        user_id = str(uuid.uuid4())
        users[user_id] = {
            "id": user_id,
            "username": username,
            "username_lower": username.lower(),
            "password_hash": pw_hash,
            "created_at": _now(),
        }
        if is_first_user:
            # Adopt legacy single-user data.
            adopt_orphan_items(data, user_id)
        data.setdefault("sessions", {})[token] = {
            "token": token,
            "user_id": user_id,
            "created_at": _now(),
            "expires_at": expires_at,
        }
        state["user_id"] = user_id

    _update_data(_mut)
    # `remember=True` on registration so a fresh signup isn't logged out
    # the moment the user closes the tab.
    _set_session_cookie(response, token, remember=True)
    return {"ok": True, "username": username}


@app.post("/api/auth/login")
async def auth_login(req: LoginReq, response: Response):
    username = (req.username or "").strip()
    password = req.password or ""
    if not username or not password:
        raise HTTPException(400, "Username and password are required")

    token = _new_session_token()
    ttl = SESSION_TTL_REMEMBER if req.remember else SESSION_TTL_SHORT
    expires_at = _now() + ttl

    user_box: dict = {}

    def _mut(data: dict) -> None:
        _prune_expired_sessions(data)
        user = _find_user_by_username(data, username)
        if user is None or not verify_password(user["password_hash"], password):
            # Same error for "no such user" and "wrong password" so the
            # endpoint can't be used to enumerate accounts.
            raise HTTPException(401, "Invalid username or password")
        data.setdefault("sessions", {})[token] = {
            "token": token,
            "user_id": user["id"],
            "created_at": _now(),
            "expires_at": expires_at,
        }
        user_box["username"] = user["username"]

    _update_data(_mut)
    _set_session_cookie(response, token, remember=req.remember)
    return {"ok": True, "username": user_box.get("username", username)}


@app.post("/api/auth/logout")
async def auth_logout(
    response: Response,
    noirpad_session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
):
    if noirpad_session:
        def _mut(data: dict) -> None:
            data.get("sessions", {}).pop(noirpad_session, None)

        _update_data(_mut)
    _clear_session_cookie(response)
    return {"ok": True}


@app.get("/api/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {"username": user["username"]}


# ---- Data ----


@app.get("/api/data")
async def get_data(user: dict = Depends(get_current_user)):
    return _scope_view_for_user(_read_data(), user["id"])


@app.get("/api/data/version")
async def get_data_version(user: dict = Depends(get_current_user)):
    # File mtime is shared across users — fine as a "something changed" hint
    # for the poller; per-request scoping happens on the follow-up /api/data.
    return {"version": _data_mtime()}


@app.get("/api/storage")
async def get_storage(user: dict = Depends(get_current_user)):
    """Storage usage. Images are shared on disk (single folder); the JSON
    file is also shared. Surfacing on-disk totals here is fine because no
    per-user data leaks — just a couple of byte counts."""
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
async def new_note(req: NewItemReq, user: dict = Depends(get_current_user)):
    note_id = str(uuid.uuid4())
    item = {"id": note_id, "name": req.name, "type": "note", "user_id": user["id"]}

    def _mut(data: dict) -> None:
        if req.parent_id:
            parent = find_item_by_id(data["tree"], req.parent_id)
            if (parent is None or parent.get("type") != "folder"
                    or parent.get("user_id") != user["id"]):
                raise HTTPException(400, "Parent folder not found")
            parent.setdefault("children", []).append(item)
        else:
            data["tree"].append(item)
        data.setdefault("notes", {})[note_id] = ""

    _update_data(_mut)  # Fix #6
    return {"id": note_id, "item": item}


@app.post("/api/tree/new-folder")
async def new_folder(req: NewItemReq, user: dict = Depends(get_current_user)):
    folder_id = str(uuid.uuid4())
    item = {
        "id": folder_id, "name": req.name, "type": "folder",
        "children": [], "user_id": user["id"],
    }

    def _mut(data: dict) -> None:
        if req.parent_id:
            parent = find_item_by_id(data["tree"], req.parent_id)
            if (parent is None or parent.get("type") != "folder"
                    or parent.get("user_id") != user["id"]):
                raise HTTPException(400, "Parent folder not found")
            parent.setdefault("children", []).append(item)
        else:
            data["tree"].append(item)

    _update_data(_mut)  # Fix #6
    return {"id": folder_id, "item": item}


@app.post("/api/tree/rename")
async def rename_item(req: RenameReq, user: dict = Depends(get_current_user)):
    def _mut(data: dict) -> None:
        item = find_item_by_id(data["tree"], req.id)
        if item is None or item.get("user_id") != user["id"]:
            raise HTTPException(404, "Item not found")
        item["name"] = req.name

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/tree/move")
async def move_item(req: MoveReq, user: dict = Depends(get_current_user)):
    def _mut(data: dict) -> None:
        source_list = find_parent_list(data["tree"], req.id)
        if source_list is None:
            raise HTTPException(404, "Source item not found")
        item = next(i for i in source_list if i["id"] == req.id)
        if item.get("user_id") != user["id"]:
            raise HTTPException(404, "Source item not found")

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
            if (target is None or target.get("type") != "folder"
                    or target.get("user_id") != user["id"]):
                raise HTTPException(400, "Target folder not found")
            target.setdefault("children", []).append(item)
        else:
            target_list = find_parent_list(data["tree"], req.target_id)
            if target_list is None:
                raise HTTPException(404, "Target item not found")
            target_item = next(
                x for x in target_list if x["id"] == req.target_id
            )
            if target_item.get("user_id") != user["id"]:
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
async def delete_item(req: DeleteReq, user: dict = Depends(get_current_user)):
    def _mut(data: dict) -> None:
        item = find_item_by_id(data["tree"], req.id)
        if item is None or item.get("user_id") != user["id"]:
            raise HTTPException(404, "Item not found")
        try:
            move_to_trash(data, req.id)
        except ValueError:
            raise HTTPException(404, "Item not found")

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Notes ----


@app.get("/api/note/{note_id}")
async def get_note(note_id: str, user: dict = Depends(get_current_user)):
    data = _read_data()
    if not _user_owns_note(data, user["id"], note_id):
        raise HTTPException(404, "Note not found")
    content = data.get("notes", {}).get(note_id)
    if content is None:
        raise HTTPException(404, "Note not found")
    formats = data.get("note_formats", {}).get(note_id, [])
    mode = data.get("note_modes", {}).get(note_id, "rich-text")
    return {"content": content, "formats": formats, "mode": mode}


@app.put("/api/note/{note_id}")
async def put_note(
    note_id: str, body: NoteBody, user: dict = Depends(get_current_user)
):
    def _mut(data: dict) -> None:
        if not _user_owns_note(data, user["id"], note_id):
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
    req: ToggleFavReq, user: dict = Depends(get_current_user)
):
    def _mut(data: dict) -> bool:
        if not _user_owns_note(data, user["id"], req.id):
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
async def list_tags(user: dict = Depends(get_current_user)):
    data = _read_data()
    tags: set = set()

    def _walk(items: list) -> None:
        for item in items:
            if item.get("user_id") == user["id"]:
                for t in item.get("tags", []):
                    tags.add(t)
            _walk(item.get("children") or [])

    _walk(data.get("tree") or [])
    _walk(data.get("trash", {}).get("tree") or [])
    return {"tags": sorted(tags)}


@app.put("/api/tags/{item_id}")
async def set_tags(
    item_id: str, body: TagsBody, user: dict = Depends(get_current_user)
):
    def _mut(data: dict) -> None:
        item = find_item_by_id(data["tree"], item_id)
        if item is None or item.get("user_id") != user["id"]:
            raise HTTPException(404, "Item not found")
        item["tags"] = body.tags

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Trash ----


@app.get("/api/trash")
async def get_trash(user: dict = Depends(get_current_user)):
    data = _read_data()
    user_id = user["id"]
    trash = data.get("trash", {"tree": [], "notes": {}})

    def _filter(items: list) -> list:
        out = []
        for item in items:
            if item.get("user_id") != user_id:
                continue
            copied = copy.deepcopy(item)
            if copied.get("type") == "folder":
                copied["children"] = _filter(item.get("children") or [])
            out.append(copied)
        return out

    visible_tree = _filter(trash.get("tree") or [])
    visible_ids: set = set()
    for root_item in visible_tree:
        visible_ids.update(collect_note_ids(root_item))

    return {
        "tree": visible_tree,
        "notes": {
            nid: trash.get("notes", {}).get(nid)
            for nid in visible_ids
            if nid in trash.get("notes", {})
        },
    }


@app.post("/api/trash/restore")
async def trash_restore(req: RestoreReq, user: dict = Depends(get_current_user)):
    def _mut(data: dict) -> None:
        trash_tree = data.get("trash", {}).get("tree") or []
        item = find_item_by_id(trash_tree, req.id)
        if item is None or item.get("user_id") != user["id"]:
            raise HTTPException(404, "Item not found in trash")
        try:
            restore_from_trash(data, req.id)
        except ValueError:
            raise HTTPException(404, "Item not found in trash")

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/trash/empty")
async def trash_empty(user: dict = Depends(get_current_user)):
    """Empty THIS user's trash only — other users' trash is preserved."""
    def _mut(data: dict) -> None:
        trash = data.setdefault("trash", {"tree": [], "notes": {}})
        note_images: dict = data.get("note_images", {})

        # Find this user's top-level trash items.
        user_root_items = [
            i for i in (trash.get("tree") or [])
            if i.get("user_id") == user["id"]
        ]

        trashed_ids: set[str] = set()
        for root_item in user_root_items:
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

        trash["tree"] = [
            i for i in (trash.get("tree") or [])
            if i.get("user_id") != user["id"]
        ]

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/trash/delete")
async def trash_delete_item(
    req: RestoreReq, user: dict = Depends(get_current_user)
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
        if parent_list[idx].get("user_id") != user["id"]:
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
    body: SettingsBody, user: dict = Depends(get_current_user)
):
    def _mut(data: dict) -> None:
        for field in _SETTINGS_FIELDS:
            value = getattr(body, field)
            if value is not None:
                data[field] = value

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/settings/reset")
async def reset_settings(user: dict = Depends(get_current_user)):
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
async def encrypt_note(req: CryptoReq, user: dict = Depends(get_current_user)):
    def _mut(data: dict) -> None:
        if not _user_owns_note(data, user["id"], req.id):
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
async def decrypt_note(req: CryptoReq, user: dict = Depends(get_current_user)):
    def _mut(data: dict) -> None:
        if not _user_owns_note(data, user["id"], req.id):
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
async def decrypt_view(req: CryptoReq, user: dict = Depends(get_current_user)):
    """Decrypt note content in memory and return it WITHOUT modifying the file."""
    data = _read_data()
    if not _user_owns_note(data, user["id"], req.id):
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
    req: SaveEncryptedReq, user: dict = Depends(get_current_user)
):
    """Save note content by re-encrypting it with the given password."""
    def _mut(data: dict) -> None:
        if not _user_owns_note(data, user["id"], req.id):
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
async def upload_image(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
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
async def get_image(filename: str, user: dict = Depends(get_current_user)):
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
async def export_txt(note_id: str, user: dict = Depends(get_current_user)):
    data = _read_data()
    if not _user_owns_note(data, user["id"], note_id):
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
async def export_html(note_id: str, user: dict = Depends(get_current_user)):
    data = _read_data()
    if not _user_owns_note(data, user["id"], note_id):
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
async def export_all_notes(user: dict = Depends(get_current_user)):
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
    user_tree = [
        i for i in (data.get("tree") or [])
        if i.get("user_id") == user["id"]
    ]

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
        visit(user_tree, [], zf)

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
async def backup_download(user: dict = Depends(get_current_user)):
    """Per-user backup. Dumps ONLY the caller's scoped view of the JSON
    (no `users`/`sessions`/other accounts) so handing the zip to someone
    else doesn't leak other users' notes or password hashes."""
    data = _read_data()
    scoped = _scope_view_for_user(data, user["id"])
    scoped_json = json.dumps(scoped, ensure_ascii=False, indent=2).encode("utf-8")

    # Only embed images actually referenced by this user's notes.
    user_image_names: set = set()
    for names in (scoped.get("note_images") or {}).values():
        if names:
            user_image_names.update(names)
    # Also scan plaintext content (legacy notes that predate note_images).
    for content in (scoped.get("notes") or {}).values():
        user_image_names.update(_extract_image_names(content))
    for content in (scoped.get("trash", {}).get("notes") or {}).values():
        user_image_names.update(_extract_image_names(content))

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("notes_data.json", scoped_json)
        if IMAGES_DIR.exists():
            for img in IMAGES_DIR.iterdir():
                if img.is_file() and img.name in user_image_names:
                    zf.write(img, f"images/{img.name}")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="noirpad_backup.zip"'},
    )


@app.post("/api/backup/import")
async def backup_import(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Restore the caller's data from a scoped backup zip.

    Multi-user safe: only the current user's notes/folders/trash/etc. are
    replaced. Other users + auth state are left intact. Any user_id stamps
    in the imported JSON are overwritten with the caller's id.
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

            user_id = user["id"]

            def _restamp(items: list) -> list:
                """Force every imported item to belong to *this* user."""
                out = []
                for item in items or []:
                    new_item = copy.deepcopy(item)
                    new_item["user_id"] = user_id
                    if new_item.get("type") == "folder":
                        new_item["children"] = _restamp(
                            new_item.get("children") or []
                        )
                    out.append(new_item)
                return out

            imp_tree = _restamp(imported.get("tree") or [])
            imp_trash_tree = _restamp(
                (imported.get("trash") or {}).get("tree") or []
            )
            imp_notes = imported.get("notes") or {}
            imp_trash_notes = (imported.get("trash") or {}).get("notes") or {}
            imp_formats = imported.get("note_formats") or {}
            imp_modes = imported.get("note_modes") or {}
            imp_images = imported.get("note_images") or {}
            imp_favorites = imported.get("favorites") or []

            # Only keep notes/formats/etc that are actually referenced by
            # the imported tree (defends against trash-stuffed payloads).
            imp_note_ids: set = set()
            for root_item in imp_tree + imp_trash_tree:
                imp_note_ids.update(collect_note_ids(root_item))

            def _mut(data: dict) -> None:
                # Drop the current user's existing items + notes.
                old_ids = _collect_user_note_ids(data, user_id)

                data["tree"] = [
                    i for i in (data.get("tree") or [])
                    if i.get("user_id") != user_id
                ]
                trash = data.setdefault("trash", {"tree": [], "notes": {}})
                trash["tree"] = [
                    i for i in (trash.get("tree") or [])
                    if i.get("user_id") != user_id
                ]
                for nid in old_ids:
                    data.get("notes", {}).pop(nid, None)
                    trash.get("notes", {}).pop(nid, None)
                    trash.get("note_formats", {}).pop(nid, None)
                    data.get("note_formats", {}).pop(nid, None)
                    data.get("note_modes", {}).pop(nid, None)
                    data.get("note_images", {}).pop(nid, None)
                favorites: list = data.setdefault("favorites", [])
                data["favorites"] = [f for f in favorites if f not in old_ids]

                # Splice imported items in.
                data["tree"].extend(imp_tree)
                trash["tree"].extend(imp_trash_tree)
                for nid in imp_note_ids:
                    if nid in imp_notes:
                        data.setdefault("notes", {})[nid] = imp_notes[nid]
                    if nid in imp_trash_notes:
                        trash.setdefault("notes", {})[nid] = imp_trash_notes[nid]
                    if nid in imp_formats:
                        data.setdefault("note_formats", {})[nid] = imp_formats[nid]
                    if nid in imp_modes:
                        data.setdefault("note_modes", {})[nid] = imp_modes[nid]
                    if nid in imp_images:
                        data.setdefault("note_images", {})[nid] = imp_images[nid]
                for nid in imp_favorites:
                    if nid in imp_note_ids and nid not in data["favorites"]:
                        data["favorites"].append(nid)

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

    # Fix #4: bind to loopback only. This is a local desktop-style app; it
    # must not be reachable from other machines on the LAN. Change to
    # "0.0.0.0" only if you deliberately add authentication first.
    uvicorn.run(app, host="127.0.0.1", port=8000)
