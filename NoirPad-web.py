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
import threading
import uuid
import zipfile
# Fix #11: removed unused `import shutil` (the .bak copy below uses
# Path.read_bytes()/write_bytes() instead, so shutil is genuinely unused).
from pathlib import Path
from typing import Any, Callable, Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

log = logging.getLogger("noirpad")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent  # project root
DATA_FILE = BASE_DIR / "notes_data.json"
IMAGES_DIR = BASE_DIR / "images"
STATIC_DIR = BASE_DIR / "static"

# Resolved roots used for path-traversal / zip-slip checks.
BASE_DIR_R = BASE_DIR.resolve()
IMAGES_DIR_R = IMAGES_DIR.resolve()

# .bak / .tmp companions of the data file.
DATA_BAK = DATA_FILE.parent / (DATA_FILE.name + ".bak")
DATA_TMP = DATA_FILE.parent / (DATA_FILE.name + ".tmp")

IMAGES_DIR.mkdir(exist_ok=True)
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


class CryptoReq(BaseModel):
    id: str
    password: str


class SaveEncryptedReq(BaseModel):
    id: str
    password: str
    content: str
    formats: list[Any] = []


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="NoirPad Web", version="1.0.0")

# Fix #3: `allow_origins=["*"]` together with `allow_credentials=True` is
# invalid per the CORS spec (and silently breaks credentialed requests).
# This is a local desktop-style app served from the same origin and uses no
# cookies/credentials, so: restrict to localhost and disable credentials.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=False,
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
# Routes
# ---------------------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
async def root():
    index = STATIC_DIR / "index.html"
    if not index.exists():
        raise HTTPException(404, "index.html not found in static/")
    return index.read_text(encoding="utf-8")


# ---- Data ----


@app.get("/api/data")
async def get_data():
    return _read_data()


@app.get("/api/data/version")
async def get_data_version():
    return {"version": _data_mtime()}


@app.get("/api/storage")
async def get_storage():
    """Read-only: on-disk size of notes_data.json + images/."""
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
    item = {"id": folder_id, "name": req.name, "type": "folder", "children": []}

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
    content = data.get("notes", {}).get(note_id)
    if content is None:
        raise HTTPException(404, "Note not found")
    formats = data.get("note_formats", {}).get(note_id, [])
    return {"content": content, "formats": formats}


@app.put("/api/note/{note_id}")
async def put_note(note_id: str, body: NoteBody):
    def _mut(data: dict) -> None:
        if note_id not in data.get("notes", {}):
            # Allow saving even if key doesn't exist yet (new note)
            item = find_item_by_id(data["tree"], note_id)
            if item is None:
                raise HTTPException(404, "Note not found in tree")
        data.setdefault("notes", {})[note_id] = body.content
        if body.formats:
            data.setdefault("note_formats", {})[note_id] = body.formats
        else:
            data.get("note_formats", {}).pop(note_id, None)
        # Fix #9: keep the image map in sync for plaintext saves.
        data.setdefault("note_images", {})[note_id] = _extract_image_names(
            body.content
        )

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Favorites ----


@app.post("/api/favorites/toggle")
async def toggle_favorite(req: ToggleFavReq):
    def _mut(data: dict) -> bool:
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
    return {"tags": get_all_tags(data)}


@app.put("/api/tags/{item_id}")
async def set_tags(item_id: str, body: TagsBody):
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
    data = _read_data()
    return data.get("trash", {"tree": [], "notes": {}})


@app.post("/api/trash/restore")
async def trash_restore(req: RestoreReq):
    def _mut(data: dict) -> None:
        try:
            restore_from_trash(data, req.id)
        except ValueError:
            raise HTTPException(404, "Item not found in trash")

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/trash/empty")
async def trash_empty():
    def _mut(data: dict) -> None:
        trash = data.get("trash", {"tree": [], "notes": {}})
        note_images: dict = data.get("note_images", {})

        # Every note id sitting in the trash (loose notes + notes in folders).
        trashed_ids: set[str] = set(trash.get("notes", {}).keys())
        for root_item in trash.get("tree", []):
            trashed_ids.update(collect_note_ids(root_item))

        # Fix #9: union of (a) the tracked image map — this is what covers
        # ENCRYPTED notes, whose base64 content the regex can't parse — and
        # (b) regex over plaintext content (legacy data / not-yet-tracked).
        to_delete: set[str] = set()
        for nid in trashed_ids:
            to_delete.update(note_images.get(nid, []))
        for content in trash.get("notes", {}).values():
            to_delete.update(_extract_image_names(content))

        _delete_images(to_delete)

        # Drop image-map entries for the now-gone notes.
        for nid in trashed_ids:
            note_images.pop(nid, None)

        data["trash"] = {"tree": [], "notes": {}}

    _update_data(_mut)  # Fix #6
    return {"ok": True}


@app.post("/api/trash/delete")
async def trash_delete_item(req: RestoreReq):
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


@app.put("/api/settings")
async def update_settings(body: SettingsBody):
    def _mut(data: dict) -> None:
        for field in (
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
        ):
            value = getattr(body, field)
            if value is not None:
                data[field] = value

    _update_data(_mut)  # Fix #6
    return {"ok": True}


# ---- Encryption ----


@app.post("/api/encrypt")
async def encrypt_note(req: CryptoReq):
    def _mut(data: dict) -> None:
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
    content = data.get("notes", {}).get(req.id)
    if content is None:
        raise HTTPException(404, "Note not found")
    try:
        decrypted = decrypt_content(content, req.password)
    except (InvalidToken, ValueError):  # Fix #5
        raise HTTPException(400, "Wrong password")
    formats = data.get("note_formats", {}).get(req.id, [])
    return {"content": decrypted, "formats": formats}


@app.post("/api/save-encrypted")
async def save_encrypted(req: SaveEncryptedReq):
    """Save note content by re-encrypting it with the given password."""
    def _mut(data: dict) -> None:
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


# ---- Backup ----


@app.get("/api/backup")
async def backup_download():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        with _file_lock:
            if DATA_FILE.exists():
                zf.write(DATA_FILE, "notes_data.json")
        # Add images
        if IMAGES_DIR.exists():
            for img in IMAGES_DIR.iterdir():
                if img.is_file():
                    zf.write(img, f"images/{img.name}")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="noirpad_backup.zip"'},
    )


@app.post("/api/backup/import")
async def backup_import(file: UploadFile = File(...)):
    contents = await _read_upload_limited(file, MAX_BACKUP_BYTES)  # Fix #7
    buf = io.BytesIO(contents)
    try:
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()
            if "notes_data.json" not in names:
                raise HTTPException(400, "Invalid backup: notes_data.json missing")

            # notes_data.json: we IGNORE the archive's path entirely and
            # write to the fixed DATA_FILE under BASE_DIR, so this entry
            # can't be used for a zip-slip write (Fix #2).
            raw = zf.read("notes_data.json")
            try:
                json.loads(raw)
            except json.JSONDecodeError:
                raise HTTPException(400, "Invalid backup: corrupt notes_data.json")

            with _file_lock:
                # Snapshot + atomic replace, same as _write_data_unlocked.
                if DATA_FILE.exists():
                    try:
                        DATA_BAK.write_bytes(DATA_FILE.read_bytes())
                    except OSError as exc:
                        log.warning("Could not back up data file: %s", exc)
                DATA_TMP.write_bytes(raw)
                os.replace(DATA_TMP, DATA_FILE)

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
