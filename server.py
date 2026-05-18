"""
NoirPad Web — FastAPI backend.
Standalone project: notes_data.json and images/ live next to this file.
"""

import base64
import copy
import io
import json
import os
import re
import shutil
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Any, Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent  # project root
DATA_FILE = BASE_DIR / "notes_data.json"
IMAGES_DIR = BASE_DIR / "images"
STATIC_DIR = BASE_DIR / "static"

IMAGES_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)

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
    "theme": "matrix",
    "font_family": "Cascadia Code",
    "font_size": 12,
    "autosave": False,
    "page_orientation": "landscape",
}


def _read_data() -> dict[str, Any]:
    """Read notes_data.json under lock. Returns default structure if missing."""
    with _file_lock:
        if not DATA_FILE.exists():
            return copy.deepcopy(DEFAULT_DATA)
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)


def _write_data(data: dict[str, Any]) -> None:
    """Write notes_data.json under lock."""
    with _file_lock:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


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
    """Decrypt using the same format as desktop app."""
    obj = json.loads(stored)
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
    font_family: Optional[str] = None
    font_size: Optional[int] = None
    autosave: Optional[bool] = None
    page_orientation: Optional[str] = None


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files (CSS, JS, assets)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


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


# ---- Tree ----


@app.post("/api/tree/new-note")
async def new_note(req: NewItemReq):
    data = _read_data()
    note_id = str(uuid.uuid4())
    item = {"id": note_id, "name": req.name, "type": "note"}

    if req.parent_id:
        parent = find_item_by_id(data["tree"], req.parent_id)
        if parent is None or parent.get("type") != "folder":
            raise HTTPException(400, "Parent folder not found")
        parent.setdefault("children", []).append(item)
    else:
        data["tree"].append(item)

    data.setdefault("notes", {})[note_id] = ""
    _write_data(data)
    return {"id": note_id, "item": item}


@app.post("/api/tree/new-folder")
async def new_folder(req: NewItemReq):
    data = _read_data()
    folder_id = str(uuid.uuid4())
    item = {"id": folder_id, "name": req.name, "type": "folder", "children": []}

    if req.parent_id:
        parent = find_item_by_id(data["tree"], req.parent_id)
        if parent is None or parent.get("type") != "folder":
            raise HTTPException(400, "Parent folder not found")
        parent.setdefault("children", []).append(item)
    else:
        data["tree"].append(item)

    _write_data(data)
    return {"id": folder_id, "item": item}


@app.post("/api/tree/rename")
async def rename_item(req: RenameReq):
    data = _read_data()
    item = find_item_by_id(data["tree"], req.id)
    if item is None:
        raise HTTPException(404, "Item not found")
    item["name"] = req.name
    _write_data(data)
    return {"ok": True}


@app.post("/api/tree/move")
async def move_item(req: MoveReq):
    data = _read_data()

    # Remove item from current location
    source_list = find_parent_list(data["tree"], req.id)
    if source_list is None:
        raise HTTPException(404, "Source item not found")
    item = next(i for i in source_list if i["id"] == req.id)
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
        idx = next(i for i, x in enumerate(target_list) if x["id"] == req.target_id)
        if req.position == "after":
            idx += 1
        target_list.insert(idx, item)

    _write_data(data)
    return {"ok": True}


@app.post("/api/tree/delete")
async def delete_item(req: DeleteReq):
    data = _read_data()
    try:
        move_to_trash(data, req.id)
    except ValueError:
        raise HTTPException(404, "Item not found")
    _write_data(data)
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
    data = _read_data()
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
    _write_data(data)
    return {"ok": True}


# ---- Favorites ----


@app.post("/api/favorites/toggle")
async def toggle_favorite(req: ToggleFavReq):
    data = _read_data()
    favs: list[str] = data.setdefault("favorites", [])
    if req.id in favs:
        favs.remove(req.id)
        state = False
    else:
        favs.append(req.id)
        state = True
    _write_data(data)
    return {"favorite": state}


# ---- Tags ----


@app.get("/api/tags")
async def list_tags():
    data = _read_data()
    return {"tags": get_all_tags(data)}


@app.put("/api/tags/{item_id}")
async def set_tags(item_id: str, body: TagsBody):
    data = _read_data()
    item = find_item_by_id(data["tree"], item_id)
    if item is None:
        raise HTTPException(404, "Item not found")
    item["tags"] = body.tags
    _write_data(data)
    return {"ok": True}


# ---- Trash ----


@app.get("/api/trash")
async def get_trash():
    data = _read_data()
    return data.get("trash", {"tree": [], "notes": {}})


@app.post("/api/trash/restore")
async def trash_restore(req: RestoreReq):
    data = _read_data()
    try:
        restore_from_trash(data, req.id)
    except ValueError:
        raise HTTPException(404, "Item not found in trash")
    _write_data(data)
    return {"ok": True}


@app.post("/api/trash/empty")
async def trash_empty():
    data = _read_data()
    trash = data.get("trash", {})

    # Delete associated images for trashed notes.
    # Web client uses <<IMG:filename>> markers; legacy desktop format used \x00IMG:filename\x00.
    img_re = re.compile(r"<<IMG:([^>\x00]+)>>|\x00IMG:([^\x00]+)\x00")
    for nid, content in trash.get("notes", {}).items():
        if not content:
            continue
        for m in img_re.finditer(content):
            fname = m.group(1) or m.group(2)
            if not fname:
                continue
            img_path = IMAGES_DIR / fname
            if img_path.exists():
                img_path.unlink()

    data["trash"] = {"tree": [], "notes": {}}
    # Also clear trash note_formats if present
    if "note_formats" in data.get("trash", {}):
        del data["trash"]["note_formats"]
    _write_data(data)
    return {"ok": True}


@app.post("/api/trash/delete")
async def trash_delete_item(req: RestoreReq):
    """Permanently delete a single item from trash."""
    data = _read_data()
    trash = data.get("trash", {"tree": [], "notes": {}})
    parent_list = find_parent_list(trash["tree"], req.id)
    if parent_list is None:
        raise HTTPException(404, "Item not found in trash")
    # Find the index of the item in parent_list
    idx = None
    for i, item in enumerate(parent_list):
        if item["id"] == req.id:
            idx = i
            break
    if idx is None:
        raise HTTPException(404, "Item not found in trash")
    item = parent_list.pop(idx)
    # Remove note contents
    note_ids = collect_note_ids(item)
    for nid in note_ids:
        trash.get("notes", {}).pop(nid, None)
    data["trash"] = trash
    _write_data(data)
    return {"ok": True}


# ---- Settings ----


@app.put("/api/settings")
async def update_settings(body: SettingsBody):
    data = _read_data()
    for field in ("theme", "font_family", "font_size", "autosave", "page_orientation"):
        value = getattr(body, field)
        if value is not None:
            data[field] = value
    _write_data(data)
    return {"ok": True}


# ---- Encryption ----


@app.post("/api/encrypt")
async def encrypt_note(req: CryptoReq):
    data = _read_data()
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
    encrypted = encrypt_content(content, req.password)
    data["notes"][req.id] = encrypted
    _write_data(data)
    return {"ok": True}


@app.post("/api/decrypt")
async def decrypt_note(req: CryptoReq):
    data = _read_data()
    content = data.get("notes", {}).get(req.id)
    if content is None:
        raise HTTPException(404, "Note not found")
    try:
        decrypted = decrypt_content(content, req.password)
    except (InvalidToken, Exception):
        raise HTTPException(400, "Wrong password or content is not encrypted")
    data["notes"][req.id] = decrypted
    _write_data(data)
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
    except (InvalidToken, Exception):
        raise HTTPException(400, "Wrong password")
    formats = data.get("note_formats", {}).get(req.id, [])
    return {"content": decrypted, "formats": formats}


@app.post("/api/save-encrypted")
async def save_encrypted(req: SaveEncryptedReq):
    """Save note content by re-encrypting it with the given password."""
    data = _read_data()
    encrypted = encrypt_content(req.content, req.password)
    data.setdefault("notes", {})[req.id] = encrypted
    if req.formats:
        data.setdefault("note_formats", {})[req.id] = req.formats
    _write_data(data)
    return {"ok": True}


# ---- Images ----


@app.post("/api/images/upload")
async def upload_image(file: UploadFile = File(...)):
    ext = Path(file.filename or "img.png").suffix or ".png"
    name = f"{uuid.uuid4()}{ext}"
    dest = IMAGES_DIR / name
    contents = await file.read()
    with _file_lock:
        with open(dest, "wb") as f:
            f.write(contents)
    return {"filename": name, "url": f"/images/{name}"}


@app.get("/images/{filename}")
async def get_image(filename: str):
    path = IMAGES_DIR / filename
    if not path.exists():
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
    formats = data.get("note_formats", {}).get(note_id, [])

    # Build a simple HTML document
    theme = data.get("theme", "matrix")
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
    contents = await file.read()
    buf = io.BytesIO(contents)
    try:
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()
            if "notes_data.json" not in names:
                raise HTTPException(400, "Invalid backup: notes_data.json missing")
            # Extract data file
            raw = zf.read("notes_data.json")
            # Validate JSON
            try:
                json.loads(raw)
            except json.JSONDecodeError:
                raise HTTPException(400, "Invalid backup: corrupt notes_data.json")

            with _file_lock:
                with open(DATA_FILE, "wb") as f:
                    f.write(raw)

            # Extract images
            for name in names:
                if name.startswith("images/") and not name.endswith("/"):
                    img_name = name.split("/", 1)[1]
                    img_path = IMAGES_DIR / img_name
                    with _file_lock:
                        with open(img_path, "wb") as f:
                            f.write(zf.read(name))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Uploaded file is not a valid zip")

    return {"ok": True}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
